import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getUser } from '../auth/middleware';
import { ApiError, requireProjectAccess } from '../security/access';
import { buildMerged, saveAppConfig } from '../config/store';

export async function processingPolicyRoutes(app: FastifyInstance) {
  const prisma = (app as unknown as { prisma: PrismaClient }).prisma;
  app.get('/projects/:id/processing-policy', async (req) => {
    const user = getUser(req); const project = await requireProjectAccess(prisma, user.id, Number((req.params as { id: string }).id));
    return { allowExternalProcessing: project.allowExternalProcessing, canManage: user.role === 'admin' };
  });
  app.put('/projects/:id/processing-policy', async (req) => {
    const user = getUser(req); const project = await requireProjectAccess(prisma, user.id, Number((req.params as { id: string }).id));
    if (user.role !== 'admin') throw new ApiError(403, '仅管理员可改变处理策略');
    const value = (req.body as { allowExternalProcessing?: unknown }).allowExternalProcessing;
    if (typeof value !== 'boolean') throw new ApiError(400, '请选择是否允许外部处理');
    await prisma.project.update({ where: { id: project.id }, data: { allowExternalProcessing: value } });
    return { allowExternalProcessing: value, canManage: true };
  });
  app.get('/config/processing-policy', async (req) => {
    const user = getUser(req); const config = await buildMerged(prisma, user.id);
    return { allowExternalProcessing: config.allow_external_processing_shared === true, canManage: user.role === 'admin' };
  });
  app.put('/config/processing-policy', async (req) => {
    const user = getUser(req);
    if (user.role !== 'admin') throw new ApiError(403, '仅管理员可改变处理策略');
    const value = (req.body as { allowExternalProcessing?: unknown }).allowExternalProcessing;
    if (typeof value !== 'boolean') throw new ApiError(400, '请选择是否允许外部处理');
    await saveAppConfig(prisma, { allow_external_processing_shared: value });
    return { allowExternalProcessing: value, canManage: true };
  });
}
