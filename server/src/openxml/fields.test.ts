import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplateSelection, type TemplateCandidate } from './fields';

const candidates: TemplateCandidate[] = [
  { candidate_id: 'a', text: '投标人：____', context: '', suggested_name: '投标人名称', suggested_fill_by: 'ai' },
  { candidate_id: 'b', text: '签字：____', context: '', suggested_name: '法定代表人签字', suggested_fill_by: 'manual' },
];
test('template classification is exhaustive and keeps signatures manual', () => {
  validateTemplateSelection(candidates, { fields: [{ candidate_id: 'a', name: '投标人名称', fill_by: 'ai' }, { candidate_id: 'b', name: '法定代表人签字', fill_by: 'manual' }], ignored_candidate_ids: [] });
  assert.throws(() => validateTemplateSelection(candidates, { fields: [], ignored_candidate_ids: ['a'] }), /未分类/);
  assert.throws(() => validateTemplateSelection(candidates, { fields: [{ candidate_id: 'b', name: '签字', fill_by: 'ai' }], ignored_candidate_ids: ['a'] }), /手工/);
  assert.throws(() => validateTemplateSelection(candidates, { fields: [], ignored_candidate_ids: ['a', 'a', 'b'] }), /重复/);
});
