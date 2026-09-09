import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getProjectId, getUserId } from '../auth/middleware';
import { createRequireModule } from '../auth/permissions';
import type { JobService } from '../jobs/service';
import { createBusinessStore } from '../business-bid/store';
import { createBusinessPackage, packageFile } from '../business-bid/export';
import { snapshotHistory, usableSnapshot, type SnapshotFile } from '../business-bid/snapshots';
import { attachChapterReferences } from '../business-bid/technical';
import { createWorkspacePaths } from '../document/paths';
import { resolveInside } from '../security/files';
import { ApiError } from '../security/access';
import { exportQueue } from '../resources/queue';
import { getAiService } from '../ai/service';

export async function businessBidRoutes(app: FastifyInstance) {
  const { prisma, jobs } = app as unknown as { prisma: PrismaClient; jobs: JobService };
  const store = createBusinessStore(prisma);
  app.addHook('onRequest', createRequireModule(prisma, 'knowledge-base'));
  jobs.register('business-extract', (job) => store.extract(job, getAiService()));
  jobs.register('business-confirm', (job, update) => exportQueue.run(() => { const input = job.input as any; return store.confirm(job.projectId!, job.userId, input.requirementId, input); }, () => { void update('queued', 0).catch(() => undefined); }));
  jobs.register('business-revision', (job) => store.createRevision(job.projectId!, job.userId, job.id));
  jobs.register('business-package', (job, update, signal) => { const input = job.input as any; return createBusinessPackage(prisma, job.projectId!, job.userId, input.revisionId, input.draft === true, update, signal); });
  app.get('/business-bid', (req) => store.workspace(getProjectId(req), getUserId(req)));
  app.put('/business-bid/deadline', (req) => store.setDeadline(getProjectId(req), getUserId(req), (req.body as any)?.bidDeadline));
  app.post('/business-bid/requirements', (req) => store.createRequirement(getProjectId(req), getUserId(req), (req.body || {}) as any));
  app.put('/business-bid/requirements/:id', (req) => store.updateRequirement(getProjectId(req), getUserId(req), (req.params as { id: string }).id, (req.body || {}) as any));
  app.delete('/business-bid/requirements/:id', (req) => store.archiveRequirement(getProjectId(req), getUserId(req), (req.params as { id: string }).id, (req.query as any).version));
  app.get('/business-bid/requirements/:id/candidates', (req) => store.candidates(getProjectId(req), getUserId(req), (req.params as { id: string }).id, (req.query as any).q || ''));
  app.post('/business-bid/requirements/:id/confirm', async (req, reply) => reply.code(202).send(await jobs.start({ kind: 'business-confirm', projectId: getProjectId(req), userId: getUserId(req), input: { ...(req.body as any), requirementId: (req.params as { id: string }).id }, requestKey: (req.body as any)?.requestKey })));
  app.post('/business-bid/extract', async (req, reply) => reply.code(202).send(await jobs.start({ kind: 'business-extract', projectId: getProjectId(req), userId: getUserId(req), input: {}, requestKey: (req.body as any)?.requestKey || randomUUID() })));
  app.post('/business-bid/revisions', async (req, reply) => reply.code(202).send(await jobs.start({ kind: 'business-revision', projectId: getProjectId(req), userId: getUserId(req), input: {}, requestKey: (req.body as any)?.requestKey || randomUUID() })));
  app.post('/business-bid/revisions/:id/export', async (req, reply) => reply.code(202).send(await jobs.start({ kind: 'business-package', projectId: getProjectId(req), userId: getUserId(req), input: { revisionId: (req.params as { id: string }).id, draft: (req.body as any)?.draft === true }, requestKey: (req.body as any)?.requestKey || randomUUID() })));
  app.get('/business-bid/packages/:id/download', async (req, reply) => {
    const word = (req.query as any).format === 'word'; const result = await packageFile(prisma, getProjectId(req), getUserId(req), (req.params as { id: string }).id, word);
    return reply.type(word ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/zip').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`).send(fs.createReadStream(result.file));
  });
  app.get('/business-bid/snapshots', async (req) => ({ items: await snapshotHistory(prisma, getProjectId(req), getUserId(req)) }));
  app.get('/business-bid/snapshots/:id/files/:fileId', async (req, reply) => {
    const { id, fileId } = req.params as { id: string; fileId: string };
    const snapshot = await usableSnapshot(prisma, id, getProjectId(req), getUserId(req), true);
    const file = (snapshot.files as unknown as SnapshotFile[]).find((item) => item.id === fileId); if (!file) throw new ApiError(404, '附件不存在');
    return reply.type(file.mimeType).header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`).send(fs.createReadStream(resolveInside(createWorkspacePaths(getProjectId(req)).workspaceDir, file.relativePath)));
  });
  app.get('/business-bid/chapters', async (req) => {
    const nodes = await prisma.technicalPlanOutlineNode.findMany({ where: { projectId: getProjectId(req) }, select: { nodeId: true, parentNodeId: true, title: true, sortOrder: true, manualLocked: true }, orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }] });
    const parents = new Set(nodes.map((node) => node.parentNodeId)); return { items: nodes.filter((node) => !parents.has(node.nodeId)) };
  });
  app.post('/business-bid/chapters/:id/references', (req) => attachChapterReferences(prisma, getProjectId(req), getUserId(req), (req.params as { id: string }).id, (req.body as any)?.snapshotIds));
}
