import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveProjectId } from './resolveActiveProject';

test('R09 waits for config and restores a non-first project', () => {
  const projects = [{ id: 1 }, { id: 42 }, { id: 7 }];
  assert.equal(resolveActiveProjectId({ projectsLoading: false, configLoading: true, configError: false, projects, hint: 42 }).ready, false);
  assert.equal(resolveActiveProjectId({ projectsLoading: true, configLoading: false, configError: false, projects, hint: 42 }).ready, false);
  assert.deepEqual(
    resolveActiveProjectId({ projectsLoading: false, configLoading: false, configError: false, projects, hint: 42 }),
    { ready: true, id: 42, fallbackToFirst: false },
  );
  assert.deepEqual(
    resolveActiveProjectId({ projectsLoading: false, configLoading: false, configError: false, projects, hint: null }),
    { ready: true, id: 1, fallbackToFirst: true },
  );
  assert.equal(resolveActiveProjectId({ projectsLoading: false, configLoading: false, configError: true, projects, hint: undefined }).ready, false, 'transient config failure is not treated as no preference');
  assert.deepEqual(
    resolveActiveProjectId({ projectsLoading: false, configLoading: false, configError: false, projects: [{ id: 9 }], hint: 42 }),
    { ready: true, id: 9, fallbackToFirst: true },
  );
});
