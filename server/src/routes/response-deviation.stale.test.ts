import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createResponseDeviationStore } from '../response-deviation/store';
import { responseDeviationRoutes } from './response-deviation';

test('R05 confirm and export re-check the current tender source', async (t) => {
  const workspace: any = {
    id: 'synthetic-workspace',
    projectId: 42,
    status: 'stale',
    tenderHash: 'old-source-hash',
    selectedSectionId: '',
    extractorVersion: '2026-08-15-v3',
    templateTitle: 'Synthetic response table',
    statsJson: { uncoveredBlockIds: [], duplicateBlockIds: [] },
    projectFieldsJson: {},
    templateSchemaJson: {},
  };
  const rows = [{
    id: 'synthetic-row', projectId: 42, clauseNo: '1', requirementMarkdown: 'Old procurement requirement',
    requirementTitle: '1', requirementPlainText: 'Old', responseText: 'Synthetic response',
    deviationStatus: '', deviationExplanation: '', notes: '', sortOrder: 1,
  }];
  let sourceReads = 0;
  const db = {
    responseDeviationWorkspace: {
      findUnique: async () => workspace,
      update: async (args: any) => Object.assign(workspace, args.data),
    },
    responseDeviationRow: { findMany: async () => rows, findFirst: async () => rows[0] },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('responseDeviationStore', createResponseDeviationStore(db));
  app.decorate('tenderSourceService', { getSnapshot: async () => { sourceReads += 1; return { tenderHash: 'new-source-hash', selectedSectionId: '' }; } });
  app.decorate('taskService', {});
  app.addHook('onRequest', async (request: any) => { request.projectId = 42; });
  await app.register(responseDeviationRoutes);

  const confirm = await app.inject({ method: 'POST', url: '/response-deviation/confirm' });
  assert.equal(confirm.statusCode, 409);
  assert.equal(workspace.status, 'stale');
  const exported = await app.inject({ method: 'POST', url: '/response-deviation/export' });
  assert.equal(exported.statusCode, 409);
  assert.ok(sourceReads >= 1);
  assert.equal(workspace.status, 'stale');
});

test('R05 confirmed workspace still refuses export after the source hash changes', async (t) => {
  const workspace: any = {
    id: 'synthetic-workspace',
    projectId: 7,
    status: 'confirmed',
    tenderHash: 'hash-a',
    selectedSectionId: 'section-a',
    extractorVersion: '2026-08-15-v3',
    templateTitle: 'Synthetic response table',
    statsJson: { uncoveredBlockIds: [], duplicateBlockIds: [] },
    projectFieldsJson: { projectName: 'A' },
    templateSchemaJson: { columns: [{ key: 'requirement', title: '要求' }] },
  };
  const db = {
    responseDeviationWorkspace: {
      findUnique: async () => workspace,
      update: async (args: any) => Object.assign(workspace, args.data),
    },
    responseDeviationRow: { findMany: async () => [] },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('responseDeviationStore', createResponseDeviationStore(db));
  app.decorate('tenderSourceService', { getSnapshot: async () => ({ tenderHash: 'hash-b', selectedSectionId: 'section-a' }) });
  app.decorate('taskService', {});
  app.addHook('onRequest', async (request: any) => { request.projectId = 7; });
  await app.register(responseDeviationRoutes);
  const exported = await app.inject({ method: 'POST', url: '/response-deviation/export' });
  assert.equal(exported.statusCode, 409);
  assert.equal(workspace.status, 'stale');
});
