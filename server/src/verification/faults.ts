import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Agent, fetch, FormData } from 'undici';
import AdmZip from 'adm-zip';
if (process.env.YIBIAO_TEST_SCOPE !== 'yibiao-transform') throw Error('Synthetic scope required');
const root = path.resolve(process.cwd(), '..');
const compose = ['compose', '-p', 'yibiao-transform', '--env-file', '/tmp/yibiao-transform.env', '-f', 'docker-compose.yml', '-f', 'deploy/test/compose.override.yml', '-f', 'deploy/test/compose.basic.yml', '-f', 'deploy/test/compose.faults.yml'];
const run = async (...args: string[]) => { const started = Date.now(); await promisify(execFile)('docker', [...compose, ...args], { cwd: root, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }); return Date.now() - started; };
const base = 'https://127.0.0.1:54443'; const dispatcher = new Agent({ connect: { ca: fs.readFileSync('/tmp/yibiao-transform-certs/fullchain.pem') } });
let token = '';
async function call(route: string, body?: any, method = body === undefined ? 'GET' : 'POST', projectId?: number) {
  return fetch(`${base}/api${route}`, { dispatcher, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(projectId ? { 'x-project-id': String(projectId) } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
}
async function api(route: string, body?: any, method?: string, projectId?: number): Promise<any> {
  const res = await call(route, body, method, projectId); const data: any = await res.json(); assert.ok(res.ok, `${route}: ${res.status} ${JSON.stringify(data)}`); return data;
}
const control = async (body?: any) => { const res = await fetch('http://127.0.0.1:55439/control', { method: body ? 'POST' : 'GET', headers: { 'x-fixture-key': 'synthetic-test-only', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return res.json() as Promise<any>; };
async function until<T>(worker: () => Promise<T>, done: (value: T) => boolean, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  while (true) { const value = await worker(); if (done(value)) return value; if (Date.now() >= end) throw new Error(`Fixture timeout: ${JSON.stringify(value)}`); await new Promise((resolve) => setTimeout(resolve, 300)); }
}
const state = (id: number) => api('/technical-plan/state', undefined, 'GET', id);
const required = ['projectOverview', 'techRequirements', 'projectInfo', 'partAInfo', 'deliveryAndServiceRequirements'];
const startAnalysis = (id: number) => api('/tasks/start-bid-analysis', { mode: 'custom', selected_task_ids: required, force_rerun: true }, 'POST', id);
try {
  await run('up', '-d', '--wait', 'fixture-model', 'app', 'nginx');
  token = (await api('/login', { username: 'admin', password: 'Synthetic-Test-2026!' })).token;
  await api('/config', { text_model_provider: 'custom', api_key: 'synthetic-fixture-key', base_url: 'http://fixture-model:8800/v1', model_name: 'fixture', request_mode: 'normal', text_model_profiles: { custom: { api_key: 'synthetic-fixture-key', base_url: 'http://fixture-model:8800/v1', model_name: 'fixture', request_mode: 'normal' } } }, 'PUT');
  const projects: number[] = [];
  for (const suffix of ['A', 'B']) {
    const project = await api('/projects', { name: `故障演练-${suffix}-${Date.now()}`, bidderName: '合成测试公司' }); projects.push(project.id);
    const form = new FormData(); form.append('file', new Blob(['合成招标文件。技术评分项：实施方案；30 天内实施，完成验收。']), '合成招标.txt');
    const job = await api('/technical-plan/import-tender-document', form, 'POST', project.id);
    const result = await until(() => api(`/jobs/${job.jobId}`), (j) => ['success', 'error'].includes(j.status)); assert.equal(result.status, 'success', result.error);
    await api('/technical-plan/bid-analysis-config', { mode: 'custom', selectedTaskIds: required, bidSectionMode: 'single' }, 'POST', project.id);
  }
  const [a, b] = projects as [number, number];
  await control({ delay: 2500 });
  const stream = await call(`/events?projectId=${a}`); const reader = stream.body!.getReader(); await reader.read();
  await Promise.all([startAnalysis(a), startAnalysis(b)]); await reader.cancel();
  const complete = await Promise.all(projects.map((id) => until(() => state(id), (s) => ['success', 'error'].includes(s.bidAnalysisTask?.status))));
  for (const item of complete) assert.equal(item.bidAnalysisTask.status, 'success', item.bidAnalysisTask.error);
  const snapshot = await api('/tasks/snapshot', undefined, 'GET', a); assert.match(snapshot.technicalPlanPatch.projectOverview, /合成/);
  console.log(JSON.stringify({ step: 'disconnect-and-parallel-projects', status: 'passed', projects }));
  await control({ hold: true }); await startAnalysis(a); await until(control, (s) => s.waiting > 0);
  const termMs = await run('stop', '-t', '45', 'app'); assert.ok(termMs < 46000);
  await run('up', '-d', '--wait', 'app');
  const afterTerm = await state(a); assert.equal(afterTerm.bidAnalysisTask.status, 'error'); assert.equal((await state(b)).bidAnalysisTask.status, 'success');
  console.log(JSON.stringify({ step: 'SIGTERM', status: 'passed', elapsedMs: termMs }));
  await run('run', '--rm', '--no-deps', '-T', '-e', 'YIBIAO_TEST_SCOPE=yibiao-transform', '-v', `${root}/server/src:/app/server/src:ro`, 'migrate', 'node', '--import', 'tsx', 'src/verification/fault-seed.ts', String(a));
  await api('/tasks/start-content-generation', {}, 'POST', a);
  await until(control, (s) => s.waiting > 0);
  assert.equal((await state(a)).contentGenerationTask.status, 'running');
  const killMs = await run('kill', '-s', 'SIGKILL', 'app'); await run('up', '-d', '--wait', 'app');
  assert.equal((await state(a)).contentGenerationTask.status, 'paused'); assert.equal((await state(b)).bidAnalysisTask.status, 'success');
  const recreateMs = await run('up', '-d', '--wait', '--force-recreate', 'app');
  assert.equal((await state(a)).contentGenerationTask.status, 'paused');
  const outline = [{ id: '1', title: '恢复验收', content: '合成恢复后的正文与原件一致。' }];
  const word = await call('/export/word', { outline, project_name: '故障恢复验收' }, 'POST', b); assert.equal(word.status, 200);
  assert.match(new AdmZip(Buffer.from(await word.arrayBuffer())).readAsText('word/document.xml'), /合成恢复/);
  const report = { projects, transport: 'synthetic-local-model', disconnectedTaskContinued: true, parallelProjects: true, sigtermMs: termMs, sigkillMs: killMs, recreateMs, contentAfterRestart: 'paused', otherProjectUnaffected: true, wordAfterRecreate: 'passed' };
  fs.writeFileSync('/tmp/yibiao-verification/faults.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  await control({ hold: false, delay: 0 }).catch(() => undefined);
  await api('/config', { clear_secrets: ['text_model_profiles.custom.api_key'], base_url: '', model_name: '' }, 'PUT').catch(() => undefined);
  await dispatcher.close();
}
