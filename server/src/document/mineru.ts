// Protocol adapted from palmtom316/yibiao b079bc0, fileService.cjs (AGPL-3.0-only).
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { processingFetch, ProcessingDeniedError } from '../security/processing';
import { ApiError } from '../security/access';

export function validateMineruArchive(buffer: Buffer) {
  const entries = new AdmZip(buffer).getEntries();
  if (entries.length > 2000 || entries.reduce((n, e) => n + e.header.size, 0) > 256 * 1024 * 1024) throw new ApiError(422, 'OCR 压缩包超过解压限制');
  for (const entry of entries) {
    const name = entry.entryName;
    if (!name || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')
      || ((entry.header.attr >>> 16) & 0o170000) === 0o120000 || entry.header.size > 100 * 1024 * 1024) throw new ApiError(422, 'OCR 压缩包包含不安全路径或链接');
  }
  return entries;
}
async function readResponse(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new ApiError(422, 'OCR 下载超过大小限制'); }
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  if (reader) try {
    while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > limit) throw new ApiError(422, 'OCR 下载超过大小限制'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}
export async function parseWithMineru(options: {
  fileName: string; bytes: Buffer; output: string; provider: string; token?: string; baseUrl?: string;
  signal?: AbortSignal; pollIntervalMs?: number; timeoutMs?: number;
}) {
  const base = (options.baseUrl || 'https://mineru.net').replace(/\/+$/, '');
  const accurate = options.provider === 'mineru-accurate-api';
  if (accurate && !options.token) throw new ApiError(422, '请由管理员配置 MinerU Token');
  const controller = AbortSignal.timeout(options.timeoutMs ?? 600_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller]) : controller;
  const auth: Record<string, string> = accurate ? { Authorization: `Bearer ${options.token}` } : {};
  async function request(url: string, init: RequestInit = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      const response = await processingFetch(url, { ...init, signal });
      if (response.ok) return response;
      await response.body?.cancel();
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await delay(500 * 2 ** attempt, undefined, { signal }); continue; }
      throw new ApiError(422, `MinerU 请求失败：HTTP ${response.status}`);
    }
    throw new ApiError(422, 'MinerU 重试次数已用尽');
  }
  async function json(url: string, init: RequestInit = {}) {
    const data = JSON.parse((await readResponse(await request(url, init), 1024 * 1024)).toString());
    if (data.code !== 0) throw new ApiError(422, 'MinerU 未接受请求，请检查服务配置');
    return data.data;
  }
  const dataId = randomUUID();
  const created = await json(`${base}${accurate ? '/api/v4/file-urls/batch' : '/api/v1/agent/parse/file'}`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(accurate ? { files: [{ name: options.fileName, data_id: dataId, is_ocr: true }], model_version: 'vlm', language: 'ch', enable_table: true, enable_formula: true }
      : { file_name: options.fileName, language: 'ch', is_ocr: true, enable_table: true, enable_formula: true }),
  });
  const taskId = accurate ? created?.batch_id : created?.task_id;
  const uploadUrl = accurate ? created?.file_urls?.[0] : created?.file_url;
  if (!taskId || !uploadUrl) throw new ApiError(422, 'MinerU 缺少任务或上传地址');
  await (await request(uploadUrl, { method: 'PUT', body: new Uint8Array(options.bytes) })).body?.cancel();
  let finished: any;
  while (!finished) {
    signal.throwIfAborted();
    const state = await json(`${base}${accurate ? '/api/v4/extract-results/batch/' : '/api/v1/agent/parse/'}${encodeURIComponent(taskId)}`, { headers: auth });
    const item = accurate ? state?.extract_result?.find((x: any) => x.data_id === dataId || x.file_name === options.fileName) : state;
    if (item?.state === 'failed') throw new ApiError(422, 'MinerU 解析失败，原件保留');
    if (item?.state === 'done') { finished = item; break; }
    await delay(options.pollIntervalMs ?? 3000, undefined, { signal });
  }
  const resultUrl = accurate ? finished.full_zip_url : finished.markdown_url;
  if (!resultUrl) throw new ApiError(422, 'MinerU 未返回解析产物');
  let markdown: string; let entries: ReturnType<typeof validateMineruArchive> = []; let markdownName = '';
  if (accurate) {
    entries = validateMineruArchive(await readResponse(await request(resultUrl), 100 * 1024 * 1024));
    const entry = entries.find((e) => /(^|\/)full\.md$/i.test(e.entryName)) || entries.find((e) => e.entryName.endsWith('.md'));
    if (!entry || entry.header.size > 10 * 1024 * 1024) throw new ApiError(422, 'OCR 压缩包缺少有效 Markdown');
    markdown = entry.getData().toString('utf8'); markdownName = entry.entryName;
  } else markdown = (await readResponse(await request(resultUrl), 10 * 1024 * 1024)).toString('utf8');
  const assets: Array<{ id: string; fileName: string; mimeType: string; size: number; sha256: string }> = [];
  const warnings: string[] = []; let imageBytes = 0;
  for (const match of [...markdown.matchAll(/!\[([^\]]*)\]\((<?[^\s)]+>?)\)/g)]) {
    try {
      if (assets.length >= 300) throw new Error('图片数量超过限制');
      const name = match[2].replace(/^<|>$/g, '');
      let bytes: Buffer;
      if (accurate) {
        const entryName = path.posix.normalize(path.posix.join(path.posix.dirname(markdownName), name));
        const entry = entries.find((e) => e.entryName === entryName);
        if (!entry || entry.header.size > 20 * 1024 * 1024) throw new Error('图片缺失或过大');
        bytes = entry.getData();
      } else bytes = await readResponse(await request(new URL(name, resultUrl).toString()), 20 * 1024 * 1024);
      const png = await sharp(bytes, { limitInputPixels: 40_000_000 }).png().toBuffer(); imageBytes += png.length;
      if (imageBytes > 200 * 1024 * 1024) throw new Error('图片总量超过限制');
      const id = randomUUID(); const fileName = `${id}.png`;
      await fs.writeFile(path.join(options.output, fileName), png, { flag: 'wx', mode: 0o600 });
      assets.push({ id, fileName, mimeType: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') });
      markdown = markdown.replace(match[0], `![${match[1]}](yibiao-asset://${id})`);
    } catch (error) {
      if (error instanceof ProcessingDeniedError) throw error;
      warnings.push('OCR 结果中有图片缺失或不可转换，请核对原件');
      markdown = markdown.replace(match[0], `[图片缺失：${match[1] || '原文图片'}]`);
    }
  }
  if (!markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim()) throw new ApiError(422, 'OCR 未返回可用文本，需人工处理');
  return { markdown, assets, warnings };
}
