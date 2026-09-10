import { checkUploadLimits } from '../resources/uploads';
// multipart 上传仅收字节缓冲（不解析），调用方自行决定落盘与是否再解析；
// 单 part 失败不阻断整批（收集到 errors）。
// 招标/废标导入一律走 document/imports.startImport → persistSource（先持久化原件再解析）；
// 旧的 collectParsedImports（临时文件先解析后删原件）已删除，P2-04 后不得恢复。
import path from 'node:path';
import type { FastifyRequest } from 'fastify';

export interface RawUpload {
  fileName: string;
  ext: string;
  buffer: Buffer;
}

export interface CollectedRawUploads {
  files: RawUpload[];
  errors: string[];
}

// 仅收集 multipart 字节缓冲（不落临时文件、不解析）。调用方自行持久化或再 parseDocument。
export async function collectRawUploads(req: FastifyRequest): Promise<CollectedRawUploads> {
  const files: RawUpload[] = [];
  let totalBytes = 0;
  let fileCount = 0;
  const errors: string[] = [];
  for await (const part of req.files()) {
    const fileName = String(part.filename || 'upload');
    const ext = path.extname(fileName).toLowerCase();
    try {
      const buffer = await part.toBuffer();
      totalBytes += buffer.length;
      checkUploadLimits(buffer.length, totalBytes, ++fileCount);
      files.push({ fileName, ext, buffer });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 413) throw error;
      errors.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { files, errors };
}
