import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { ProcessingDeniedError, setProcessingAuthorizer, withProcessingScope } from './processing';
import { createProcessingAuthorizer } from './processing-authorizer';
import { createVerifyToken, signToken } from '../auth/middleware';
import { normalizeConfig } from '../config/normalize';
import { isRetryableAiRequestError } from '../ai/retry';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'synthetic-test-secret-at-least-32-characters';

function databaseDouble() {
  const admin = { id: 1, username: 'review-admin', role: 'admin', status: 'active', mustChangePassword: false, modules: '[]' };
  const user = { id: 2, username: 'review-user', role: 'user', status: 'active', mustChangePassword: false, modules: '[]' };
  const allowedProject = { id: 42, ownerId: 1, allowExternalProcessing: true };
  const deniedProject = { id: 43, ownerId: 1, allowExternalProcessing: false };
  const otherProject = { id: 99, ownerId: 2, allowExternalProcessing: true };
  const projects = new Map([[42, allowedProject], [43, deniedProject], [99, otherProject]]);
  const data = normalizeConfig({
    text_model_provider: 'custom',
    api_key: 'synthetic-review-model-key',
    base_url: 'https://review.invalid/v1',
    model_name: 'review-model',
    image_model: {
      provider: 'custom',
      api_key: 'synthetic-review-image-key',
      base_url: 'https://review.invalid/v1',
      model_name: 'review-image',
    },
  });
  const db: any = {
    user: {
      findUnique: async ({ where }: any) => [admin, user].find((item) => item.id === where.id) || null,
    },
    project: {
      findUnique: async ({ where }: any) => projects.get(where.id) || null,
    },
    appConfig: {
      upsert: async () => ({ data }),
      findUnique: async () => ({ data }),
      update: async (args: any) => { Object.assign(data, args.data.data); return { data }; },
    },
    userConfig: {
      upsert: async () => ({ data: {} }),
      update: async () => ({ data: {} }),
    },
  };
  return { db, admin, user };
}

async function interceptFetch<T>(run: (calls: Array<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input: any, init: any = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    let body: any = {};
    try { body = init.body ? JSON.parse(String(init.body)) : {}; } catch { body = {}; }
    calls.push({
      url,
      method: init.method || 'GET',
      redirect: init.redirect,
      authorizationPresent: Boolean(headers.get('authorization')),
      authorization: headers.get('authorization') || '',
      stream: Boolean(body.stream),
    });
    if (url.includes('/models')) {
      return Response.json({ data: [{ id: 'review-model' }] });
    }
    if (url.includes('/images/generations')) {
      return Response.json({ data: [{ url: 'https://review.invalid/image.png' }] });
    }
    const payload = {
      choices: [{
        message: { content: 'OK', tool_calls: [{ function: { name: 'diagnostic_echo', arguments: '{"value":"YIBIAO_PI_TOOL_OK"}' } }] },
        delta: { content: 'OK', tool_calls: [{ function: { name: 'diagnostic_echo', arguments: '{"value":"YIBIAO_PI_TOOL_OK"}' } }] },
      }],
    };
    if (body.stream) {
      return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = previous;
  }
}

test('R01 self-check probes use processingFetch and honor allowlists', async (t) => {
  const previousInternal = process.env.YIBIAO_INTERNAL_ENDPOINTS;
  const previousExternal = process.env.YIBIAO_EXTERNAL_ENDPOINTS;
  t.after(() => {
    if (previousInternal === undefined) delete process.env.YIBIAO_INTERNAL_ENDPOINTS; else process.env.YIBIAO_INTERNAL_ENDPOINTS = previousInternal;
    if (previousExternal === undefined) delete process.env.YIBIAO_EXTERNAL_ENDPOINTS; else process.env.YIBIAO_EXTERNAL_ENDPOINTS = previousExternal;
  });
  const { runPiTextModelSelfCheck } = await import('../agent/pi/piSelfCheck');
  const config = { api_key: 'synthetic-review-model-key', model_name: 'review-model', base_url: 'https://review.invalid/v1' };

  process.env.YIBIAO_INTERNAL_ENDPOINTS = '';
  process.env.YIBIAO_EXTERNAL_ENDPOINTS = '';
  let authorizationChecks = 0;
  setProcessingAuthorizer(async () => { authorizationChecks += 1; throw new ProcessingDeniedError('synthetic deny'); });
  await interceptFetch(async (calls) => {
    const report = await withProcessingScope({ kind: 'administration', userId: 1 }, () => runPiTextModelSelfCheck(config));
    assert.equal(calls.length, 0, 'blank allowlists must not send');
    assert.equal(authorizationChecks, 3, 'each probe must authorize');
    assert.equal(report.success, false);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('synthetic-review-model-key'), false);
  });

  process.env.YIBIAO_INTERNAL_ENDPOINTS = 'https://review.invalid/v1';
  process.env.YIBIAO_EXTERNAL_ENDPOINTS = '';
  setProcessingAuthorizer(async () => ({ allowExternal: false }));
  await interceptFetch(async (calls) => {
    const report = await withProcessingScope({ kind: 'administration', userId: 1 }, () => runPiTextModelSelfCheck(config));
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.redirect === 'manual'));
    assert.equal(report.success, true);
    assert.equal(JSON.stringify(report).includes('synthetic-review-model-key'), false);
  });

  process.env.YIBIAO_INTERNAL_ENDPOINTS = '';
  process.env.YIBIAO_EXTERNAL_ENDPOINTS = 'https://review.invalid/v1';
  setProcessingAuthorizer(async () => ({ allowExternal: false }));
  await interceptFetch(async (calls) => {
    await withProcessingScope({ kind: 'administration', userId: 1 }, () => runPiTextModelSelfCheck(config));
    assert.equal(calls.length, 0, 'administration must not send to external endpoints');
  });
  setProcessingAuthorizer(async (scope) => ({ allowExternal: scope.kind === 'project' && scope.projectId === 42 }));
  await interceptFetch(async (calls) => {
    const report = await withProcessingScope({ kind: 'project', projectId: 42, userId: 1 }, () => runPiTextModelSelfCheck(config));
    assert.equal(calls.length, 3);
    assert.equal(report.success, true);
  });
});

test('R02 list-models and image tests bind a verified project scope', async (t) => {
  const previousInternal = process.env.YIBIAO_INTERNAL_ENDPOINTS;
  const previousExternal = process.env.YIBIAO_EXTERNAL_ENDPOINTS;
  t.after(() => {
    if (previousInternal === undefined) delete process.env.YIBIAO_INTERNAL_ENDPOINTS; else process.env.YIBIAO_INTERNAL_ENDPOINTS = previousInternal;
    if (previousExternal === undefined) delete process.env.YIBIAO_EXTERNAL_ENDPOINTS; else process.env.YIBIAO_EXTERNAL_ENDPOINTS = previousExternal;
  });
  const { aiRoutes } = await import('../routes/ai');
  const { db, admin, user } = databaseDouble();
  setProcessingAuthorizer(createProcessingAuthorizer(db));
  process.env.YIBIAO_INTERNAL_ENDPOINTS = '';
  process.env.YIBIAO_EXTERNAL_ENDPOINTS = 'https://review.invalid/v1';
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('prisma', db);
  app.addHook('onRequest', createVerifyToken(db));
  await app.register(aiRoutes);
  const adminHeaders = { authorization: `Bearer ${signToken(admin)}`, 'x-project-id': '42' };

  await interceptFetch(async (calls) => {
    const listed = await app.inject({ method: 'POST', url: '/ai/list-models', headers: adminHeaders, payload: {} });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.deepEqual(listed.json().models, ['review-model']);
    assert.equal(calls.length, 1);
    const image = await app.inject({
      method: 'POST',
      url: '/ai/test-image-model',
      headers: adminHeaders,
      payload: { image_model: { provider: 'custom', api_key: 'synthetic-review-image-key', base_url: 'https://review.invalid/v1', model_name: 'review-image', request_mode: 'normal' } },
    });
    assert.equal(image.statusCode, 200, image.body);
    assert.equal(image.json().success, true);
    assert.equal(calls.length, 2);
  });

  await interceptFetch(async (calls) => {
    const missing = await app.inject({ method: 'POST', url: '/ai/list-models', headers: { authorization: `Bearer ${signToken(admin)}` }, payload: {} });
    assert.equal(missing.statusCode, 400);
    const forbiddenProject = await app.inject({ method: 'POST', url: '/ai/list-models', headers: { authorization: `Bearer ${signToken(user)}`, 'x-project-id': '42' }, payload: {} });
    assert.equal(forbiddenProject.statusCode, 403);
    const regular = await app.inject({ method: 'POST', url: '/ai/list-models', headers: { authorization: `Bearer ${signToken(user)}`, 'x-project-id': '99' }, payload: {} });
    assert.equal(regular.statusCode, 403);
    const unauthorizedExternal = await app.inject({ method: 'POST', url: '/ai/list-models', headers: { authorization: `Bearer ${signToken(admin)}`, 'x-project-id': '43' }, payload: {} });
    assert.equal(unauthorizedExternal.statusCode, 403);
    assert.match(unauthorizedExternal.body, /未获准/);
    assert.equal(calls.length, 0);
    assert.equal(unauthorizedExternal.body.includes('synthetic-review-model-key'), false);
  });
});

test('processing denials are not retried', async () => {
  const denied = new ProcessingDeniedError('synthetic deny');
  assert.equal(isRetryableAiRequestError(denied), false);
  const { listModelsWithConfig } = await import('../ai/service');
  let checks = 0;
  setProcessingAuthorizer(async () => { checks += 1; throw new ProcessingDeniedError('synthetic deny'); });
  await withProcessingScope({ kind: 'project', projectId: 42, userId: 1 }, async () => {
    await assert.rejects(
      () => listModelsWithConfig({ api_key: 'synthetic-review-model-key', base_url: 'https://review.invalid/v1' }),
      /未获准|synthetic deny/,
    );
  });
  assert.equal(checks, 1, 'permission denials must not be retried');
});
