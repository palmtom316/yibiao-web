import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../test/database';
import { createProcessingAuthorizer } from './processing-authorizer';
test('project plus shared processing requires both policies and refreshes revoked modules', async (t) => {
  const { prisma } = await testDatabase(t);
  const user = await prisma.user.create({ data: { username: 'processing-policy', password: 'synthetic', status: 'active', modules: '["knowledge-base"]' } });
  const [allowed, denied] = await Promise.all([
    prisma.project.create({ data: { ownerId: user.id, projectCode: 'OUTBOUND-A', name: '允许项目', allowExternalProcessing: true } }),
    prisma.project.create({ data: { ownerId: user.id, projectCode: 'OUTBOUND-B', name: '禁止项目', allowExternalProcessing: false } }),
  ]);
  const authorize = createProcessingAuthorizer(prisma);
  const scope = { kind: 'project' as const, projectId: allowed.id, userId: user.id, includesSharedData: true };
  await prisma.appConfig.upsert({ where: { id: 1 }, create: { id: 1, data: { allow_external_processing_shared: false } }, update: { data: { allow_external_processing_shared: false } } });
  assert.equal((await authorize(scope)).allowExternal, false);
  assert.equal((await authorize({ ...scope, includesSharedData: false })).allowExternal, true);
  await prisma.appConfig.update({ where: { id: 1 }, data: { data: { allow_external_processing_shared: true } } });
  const results = await Promise.all([authorize(scope), authorize({ ...scope, projectId: denied.id }), authorize({ kind: 'shared', userId: user.id })]);
  assert.deepEqual(results.map((result) => result.allowExternal), [true, false, true]);
  await prisma.user.update({ where: { id: user.id }, data: { modules: '[]' } });
  await assert.rejects(authorize(scope), /授权已失效/);
  await assert.rejects(authorize({ kind: 'shared', userId: user.id }), /无资料处理权限/);
  assert.equal((await authorize({ ...scope, includesSharedData: false })).allowExternal, true, 'basic project generation does not require knowledge module');
});
