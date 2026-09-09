import { chromium } from 'playwright-core';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

assert.equal(process.env.YIBIAO_TEST_SCOPE, 'yibiao-transform');
assert.equal(process.env.YIBIAO_PUBLIC_ORIGIN, 'https://localhost:54443');
assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'postgres');
const output = process.env.YIBIAO_VERIFICATION_OUTPUT || '/tmp';
await fs.mkdir(output, { recursive: true });
const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const projectName = `UI验收-${suffix}`;
const performanceName = `UI业绩-${suffix}`;
const assetName = `UI合同原件-${suffix}`;
const personName = `合成人员-${suffix}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--disable-dev-shm-usage'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage(); page.setDefaultTimeout(20000);
const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
let token = ''; let projectId = 0;
async function api(route: string, data?: unknown, method?: string): Promise<any> {
  const response = await context.request.fetch(`https://nginx/api${route}`, { method: method || (data === undefined ? 'GET' : 'POST'), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(projectId ? { 'X-Project-Id': String(projectId) } : {}) }, data });
  const result = await response.json(); assert.ok(response.ok(), `${route}: ${response.status()} ${JSON.stringify(result)}`); return result;
}
async function section(parent: string, child: string) {
  await page.getByRole('button', { name: parent, exact: true }).click();
  await page.getByRole('button', { name: new RegExp(child) }).last().click();
}
try {
  token = (await api('/login', { username: 'admin', password: 'Synthetic-Test-2026!' })).token;
  projectId = (await api('/projects', { name: projectName, bidderName: '合成投标公司' })).id;
  const actor = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  // Synthetic legacy knowledge covers compatibility with an already approved knowledge library.
  const folder = await prisma.knowledgeFolder.create({ data: { folderId: `ui-folder-${suffix}`, name: '合成知识资料', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  const documentId = `ui-doc-${suffix}`;
  await prisma.knowledgeDocument.create({ data: { documentId, folderId: folder.folderId, fileName: `UI方案-${suffix}.md`, documentDir: `ui/${suffix}`, sourcePath: `ui/${suffix}/source.md`, markdownPath: `ui/${suffix}/content.md`, status: 'success', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  await prisma.knowledgeItem.create({ data: { documentId, itemId: `ui-item-${suffix}`, title: '合成项目叙述', resume: '按合同完成建设与验收', content: '项目按合同完成系统建设和验收。', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  const profile = await prisma.personnelProfile.create({ data: { name: personName, createdByUserId: actor.id, updatedByUserId: actor.id } });
  for (let i = 1; i <= 2; i++) await prisma.personnelCertificate.create({ data: { profileId: profile.id, certName: `合成证书${i}`, certificateNo: `QA-${suffix}-${i}`, validityKind: 'permanent', createdByUserId: actor.id, updatedByUserId: actor.id } });
  await api('/technical-plan/outline', { outlineData: { outline: [{ id: '1', title: '类似业绩', content: '' }] } });
  await api('/technical-plan/chapter-content', { nodeId: '1', content: '保留已有人工说明。' });
  await page.goto('https://nginx');
  await page.getByPlaceholder('手机号 / admin').fill('admin'); await page.getByPlaceholder('请输入密码').fill('Synthetic-Test-2026!');
  await page.locator('.login-submit').click(); await page.getByRole('button', { name: '仪表盘', exact: true }).waitFor();
  await section('资料库', '公司资质库');
  await page.getByRole('button', { name: /新增/ }).first().click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('名称', { exact: true }).fill(assetName);
  await dialog.getByLabel('资料类别', { exact: true }).selectOption('业绩原件');
  await dialog.getByLabel('关联业绩档案').selectOption('new'); await dialog.getByPlaceholder('新业绩名称').fill(performanceName);
  await dialog.locator('input[type=file]').setInputFiles({ name: '合成合同.txt', mimeType: 'text/plain', buffer: Buffer.from('合成合同证明：金额 1000000.50 元。') });
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await section('资料库', '业绩档案');
  const row = page.getByRole('row').filter({ hasText: performanceName }); await row.getByRole('button', { name: '编辑', exact: true }).click();
  const form = page.locator('form.performance-editor');
  await form.getByLabel('合同金额（元）').fill('1000000.50'); await form.getByLabel('项目类型', { exact: true }).fill('弱电工程'); await form.getByLabel('完成日期', { exact: true }).fill('2025-12-31');
  await form.getByLabel('可复述的项目叙述').fill('按合同完成系统建设与验收。'); await form.getByLabel('允许本业绩用于对外投标引用').check();
  await form.getByLabel('关联知识文档').selectOption(documentId); await form.getByLabel('合成项目叙述', { exact: true }).check();
  await form.getByLabel(personName, { exact: true }).check(); await form.getByLabel(`${personName}的项目岗位`).fill('项目经理');
  await form.getByRole('button', { name: '保存业绩', exact: true }).click(); await form.waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(output, 'performance.png'), fullPage: true });
  await section('标书生成', '商务响应');
  await page.getByLabel('投标截止核验日期').fill('2026-09-08'); await page.getByRole('button', { name: '保存日期', exact: true }).click();
  await page.getByRole('button', { name: '人工添加要求', exact: true }).click();
  const requirementForm = page.locator('form.performance-editor');
  await requirementForm.getByLabel('类别', { exact: true }).selectOption('performance'); await requirementForm.getByLabel('要求原文', { exact: true }).fill('提供一项合同金额至少 1000000 元的类似工程业绩');
  await requirementForm.getByLabel('最低合同金额（元）').fill('1000000.00'); await requirementForm.getByRole('button', { name: '保存已核对要求' }).click(); await requirementForm.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '检索 / 核验', exact: true }).first().click(); await page.getByLabel('候选资料关键词').fill(performanceName); await page.getByRole('button', { name: '查询候选', exact: true }).click();
  await page.locator('.business-candidates button').filter({ hasText: performanceName }).click();
  await page.getByLabel('人工核验说明').fill('已人工核对合同原件、金额及日期。'); await page.getByRole('button', { name: '人工确认满足', exact: true }).click();
  await page.getByText('人工结论与引用版本已保存', { exact: true }).waitFor();
  const referenceArea = page.locator('section').filter({ has: page.getByRole('heading', { name: '将已确认资料加入技术标' }) });
  await referenceArea.locator('input[type=checkbox]').check(); await referenceArea.getByLabel('目标章节').selectOption('1'); await referenceArea.getByRole('button', { name: '加入技术标章节' }).click();
  await page.getByRole('button', { name: '生成响应版本', exact: true }).click(); await page.getByText('已保存不可变响应版本', { exact: true }).waitFor();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '正式 ZIP', exact: true }).first().click(); const file = await download; await file.saveAs(path.join(output, 'browser-business.zip'));
  await page.screenshot({ path: path.join(output, 'business.png'), fullPage: true });
  const final = await api('/business-bid'); assert.equal(final.requirements[0].match.conclusion, 'confirmed'); assert.equal(final.revisions[0].status, 'ready');
  // UI-only fixtures verify structured selection and reconnect reconciliation.
  // The real V2 runner/session checkpoints are covered separately; no model claim.
  const answers: any[] = [];
  let pending: any = { question_id: 'ui-root-selection', task_id: 'ui-fixture', project_id: projectId, question: '确认技术一级目录', options: [{ id: 'confirm', label: '确认所选目录', recommended: true }],
    metadata: { kind: 'outline-v2-selection', items: [{ id: '1', title: '实施方案', description: '合成实施' }, { id: '2', title: '质量控制', description: '合成质量' }] } };
  await page.route('**/api/agent/pending-question', (route) => route.fulfill({ json: { question: pending } }));
  await page.route('**/api/agent/answer', (route) => { answers.push(route.request().postDataJSON()); pending = null; return route.fulfill({ json: { success: true } }); });
  await section('标书生成', '生成技术方案');
  await page.locator('.agent-question-roots input').nth(1).uncheck();
  await page.getByRole('button', { name: '确定并继续', exact: true }).click();
  await page.locator('.agent-question-card').waitFor({ state: 'hidden' });
  assert.deepEqual(answers[0].answer_payload.selectedIds, ['1']);
  pending = { question_id: 'ui-custom', task_id: 'ui-fixture', project_id: projectId, question: '调整小节安排', options: [{ id: 'custom', label: '具体调整要求', custom: true, recommended: true }] };
  await page.evaluate(() => window.dispatchEvent(new Event('yibiao:sse-reconnected')));
  await page.locator('.agent-question-custom textarea').fill('保持评分对应，合并重复小节。');
  await page.getByRole('button', { name: '确定并继续', exact: true }).click();
  await page.locator('.agent-question-card').waitFor({ state: 'hidden' });
  assert.equal(answers[1].custom_answer, '保持评分对应，合并重复小节。');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ result: 'passed', projectId, projectName, checks: ['browser login', 'material classification and performance creation', 'performance amount/knowledge/team editing', 'manual candidate confirmation', 'technical chapter injection', 'formal ZIP download', 'structured root selection (UI fixture)', 'custom answer after reconnect (UI fixture)'], output }));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'browser-failure.png'), fullPage: true }).catch(() => undefined);
  console.error({ pageText: (await page.locator('body').innerText().catch(() => '')).slice(-5000), errors });
  throw error;
} finally { await context.close(); await browser.close(); await prisma.$disconnect(); }
