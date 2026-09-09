import type { PrismaClient, Prisma } from '@prisma/client';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getDataDir } from '../document/paths';
import { resolveInside } from '../security/files';
import { requireProjectAccess, ApiError } from '../security/access';
import { bindConfigScope, processingFetch, withConfigScope } from '../security/processing';
import { buildMerged } from '../config/store';
import { getAiService } from '../ai/service';
import { createTechnicalPlanStore } from '../technical-plan/store';
import { hashValue } from '../business-bid/sources';
import { sha256 } from '../document/sources';
import { renderLocalDiagram } from './render';
import type { JobUpdate } from '../jobs/service';
import type { AgentService } from '../agent/types';
import { isAgentBusyResult } from '../agent/types';
import { ResourceQueue } from '../resources/queue';
import { usableSnapshot } from '../business-bid/snapshots';

const planning = createRequire(import.meta.url)('./vendor/contentIllustrationPlanning.cjs');
const generation = createRequire(import.meta.url)('./vendor/contentIllustrationGeneration.cjs');
const illustrationQueue = new ResourceQueue('illustration-generation', 1, 12);
const stripLegacyFigures = (text: string) => text.replace(/<!-- yibiao-illustration:[a-z0-9-]+ -->[\s\S]*?<!-- \/yibiao-illustration:[a-z0-9-]+ -->/g, '').trim();
export const stripFigures = (text: string): string => generation.stripGeneratedIllustrationsFromDocument(null, { content: { content: stripLegacyFigures(text) } }).sections.content.content;
export async function saveGeneratedImage(prisma: PrismaClient, projectId: number, buffer: Buffer) {
  const image = await sharp(buffer, { limitInputPixels: 40_000_000 }).png().toBuffer();
  if (image.length > 20 * 1024 * 1024) throw new ApiError(422, '生成图片超过 20 MiB');
  const id = randomUUID(); const relativePath = `${projectId}/workspace/generated-images/${id}.png`;
  const target = resolveInside(getDataDir(), relativePath, false); await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(`${target}.tmp`, image, { mode: 0o600, flag: 'wx' }); await fs.rename(`${target}.tmp`, target);
    return await prisma.documentAsset.create({ data: { id, projectId, kind: 'generated', relativePath, mimeType: 'image/png', size: image.length, sha256: sha256(image) } });
  } catch (error) { await fs.rm(target, { force: true }); throw error; }
}
async function generatedPhoto(config: any, prompt: string): Promise<Buffer> {
  const model = config.image_model;
  if (!model?.api_key || !model?.base_url || !model?.model_name) throw new ApiError(422, '生图服务未配置');
  if (model.provider === 'google-ai-studio') throw new ApiError(422, '此配图路径需要已批准的 OpenAI-compatible 生图服务');
  const response = await processingFetch(`${model.base_url.replace(/\/+$/, '')}/images/generations`, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.api_key}` }, body: JSON.stringify({ model: model.model_name, prompt, size: '1024x1024', response_format: 'b64_json', n: 1 }) });
  if (!response.ok) throw new ApiError(422, `生图服务失败：HTTP ${response.status}`);
  const data = await response.json() as any; const image = data.data?.[0];
  if (image?.b64_json) { if (image.b64_json.length > 28 * 1024 * 1024) throw new ApiError(422, '生图结果过大'); return Buffer.from(image.b64_json, 'base64'); }
  if (image?.url) {
    const downloaded = await processingFetch(image.url, { signal: AbortSignal.timeout(60000) });
    if (!downloaded.ok || Number(downloaded.headers.get('content-length')) > 20 * 1024 * 1024) throw new ApiError(422, '生成图片下载失败或过大');
    const reader = downloaded.body!.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > 20 * 1024 * 1024) throw new ApiError(422, '图片下载过大'); chunks.push(value); } } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  }
  throw new ApiError(422, '生图服务未返回图片');
}
export async function generateIllustrations(prisma: PrismaClient, projectId: number, userId: number, options: Record<string, any>, update: JobUpdate = async () => {}, signal?: AbortSignal, agent?: AgentService) {
  await requireProjectAccess(prisma, userId, projectId);
  for (const reference of await prisma.chapterReference.findMany({ where: { projectId, active: true } })) await usableSnapshot(prisma, reference.snapshotId, projectId, userId);
  const includesSharedData = (await prisma.chapterReference.count({ where: { projectId, active: true } })) > 0 || (await prisma.technicalPlanReferenceDoc.count({ where: { projectId } })) > 0;
  const config = bindConfigScope(await buildMerged(prisma, userId), { kind: 'project', projectId, userId, includesSharedData, requiredModules: includesSharedData ? ['knowledge-base'] : [] });
  return illustrationQueue.run(() => withConfigScope(config, async () => {
    signal?.throwIfAborted();
    const state = await createTechnicalPlanStore(prisma).loadTechnicalPlan(projectId);
    const outlines = (state.outlineData as any)?.outline || [];
    if (!outlines.length) throw new ApiError(400, '请先完成目录与正文');
    const sections: Record<string, any> = {}; const contentById = new Map<string, string>();
    const adapt = (items: any[]): any[] => items.map((item) => {
      const content = stripFigures(item.content || ''); contentById.set(item.id, content);
      sections[item.id] = { status: content && !item.manualLocked ? 'success' : 'idle', content };
      return { ...item, content, content_mode: item.manualLocked ? 'manual' : 'ai-generate', children: item.children?.length ? adapt(item.children) : [] };
    });
    const outlineData = { ...(state.outlineData as any), outline: adapt(outlines) };
    const context = planning.buildIllustrationPlanningContext({ outlineData, sections, options: { ...options, htmlImageTypes: options.htmlImageTypes || '系统架构图,部署图,进度图' }, aiImagesAvailable: Boolean(config.image_model?.api_key) });
    if (!context.eligibleSectionIds.length) return { status: 'skipped', warnings: ['没有可配图的未锁定正文小节'] };
    const inputHash = hashValue({ content: context.files, options });
    let plan = (state as any).contentIllustrationPlan;
    if (plan?.inputHash !== inputHash) {
      const result = await getAiService().requestJson(config, { messages: [{ role: 'system', content: `${planning.buildIllustrationPlanningPrompt()}\nWeb 环境下直接返回 illustration-plan.json 的 JSON 内容，不调用文件工具。` }, { role: 'user', content: context.files.map((file: any) => `${file.path}\n${file.content}`).join('\n\n') }], response_format: { type: 'json_object' } });
      plan = { ...planning.resolveIllustrationPlan(JSON.stringify(result), context).plan, inputHash };
    }
    if (plan.items.length > 60) throw new ApiError(422, '本次配图超过 60 张，请降低配图数量');
    const persist = () => prisma.technicalPlanMeta.update({ where: { projectId }, data: { contentIllustrationPlanJson: plan as Prisma.InputJsonValue } });
    await persist(); const warnings: string[] = []; let completed = 0;
    const ai = getAiService();
    const adapter = {
      chat: (request: any) => { signal?.throwIfAborted(); return ai.chat(config, request); },
      collectJsonResponse: (request: any) => { signal?.throwIfAborted(); return ai.collectJsonResponse(config, request); },
    };
    for (const item of plan.items) {
      signal?.throwIfAborted();
      if (item.generation?.status === 'success') { completed++; continue; }
      await update('running', Math.round(10 + completed / Math.max(1, plan.items.length) * 85));
      try {
        const execution = { planItem: item, reference: item.section_ids.map((id: string) => contentById.get(id) || '').join('\n\n') };
        let buffer: Buffer | undefined; let result: any;
        if (item.kind === 'ai') {
          buffer = await generatedPhoto(config, `${generation.buildAiImagePrompt(execution)}\n图片仅为方案示意，不生成证照、签名、合同或证明资料。`);
          result = { attempts: 1, visual_qa: { status: 'needs-manual-review', reason: '生图是方案示意，须核对正文事实' } };
        } else if (item.kind === 'mermaid') {
          result = await generation.generateMermaidIllustration(adapter, execution, () => Boolean(signal?.aborted));
          buffer = await renderLocalDiagram('mermaid', result.code, 1240, 1800);
        } else if (item.kind === 'html') {
          const sourceRelativePath = `${projectId}/workspace/illustrations/${plan.revision}/${item.item_id}.html`;
          const sourceFile = resolveInside(getDataDir(), sourceRelativePath, false);
          result = await generation.generateHtmlIllustration({ aiService: adapter, execution, plan,
            workspaceStore: {
              readIllustrationHtml: (relative: string) => relative === sourceRelativePath && fsSync.existsSync(sourceFile) ? fsSync.readFileSync(sourceFile, 'utf8') : '',
              findIllustrationHtml: () => fsSync.existsSync(sourceFile) ? { relativePath: sourceRelativePath, content: fsSync.readFileSync(sourceFile, 'utf8') } : null,
              saveIllustrationHtml: ({ content }: { content: string }) => { fsSync.mkdirSync(path.dirname(sourceFile), { recursive: true }); fsSync.writeFileSync(`${sourceFile}.tmp`, content, { mode: 0o600 }); fsSync.renameSync(`${sourceFile}.tmp`, sourceFile); return { relativePath: sourceRelativePath }; },
              saveIllustrationPng: ({ buffer: rendered }: { buffer: Buffer }) => { buffer = rendered; return { assetUrl: 'pending-publication' }; },
            },
            runAgentHtml: async (request: any) => {
              if (!agent?.getStatus().available) throw new ApiError(503, '长章节 HTML 配图需要可用智能体；正文与图源保留');
              const response = await agent.runTask({ project_id: projectId, title: request.title, prompt: request.prompt, files: request.files, output_file: request.outputFile, validateOutput: request.validateOutput, signal });
              if (isAgentBusyResult(response)) throw new ApiError(409, '智能体忙，请稍后重试此图');
              return response.output_content;
            },
            isPauseRequested: () => Boolean(signal?.aborted), createPauseError: () => new Error('配图已取消，图源和正文保留'),
          });
        } else throw new ApiError(422, '配图类型无效');
        signal?.throwIfAborted();
        if (!buffer) throw new ApiError(422, '配图未产生图片');
        const asset = await saveGeneratedImage(prisma, projectId, buffer);
        item.generation = { ...result, status: 'success', asset_id: asset.id, asset_url: `yibiao-asset://${asset.id}`, image_url: `yibiao-asset://${asset.id}` };
      } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : '配图失败';
        item.generation = { ...item.generation, status: 'error', error: message }; warnings.push(`${item.title}：${message}`);
      }
      completed++; await persist();
    }
    // Rebuild all successful figures together. Retrying after a crash is idempotent
    // and several figures in one section cannot overwrite each other.
    const composed = generation.applyGeneratedIllustrationsToDocument(plan, outlineData, sections);
    for (const [nodeId, section] of Object.entries(composed.sections) as [string, any][]) {
      if (!section.content || section.content === sections[nodeId]?.content) continue;
      const node = await prisma.technicalPlanOutlineNode.findUnique({ where: { projectId_nodeId: { projectId, nodeId } } });
      if (!node || node.manualLocked || stripFigures(node.content) !== contentById.get(nodeId)) { warnings.push(`章节 ${nodeId} 已被人工修改，配图未写入`); continue; }
      const saved = await prisma.technicalPlanOutlineNode.updateMany({ where: { projectId, nodeId, content: node.content, manualLocked: false }, data: { content: section.content, updatedAt: new Date().toISOString() } });
      if (!saved.count) warnings.push(`章节 ${nodeId} 同时被编辑，配图未写入`);
    }
    return { status: warnings.length ? 'degraded' : 'success', warnings, plan };
  }), () => { void update('queued', 0).catch(() => undefined); });
}
