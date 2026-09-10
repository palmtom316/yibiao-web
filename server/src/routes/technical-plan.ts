import { extractTemplate } from '../openxml/service';
import { applyTemplateFields, getTemplateFields, suggestTemplateFields, type TemplateSelection } from '../openxml/fields';
import { readBoundedFile, resolveInside } from '../security/files';
import { createWorkspacePaths } from '../document/paths';
import fs from 'node:fs';
import { generateIllustrations, saveGeneratedImage } from '../illustrations/service';
import { renderingEnabled, renderLocalDiagram } from '../illustrations/render';
import { getUserId } from '../auth/middleware';
import { startImport, registerImportJob } from '../document/imports';
import type { JobService } from '../jobs/service';
// 技术方案状态命名空间路由（受保护，按 projectId 隔离）。
// RPC 风格 POST：每条写路由返回完整 TechnicalPlanState（select-bid-section/clear 多一层 envelope）。
// 移植自 client/electron/ipc/technicalPlanIpc.cjs 的 1:1 透传契约。
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getProjectId } from '../auth/middleware';
import { createTechnicalPlanStore } from '../technical-plan/store';

export async function technicalPlanRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  const prisma = (app as unknown as { prisma: PrismaClient }).prisma;
  const store = createTechnicalPlanStore(prisma);
  const jobs = (app as unknown as { jobs: JobService }).jobs;
  jobs.register('template-extract', (job) => extractTemplate(prisma, job.projectId!, job.userId, (job.input as any).sourceId));
  app.post('/technical-plan/extract-template', async (req, reply) => reply.code(202).send(await jobs.start({ kind: 'template-extract', projectId: getProjectId(req), userId: getUserId(req), input: (req.body || {}) as any })));
  jobs.register('template-field-suggestions', (job) => suggestTemplateFields(prisma, job.projectId!, job.userId, (job.input as any).artifactId));
  jobs.register('template-field-apply', (job) => { const input = job.input as any; return applyTemplateFields(prisma, job.projectId!, job.userId, input.artifactId, input.version, input.selection as TemplateSelection); });
  app.get('/technical-plan/templates/:id/fields', (req) => getTemplateFields(prisma, getProjectId(req), getUserId(req), (req.params as { id: string }).id));
  for (const [action, kind] of [['suggest', 'template-field-suggestions'], ['apply', 'template-field-apply']]) {
    app.post(`/technical-plan/templates/:id/fields/${action}`, async (req, reply) => reply.code(202).send(await jobs.start({ kind: kind!, projectId: getProjectId(req), userId: getUserId(req), input: { ...(req.body as any), artifactId: (req.params as { id: string }).id } })));
  }
  app.get('/technical-plan/templates/:id/download', async (req, reply) => {
    const root = createWorkspacePaths(getProjectId(req)).workspaceDir;
    const id = (req.params as { id: string }).id;
    const manifest = JSON.parse(readBoundedFile(root, `openxml/${id}/manifest.json`).toString());
    return reply.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').header('Content-Disposition', "attachment; filename*=UTF-8''template.docx").send(fs.createReadStream(resolveInside(root, manifest.relativePath)));
  });
  jobs.register('manual-illustration', async (job) => {
    const input = job.input as { nodeId: string; kind: 'html' | 'mermaid'; code: string };
    if (!['html', 'mermaid'].includes(input.kind)) throw new Error('图表类型无效');
    const node = await prisma.technicalPlanOutlineNode.findUniqueOrThrow({ where: { projectId_nodeId: { projectId: job.projectId!, nodeId: input.nodeId } } });
    const image = await saveGeneratedImage(prisma, job.projectId!, await renderLocalDiagram(input.kind, input.code));
    await store.saveChapterContent(job.projectId!, { nodeId: input.nodeId, content: `${node.content}\n\n![本地图表](yibiao-asset://${image.id})`, expectedContent: node.content });
    return { success: true, assetId: image.id };
  });
  app.post('/technical-plan/illustrations/render', async (req, reply) => reply.code(202).send(await jobs.start({ kind: 'manual-illustration', projectId: getProjectId(req), userId: getUserId(req), input: (req.body || {}) as any })));
  jobs.register('illustrations', (job, update, signal) => generateIllustrations(prisma, job.projectId!, job.userId, job.input as Record<string, any>, update, signal, (app as any).agentService));
  app.get('/technical-plan/illustrations/status', async () => ({ localRender: renderingEnabled() }));
  app.post('/technical-plan/illustrations', async (req, reply) => reply.code(202).send(await jobs.start({ kind: 'illustrations', projectId: getProjectId(req), userId: getUserId(req), input: (req.body || {}) as any })));
  registerImportJob(jobs, 'import-tender', (projectId, docs) => store.importTenderDocument(projectId, docs));
  registerImportJob(jobs, 'import-original-plan', (projectId, docs) => store.importOriginalPlanDocument(projectId, docs));

  const bodyOf = (req: FastifyRequest) => (req as FastifyRequest & { body: unknown }).body as Record<string, unknown> | undefined;

  app.get('/technical-plan/state', async (req) => store.loadTechnicalPlan(getProjectId(req)));

  app.post('/technical-plan/step', async (req) => store.updateStep(getProjectId(req), bodyOf(req)?.step));

  app.post('/technical-plan/workflow-kind', async (req) => store.setWorkflowKind(getProjectId(req), bodyOf(req)?.workflowKind));

  app.post('/technical-plan/switch-workflow-kind', async (req) => store.switchWorkflowKind(getProjectId(req), bodyOf(req)?.workflowKind));

  app.post('/technical-plan/bid-analysis-config', async (req) =>
    store.saveBidAnalysisConfig(
      getProjectId(req),
      bodyOf(req) as { mode?: unknown; selectedTaskIds?: unknown; bidSectionMode?: unknown },
    ),
  );

  app.post('/technical-plan/outline-config', async (req) =>
    store.saveOutlineConfig(
      getProjectId(req),
      bodyOf(req) as { referenceKnowledgeDocumentIds?: unknown; outlineExpansionMode?: unknown; mirrorProcurementEnabled?: unknown; outlineWordControlOptions?: unknown },
    ),
  );

  app.post('/technical-plan/outline', async (req) =>
    store.saveOutline(
      getProjectId(req),
      bodyOf(req) as { outlineData?: unknown; reason?: string; idMap?: Record<string, string>; affectedNodeIds?: string[] },
    ),
  );

  app.post('/technical-plan/global-facts', async (req) => store.saveGlobalFacts(getProjectId(req), bodyOf(req)?.globalFacts));

  app.post('/technical-plan/content-generation-options', async (req) =>
    store.saveContentGenerationOptions(getProjectId(req), bodyOf(req)?.options),
  );

  app.post('/technical-plan/chapter-content', async (req) =>
    store.saveChapterContent(getProjectId(req), bodyOf(req) as { nodeId?: string; content?: unknown }),
  );

  app.post('/technical-plan/select-bid-section', async (req) =>
    store.selectBidSection(getProjectId(req), bodyOf(req)?.selectedSection as { id?: string; title?: string }),
  );

  app.post('/technical-plan/clear', async (req) => store.clear(getProjectId(req)));

  // 文件导入（multipart）：bridge 侧 pickFiles → FormData 上传，route 解析后交 store 落盘+写库。
  app.post('/technical-plan/import-tender-document', async (req, reply) => reply.code(202).send(await startImport(req, 'import-tender')));
  app.post('/technical-plan/import-original-plan-document', async (req, reply) => reply.code(202).send(await startImport(req, 'import-original-plan')));

  app.get('/technical-plan/tender-markdown', async (req) => store.readTenderMarkdown(getProjectId(req)));
  app.get('/technical-plan/tender-source-markdown/:sourceId', async (req) =>
    store.readTenderSourceMarkdown(getProjectId(req), (req.params as { sourceId: string }).sourceId),
  );
  app.get('/technical-plan/original-plan-markdown', async (req) => store.readOriginalPlanMarkdown(getProjectId(req)));
  app.get('/technical-plan/bid-sections', async (req) => store.checkBidSections(getProjectId(req)));
}
