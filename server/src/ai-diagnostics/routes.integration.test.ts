import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { aiDiagnosticRoutes } from './routes';
import { createVerifyToken, createRequireAdmin, signToken } from '../auth/middleware';
import { createAiDiagnosticsService } from './service';
import { testDatabase } from '../test/database';

test('R10 diagnostics projectCode filter works on PostgreSQL', async (t) => {
  const { prisma } = await testDatabase(t);
  const suffix = `${Date.now()}-${process.pid}`;
  const admin = await prisma.user.create({ data: { username: `diag-admin-${suffix}`, password: 'synthetic', role: 'admin', status: 'active' } });
  const member = await prisma.user.create({ data: { username: `diag-user-${suffix}`, password: 'synthetic', role: 'user', status: 'active' } });
  const project = await prisma.project.create({ data: { projectCode: `XM-DIAG-${suffix}`, name: 'diag', ownerId: admin.id } });
  await prisma.aiDiagnosticRun.create({ data: { traceId: `tr-${suffix}`, projectId: project.id, userId: admin.id, operation: 'chat', expiresAt: new Date(Date.now() + 86400000) } });

  const app = Fastify();
  t.after(() => app.close());
  app.decorate('prisma', prisma);
  app.decorate('aiDiagnostics', createAiDiagnosticsService({ prisma, storage: { writeFailure: async () => null, deleteExpired: async () => 0, readFailure: async () => '' }, logger: { error() {} } }));
  app.addHook('onRequest', createVerifyToken(prisma));
  app.addHook('onRequest', createRequireAdmin());
  await app.register(aiDiagnosticRoutes);
  const headers = { authorization: `Bearer ${signToken({ id: admin.id, username: admin.username, role: 'admin' })}` };

  const hit = await app.inject({ method: 'GET', url: `/ai-diagnostics?projectCode=${project.projectCode}`, headers });
  assert.equal(hit.statusCode, 200);
  assert.equal(hit.json().items.some((row: { traceId: string }) => row.traceId === `tr-${suffix}`), true);

  const miss = await app.inject({ method: 'GET', url: '/ai-diagnostics?projectCode=XM-NOPE', headers });
  assert.equal(miss.statusCode, 200);
  assert.equal(miss.json().items.some((row: { traceId: string }) => row.traceId === `tr-${suffix}`), false);

  const memberRes = await app.inject({ method: 'GET', url: '/ai-diagnostics', headers: { authorization: `Bearer ${signToken({ id: member.id, username: member.username, role: 'user' })}` } });
  assert.equal(memberRes.statusCode, 403);
});
