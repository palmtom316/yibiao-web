import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { TaskService } from './service';

test('R07 runner failure plus persistence failure does not raise unhandledRejection', async () => {
  const user = { id: 1, username: 'review-admin', role: 'admin', status: 'active', mustChangePassword: false, modules: '[]' };
  const db: any = {
    user: { findUnique: async () => user },
    project: { findUnique: async () => ({ id: 42, ownerId: 1 }) },
    chapterReference: { findMany: async () => [] },
    appConfig: { upsert: async () => ({ data: {} }), findUnique: async () => ({ data: {} }) },
    userConfig: { upsert: async () => ({ data: {} }) },
  };
  let state: any = {};
  const store = {
    loadTechnicalPlan: async () => state,
    updateTechnicalPlan: async (_id: number, partial: any) => {
      if (partial.bidAnalysisTask?.status === 'error') throw new Error('synthetic task persistence unavailable');
      state = { ...state, ...partial };
      return state;
    },
  };
  const service = new TaskService({
    prisma: db,
    aiService: {},
    technicalPlanStore: store,
  } as never);
  service.registerRunner('bid-analysis', async () => { throw new Error('synthetic runner failure'); });
  const rejections: string[] = [];
  const handler = (error: any) => { rejections.push(error?.message || String(error)); };
  process.on('unhandledRejection', handler);
  try {
    await service.startBidAnalysis(42, { __actorUserId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(rejections, []);
    const active = (service as unknown as { projects: Map<number, { activeTasks: Map<string, unknown> }> }).projects.get(42)?.activeTasks;
    assert.equal(active?.has('bid-analysis'), false);
  } finally {
    process.off('unhandledRejection', handler);
  }
});

test('R07 default Node 22 does not terminate when persistence of the error state fails', () => {
  const script = `
    import { TaskService } from ${JSON.stringify(new URL('./service.ts', import.meta.url).href)};
    const user = { id: 1, username: 'a', role: 'admin', status: 'active', mustChangePassword: false, modules: '[]' };
    const db = { user: { findUnique: async () => user }, project: { findUnique: async () => ({ id: 42, ownerId: 1 }) }, chapterReference: { findMany: async () => [] }, appConfig: { upsert: async () => ({ data: {} }), findUnique: async () => ({ data: {} }) }, userConfig: { upsert: async () => ({ data: {} }) } };
    let state = {};
    const store = {
      loadTechnicalPlan: async () => state,
      updateTechnicalPlan: async (_id, partial) => {
        if (partial.bidAnalysisTask?.status === 'error') throw new Error('synthetic task persistence unavailable');
        state = { ...state, ...partial }; return state;
      },
    };
    const service = new TaskService({ prisma: db, aiService: {}, technicalPlanStore: store });
    service.registerRunner('bid-analysis', async () => { throw new Error('synthetic runner failure'); });
    await service.startBidAnalysis(42, { __actorUserId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    console.log('child-survived');
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: process.env.JWT_SECRET || 'synthetic-test-secret-at-least-32-characters',
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:1/yibiao_test',
      YIBIAO_DATA_DIR: process.env.YIBIAO_DATA_DIR || '/tmp/yibiao-r07',
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /child-survived/);
  assert.doesNotMatch(`${result.stderr}\n${result.stdout}`, /UnhandledPromiseRejection|unhandledRejection/);
});
