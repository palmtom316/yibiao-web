import fs from 'node:fs';
import path from 'node:path';
import { readBoundedFile, resolveInside, ResourceAccessError } from '../../security/files';
import type { PiTypeBuilder } from './piJsonValidationTool';

export function createSafeFileTools(workspace: string, Type: PiTypeBuilder) {
  return ['read', 'write', 'edit', 'ls'].map((name) => ({
    name,
    label: name,
    description: `${name}: only task workspace files. Relative paths required; no shell, links or environment access.`,
    parameters: Type.Object({
      path: Type.String(),
      content: Type.Optional(Type.String()),
      oldText: Type.Optional(Type.String()),
      newText: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    async execute(_callId: string, input: { path: string; content?: string; oldText?: string; newText?: string }) {
      const target = resolveInside(workspace, input.path, name !== 'write');
      let result = '';
      if (name === 'read') result = readBoundedFile(workspace, input.path, 4 * 1024 * 1024).toString('utf8');
      else if (name === 'ls') {
        result = fs.readdirSync(target, { withFileTypes: true }).filter((e) => !e.isSymbolicLink())
          .slice(0, 1000).map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`).join('\n');
      } else {
        let content = input.content;
        if (name === 'edit') {
          const before = readBoundedFile(workspace, input.path, 4 * 1024 * 1024).toString('utf8');
          if (!input.oldText || before.split(input.oldText).length !== 2) throw new ResourceAccessError('替换目标必须唯一');
          content = before.replace(input.oldText, input.newText || '');
        }
        if (typeof content !== 'string' || Buffer.byteLength(content) > 4 * 1024 * 1024) throw new ResourceAccessError('文件内容超过限制');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
        try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }
        result = '已保存';
      }
      return { content: [{ type: 'text', text: result }], details: { path: input.path } };
    },
  }));
}
