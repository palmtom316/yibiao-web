const test = require('node:test');
const assert = require('node:assert/strict');
const { enforceMinimumLeafTarget, createInitialPrompt, createChildrenPrompt } = require('./outlineV2.cjs');
// Regression examples retained from upstream 6f433665 and bc6fe56d.
test('standalone roots obey strict word capacity without forced two-leaf expansion', () => {
  assert.equal(enforceMinimumLeafTarget(10, 0, 6), 10);
  assert.equal(enforceMinimumLeafTarget(4, 0, 6), 6);
  assert.equal(enforceMinimumLeafTarget(null, 0, 6), null);
  assert.equal(enforceMinimumLeafTarget(2, 0, 1, { maximumWords: 4000, sectionWords: 3000, strictSectionWords: true }), 1);
  assert.throws(() => enforceMinimumLeafTarget(4, 0, 6, { maximumWords: 4000, sectionWords: 1000, strictSectionWords: true }), /最多容纳 5 个/);
  assert.match(createInitialPrompt('', { standaloneTechnical: true }), /商务、资信、投标函/);
  assert.match(createChildrenPrompt({ standaloneTechnical: true, targetLeafCount: 4 }), /不得在根节点下面再次生成同名评分项/);
});
