import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { splitContentSentences, buildTenderSourceMatcher } from './duplicateAnalysisHelpers';
test('long unpunctuated content splits within a bounded time and preserves text', () => {
  const text = '工程设备实施与验收技术要求'.repeat(20000) + '。';
  const started = performance.now(); const result = splitContentSentences(text);
  assert.ok(performance.now() - started < 3000, 'sentence splitting must not repeatedly scan the growing prefix');
  assert.equal(result.length, 1); assert.equal(result[0]!.normalized, text);
  assert.equal(result[0]!.sentence.length, 603, 'display text is capped independently from matching content');
});
test('near-source matcher counters cannot leak between repeated or unrelated queries', () => {
  const sentences = splitContentSentences('投标人应当根据工程施工实际情况编制项目实施和安全管理专项方案。');
  const matcher = buildTenderSourceMatcher(sentences);
  const similar = splitContentSentences('投标人应当根据工程施工实际情况编制项目实施和安全管理的专项方案。')[0]!;
  const unrelated = splitContentSentences('企业必须提供不同型号设备的备品备件以及硬件维护工具和运输车辆。')[0]!;
  const expected = matcher.match(similar); assert.ok(expected);
  for (let i = 0; i < 20; i++) { assert.equal(matcher.match(unrelated), null); assert.deepEqual(matcher.match(similar), expected); }
});
