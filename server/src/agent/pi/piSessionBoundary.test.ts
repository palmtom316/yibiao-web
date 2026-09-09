import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { preparePiEnvironment } from './piEnvironment';
import { createPiSession } from './piSessionFactory';

test('actual Pi SDK registers confined tools and excludes command execution without contacting a model', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-pi-session-boundary-'));
  let session: any;
  const fetchBefore = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('No model/network call is allowed by this constructor test'); };
    const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, 'input.txt'), 'synthetic allowed input');
    await fs.writeFile(path.join(root, 'other-project.txt'), 'synthetic forbidden input');
    await fs.symlink(root, path.join(workspace, 'outside'));
    const handle = await createPiSession({ workspaceDir: workspace, environment: preparePiEnvironment(path.join(root, 'runtime')),
      proxyInfo: { baseUrl: 'http://127.0.0.1:1', port: 1, token: 'synthetic-proxy-token' }, config: {}, timeoutMs: 1000,
      requestUserQuestion: async () => { throw new Error('No question expected'); }, reportTaskFailure: () => {} });
    session = handle.session;
    const active = session.getActiveToolNames();
    assert.deepEqual([...active].sort(), ['read', 'write', 'edit', 'ls', 'json-validation', 'ask-user', 'report-failure'].sort());
    const read = session.getToolDefinition('read');
    assert.match(JSON.stringify(await read.execute('allowed', { path: 'input.txt' })), /synthetic allowed input/);
    await assert.rejects(read.execute('cross-project', { path: '../other-project.txt' }));
    await assert.rejects(read.execute('symlink', { path: 'outside/other-project.txt' }));
    const write = session.getToolDefinition('write');
    await assert.rejects(write.execute('escape-write', { path: '../other-project.txt', content: 'changed' }));
    assert.equal(await fs.readFile(path.join(root, 'other-project.txt'), 'utf8'), 'synthetic forbidden input');
  } finally { session?.dispose?.(); globalThis.fetch = fetchBefore; await fs.rm(root, { recursive: true, force: true }); }
});
