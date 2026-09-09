// Synthetic local acceptance only. This never targets an arbitrary deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Agent, fetch, FormData } from 'undici';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from 'docx';
import AdmZip from 'adm-zip';

const base = process.env.TEST_BASE_URL || 'https://127.0.0.1:54443';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Smoke test must target localhost');
const dispatcher = new Agent({ connect: { ca: fs.readFileSync(process.env.TEST_CA_PATH || '/tmp/yibiao-transform-certs/fullchain.pem') } });
const password = 'Synthetic-Test-2026!';
let token = '';
async function call(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', projectId?: number, access = token) {
  const response = await fetch(`${base}/api${route}`, {
    dispatcher,
    method,
    headers: { ...(access ? { authorization: `Bearer ${access}` } : {}), ...(projectId ? { 'x-project-id': String(projectId) } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}
async function json(route: string, body?: unknown, method?: string, projectId?: number, access = token): Promise<any> {
  const response = await call(route, body, method, projectId, access);
  let data: any = await response.json();
  assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(data)}`);
  if (data?.jobId) {
    const deadline = Date.now() + 180000;
    while (!['success', 'error', 'cancelled'].includes(data.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const task = await call(`/jobs/${data.jobId}`, undefined, 'GET', projectId, access); data = await task.json();
    }
    assert.equal(data.status, 'success', data.error || 'job timed out'); return data.result;
  }
  return data;
}
try {
  let login = await call('/login', { username: 'admin', password: 'admin' });
  if (login.ok) {
    const initial: any = await login.json();
    assert.equal(initial.password_change_required, true);
    const changed = await json('/change-initial-password', { newPassword: password, confirmPassword: password }, 'POST', undefined, initial.password_change_token);
    token = changed.token;
    assert.equal((await call('/login', { username: 'admin', password: 'admin' })).status, 401);
  } else token = (await json('/login', { username: 'admin', password })).token;
  assert.ok(token);
  const projects = await json('/projects');
  const list = Array.isArray(projects) ? projects : projects.projects;
  const project = list.find((p: any) => p.name === '合成验收项目') || await json('/projects', { name: '合成验收项目', bidderName: '合成测试公司' });
  const pid = project.id;
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('合成招标文件：技术服务需求')] }), new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('条款')] }), new TableCell({ children: [new Paragraph('提供维护服务')] })] })] })] }] });
  const docx = await Packer.toBuffer(doc);
  const form = new FormData(); form.append('file', new Blob([new Uint8Array(docx)]), '合成招标.docx');
  await json('/technical-plan/import-tender-document', form, 'POST', pid);
  const markdown = await (await call('/technical-plan/tender-markdown', undefined, 'GET', pid)).text();
  assert.match(markdown, /提供维护服务/);
  const outline = [{ id: '1', title: '服务方案', content: '合成测试公司按要求提供维护服务。' }];
  await json('/technical-plan/outline', { outlineData: { outline, project_name: '合成验收项目' } }, 'POST', pid);
  await json('/technical-plan/chapter-content', { nodeId: '1', content: outline[0].content }, 'POST', pid);
  const exported = await call('/export/word', { outline, project_name: project.name, base_dir: '/etc' }, 'POST', pid);
  assert.equal(exported.status, 200);
  const zip = new AdmZip(Buffer.from(await exported.arrayBuffer()));
  assert.match(zip.readAsText('word/document.xml'), /合成测试公司/);
  const excess = new FormData();
  for (let i = 0; i < 11; i++) excess.append('file', new Blob(['test']), `file${i}.txt`);
  const tooMany = await call('/technical-plan/import-tender-document', excess, 'POST', pid);
  assert.equal(tooMany.status, 413);
  await tooMany.body?.cancel();
  const phone = '19900000001';
  const registration = await call('/register', { phone, password, displayName: '合成用户' });
  await registration.body?.cancel();
  const account = (await json('/users')).users.find((u: any) => u.username === phone);
  if (account.status === 'pending') await json(`/users/${account.id}/approve`, {});
  const ordinaryToken = (await json('/login', { username: phone, password })).token;
  const denied = await call('/technical-plan/state', undefined, 'GET', pid, ordinaryToken);
  assert.equal(denied.status, 403); await denied.body?.cancel();
  const deniedEvents = await call(`/events?projectId=${pid}`, undefined, 'GET', undefined, ordinaryToken);
  assert.equal(deniedEvents.status, 403); await deniedEvents.body?.cancel();
  const events = await call(`/events?projectId=${pid}`, undefined, 'GET');
  assert.equal(events.status, 200);
  const reader = events.body!.getReader();
  const first = await reader.read(); assert.match(Buffer.from(first.value!).toString(), /connected/);
  await reader.cancel();
  assert.ok((await json('/tasks/snapshot', undefined, 'GET', pid)).technicalPlanPatch.outlineData);
  console.log(JSON.stringify({ result: 'passed', projectId: pid, checks: ['first-password-change', 'DOCX/table import', 'saved content to Word', 'upload file-count limit', 'two-user project/SSE isolation', 'SSE connect and authoritative snapshot'] }));
} finally { await dispatcher.close(); }
