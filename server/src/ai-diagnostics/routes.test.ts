import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { aiDiagnosticRoutes } from './routes';
import { createVerifyToken, createRequireAdmin, signToken } from '../auth/middleware';

test('R10 diagnostics filter by Project.projectCode and reject invalid paging or dates', async (t) => {
  const queries: any[] = [];
  const prisma: any = {
    user: { findUnique: async () => ({ id: 1, username: 'admin', role: 'admin', status: 'active', mustChangePassword: false }) },
    project: {
      findMany: async ({ where }: any) => {
        queries.push(where);
        if (where.projectCode?.contains === 'XM2026-0001') return [{ id: 42 }];
        return [];
      },
    },
  };
  const listed: any[] = [];
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('prisma', prisma);
  app.decorate('aiDiagnostics', {
    listRuns: async (args: any) => { listed.push(args); return [{ traceId: 't1', projectId: 42 }]; },
    getRun: async () => null,
    readFailure: async () => '',
  });
  app.addHook('onRequest', createVerifyToken(prisma));
  app.addHook('onRequest', createRequireAdmin());
  await app.register(aiDiagnosticRoutes);
  const headers = { authorization: `Bearer ${signToken({ id: 1, username: 'admin', role: 'admin' })}` };

  const matched = await app.inject({ method: 'GET', url: '/ai-diagnostics?projectCode=XM2026-0001', headers });
  assert.equal(matched.statusCode, 200);
  assert.deepEqual(queries[0], { projectCode: { contains: 'XM2026-0001', mode: 'insensitive' } });
  assert.deepEqual(listed[0].where.projectId, { in: [42] });

  const empty = await app.inject({ method: 'GET', url: '/ai-diagnostics?projectCode=NO-SUCH', headers });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json().items, []);
  assert.equal(listed.length, 1, 'unmatched projectCode must not create an empty-IN Prisma query');

  const blank = await app.inject({ method: 'GET', url: '/ai-diagnostics', headers });
  assert.equal(blank.statusCode, 200);
  assert.equal(listed[1].where.projectId, undefined);

  const badPage = await app.inject({ method: 'GET', url: '/ai-diagnostics?page=-3&pageSize=5000', headers });
  assert.equal(badPage.statusCode, 400);

  const badDate = await app.inject({ method: 'GET', url: '/ai-diagnostics?from=not-a-date', headers });
  assert.equal(badDate.statusCode, 400);

  prisma.user.findUnique = async () => ({ id: 9, username: 'bob', role: 'user', status: 'active', mustChangePassword: false });
  const forbidden = await app.inject({ method: 'GET', url: '/ai-diagnostics', headers: { authorization: `Bearer ${signToken({ id: 9, username: 'bob', role: 'user' })}` } });
  assert.equal(forbidden.statusCode, 403);
});
