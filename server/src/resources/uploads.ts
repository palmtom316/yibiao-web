export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;
export function checkUploadLimits(size: number, total: number, count: number): void {
  if (size > MAX_FILE_BYTES || total > MAX_UPLOAD_BYTES || count > MAX_UPLOAD_FILES) {
    throw Object.assign(new Error('每个文件最多 100 MiB，每批最多 10 个文件、合计 200 MiB'), { statusCode: 413 });
  }
}
