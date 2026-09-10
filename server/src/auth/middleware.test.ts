import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';

test('受限令牌只能通过初始改密校验', async () => {
  const auth = await import('./middleware');
  const token = auth.signInitialPasswordChangeToken({ id: 1, username: 'admin', role: 'admin' });
  const decoded = jwt.decode(token) as { iat?: number; exp?: number };

  assert.equal(decoded.exp! - decoded.iat!, 600);
  assert.equal(auth.verifyInitialPasswordChangeToken(token).purpose, 'initial-password-change');
  assert.throws(() => auth.verifyAccessToken(token));
});

test('非管理员不能通过管理员钩子，且后续处理函数不执行', async (t) => {
  const auth = await import('./middleware');
  let reached = false;
  const app = Fastify(); t.after(() => app.close());
  app.addHook('onRequest', async (req) => { (req as FastifyRequest & { user: object }).user = { id: 1, username: 'user', role: 'user' }; });
  app.addHook('onRequest', auth.createRequireAdmin());
  app.get('/admin-only', async () => { reached = true; return { ok: true }; });
  const response = await app.inject({ method: 'GET', url: '/admin-only' });
  assert.equal(response.statusCode, 403);
  assert.equal(reached, false, '拒绝后不得继续执行路由处理函数');
});

test('缺少模块授权时模块钩子返回 403 且处理函数不执行', async (t) => {
  const { createRequireModule } = await import('./permissions');
  let reached = false;
  const prisma = { user: { findUnique: async () => ({ modules: '[]' }) } };
  const app = Fastify(); t.after(() => app.close());
  app.addHook('onRequest', async (req) => { (req as FastifyRequest & { user: object }).user = { id: 1, username: 'user', role: 'user' }; });
  app.addHook('onRequest', createRequireModule(prisma as never, 'knowledge-base'));
  app.get('/module-only', async () => { reached = true; return { ok: true }; });
  const response = await app.inject({ method: 'GET', url: '/module-only' });
  assert.equal(response.statusCode, 403);
  assert.equal(reached, false, '拒绝后不得继续执行路由处理函数');
});

test('旧正式令牌没有 purpose 时继续兼容', async () => {
  const auth = await import('./middleware');
  const token = jwt.sign(
    { id: 2, username: 'legacy', role: 'user' },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' },
  );

  assert.equal(auth.verifyAccessToken(token).username, 'legacy');
});

test('未知 purpose 的签名令牌不能作为正式访问令牌', async () => {
  const auth = await import('./middleware');
  const token = jwt.sign(
    { id: 3, username: 'unexpected', role: 'user', purpose: 'service-token' },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' },
  );

  assert.throws(() => auth.verifyAccessToken(token));
});

test('正式令牌不能用于初始改密', async () => {
  const auth = await import('./middleware');
  const token = auth.signToken({ id: 1, username: 'admin', role: 'admin' });
  const decoded = jwt.decode(token) as { purpose?: string; iat?: number; exp?: number };

  assert.equal(decoded.purpose, 'access');
  assert.equal(decoded.exp! - decoded.iat!, 7 * 24 * 60 * 60);
  assert.throws(() => auth.verifyInitialPasswordChangeToken(token));
});

test('受限令牌不能访问普通受保护路由', async (t) => {
  const auth = await import('./middleware');
  const app = Fastify();
  t.after(() => app.close());
  app.get('/protected', { onRequest: auth.verifyToken }, async () => ({ success: true }));

  const restrictedResponse = await app.inject({
    method: 'GET',
    url: '/protected',
    headers: {
      authorization: `Bearer ${auth.signInitialPasswordChangeToken({ id: 1, username: 'admin', role: 'admin' })}`,
    },
  });
  assert.equal(restrictedResponse.statusCode, 401);

  const accessResponse = await app.inject({
    method: 'GET',
    url: '/protected',
    headers: {
      authorization: `Bearer ${auth.signToken({ id: 1, username: 'admin', role: 'admin' })}`,
    },
  });
  assert.equal(accessResponse.statusCode, 200);
});
