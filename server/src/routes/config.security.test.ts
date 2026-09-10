import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { configRoutes } from './config';
import { createVerifyToken, signToken } from '../auth/middleware';
import { normalizeConfig } from '../config/normalize';
import { buildMerged } from '../config/store';

test('admin/user config reads and writes never return secrets; empty keeps, masks reject, explicit clear works', async (t) => {
  const secret = 'synthetic-secret-that-must-never-be-returned';
  let data = normalizeConfig({ text_model_provider: 'custom', api_key: secret, base_url: 'https://internal.example/v1', model_name: 'mock', file_parser: { mineru_token: secret } });
  const userConfig = new Map<number, any>();
  const user = { id: 1, username: 'a', role: 'admin', status: 'active', mustChangePassword: false };
  const prisma = {
    user: { findUnique: async () => user },
    appConfig: { upsert: async () => ({ data }), update: async (args: any) => { data = args.data.data; return { data }; } },
    userConfig: { upsert: async (args: any) => ({ data: userConfig.get(args.where.userId) || {} }), update: async (args: any) => { userConfig.set(args.where.userId, args.data.data); } },
  } as any;
  const app = Fastify(); t.after(() => app.close()); app.decorate('prisma', prisma);
  app.addHook('onRequest', createVerifyToken(prisma)); await app.register(configRoutes);
  const headers = { authorization: `Bearer ${signToken(user)}` };
  for (const role of ['admin', 'user']) {
    user.role = role;
    for (const options of [{ method: 'GET' as const, url: '/config' }, { method: 'PUT' as const, url: '/config/user', payload: { file_parser: { provider: 'local' } } }]) {
      const result = await app.inject({ ...options, headers });
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.includes(secret), false);
      assert.equal(result.json().config.configured, true);
    }
  }
  assert.equal((await app.inject({ method: 'PUT', url: '/config', headers, payload: {} })).statusCode, 403, 'old admin token cannot bypass role change');
  user.role = 'admin';
  const blank = await app.inject({ method: 'PUT', url: '/config', headers, payload: { text_model_profiles: { custom: { api_key: '' } }, file_parser: { mineru_token: '' } } });
  assert.equal(blank.statusCode, 200); assert.equal(blank.body.includes(secret), false);
  assert.equal((await buildMerged(prisma, 1)).api_key, secret);
  assert.equal((await buildMerged(prisma, 1)).file_parser.mineru_token, secret);
  assert.equal((await app.inject({ method: 'PUT', url: '/config', headers, payload: { text_model_profiles: { custom: { api_key: '********' } } } })).statusCode, 400);
  const clear = await app.inject({ method: 'PUT', url: '/config', headers, payload: { clear_secrets: ['text_model_profiles.custom.api_key', 'file_parser.mineru_token'] } });
  assert.equal(clear.statusCode, 200); assert.equal(clear.json().config.configured, false);
  assert.equal((await buildMerged(prisma, 1)).api_key, '');
  // P2-06：清除 MinerU Token 后，普通用户再选“MinerU 精准解析”必须折回本地解析。
  const mineruPick = await app.inject({ method: 'PUT', url: '/config/user', headers, payload: { file_parser: { provider: 'mineru-accurate-api' } } });
  assert.equal(mineruPick.statusCode, 200);
  assert.match(mineruPick.json().message, /回落本地解析/);
  assert.equal((await buildMerged(prisma, 1)).file_parser.provider, 'local', '未配置 MinerU Token 时必须折回 local');
  user.status = 'disabled';
  assert.equal((await app.inject({ method: 'GET', url: '/config', headers })).statusCode, 401);
});
