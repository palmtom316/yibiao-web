import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceQueue } from './queue';
import { withProcessingScope, currentProcessingScope } from '../security/processing';

test('local resource queue runs one job and preserves the waiting project context', async () => {
  const queue = new ResourceQueue('test');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let secondStarted = false; let position = 0;
  const first = withProcessingScope({ kind: 'project', projectId: 1, userId: 1 }, () => queue.run(async () => { await gate; return currentProcessingScope(); }));
  const second = withProcessingScope({ kind: 'project', projectId: 2, userId: 2 }, () => queue.run(async () => { secondStarted = true; return currentProcessingScope(); }, (n) => { position = n; }));
  assert.equal(secondStarted, false); assert.equal(position, 1);
  release();
  assert.deepEqual(await first, { kind: 'project', projectId: 1, userId: 1 });
  assert.deepEqual(await second, { kind: 'project', projectId: 2, userId: 2 });
  queue.stopAccepting(); await assert.rejects(queue.run(async () => 1));
});
