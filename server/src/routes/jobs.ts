import type { FastifyInstance } from 'fastify';
import { getUserId } from '../auth/middleware';
import type { JobService } from '../jobs/service';
import { requireProjectAccess } from '../security/access';
export async function jobRoutes(app: FastifyInstance) {
  const jobs = (app as unknown as { jobs: JobService }).jobs;
  app.get('/jobs', async (req) => {
    const projectId = Number(req.headers['x-project-id']);
    await requireProjectAccess(jobs.prisma, getUserId(req), projectId);
    const items = await jobs.prisma.backgroundJob.findMany({ where: { projectId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30 });
    const allowed = [];
    for (const item of items) { try { await jobs.authorize(item, getUserId(req)); allowed.push({ ...jobs.dto(item), result: undefined }); } catch { /* no module access: omit restricted jobs */ } }
    return { items: allowed };
  });
  app.get('/jobs/:id', async (req) => jobs.dto(await jobs.get((req.params as { id: string }).id, getUserId(req))));
  app.post('/jobs/:id/retry', async (req) => jobs.retry((req.params as { id: string }).id, getUserId(req)));
  app.post('/jobs/:id/cancel', async (req) => { await jobs.cancel((req.params as { id: string }).id, getUserId(req)); return { success: true }; });
}
