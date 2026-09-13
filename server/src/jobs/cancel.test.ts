import test from 'node:test';
import assert from 'node:assert/strict';
import { JobService } from './service';
import { ResourceQueue } from '../resources/queue';
import { ApiError } from '../security/access';

function jobDatabase() {
  const rows = new Map<string, any>();
  let seq = 0;
  const prisma: any = {
    user: { findUnique: async () => ({ id: 1, role: 'admin', status: 'active', mustChangePassword: false, modules: '["knowledge-base"]' }) },
    project: { findUnique: async () => ({ id: 42, ownerId: 1 }) },
    backgroundJob: {
      upsert: async ({ create }: any) => {
        const id = `job-${++seq}`;
        const row = { id, status: 'queued', progress: 0, error: null, result: null, attempts: 1, ...create };
        rows.set(id, row);
        return row;
      },
      findUnique: async ({ where }: any) => rows.get(where.id) || null,
      findUniqueOrThrow: async ({ where }: any) => {
        const row = rows.get(where.id);
        if (!row) throw new Error('missing job');
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(rows.get(where.id), data),
      updateMany: async ({ where, data }: any) => {
        const row = rows.get(where.id);
        if (!row) return { count: 0 };
        const allowed = where.status?.in;
        if (allowed && !allowed.includes(row.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
  return { prisma, rows };
}

test('R11 cancel of a running job stays cancelling until the runner stops', async () => {
  const { prisma, rows } = jobDatabase();
  const jobs = new JobService(prisma);
  let continueRunner!: () => void;
  let sawAbort = false;
  let startedFollowOn = false;
  jobs.register('knowledge-prepare', async (_job, _update, signal) => {
    await new Promise<void>((resolve) => {
      continueRunner = resolve;
      signal.addEventListener('abort', () => { sawAbort = true; }, { once: true });
    });
    if (signal.aborted) throw new ApiError(409, '任务已取消，原件保留');
    startedFollowOn = true;
    return { extracted: true };
  });
  const started = await jobs.start({ kind: 'knowledge-prepare', userId: 1, projectId: 42, input: {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const cancelling = await jobs.cancel(started.jobId, 1);
  assert.equal(cancelling.status, 'cancelling');
  assert.equal(rows.get(started.jobId).status, 'cancelling');
  continueRunner();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sawAbort, true);
  assert.equal(startedFollowOn, false);
  assert.equal(rows.get(started.jobId).status, 'cancelled');
  assert.equal(rows.get(started.jobId).result, null);
});

test('R11 cancel does not overwrite a job that already succeeded', async () => {
  const { prisma, rows } = jobDatabase();
  const jobs = new JobService(prisma);
  jobs.register('template-extract', async () => ({ ok: true }));
  const started = await jobs.start({ kind: 'template-extract', userId: 1, projectId: 42, input: {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rows.get(started.jobId).status, 'success');
  const after = await jobs.cancel(started.jobId, 1);
  assert.equal(after.status, 'success');
  assert.equal(rows.get(started.jobId).status, 'success');
});

test('R11 queued resource work is rejected on abort without occupying a slot', async () => {
  const queue = new ResourceQueue('parse-test', 1, 8);
  let release!: () => void;
  const blocker = queue.run(() => new Promise<void>((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const pending = queue.run(async () => { throw new Error('should not run'); }, undefined, controller.signal);
  assert.equal(queue.status().queued, 1);
  controller.abort();
  await assert.rejects(pending, /取消/);
  assert.equal(queue.status().queued, 0);
  assert.equal(queue.status().active, 1);
  release();
  await blocker;
});
