import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getUserId } from '../auth/middleware';
import { createPerformanceStore } from '../performance/store';
export async function performanceRoutes(app: FastifyInstance) {
  const store = createPerformanceStore((app as unknown as { prisma: PrismaClient }).prisma);
  app.get('/performance-records', (req) => { const q = req.query as { q?: string; page?: string; archived?: string }; return store.list(q.q, q.page, q.archived === 'true'); });
  app.get('/performance-records/:id', (req) => store.get((req.params as { id: string }).id));
  app.post('/performance-records', (req) => store.create((req.body || {}) as Record<string, any>, getUserId(req)));
  app.put('/performance-records/:id', (req) => store.update((req.params as { id: string }).id, (req.body || {}) as Record<string, any>, getUserId(req)));
  app.put('/performance-records/:id/links', (req) => store.update((req.params as { id: string }).id, (req.body || {}) as Record<string, any>, getUserId(req), true));
  app.post('/performance-records/:id/archive', (req) => store.archive((req.params as { id: string }).id, (req.body as { version?: number })?.version, getUserId(req)));
}
