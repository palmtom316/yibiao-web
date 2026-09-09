import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { parseWithMineru, validateMineruArchive } from './mineru';
import { setProcessingAuthorizer, withProcessingScope } from '../security/processing';

test('MinerU denies unauthorized sends, limits retries, handles timeout and rejects corrupt archives', async (t) => {
  const fetchBefore = globalThis.fetch; const endpoints = process.env.YIBIAO_EXTERNAL_ENDPOINTS;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'mineru-test-'));
  t.after(() => { globalThis.fetch = fetchBefore; fs.rmSync(output, { recursive: true, force: true }); if (endpoints === undefined) delete process.env.YIBIAO_EXTERNAL_ENDPOINTS; else process.env.YIBIAO_EXTERNAL_ENDPOINTS = endpoints; });
  process.env.YIBIAO_EXTERNAL_ENDPOINTS = 'https://ocr.example';
  const options = { fileName: 'synthetic.pdf', bytes: Buffer.from('synthetic'), output, provider: 'mineru-accurate-api', token: 'fake', baseUrl: 'https://ocr.example', pollIntervalMs: 1 };
  let sends = 0;
  globalThis.fetch = async () => { sends++; return new Response('{}', { status: 401 }); };
  setProcessingAuthorizer(async () => ({ allowExternal: false }));
  await withProcessingScope({ kind: 'project', projectId: 1, userId: 1 }, () => assert.rejects(parseWithMineru(options), /未获准/));
  assert.equal(sends, 0);
  setProcessingAuthorizer(async () => ({ allowExternal: true }));
  await withProcessingScope({ kind: 'project', projectId: 1, userId: 1 }, () => assert.rejects(parseWithMineru(options), /401/));
  assert.equal(sends, 1);
  sends = 0; globalThis.fetch = async () => { sends++; return new Response('{}', { status: 429 }); };
  await withProcessingScope({ kind: 'project', projectId: 1, userId: 1 }, () => assert.rejects(parseWithMineru(options), /429/));
  assert.equal(sends, 3);
  globalThis.fetch = async (_url, init) => new Promise<Response>((resolve, reject) => { const timer = setTimeout(() => resolve(new Response('{}')), 1000); init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('timeout')); }, { once: true }); });
  await withProcessingScope({ kind: 'project', projectId: 1, userId: 1 }, () => assert.rejects(parseWithMineru({ ...options, timeoutMs: 10 }), /timeout/));
  assert.throws(() => validateMineruArchive(Buffer.from('broken zip')));
  const zip = new AdmZip(); zip.addFile('full.md', Buffer.from('合成 OCR 文本'));
  assert.equal(validateMineruArchive(zip.toBuffer())[0].entryName, 'full.md');
  // Change both ZIP header names without relying on adm-zip's path normalizer.
  const bad = new AdmZip(); bad.addFile('safe/a', Buffer.from('x'));
  const payload = bad.toBuffer();
  for (let offset = payload.indexOf(Buffer.from('safe/a')); offset >= 0; offset = payload.indexOf(Buffer.from('safe/a'), offset + 6)) payload.write('../bad', offset);
  assert.throws(() => validateMineruArchive(payload), /不安全路径/);
});
