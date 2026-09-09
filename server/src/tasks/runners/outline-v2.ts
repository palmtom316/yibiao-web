import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import type { TaskRunnerContext } from '../types';
import type { AgentTaskFile, AgentQuestionResolution } from '../../agent/types';
import { isAgentBusyResult } from '../../agent/types';
import { getPersistentAgentTaskPaths, loadPersistentAgentTask } from '../../agent/pi/piPersistentTaskStore';
import { readBoundedFile } from '../../security/files';
import { hashValue } from '../../business-bid/sources';

// Pinned upstream algorithms; desktop sync stores / Agent continuation callbacks are
// replaced by explicit, awaited PostgreSQL checkpoints and project-bound Pi sessions.
const upstream = createRequire(import.meta.url)('../vendor/outlineV2.cjs');
export interface V2Node {
  id: string; title: string; description: string; attr?: string; branch_id?: string;
  content_mode?: string; children?: V2Node[];
}
interface V2Outline { outline: V2Node[] }
interface ScoreGroup { requirement_id: string; title: string; description: string; detail_points: string[] }
interface ScorePlan {
  allow_root_changes: boolean;
  branches: { branch_id: string; root_id: string; root_title: string; score_item_level: number;
    mappings: { requirement_id: string; target_title: string; additional_titles?: string[] }[] }[];
  extra_titles: unknown[];
}
interface Review { status: string; summary: string; issues: { category: string; problem: string; repair: string; confirmation_required: boolean }[] }
interface Checkpoint {
  inputHash: string; taskKey: string; phase: string; results: Record<string, unknown>;
  decisions: Record<string, AgentQuestionResolution>;
}
interface Inputs {
  overview: string; requirements: string; proposalInstruction: string;
  referenceDocumentIds: string[]; wordOptions: Record<string, unknown>;
}
const ajv = new Ajv({ allErrors: true, strict: true });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
const schemas: Record<string, object> = {
  'outline.json': upstream.OUTLINE_JSON_SCHEMA,
  'technical-score-groups.json': upstream.TECHNICAL_SCORE_GROUPS_SCHEMA,
  'score-directory-plan.json': upstream.SCORE_DIRECTORY_PLAN_SCHEMA,
  'leaf-allocation.json': upstream.createLeafAllocationSchema(1),
  'outline-review.json': upstream.OUTLINE_REVIEW_SCHEMA,
};
function parseOutput(text: string, file: string): any {
  const value = JSON.parse(text);
  let validate = validators.get(file);
  if (!validate) { validate = ajv.compile(schemas[file]!); validators.set(file, validate); }
  if (!validate(value)) throw new Error(`${file} 结构不正确：${ajv.errorsText(validate.errors).slice(0, 1500)}`);
  return value;
}
export function validateTechnicalOutline(value: V2Outline, roots?: V2Node[]): void {
  if (!value.outline?.length || value.outline.length > 100) throw new Error('技术一级目录数量无效');
  let count = 0;
  const visit = (nodes: V2Node[], prefix = '') => nodes.forEach((node, i) => {
    count++;
    const id = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    if (node.id !== id) throw new Error('目录编号与父子位置不一致');
    if (!prefix && node.attr !== '技术') throw new Error('技术目录不能包含商务、资信或通用资料章节');
    if (/^(投标函|授权委托书|法定代表人身份证明|营业执照|商务响应|资格证明|资质证书|投标保证金)/.test(node.title)) {
      throw new Error('商务与资格材料应在商务响应清单中处理');
    }
    if (id.split('.').length > 6 || count > 2000) throw new Error('目录层数或节点数量超过上限');
    if (node.children?.length) {
      if (node.children.length < 2 || node.content_mode) throw new Error('父节点至少需要两个子节点，且不能设置正文模式');
      visit(node.children, id);
    } else if (node.content_mode !== 'ai-generate') throw new Error('技术目录叶子必须采用技术正文模式');
  });
  visit(value.outline);
  if (roots) {
    const signature = (items: V2Node[]) => items.map(({ id, title, description, attr }) => ({ id, title, description, attr }));
    if (JSON.stringify(signature(value.outline)) !== JSON.stringify(signature(roots))) {
      throw new Error('生成结果修改了人工确认的一级目录，请保留其数量、顺序、标题和说明');
    }
  }
}
export function validateScorePlan(plan: ScorePlan, groups: ScoreGroup[], roots: V2Node[]): void {
  if (plan.allow_root_changes || plan.extra_titles.length) throw new Error('当前技术分册已锁定一级目录，不能自行改变评分分支');
  const rootIds = new Set<string>(); const branchIds = new Set<string>(); const mapped = new Set<string>();
  for (const branch of plan.branches) {
    const root = roots.find((node) => node.id === branch.root_id);
    if (!root || root.title !== branch.root_title || branch.score_item_level !== 1 || rootIds.has(root.id) || branchIds.has(branch.branch_id)) throw new Error('评分分支必须与已选技术一级目录一一对应');
    rootIds.add(root.id); branchIds.add(branch.branch_id);
    if (branch.mappings.length !== 1) throw new Error('技术一级目录必须对应一个评分大项');
    for (const mapping of branch.mappings) {
      if (!groups.some((g) => g.requirement_id === mapping.requirement_id) || mapped.has(mapping.requirement_id) || mapping.target_title !== root.title || mapping.additional_titles?.length) throw new Error('评分项映射无效或重复');
      mapped.add(mapping.requirement_id);
    }
  }
  if (rootIds.size !== roots.length) throw new Error('有已确认的技术一级目录缺少评分分支');
}
export function validateAllocation(value: any, branches: ScorePlan['branches'], target: number): void {
  const ids = new Set(branches.map((b) => b.branch_id));
  if (value.mode !== 'allocated' || value.target_ai_leaf_count !== target || value.fixed_ai_leaf_count !== 0 || value.allocatable_ai_leaf_count !== target || value.allocations.length !== ids.size) throw new Error('小节分配与字数目标不一致');
  let total = 0;
  for (const item of value.allocations) {
    if (!ids.delete(item.branch_id) || !Number.isSafeInteger(item.leaf_count) || item.leaf_count < 1) throw new Error('小节分配分支重复、遗漏或数量无效');
    total += item.leaf_count;
  }
  if (ids.size || total !== target) throw new Error('小节分配总数不符合字数目标');
}

export async function runOutlineV2(ctx: TaskRunnerContext, input: Inputs) {
  const agent = ctx.agentService;
  if (!agent?.requestQuestion) throw new Error('目录 V2 需要可用的 Pi 确认通道');
  const store = ctx.workspaceStore as { loadTechnicalPlan(): Promise<any> };
  const stored = await store.loadTechnicalPlan();
  const knowledge = ctx.knowledgeBaseService as { readReferences?(ids: string[], options: object): Promise<any[]> };
  // This adapter is asynchronous; never call .map on a PostgreSQL Promise.
  const references = knowledge?.readReferences ? await knowledge.readReferences(input.referenceDocumentIds, { includeMarkdown: true, includeItems: false }) : [];
  const knowledgeFiles: AgentTaskFile[] = references.map((r, i) => ({ path: `参考知识库/参考资料-${i + 1}.md`, content: String(r.markdown || '') })).filter((f) => f.content);
  const inputHash = hashValue({ ...input, knowledgeFiles });
  const previous = (ctx.previousState as any)?.outlineGenerationTask;
  const prior = previous?.stats?.v2 as Checkpoint | undefined;
  const canResume = previous?.status !== 'success' && prior?.inputHash === inputHash && loadPersistentAgentTask(prior.taskKey);
  const checkpoint: Checkpoint = canResume ? structuredClone(prior!) : {
    inputHash, taskKey: `outline-v2-p${ctx.projectId}-${randomUUID()}`, phase: 'initial', results: {}, decisions: {},
  };
  let created = Boolean(canResume);
  let current = await ctx.updateTask({ status: 'running' }, true);
  const logs = [...(current.logs || []), canResume ? '目录 V2：已恢复上次完成的阶段与人工选择' : '目录 V2：开始生成技术分册一级目录'];
  const persist = async (phase: string, progress: number, message?: string) => {
    checkpoint.phase = phase;
    if (message && logs.at(-1) !== message) logs.push(message);
    current = await ctx.updateTask({ status: 'running', progress, logs: [...logs], stats: { ...(current.stats as object), v2: structuredClone(checkpoint) } }, true);
  };
  const file = (path: string, content: unknown): AgentTaskFile => ({ path, content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) });
  const stage = async (name: string, progress: number, prompt: string, output: string, files: AgentTaskFile[], check?: (value: any) => void) => {
    if (checkpoint.results[name]) return structuredClone(checkpoint.results[name]) as any;
    await persist(name, progress, `目录 V2：${name}`);
    const result = await agent.runTask({
      task_id: `${current.task_id}-${name}`, project_id: ctx.projectId, title: `目录 V2 · ${name}`,
      prompt: `${prompt}\n\nWeb 执行约束：本阶段的人工确认由主程序统一展示，请直接生成本阶段文件，不调用 ask-user。仅生成技术分册，禁止商务/资信章节；一级目录一经确认不得变更。若材料不足，请停止并说明错误，不编造评分项。`,
      output_file: output, files, json_validation_schemas: schemas, max_retries: 1,
      persistent_task: { task_key: checkpoint.taskKey, mode: created ? 'resume' : 'create', initial_stage: name, state: { project_id: ctx.projectId } },
      validateOutput: (candidate) => { const value = parseOutput(candidate.output_content || '', output); check?.(value); return value; },
    });
    if (isAgentBusyResult(result)) throw new Error('智能体正在处理其他任务，请稍后重试；已完成阶段已保存');
    created = true;
    const value = parseOutput(result.output_content, output); check?.(value);
    checkpoint.results[name] = value;
    await persist(name, progress);
    return structuredClone(value) as any;
  };
  const ask = async (name: string, progress: number, question: string, options: any[], metadata?: object) => {
    if (checkpoint.decisions[name]) return checkpoint.decisions[name];
    await persist(name, progress, '等待人工确认；关闭页面后可重新打开继续');
    const answer = await agent.requestQuestion!({ task_id: current.task_id, task_title: '目录 V2', project_id: ctx.projectId, question, options, metadata });
    if (answer.option_id === 'defer') throw new Error('已暂停目录确认；重新生成时继续已完成的阶段');
    if (!options.some((o) => o.id === answer.option_id)) throw new Error('目录确认选项无效');
    checkpoint.decisions[name] = answer;
    await persist(name, progress);
    return answer;
  };
  const rootsResult = await stage('一级目录', 10, upstream.createInitialPrompt(
    '严格按照技术评分信息.md 的技术评分大项原文和顺序组织目录；项目概述仅提供背景。', { standaloneTechnical: true }), 'outline.json', [
      file('技术评分信息.md', input.requirements), file('项目概述.md', input.overview), file('响应文件要求.md', input.proposalInstruction || stored.bidAnalysisTasks?.responseFileRequirements?.content || ''),
    ], (value) => { validateTechnicalOutline(value); if (value.outline.some((n: V2Node) => n.children?.length)) throw new Error('此阶段只生成一级目录'); });
  const selection = await ask('选择一级目录', 30, '请选择本技术分册保留的一级目录。取消评分大项会影响覆盖完整性，后续审核会提示缺项。', [
    { id: 'confirm', label: '确认所选目录', recommended: true }, { id: 'defer', label: '暂停生成' },
  ], { kind: 'outline-v2-selection', items: rootsResult.outline, title: '技术一级目录' });
  const selectedIds = (selection.answer_payload as any)?.selectedIds;
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some((id) => !rootsResult.outline.some((r: V2Node) => r.id === id))) throw new Error('请选择至少一个有效的技术一级目录');
  const roots: V2Node[] = upstream.renumberOutline(rootsResult.outline.filter((r: V2Node) => selectedIds.includes(r.id)));
  const groupsPath = getPersistentAgentTaskPaths(checkpoint.taskKey).workspaceDir;
  const plan: ScorePlan = await stage('评分分支规划', 40, upstream.createScorePlanningPrompt({ standaloneTechnical: true }), 'score-directory-plan.json', [file('outline.json', { outline: roots }), ...knowledgeFiles], (value) => {
    const groups = parseOutput(readBoundedFile(groupsPath, 'technical-score-groups.json', 2 * 1024 * 1024).toString(), 'technical-score-groups.json');
    validateScorePlan(value, groups.groups, roots);
  });
  // Save all companion outputs in the database too; a later session may edit files.
  const groups: ScoreGroup[] = (checkpoint.results.groups as ScoreGroup[]) || parseOutput(readBoundedFile(groupsPath, 'technical-score-groups.json', 2 * 1024 * 1024).toString(), 'technical-score-groups.json').groups;
  checkpoint.results.groups = groups;
  const mapped = new Set(plan.branches.flatMap((b) => b.mappings.map((m) => m.requirement_id)));
  const missing = groups.filter((g) => !mapped.has(g.requirement_id));
  await ask('确认评分分支', 45, `技术评分项在一级目录对应，共 ${plan.branches.length} 个分支。${missing.length ? `未选择的评分项：${missing.map((g) => g.title).join('、')}；确认将保留此缺项提示。` : '所选分支均已关联评分项。'}`, [
    { id: 'confirm', label: '确认评分对应', recommended: true }, { id: 'defer', label: '暂停并检查资料' },
  ], { kind: 'outline-v2-plan', items: plan.branches.map((b) => ({ title: b.root_title })), title: '评分分支' });
  const lockedRoots = upstream.attachBranchIdsToRoots(roots, plan) as V2Node[];
  const wordOptions = upstream.normalizeWordControlOptions({ minimumWords: Number(input.wordOptions.minWordsWan || 0) * 10000,
    maximumWords: Number(input.wordOptions.maxWordsWan || 0) * 10000, sectionWords: Number(input.wordOptions.wordsPerSectionWan || 0) * 10000, strictSectionWords: input.wordOptions.forceSectionWords === true });
  const target: number | null = upstream.enforceMinimumLeafTarget(upstream.deriveTargetLeafCount(wordOptions), 0, plan.branches.length, wordOptions);
  let allocations: any[] = plan.branches.map((b) => ({ branch_id: b.branch_id, ...(target === null ? {} : { leaf_count: target }) }));
  if (target !== null && plan.branches.length > 1) {
    const allocation = await stage('小节字数分配', 50, upstream.createLeafAllocationPrompt({ standaloneTechnical: true }), 'leaf-allocation.json', [
      file('outline.json', { outline: lockedRoots }), file('leaf-allocation-context.json', { mode: 'allocated', target_ai_leaf_count: target, fixed_ai_leaf_count: 0, allocatable_ai_leaf_count: target, technical_branches: plan.branches }),
    ], (value) => validateAllocation(value, plan.branches, target));
    allocations = allocation.allocations;
  }
  const checkFinal = (value: V2Outline) => {
    validateTechnicalOutline(value, lockedRoots);
    if (!upstream.buildOutlineReviewContext({ outline: value, scoreDirectoryPlan: plan, targetLeafCount: target }).score_mapping.valid) throw new Error('生成结果缺少已确认评分映射');
  };
  let outline: V2Outline = await stage('子目录生成', 55, upstream.createChildrenPrompt({ hasOriginalPlan: false, originalOnly: false, targetLeafCount: target, allowRootChanges: false, standaloneTechnical: true }), 'outline.json', [
    file('outline.json', { outline: lockedRoots }), file('leaf-allocation.json', { mode: target === null ? 'agent-decides' : 'allocated', target_ai_leaf_count: target, fixed_ai_leaf_count: 0, allocatable_ai_leaf_count: target, allocations }),
  ], checkFinal);
  let warning = '';
  for (let attempt = 0; target !== null && upstream.countAiLeaves(outline.outline) !== target; attempt++) {
    const count = upstream.countAiLeaves(outline.outline);
    const options = [{ id: 'accept', label: '接受当前结果', recommended: true }, ...(attempt < 2 ? [{ id: 'adjust', label: '允许自动调整一次' }, { id: 'custom', label: '按具体要求调整', custom: true }] : []), { id: 'defer', label: '暂停生成' }];
    const answer = await ask(`小节数量确认-${attempt}`, 75, `目标 ${target} 个 AI 正文小节，当前 ${count} 个。目录覆盖优先于凑数，请确认处理方式。`, options);
    if (answer.option_id === 'accept') { warning = `人工接受小节数量差异：目标 ${target}，当前 ${count}`; break; }
    outline = await stage(`小节调整-${attempt}`, 78, `${upstream.createLeafAdjustmentPrompt(target, count)}\n主程序已收到人工决定：${answer.custom_answer || '允许调整一次'}；无需再询问。`, 'outline.json', [file('outline.json', outline), file('score-directory-plan.json', plan)], checkFinal);
  }
  const context = upstream.buildOutlineReviewContext({ outline, scoreDirectoryPlan: plan, targetLeafCount: target });
  const review: Review = await stage('最终审核', 88, `${upstream.createOutlineReviewPrompt({ targetLeafCount: target, actualLeafCount: upstream.countAiLeaves(outline.outline), allowRootChanges: false })}\n本阶段仅审核并写 outline-review.json，不修改 outline.json。人工确认和修复由主程序下一阶段执行。${warning}`, 'outline-review.json', [file('outline.json', outline), file('score-directory-plan.json', plan), file('outline-review-context.json', context)]);
  if (review.issues.length) {
    const answer = await ask('审核处理', 92, review.issues.map((issue) => `${issue.problem}\n建议：${issue.repair}`).join('\n\n'), [
      { id: 'repair', label: '按建议修复', recommended: true }, { id: 'keep', label: '保留当前目录' }, { id: 'custom', label: '调整修复要求', custom: true }, { id: 'defer', label: '暂停生成' },
    ]);
    if (answer.option_id !== 'keep') outline = await stage('审核修复', 95, `按以下已确认审核意见修复 outline.json，保留已确认根目录和评分映射，不再询问。\n${JSON.stringify(review.issues)}\n${answer.custom_answer || ''}`, 'outline.json', [file('outline.json', outline)], checkFinal);
  }
  checkFinal(outline);
  await persist('完成', 98, '目录 V2 的生成、人工确认和审核已完成');
  const finalContext = upstream.buildOutlineReviewContext({ outline, scoreDirectoryPlan: plan, targetLeafCount: target });
  return { outline: upstream.stripOutlineInternalFields(outline), groups, stats: {
    ...(current.stats as object), v2: checkpoint, outline: { phase: 'done', target_leaf_count: target, current_leaf_count: upstream.countAiLeaves(outline.outline), review, checks: finalContext,
      warnings: [...(warning ? [warning] : []), ...missing.map((g) => `未选择评分项：${g.title}`)] },
  } };
}
