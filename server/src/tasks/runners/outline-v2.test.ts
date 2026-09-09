import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runOutlineV2, validateAllocation, validateScorePlan, validateTechnicalOutline, type V2Node } from './outline-v2';
import { createPersistentAgentTask, getPersistentAgentTaskPaths } from '../../agent/pi/piPersistentTaskStore';
import type { TaskRunnerContext } from '../types';

const roots: V2Node[] = ['实施方案', '质量保障'].map((title, i) => ({ id: String(i + 1), title, description: `${title}范围`, attr: '技术', content_mode: 'ai-generate' }));
const groups = roots.map((root, i) => ({ requirement_id: `R${i + 1}`, title: root.title, description: root.description, detail_points: ['流程与措施'] }));
const plan = { allow_root_changes: false, extra_titles: [], branches: roots.map((root, i) => ({ branch_id: `B${i + 1}`, root_id: root.id, root_title: root.title, score_item_level: 1, mappings: [{ requirement_id: `R${i + 1}`, target_title: root.title }] })) };
const final = { outline: roots.map(({ content_mode: _, ...root }, i) => ({ ...root, branch_id: `B${i + 1}`, children: ['流程', '措施'].map((title, j) => ({ id: `${i + 1}.${j + 1}`, title, description: title, content_mode: 'ai-generate' })) })) };
test('V2 locks technical roots and validates complete, nonduplicated word allocations', () => {
  validateTechnicalOutline(final, roots); validateScorePlan(plan, groups, roots);
  assert.throws(() => validateTechnicalOutline({ outline: [{ ...roots[0]!, attr: '商务' }] }), /商务/);
  assert.throws(() => validateTechnicalOutline({ outline: [{ ...roots[0]!, title: '营业执照' }] }), /商务/);
  assert.throws(() => validateTechnicalOutline({ outline: [...roots].reverse() }, roots), /编号|确认/);
  assert.throws(() => validateScorePlan({ ...plan, branches: [plan.branches[0]!, plan.branches[0]!] }, groups, roots), /对应/);
  assert.throws(() => validateAllocation({ mode: 'allocated', target_ai_leaf_count: 5, fixed_ai_leaf_count: 0, allocatable_ai_leaf_count: 5, allocations: [{ branch_id: 'B1', leaf_count: 3 }, { branch_id: 'B1', leaf_count: 2 }] }, plan.branches, 5), /重复/);
});

test('V2 persists stages, awaits knowledge, confirms differences and resumes without repeating accepted stages', async () => {
  const called: string[] = []; const asked: string[] = []; const keys = new Set<string>();
  let state: any = { outlineGenerationTask: { task_id: 'outline-fixture', status: 'running', logs: [] } };
  let failChildren = true; let knowledgeRead = false;
  const input = { overview: '合成工程', requirements: '技术评分项：实施方案、质量保障', proposalInstruction: '', referenceDocumentIds: ['fixture-doc'], wordOptions: { minWordsWan: 1.5, maxWordsWan: 1.5, wordsPerSectionWan: 0.3 } };
  const ctx = {
    projectId: 71, prisma: {}, previousState: {},
    workspaceStore: { loadTechnicalPlan: async () => state },
    knowledgeBaseService: { readReferences: async () => { await Promise.resolve(); knowledgeRead = true; return [{ markdown: '合成知识正文' }]; } },
    updateTask: async (partial: any) => { state.outlineGenerationTask = { ...state.outlineGenerationTask, ...partial }; return state.outlineGenerationTask; },
    agentService: {
      requestQuestion: async (question: any) => { asked.push(question.question); assert.equal(question.project_id, 71); return question.metadata?.kind === 'outline-v2-selection' ? { option_id: 'confirm', answer_payload: { selectedIds: ['1', '2'] } } : { option_id: question.options[0].id }; },
      runTask: async (payload: any) => {
        assert.equal(knowledgeRead, true); assert.equal(payload.project_id, 71);
        const key = payload.persistent_task.task_key; assert.match(key, /^outline-v2-p71-/); keys.add(key);
        if (payload.persistent_task.mode === 'create') createPersistentAgentTask(key);
        const workspace = getPersistentAgentTaskPaths(key).workspaceDir;
        for (const file of payload.files) { await fs.mkdir(path.dirname(path.join(workspace, file.path)), { recursive: true }); await fs.writeFile(path.join(workspace, file.path), file.content); }
        const stage = payload.persistent_task.initial_stage; called.push(stage);
        if (stage === '子目录生成' && failChildren) throw new Error('synthetic disconnect');
        let output: any;
        if (stage === '一级目录') output = { outline: roots };
        else if (stage === '评分分支规划') { output = plan; await fs.writeFile(path.join(workspace, 'technical-score-groups.json'), JSON.stringify({ groups })); }
        else if (stage === '小节字数分配') output = { mode: 'allocated', target_ai_leaf_count: 5, fixed_ai_leaf_count: 0, allocatable_ai_leaf_count: 5, allocations: [{ branch_id: 'B1', leaf_count: 3 }, { branch_id: 'B2', leaf_count: 2 }] };
        else if (stage === '子目录生成') output = final;
        else if (stage === '最终审核') output = { status: 'passed', issues: [], user_feedback: '', summary: '人工已接受数量差异，技术覆盖完整' };
        else throw new Error(`unexpected stage ${stage}`);
        const output_content = JSON.stringify(output);
        await fs.writeFile(path.join(workspace, payload.output_file), output_content);
        payload.validateOutput({ output_content });
        return { success: true, output_content };
      },
    },
  } as unknown as TaskRunnerContext;
  try {
    await assert.rejects(runOutlineV2(ctx, input), /synthetic disconnect/);
    assert.equal(state.outlineGenerationTask.stats.v2.phase, '子目录生成');
    ctx.previousState = structuredClone({ ...state, outlineGenerationTask: { ...state.outlineGenerationTask, status: 'error' } });
    failChildren = false;
    const result = await runOutlineV2(ctx, input);
    assert.deepEqual(called, ['一级目录', '评分分支规划', '小节字数分配', '子目录生成', '子目录生成', '最终审核']);
    assert.equal(asked.length, 3); assert.equal(keys.size, 1);
    assert.equal(result.stats.outline.current_leaf_count, 4);
    assert.match(result.stats.outline.warnings[0], /人工接受/);
    assert.equal(result.outline.outline[0].branch_id, undefined);
    assert.equal(result.stats.outline.checks.score_mapping.valid, true);
  } finally { for (const key of keys) await fs.rm(getPersistentAgentTaskPaths(key).taskRoot, { force: true, recursive: true }); }
});
