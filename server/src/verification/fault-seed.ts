import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { createTechnicalPlanStore } from '../technical-plan/store';
if (process.env.YIBIAO_TEST_SCOPE !== 'yibiao-transform') throw new Error('Synthetic scope required');
const prisma = new PrismaClient(); const projectId = Number(process.argv[2]);
try {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  assert.match(project.name, /^故障演练-/);
  const store = createTechnicalPlanStore(prisma); const now = new Date().toISOString();
  await store.saveOutline(projectId, { outlineData: { outline: [{ id: '1', title: '实施方案', description: '合成实施与验收', content: '' }] } });
  await store.updateTechnicalPlan(projectId, { globalFacts: [{ id: 'fixture', title: '项目约束', content: '项目在合成地点实施，按 30 天计划完成验收。' }], globalFactsTask: { task_id: 'fixture-facts', type: 'global-facts-generation', status: 'success', progress: 100, logs: [], started_at: now, updated_at: now } });
  console.log(JSON.stringify({ projectId, syntheticGlobalFacts: true }));
} finally { await prisma.$disconnect(); }
