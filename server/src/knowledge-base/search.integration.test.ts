import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../test/database';
import { searchKnowledge } from './search';

test('PostgreSQL knowledge search covers 0/100/101/235, Chinese, file names and page fallback', async (t) => {
  const { prisma } = await testDatabase(t); const timestamp = new Date().toISOString();
  await prisma.knowledgeDocument.create({ data: { documentId: 'search-doc', folderId: 'synthetic', fileName: '中文文件名称', documentDir: 'synthetic', sourcePath: 'synthetic.md', markdownPath: 'synthetic.md', status: 'success', createdAt: timestamp, updatedAt: timestamp } });
  assert.equal((await searchKnowledge(prisma, '中文', 10)).page, 1);
  for (let start = 0, end = 100; end <= 235; start = end, end = end === 100 ? 101 : 235) {
    await prisma.knowledgeItem.createMany({ data: Array.from({ length: end - start }, (_, offset) => ({ documentId: 'search-doc', itemId: `item-${start + offset}`, title: `条目 ${start + offset}`, resume: '说明', content: '检索内容', sortOrder: start + offset, createdAt: timestamp, updatedAt: timestamp })) });
    const result = await searchKnowledge(prisma, '中文', 999);
    assert.equal(result.total, end); assert.equal(result.page, Math.ceil(end / 100));
    assert.equal((result.items as any[]).length, end % 100 || 100);
    if (end === 235) break;
  }
  assert.equal((await searchKnowledge(prisma, '', 99)).total, 0);
  assert.equal((await searchKnowledge(prisma, '检索', 'bad')).page, 1);
  assert.deepEqual((await searchKnowledge(prisma, '检索', 2)).items, (await searchKnowledge(prisma, '检索', 2)).items);
  await prisma.knowledgeItem.deleteMany({ where: { sortOrder: { gte: 100 } } });
  assert.equal((await searchKnowledge(prisma, '中文', 3)).page, 1);
  await prisma.knowledgeDocument.update({ where: { documentId: 'search-doc' }, data: { status: 'extracting' } });
  assert.equal((await searchKnowledge(prisma, '检索', 1)).total, 0);
});
