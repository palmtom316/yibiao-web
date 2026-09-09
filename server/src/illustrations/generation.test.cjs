const test = require('node:test');
const assert = require('node:assert/strict');
const { applyGeneratedIllustrationsToDocument } = require('./vendor/contentIllustrationGeneration.cjs');
test('upstream illustration composition preserves multiple figures and is idempotent', () => {
  const sections = { '1.1': { status: 'success', content: '人工已核对的正文。' } };
  const plan = { items: ['one', 'two'].map((id) => ({ item_id: id, title: `图 ${id}`, kind: 'html', placement: 'after', section_ids: ['1.1'], generation: { status: 'success', asset_url: `yibiao-asset://${id}` } })) };
  const first = applyGeneratedIllustrationsToDocument(plan, null, sections);
  const second = applyGeneratedIllustrationsToDocument(plan, null, first.sections);
  assert.equal(first.sections['1.1'].content, second.sections['1.1'].content);
  assert.equal((first.sections['1.1'].content.match(/yibiao-asset:/g) || []).length, 2);
  assert.match(first.sections['1.1'].content, /人工已核对/);
});
test('Mermaid composition prefers its persisted asset to transient code', () => {
  const result = applyGeneratedIllustrationsToDocument({ items: [{ item_id: 'chart', title: '流程', kind: 'mermaid', placement: 'after', section_ids: ['1'], generation: { status: 'success', code: 'flowchart TD\nA-->B', asset_url: 'yibiao-asset://saved-chart' } }] }, null, { '1': { status: 'success', content: '正文' } });
  assert.match(result.sections['1'].content, /yibiao-asset:\/\/saved-chart/);
  assert.doesNotMatch(result.sections['1'].content, /```mermaid/);
});
