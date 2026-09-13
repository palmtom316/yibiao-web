import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../test/database';
import { createPerformanceStore } from './store';

// O07：日期跨字段校验必须基于「合并后的结果」。只提交一个日期时，另一个仍取库中现值，
// 否则「先有 completedAt、再单独提交更晚的 startedAt」会以非法组合落库。
test('partial date updates keep start/complete cross-field validation', async (t) => {
  const { prisma } = await testDatabase(t);
  const user = await prisma.user.create({ data: { username: 'perf-dates', password: 'synthetic', status: 'active' } });
  const store = createPerformanceStore(prisma);
  const created = await store.create({ title: '合成业绩', startedAt: '2026-01-01', completedAt: '2026-06-30' }, user.id);

  // 只改 startedAt：晚于库中 completedAt，必须拒绝。
  await assert.rejects(
    store.update(created.id, { version: created.version, startedAt: '2026-12-31' }, user.id),
    /结束日期不得早于开始日期/,
  );

  // 只改 completedAt：早于库中 startedAt，必须拒绝。
  await assert.rejects(
    store.update(created.id, { version: created.version, completedAt: '2025-12-31' }, user.id),
    /结束日期不得早于开始日期/,
  );

  // 合法组合仍可写入，且另一个日期保持库中现值。
  const ok = await store.update(created.id, { version: created.version, startedAt: '2025-01-01' }, user.id);
  assert.equal(ok.startedAt.slice(0, 10), '2025-01-01');
  assert.equal(ok.completedAt.slice(0, 10), '2026-06-30');
});
