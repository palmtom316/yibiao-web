import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getUserId } from '../auth/middleware';
import { requireProjectAccess, ApiError } from '../security/access';
import { checkSourceAccess, sourceDto, parseSource, loadAuthorizedAsset, sha256 } from '../document/sources';
import { getDataDir } from '../document/paths';
import { resolveInside, readBoundedFile } from '../security/files';
import type { JobService } from '../jobs/service';

export async function documentSourceRoutes(app: FastifyInstance) {
  const { prisma, jobs } = app as unknown as { prisma: PrismaClient; jobs: JobService };
  jobs.register('parse-source', (job, update, signal) => parseSource(prisma, (job.input as { sourceId: string }).sourceId, job.userId, update, signal));
  app.get('/document-sources', async (req) => {
    const projectId = Number(req.headers['x-project-id']);
    if (!Number.isSafeInteger(projectId)) throw new ApiError(400, '请先选择项目');
    await requireProjectAccess(prisma, getUserId(req), projectId);
    return { items: (await prisma.documentSource.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } })).map(sourceDto) };
  });
  app.get('/document-sources/:id', async (req) => {
    const source = await prisma.documentSource.findUniqueOrThrow({ where: { id: (req.params as { id: string }).id }, include: { parses: { orderBy: { version: 'desc' }, include: { assets: { select: { id: true, mimeType: true, sha256: true, size: true, page: true, block: true } } } } } });
    await checkSourceAccess(prisma, getUserId(req), source);
    return { ...sourceDto(source), versions: source.parses.map(({ markdownPath, ...parse }) => ({ ...parse, markdownAvailable: Boolean(markdownPath) })) };
  });
  app.get('/document-sources/:id/original', async (req, reply) => {
    const source = await prisma.documentSource.findUniqueOrThrow({ where: { id: (req.params as { id: string }).id } });
    await checkSourceAccess(prisma, getUserId(req), source);
    const bytes = readBoundedFile(getDataDir(), source.relativePath, 100 * 1024 * 1024);
    if (sha256(bytes) !== source.sha256) throw new ApiError(409, '原件校验失败');
    return reply.type(source.mimeType).header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(source.originalName)}`).send(fs.createReadStream(resolveInside(getDataDir(), source.relativePath)));
  });
  app.post('/document-sources/:id/reparse', async (req, reply) => {
    const source = await prisma.documentSource.findUniqueOrThrow({ where: { id: (req.params as { id: string }).id } });
    await checkSourceAccess(prisma, getUserId(req), source);
    return reply.code(202).send(await jobs.start({ kind: 'parse-source', userId: getUserId(req), projectId: source.projectId || undefined, knowledgeDocumentId: source.knowledgeDocumentId || undefined, input: { sourceId: source.id } }));
  });
  app.get('/files/assets/:id', async (req, reply) => {
    const { asset, buffer } = await loadAuthorizedAsset(prisma, getUserId(req), (req.params as { id: string }).id);
    return reply.type(asset.mimeType).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').send(buffer);
  });
}
