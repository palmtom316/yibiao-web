import { parseWithMineru } from './mineru';
import { buildMerged } from '../config/store';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedProcess } from '../security/subprocess';
import { randomUUID, createHash } from 'node:crypto';
import type { PrismaClient, DocumentSource } from '@prisma/client';
import { getDataDir } from './paths';
import { resolveInside, readBoundedFile } from '../security/files';
import { requireKnowledgeAccess, requireProjectAccess, ApiError } from '../security/access';
import { parseQueue } from '../resources/queue';
import type { ParsedImport } from './parser';
import { isLocallySupported } from './parser';

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export type SourceDomain = { projectId: number; knowledgeDocumentId?: never } | { knowledgeDocumentId: string; projectId?: never };

export async function checkSourceAccess(prisma: PrismaClient, userId: number, source: { projectId: number | null; knowledgeDocumentId: string | null }) {
  if (source.projectId) await requireProjectAccess(prisma, userId, source.projectId);
  else if (source.knowledgeDocumentId) await requireKnowledgeAccess(prisma, userId);
  else throw new ApiError(403, '原件缺少有效归属');
}
export function sourceDto(source: DocumentSource) {
  return { sourceId: source.id, fileName: source.originalName, mimeType: source.mimeType, size: source.size, sourceHash: source.sha256,
    parseVersion: source.currentParseVersion, status: source.status, sourceUnavailable: source.status !== 'ready', originalUrl: `/api/document-sources/${source.id}/original` };
}
export function sourceBase(domain: SourceDomain) {
  return domain.projectId ? `${domain.projectId}/workspace/documents` : `shared/document-sources/${domain.knowledgeDocumentId}`;
}
export async function persistSource(prisma: PrismaClient, domain: SourceDomain, userId: number, fileName: string, mimeType: string, buffer: Buffer) {
  await checkSourceAccess(prisma, userId, { projectId: domain.projectId || null, knowledgeDocumentId: domain.knowledgeDocumentId || null });
  const originalName = path.basename(fileName.replaceAll('\\', '/'));
  if (!isLocallySupported(originalName) || !buffer.length || buffer.length > 100 * 1024 * 1024) throw new ApiError(422, '原件为空、格式不支持或超过 100 MiB');
  const id = randomUUID(); const relativePath = `${sourceBase(domain)}/${id}/original${path.extname(originalName).toLowerCase()}`;
  const source = await prisma.documentSource.create({ data: { id, ...domain, originalName, mimeType, size: buffer.length, sha256: sha256(buffer), relativePath, createdByUserId: userId, status: 'staging' } });
  try {
    const target = resolveInside(getDataDir(), relativePath, false);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(`${target}.tmp`, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(`${target}.tmp`, target);
    return await prisma.documentSource.update({ where: { id }, data: { status: 'ready' } });
  } catch (error) {
    await prisma.documentSource.update({ where: { id }, data: { status: 'error' } });
    throw error;
  }
}

export async function parseSource(prisma: PrismaClient, sourceId: string, userId: number, progress: (status: string, value: number) => Promise<void> = async () => {}, signal?: AbortSignal) : Promise<ParsedImport> {
  return parseQueue.run(async () => {
    signal?.throwIfAborted();
    const source = await prisma.documentSource.findUniqueOrThrow({ where: { id: sourceId } });
    await checkSourceAccess(prisma, userId, source);
    await progress('running', 10);
    const bytes = readBoundedFile(getDataDir(), source.relativePath, 100 * 1024 * 1024);
    if (sha256(bytes) !== source.sha256) throw new ApiError(409, '原件校验失败，请重新上传');
    const max = await prisma.documentParseVersion.aggregate({ where: { sourceId }, _max: { version: true } });
    const version = (max._max.version || 0) + 1;
    const config = await buildMerged(prisma, userId);
    const provider = String(config.file_parser?.provider || 'local');
    const parse = await prisma.documentParseVersion.create({ data: { sourceId, version, parser: provider, parserVersion: 'web-1', sourceHash: source.sha256 } });
    const root = path.dirname(source.relativePath);
    const published = `${root}/versions/${version}`;
    const staging = resolveInside(getDataDir(), `${root}/.staging-${parse.id}`, false);
    await fs.mkdir(staging, { recursive: true });
    let didPublish = false;
    try {
      const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'SystemRoot'].filter((key) => process.env[key]).map((key) => [key, process.env[key]!])) as NodeJS.ProcessEnv;
      const localResult = async () => {
      let output: string;
      try {
        ({ stdout: output } = await runBoundedProcess(process.execPath, ['--max-old-space-size=768', fileURLToPath(new URL('./parse-worker.mjs', import.meta.url)), resolveInside(getDataDir(), source.relativePath), staging], { env, timeoutMs: 180_000, maxBuffer: 12 * 1024 * 1024, signal }));
      } catch (error) {
        const e = error as { stdout?: string; killed?: boolean };
        let message = signal?.aborted ? '解析已取消，原件保留' : e.killed ? '解析超时，请拆分文件后重试' : '本地解析失败，原件已保留';
        try { message = JSON.parse((e.stdout || '{}').split('YIBIAO_RESULT=').at(-1)!).error || message; } catch { /* bounded error only */ }
        throw new ApiError(422, message);
      }
      return JSON.parse(output.split('YIBIAO_RESULT=').at(-1)!);
      };
      let result: any;
      let fallback = provider === 'local';
      if (provider !== 'local') {
        try { result = await parseWithMineru({ fileName: source.originalName, bytes, output: staging, provider, token: config.file_parser?.mineru_token, baseUrl: config.file_parser?.mineru_base_url, signal }); }
        catch (error) {
          signal?.throwIfAborted();
          const reason = error instanceof Error ? error.message : 'OCR 服务失败';
          try { result = await localResult(); fallback = true; result.warnings.unshift(`${reason}；已回落本地文字解析，请核对质量`); }
          catch { throw new ApiError(422, `${reason}；本地无有效文字，需 OCR 或人工处理`); }
        }
      } else result = await localResult();
      if (result.error) throw new ApiError(422, result.error);
      const hash = sha256(result.markdown); const chars = result.markdown.replace(/\s/g, '').length;
      await fs.writeFile(path.join(staging, 'content.md'), result.markdown, { mode: 0o600 });
      await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ sourceId, version, sourceHash: source.sha256, markdownHash: hash, assets: result.assets, warnings: result.warnings }), { mode: 0o600 });
      const target = resolveInside(getDataDir(), published, false);
      await fs.mkdir(path.dirname(target), { recursive: true });
      signal?.throwIfAborted();
      await fs.rename(staging, target); didPublish = true;
      await progress('running', 90);
      await prisma.$transaction(async (tx) => {
        await tx.documentAsset.createMany({ data: result.assets.map((asset: any) => ({ id: asset.id, projectId: source.projectId, knowledgeDocumentId: source.knowledgeDocumentId, parseId: parse.id, mimeType: asset.mimeType, size: asset.size, sha256: asset.sha256, relativePath: `${published}/${asset.fileName}` })) });
        await tx.documentParseVersion.update({ where: { id: parse.id }, data: { status: 'success', warnings: result.warnings, markdownHash: hash, markdownPath: `${published}/content.md`, chars } });
        await tx.documentSource.update({ where: { id: sourceId }, data: { currentParseVersion: version, status: 'ready' } });
      });
      return { fileName: source.originalName, markdown: result.markdown, parserLabel: fallback ? '本地解析（保留图片）' : 'MinerU OCR', chars, hash, fallbackToLocal: fallback,
        sourceId, sourceHash: source.sha256, parseVersion: version, sourceUnavailable: false, warnings: result.warnings, assets: result.assets.map((a: any) => ({ assetId: a.id, sha256: a.sha256, mimeType: a.mimeType, size: a.size })) };
    } catch (error) {
      await prisma.documentParseVersion.update({ where: { id: parse.id }, data: { status: 'error', warnings: [error instanceof Error ? error.message : '解析失败'] } });
      if (didPublish) await fs.rm(resolveInside(getDataDir(), published), { recursive: true, force: true });
      throw error;
    } finally { await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined); }
  }, () => { void progress('queued', 0).catch(() => undefined); });
}

export async function loadAuthorizedAsset(prisma: PrismaClient, userId: number, assetId: string, projectId?: number) {
  const asset = await prisma.documentAsset.findUnique({ where: { id: assetId }, include: { parse: true } });
  if (!asset || (asset.parse && asset.parse.status !== 'success')) throw new ApiError(404, '图片不存在或尚未发布');
  await checkSourceAccess(prisma, userId, asset);
  if (asset.referenceSnapshotId) {
    const { usableSnapshot } = await import('../business-bid/snapshots');
    await usableSnapshot(prisma, asset.referenceSnapshotId, asset.projectId!, userId);
  }
  if (projectId && asset.projectId && asset.projectId !== projectId) throw new ApiError(403, '图片不属于当前项目');
  const buffer = readBoundedFile(getDataDir(), asset.relativePath);
  if (sha256(buffer) !== asset.sha256) throw new ApiError(409, '图片校验失败');
  return { asset, buffer };
}
