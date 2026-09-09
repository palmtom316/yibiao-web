import fs from 'node:fs';
import path from 'node:path';

export class ResourceAccessError extends Error {
  readonly statusCode = 403;
  readonly retryable = false;
  constructor(message = '文件访问超出当前授权范围') { super(message); }
}

/** Resolve only relative names, rejecting traversal and every symlink component. */
export function resolveInside(root: string, relative: string, mustExist = true): string {
  if (!relative || relative.includes('\0') || relative.includes('\\') || path.isAbsolute(relative)
    || /^[a-z][a-z0-9+.-]*:/i.test(relative) || relative.split('/').includes('..')) {
    throw new ResourceAccessError();
  }
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (!target.startsWith(`${base}${path.sep}`)) throw new ResourceAccessError();
  // lstat also catches dangling links; realpath alone would mistake those for missing files.
  let current = base;
  for (const segment of [null, ...path.relative(base, target).split(path.sep)]) {
    if (segment !== null) current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new ResourceAccessError('不允许通过符号链接访问文件');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || mustExist) throw error;
    }
  }
  return target;
}

export function readBoundedFile(root: string, relative: string, maxBytes = 20 * 1024 * 1024): Buffer {
  const target = resolveInside(root, relative);
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes) throw new ResourceAccessError('文件类型或大小不符合限制');
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}
