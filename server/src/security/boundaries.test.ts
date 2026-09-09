import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadImage } from '../export/images';
import { createSafeFileTools } from '../agent/pi/safeFileTools';
import { preparePiEnvironment } from '../agent/pi/piEnvironment';
import { processingFetch, setProcessingAuthorizer, withProcessingScope } from './processing';

test('project images and Pi tools reject traversal, links, absolute paths and remote resources', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a'); const b = path.join(root, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'image.png'), 'project-a');
  fs.writeFileSync(path.join(b, 'secret.png'), 'project-b');
  fs.symlinkSync(b, path.join(a, 'link'));
  assert.equal((await loadImage('image.png', { baseDir: a }))?.buffer.toString(), 'project-a');
  for (const source of ['../b/secret.png', path.join(b, 'secret.png'), 'file:///etc/passwd', 'https://example.org/a.png', 'link/secret.png']) {
    await assert.rejects(loadImage(source, { baseDir: a }));
  }
  const Type = { Object: (x: unknown) => x, String: () => ({}), Optional: (x: unknown) => x } as never;
  const tools = createSafeFileTools(a, Type);
  assert.equal(tools.some((tool) => tool.name === 'bash'), false);
  for (const name of ['read', 'write', 'edit', 'ls']) {
    const tool = tools.find((tool) => tool.name === name)!;
    await assert.rejects(tool.execute('test', { path: '../b/secret.png', content: 'bad' }));
    await assert.rejects(tool.execute('test', { path: 'link/secret.png', content: 'bad' }));
  }
  assert.equal(fs.readFileSync(path.join(b, 'secret.png'), 'utf8'), 'project-b');
});

test('processing policy is scoped, refreshed per send, and never follows redirects', async (t) => {
  const oldFetch = globalThis.fetch;
  const oldInternal = process.env.YIBIAO_INTERNAL_ENDPOINTS;
  const oldExternal = process.env.YIBIAO_EXTERNAL_ENDPOINTS;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldInternal === undefined) delete process.env.YIBIAO_INTERNAL_ENDPOINTS; else process.env.YIBIAO_INTERNAL_ENDPOINTS = oldInternal;
    if (oldExternal === undefined) delete process.env.YIBIAO_EXTERNAL_ENDPOINTS; else process.env.YIBIAO_EXTERNAL_ENDPOINTS = oldExternal;
  });
  process.env.YIBIAO_INTERNAL_ENDPOINTS = 'https://internal.example/v1';
  process.env.YIBIAO_EXTERNAL_ENDPOINTS = 'https://approved.example/v1';
  let allowed = true; let sends = 0;
  setProcessingAuthorizer(async (scope) => ({ allowExternal: allowed && scope.kind === 'project' && scope.projectId === 1 }));
  globalThis.fetch = async (_url, options) => {
    sends += 1;
    assert.equal(options?.redirect, 'manual');
    return new Response('{}');
  };
  await assert.rejects(processingFetch('https://internal.example/v1/chat'));
  assert.equal(sends, 0);
  await Promise.all([
    withProcessingScope({ kind: 'project', projectId: 1, userId: 1 }, () => processingFetch('https://approved.example/v1/chat')),
    withProcessingScope({ kind: 'project', projectId: 2, userId: 2 }, () => assert.rejects(processingFetch('https://approved.example/v1/chat'))),
    withProcessingScope({ kind: 'shared', userId: 1 }, () => assert.rejects(processingFetch('https://approved.example/v1/chat'))),
  ]);
  assert.equal(sends, 1);
  allowed = false;
  await withProcessingScope({ kind: 'project', projectId: 1, userId: 1 }, () => assert.rejects(processingFetch('https://approved.example/v1/chat')));
  assert.equal(sends, 1);
  globalThis.fetch = async () => { sends += 1; return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }); };
  await withProcessingScope({ kind: 'project', projectId: 1, userId: 1 }, () => assert.rejects(processingFetch('https://internal.example/v1/chat'), /重定向/));
  assert.equal(sends, 2);
});

test('Pi environment does not inherit database, JWT or provider credentials', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-env-boundary-'));
  const keys = ['DATABASE_URL', 'JWT_SECRET', 'OPENAI_API_KEY'];
  const previous = keys.map((key) => process.env[key]);
  t.after(() => { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); fs.rmSync(root, { recursive: true, force: true }); });
  keys.forEach((key) => { process.env[key] = 'synthetic-env-must-not-inherit'; });
  const environment = preparePiEnvironment(root);
  keys.forEach((key) => assert.equal(environment.env[key], undefined));
  assert.doesNotMatch(JSON.stringify(environment.env), /synthetic-env-must-not-inherit/);
  assert.ok(environment.env.HOME?.startsWith(root));
});
