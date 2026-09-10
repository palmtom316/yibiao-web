import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { assetLibraryRoutes } from './asset-library';

// P2-02 回归：旧人员库写接口必须在 preHandler 钩子层直接 410，不得进入路由处理/store。
test('旧人员库写接口在 preHandler 即返回 410', async (t) => {
  const app = Fastify(); t.after(() => app.close());
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  const dummyPrisma = {
    assetItem: {
      findMany: async () => { throw new Error('写路径不应查询数据库'); },
      findUnique: async () => { throw new Error('写路径不应查询数据库'); },
      create: async () => { throw new Error('写路径不得落库'); },
      updateMany: async () => { throw new Error('写路径不得落库'); },
    },
    legacyPersonnelMigration: { findMany: async () => [] },
    auditEvent: { create: async () => ({}) },
    $transaction: async () => { throw new Error('写路径不得开事务'); },
  };
  app.decorate('prisma', dummyPrisma);
  await app.register(assetLibraryRoutes);
  for (const [method, url] of [['POST', '/asset-library/personnel'], ['PATCH', '/asset-library/personnel/x'], ['DELETE', '/asset-library/personnel/x']] as const) {
    const response = await app.inject({ method, url, payload: {} });
    assert.equal(response.statusCode, 410, `${method} ${url} 应被 410 拒绝`);
  }
});
