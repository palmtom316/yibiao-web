import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { getDataDir, createWorkspacePaths } from '../document/paths';
import { resolveInside, readBoundedFile } from '../security/files';
import { requireProjectAccess, ApiError } from '../security/access';
import { hashFile } from '../business-bid/snapshots';
import { parseQueue } from '../resources/queue';

export const helperPath = () => process.env.YIBIAO_OPENXML_HELPER || '/opt/yibiao/openxmlhelper/openxmlhelper';
export async function runOpenXmlJob(workspace: string, request: Record<string, unknown>, timeoutMs = 30000) {
  const job = randomUUID();
  const directory = resolveInside(workspace, `openxml-jobs/${job}`, false); await fs.mkdir(directory, { recursive: true });
  if (!['list-blocks', 'extract-chapters', 'scan-template-fields', 'apply-template-fields'].includes(String(request.action))) throw new ApiError(400, '不支持的模板操作');
  for (const source of (request.sources || []) as string[]) resolveInside(workspace, source);
  if (request.output) resolveInside(workspace, String(request.output), false);
  if (request.input) resolveInside(workspace, String(request.input));
  if (request.fields_output) resolveInside(workspace, String(request.fields_output), false);
  await fs.writeFile(path.join(directory, 'request.json'), JSON.stringify(request), { mode: 0o600 });
  const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'].filter((key) => process.env[key]).map((key) => [key, process.env[key]!])) as Record<string, string>;
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(helperPath(), ['--workspace', workspace], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new ApiError(504, '模板工具执行超时')); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 1000) stderr += chunk; });
    child.once('error', () => { clearTimeout(timer); reject(new ApiError(503, '模板抽取工具未安装或不可启动')); });
    child.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new ApiError(422, '模板抽取工具运行失败')); else resolve(stdout); });
    child.stdin.end(`${JSON.stringify({ v: 1, type: 'run', job })}\n`);
  });
  const signal = output.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((line) => line?.v === 1 && line?.type === 'done' && line?.job === job);
  const result = JSON.parse(readBoundedFile(workspace, `openxml-jobs/${job}/result.json`, 1024 * 1024).toString('utf8'));
  if (!signal?.ok || !result.ok) throw Object.assign(new ApiError(422, '未能从该 Word 抽取模板，仍可生成普通目录'), { internalDetails: result });
  if (request.action === 'list-blocks') return JSON.parse(readBoundedFile(workspace, `openxml-jobs/${job}/blocks.json`, 10 * 1024 * 1024).toString('utf8'));
  if (request.action === 'scan-template-fields') return JSON.parse(readBoundedFile(workspace, `openxml-jobs/${job}/template-field-candidates.json`, 10 * 1024 * 1024).toString('utf8'));
  return result;
}
export async function extractTemplate(prisma: PrismaClient, projectId: number, userId: number, sourceId: string, selectedTitles?: string[]) {
  await requireProjectAccess(prisma, userId, projectId);
  const source = await prisma.documentSource.findFirst({ where: { id: sourceId, projectId } });
  if (!source) throw new ApiError(404, '原件不存在；旧版仅 Markdown 记录需重新上传');
  if (!['.docx', '.doc', '.wps'].includes(path.extname(source.originalName).toLowerCase())) return { status: 'unavailable', message: 'PDF 或纯文本原件使用普通目录，未抽取 Word 模板' };
  const artifactId = randomUUID(); const relativeRoot = `openxml/${artifactId}`; const workspaceRoot = createWorkspacePaths(projectId).workspaceDir;
  const workspace = resolveInside(workspaceRoot, relativeRoot, false);
  return parseQueue.run(async () => {
    await fs.mkdir(path.join(workspace, 'sources'), { recursive: true });
    const ext = path.extname(source.originalName).toLowerCase();
    const original = resolveInside(getDataDir(), source.relativePath);
    if (await hashFile(original) !== source.sha256) throw new ApiError(409, '原件校验失败');
    await fs.copyFile(original, path.join(workspace, `sources/source${ext}`));
    try {
      if (ext !== '.docx') {
        const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
        await promisify(execFile)('libreoffice', ['--headless', `-env:UserInstallation=file://${workspace}/office-profile`, '--convert-to', 'docx', '--outdir', path.join(workspace, 'sources'), path.join(workspace, `sources/source${ext}`)], { timeout: 60000, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', XDG_CACHE_HOME: '/tmp/yibiao-cache' } });
      }
      const sources = ['sources/source.docx'];
      const listed = await runOpenXmlJob(workspace, { action: 'list-blocks', sources });
      const blocks = listed.sources?.[0]?.blocks || [];
      let headings = blocks.filter((block: any) => block.heading && block.text && (selectedTitles?.length ? selectedTitles.includes(block.text) : /技术|方案|投标文件格式|响应文件格式/.test(block.text)));
      if (!headings.length) throw new ApiError(422, '没有可可靠定位的方案或文件格式标题，未抽取模板');
      headings = headings.slice(0, 30);
      const chapters = headings.map((block: any, index: number) => ({ id: `template-${index + 1}`, title: block.text, source: sources[0], startBlock: block.index,
        endBlock: (blocks.find((other: any) => other.index > block.index && other.heading && other.outline_level <= block.outline_level)?.index ?? blocks.length) - 1 }));
      await runOpenXmlJob(workspace, { action: 'extract-chapters', sources, chapters, output: 'output/template.docx' });
      const scanned = await runOpenXmlJob(workspace, { action: 'scan-template-fields', input: 'output/template.docx' });
      const candidates = scanned.candidates || [];
      if (candidates.length > 2000) throw new ApiError(422, '模板待填位置过多，请按章节拆分原件');
      const relativePath = `${relativeRoot}/output/template.docx`; const file = resolveInside(workspaceRoot, relativePath);
      const result = { status: 'success', artifactId, version: 1, fieldStatus: 'pending', candidateCount: candidates.length, sourceId, sourceHash: source.sha256, sha256: await hashFile(file), chapters: chapters.map((chapter: any) => ({ title: chapter.title, sourceId, startBlock: chapter.startBlock, endBlock: chapter.endBlock })), message: `Word 模板已抽取，${candidates.length} 处待填候选需要确认` };
      await fs.writeFile(path.join(workspace, 'manifest.json'), JSON.stringify({ ...result, relativePath, candidates }), { mode: 0o600 });
      await prisma.technicalPlanMeta.update({ where: { projectId }, data: { templateExtractionJson: result } });
      return result;
    } catch (error) {
      const result = { status: 'unavailable', artifactId, sourceId, message: error instanceof ApiError ? error.message : '模板工具不可用，继续使用普通目录' };
      await prisma.technicalPlanMeta.update({ where: { projectId }, data: { templateExtractionJson: result } });
      return result;
    }
  });
}
export async function templateForOutline(prisma: PrismaClient, projectId: number, userId: number) {
  const meta = await prisma.technicalPlanMeta.findUnique({ where: { projectId } });
  const files = (meta?.tenderFilesJson || []) as any[];
  const sourceId = meta?.workflowKind === 'existing-plan-expansion' ? meta.originalPlanSourceId : files[0]?.sourceId;
  const unavailable = async (message: string) => {
    const result = { status: 'unavailable', message };
    await prisma.technicalPlanMeta.update({ where: { projectId }, data: { templateExtractionJson: result } });
    return result;
  };
  if (!sourceId) return unavailable('无 Word 原件，未抽取模板');
  try { await fs.access(helperPath()); } catch { return unavailable('模板工具未安装，未抽取模板；目录仍可生成'); }
  const previous = meta?.templateExtractionJson as any;
  if (previous?.status === 'success' && previous.sourceId === sourceId) return previous;
  return extractTemplate(prisma, projectId, userId, sourceId);
}
