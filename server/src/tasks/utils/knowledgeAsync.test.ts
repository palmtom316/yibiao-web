import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOutlineKnowledgeItems } from './outlineGenerationHelpers';
import { loadContentKnowledgeItems, loadContentKnowledgeContentMap } from './contentGenerationHelpers';

test('Web runners await PostgreSQL knowledge queries instead of silently dropping their results', async () => {
  const service = {
    async getOutlineReferences() { return { items: [{ id: 'doc::item', title: '参考措施', resume: '许可叙述' }] }; },
    async readItems() { return [{ id: 'item', content: '已核对的正文资料' }]; },
  };
  assert.equal((await loadOutlineKnowledgeItems(service, ['doc'], () => {})).length, 1);
  assert.equal((await loadContentKnowledgeItems(service, ['doc'], () => {})).length, 1);
  assert.equal((await loadContentKnowledgeContentMap(service, ['doc'], () => {})).get('doc::item')?.content, '已核对的正文资料');
});
