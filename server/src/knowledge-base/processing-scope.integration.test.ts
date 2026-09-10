import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../test/database';
import { createKnowledgeBaseStore } from './store';
import { withProcessingScope } from '../security/processing';

// P2-01 回归：知识读取函数不得改写调用方的处理作用域（includesSharedData 在任务启动时冻结，
// 启动逻辑读取 referenceKnowledgeDocumentIds/章节引用后置位，而不是靠读取时的可变对象突变）。
test('knowledge reference reads never mutate the caller processing scope', async (t) => {
  const { prisma } = await testDatabase(t);
  const user = await prisma.user.create({ data: { username: 'scope-freeze', password: 'synthetic', status: 'active', modules: '["knowledge-base"]' } });
  const kb = createKnowledgeBaseStore(prisma);
  const folder = await kb.createFolder('范围');
  const timestamp = new Date().toISOString();
  const documentId = randomUUID();
  await prisma.knowledgeDocument.create({ data: { documentId, folderId: folder.id, fileName: '范围.docx', documentDir: `documents/${documentId}`, sourcePath: '', markdownPath: '', status: 'success', createdAt: timestamp, updatedAt: timestamp } });
  const scope = { kind: 'project' as const, projectId: 1, userId: user.id, includesSharedData: false };
  await withProcessingScope(scope, async () => {
    const refs = await kb.readReferences([documentId]);
    assert.equal(refs.length, 1);
    await kb.getOutlineReferences([documentId]);
  });
  assert.equal(scope.includesSharedData, false, '知识读取不得改写任务作用域标记');
});
