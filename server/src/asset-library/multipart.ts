import { checkUploadLimits } from '../resources/uploads';
// 资产/资质上传的共享 multipart 工具：mime 推断 + part 收集 + 文件落盘。
// asset-library 与 personnel 路由共用。落盘路径由调用方通过 buildPath 注入（两库目录结构不同）。
import path from 'node:path';
import fsp from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AssetFileMeta } from './store';

export const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain', '.md': 'text/markdown',
};

export function mimeFor(filename: string, fallback?: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] || fallback || 'application/octet-stream';
}

export interface UploadedFile {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

// multipart part 鸭子类型：file part 带 filename，field part 带 value。跨 @fastify/multipart 版本稳定。
interface AssetPart {
  fieldname: string;
  filename?: string;
  mimetype?: string;
  value?: string;
  toBuffer(): Promise<Buffer>;
}

export async function collectAssetParts(req: FastifyRequest): Promise<{
  fields: Record<string, string | string[]>;
  files: UploadedFile[];
}> {
  const fields: Record<string, string | string[]> = {};
  const files: UploadedFile[] = [];
  let totalBytes = 0;
  const parts = (req as unknown as { parts(): AsyncIterable<AssetPart> }).parts();
  for await (const part of parts) {
    if (typeof part.filename === 'string') {
      const buffer = await part.toBuffer();
      totalBytes += buffer.length;
      checkUploadLimits(buffer.length, totalBytes, files.length + 1);
      files.push({ filename: part.filename, mimetype: part.mimetype || mimeFor(part.filename), buffer });
    } else {
      const name = part.fieldname;
      const value = typeof part.value === 'string' ? part.value : String(part.value ?? '');
      const existing = fields[name];
      if (existing === undefined) fields[name] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else fields[name] = [existing, value];
    }
  }
  return { fields, files };
}

export function asString(v: string | string[] | undefined): string {
  if (v === undefined) return '';
  return Array.isArray(v) ? v[0] ?? '' : v;
}

export function asStringList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
}

// 落盘上传文件并产出元数据。buildPath(fileId, ext) 返回目标绝对路径。
export async function persistUploaded(
  uploads: UploadedFile[],
  buildPath: (fileId: string, ext: string) => string,
): Promise<AssetFileMeta[]> {
  const metas: AssetFileMeta[] = [];
  const written: string[] = [];
  try {
  for (const upload of uploads) {
    const ext = path.extname(upload.filename).toLowerCase();
    const fileId = randomUUID();
    const target = buildPath(fileId, ext);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const handle = await fsp.open(target, 'wx', 0o600);
    written.push(target);
    try { await handle.writeFile(upload.buffer); } finally { await handle.close(); }
    metas.push({
      fileId,
      sha256: createHash('sha256').update(upload.buffer).digest('hex'),
      originalName: path.basename(upload.filename),
      mimeType: mimeFor(upload.filename),
      size: upload.buffer.length,
      ext,
    });
  }
  return metas;
  } catch (error) {
    await Promise.all(written.map((target) => fsp.rm(target, { force: true }).catch(() => undefined)));
    throw error;
  }
}

// A concurrent version conflict must not leave newly uploaded, unreferenced bytes.
export async function withUploadedFiles<T>(uploads: UploadedFile[], buildPath: (id: string, ext: string) => string, commit: (files: AssetFileMeta[]) => Promise<T>): Promise<T> {
  const files = await persistUploaded(uploads, buildPath);
  try { return await commit(files); }
  catch (error) {
    await Promise.all(files.map((file) => fsp.rm(buildPath(file.fileId, file.ext), { force: true }).catch(() => undefined)));
    throw error;
  }
}
