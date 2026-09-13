// Review observations for HEAD 5a926ae. These intentionally demonstrate existing
// behavior; they are not passing regression tests for the proposed fixes.
// Run from server/: node --import tsx ../docs/implementation/evidence/review-2026-09-13/probes.mts
// Uses synthetic inputs, in-memory database doubles and intercepted fetch only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const clientRequire = createRequire(path.join(root, 'client/package.json'));
const source = (name: string) => import(pathToFileURL(path.join(root, 'server/src', name)).href);
process.env.JWT_SECRET = 'synthetic-review-secret-at-least-32-characters';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/yibiao_test';
process.env.YIBIAO_INTERNAL_ENDPOINTS = '';
process.env.YIBIAO_EXTERNAL_ENDPOINTS = '';
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-review-probes-'));
process.env.YIBIAO_DATA_DIR = scratch;
const { default: Fastify } = await import(pathToFileURL(serverRequire.resolve('fastify')).href);
const security = await source('security/processing.ts');
const { normalizeConfig } = await source('config/normalize.ts');
const middleware = await source('auth/middleware.ts');
const observations: Array<Record<string, unknown>> = [];

function databaseDouble() {
  const user = { id: 1, username: 'review-admin', role: 'admin', status: 'active', mustChangePassword: false, modules: '[]' };
  const project = { id: 42, ownerId: 1, allowExternalProcessing: true };
  let data = normalizeConfig({ text_model_provider: 'custom', api_key: 'synthetic-review-model-key', base_url: 'https://review.invalid/v1', model_name: 'review-model' });
  let preferences: any = { activeProjectId: 42 };
  const db: any = {
    user: {
      findUnique: async () => user,
      update: async (args: any) => Object.assign(user, args.data),
    },
    project: { findUnique: async () => project },
    appConfig: {
      upsert: async () => ({ data }), findUnique: async () => ({ data }),
      update: async (args: any) => { data = args.data.data; return { data }; },
    },
    userConfig: {
      upsert: async () => ({ data: preferences }),
      update: async (args: any) => { preferences = args.data.data; return { data: preferences }; },
    },
  };
  return { db, user, project };
}

async function observe(id: string, run: () => Promise<Record<string, unknown>>) {
  try { observations.push({ id, status: 'reproduced', ...await run() }); }
  catch (error) {
    observations.push({ id, status: 'inconclusive', error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}

try {
  await observe('R01-self-check-egress', async () => {
    const { runPiTextModelSelfCheck } = await source('agent/pi/piSelfCheck.ts');
    let authorizationChecks = 0;
    security.setProcessingAuthorizer(async () => { authorizationChecks++; throw new security.ProcessingDeniedError('synthetic deny'); });
    const previous = globalThis.fetch;
    const calls: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (url: any, init: any) => {
      calls.push({ url: String(url), authorizationPresent: Boolean(new Headers(init?.headers).get('authorization')) });
      return new Response(JSON.stringify({ error: { message: 'synthetic response' } }), { status: 400 });
    };
    try {
      await security.withProcessingScope({ kind: 'administration', userId: 1 }, () => runPiTextModelSelfCheck({ api_key: 'synthetic-review-model-key', model_name: 'review-model', base_url: 'https://review.invalid/v1' }));
      assert.equal(calls.length, 3); assert.equal(authorizationChecks, 0);
      return { allowlists: 'both empty', authorizationChecks, interceptedNetworkCalls: calls };
    } finally { globalThis.fetch = previous; }
  });

  await observe('R02-external-model-list', async () => {
    const { aiRoutes } = await source('routes/ai.ts');
    const { createProcessingAuthorizer } = await source('security/processing-authorizer.ts');
    const { db, user } = databaseDouble();
    const scopes: string[] = []; let sends = 0;
    const authorize = createProcessingAuthorizer(db);
    security.setProcessingAuthorizer(async (scope: any) => { scopes.push(scope.kind); return authorize(scope); });
    process.env.YIBIAO_EXTERNAL_ENDPOINTS = 'https://review.invalid/v1';
    const previous = globalThis.fetch;
    globalThis.fetch = async () => { sends++; return Response.json({ data: [{ id: 'review-model' }] }); };
    const app = Fastify(); app.decorate('prisma', db);
    app.addHook('onRequest', middleware.createVerifyToken(db));
    await app.register(aiRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/ai/list-models', headers: { authorization: `Bearer ${middleware.signToken(user)}`, 'x-project-id': '42' }, payload: {} });
      assert.ok(scopes.length > 0); assert.ok(scopes.every((scope) => scope === 'administration')); assert.equal(sends, 0);
      assert.match(response.body, /未获准/);
      return { projectAllowsExternalProcessing: true, validProjectHeader: true, scopeKinds: scopes, sends, httpStatus: response.statusCode, body: response.json() };
    } finally { globalThis.fetch = previous; process.env.YIBIAO_EXTERNAL_ENDPOINTS = ''; await app.close(); }
  });

  await observe('R03-sse-clean-eof', async () => {
    const esbuild = createRequire(serverRequire.resolve('tsx'))('esbuild');
    const { fetchEventSource } = clientRequire('@microsoft/fetch-event-source');
    const text = await fs.readFile(path.join(root, 'client/src/shared/api/sse.ts'), 'utf8');
    const code = esbuild.transformSync(text, { loader: 'ts', format: 'cjs', define: { 'import.meta.env.VITE_API_BASE_URL': '"/api"' } }).code;
    const previous = { window: (globalThis as any).window, document: (globalThis as any).document };
    const fakeDocument = new EventTarget(); (fakeDocument as any).hidden = false;
    let fetches = 0;
    const fakeWindow: any = new EventTarget();
    Object.assign(fakeWindow, { setTimeout, clearTimeout, fetch: async () => {
      fetches++;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(': connected\n\n')); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    (globalThis as any).document = fakeDocument; (globalThis as any).window = fakeWindow;
    const fakeHttp = { http: { get: async () => ({ data: {} }) }, TOKEN_KEY: 'review-token', getActiveProjectId: () => 42 };
    const exported: any = {}; const module = { exports: exported };
    const localRequire = (name: string) => name === './http' ? fakeHttp : name === '@microsoft/fetch-event-source' ? { fetchEventSource } : serverRequire(name);
    let manager: any;
    try {
      new Function('require', 'exports', 'module', 'window', 'localStorage', code)(localRequire, exported, module, fakeWindow, { getItem: () => 'synthetic-token' });
      manager = module.exports.sseManager; manager.start();
      await new Promise((resolve) => setTimeout(resolve, 1150));
      const stillStarted = manager.started; manager.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(fetches, 1); assert.equal(stillStarted, true);
      return { gracefulEOF: true, fetchesAfterRetryIntervalAndStart: fetches, managerStillStarted: stillStarted };
    } finally { manager?.stop(); (globalThis as any).window = previous.window; (globalThis as any).document = previous.document; }
  });

  await observe('R04-last-admin-demotion', async () => {
    const { userRoutes } = await source('routes/users.ts');
    const { db, user } = databaseDouble();
    const app = Fastify(); app.decorate('prisma', db);
    app.addHook('onRequest', middleware.createVerifyToken(db)); app.addHook('onRequest', middleware.createRequireAdmin());
    await app.register(userRoutes);
    const headers = { authorization: `Bearer ${middleware.signToken(user)}` };
    try {
      const update = await app.inject({ method: 'PUT', url: '/users/1', headers, payload: { role: 'user' } });
      const next = await app.inject({ method: 'GET', url: '/users', headers });
      assert.equal(update.statusCode, 200); assert.equal(user.role, 'user'); assert.equal(next.statusCode, 403);
      return { onlyAccount: true, updateStatus: update.statusCode, roleAfter: user.role, subsequentAdminRequest: next.statusCode };
    } finally { await app.close(); }
  });

  await observe('R05-stale-deviation-export', async () => {
    const { createResponseDeviationStore } = await source('response-deviation/store.ts');
    const { responseDeviationRoutes } = await source('routes/response-deviation.ts');
    const workspace: any = { id: 'synthetic-workspace', projectId: 42, status: 'stale', tenderHash: 'old-source-hash', selectedSectionId: '', templateTitle: 'Synthetic response table', statsJson: { uncoveredBlockIds: [], duplicateBlockIds: [] }, projectFieldsJson: {}, templateSchemaJson: {} };
    const rows = [{ id: 'synthetic-row', projectId: 42, clauseNo: '1', requirementMarkdown: 'Old procurement requirement', responseText: 'Synthetic response' }];
    let sourceReads = 0;
    const db = { responseDeviationWorkspace: { findUnique: async () => workspace, update: async (args: any) => Object.assign(workspace, args.data) }, responseDeviationRow: { findMany: async () => rows } };
    const app = Fastify();
    app.decorate('responseDeviationStore', createResponseDeviationStore(db));
    app.decorate('tenderSourceService', { getSnapshot: async () => { sourceReads++; return { tenderHash: 'new-source-hash' }; } });
    app.decorate('taskService', {}); app.addHook('onRequest', async (request: any) => { request.projectId = 42; });
    await app.register(responseDeviationRoutes);
    try {
      const confirm = await app.inject({ method: 'POST', url: '/response-deviation/confirm' });
      const exported = await app.inject({ method: 'POST', url: '/response-deviation/export' });
      assert.equal(confirm.statusCode, 200); assert.equal(exported.statusCode, 200); assert.equal(sourceReads, 0);
      return { initialStatus: 'stale', statusAfterConfirmation: workspace.status, sourceReads, exportStatus: exported.statusCode, exportedBytes: exported.rawPayload.length };
    } finally { await app.close(); }
  });

  await observe('R06-import-database-failure', async () => {
    const { createTechnicalPlanStore } = await source('technical-plan/store.ts');
    const { createWorkspacePaths } = await source('document/paths.ts');
    const layout = createWorkspacePaths(44);
    await fs.mkdir(layout.technicalPlanTenderFilesDir, { recursive: true });
    await fs.writeFile(layout.technicalPlanTenderMarkdownPath, 'OLD WORKING COPY');
    await fs.writeFile(layout.technicalPlanTenderOriginalMarkdownPath, 'OLD ORIGINAL MARKDOWN');
    const previousFile = path.join(layout.technicalPlanTenderFilesDir, 'old.md');
    await fs.writeFile(previousFile, 'OLD SOURCE MARKDOWN');
    const store = createTechnicalPlanStore({ $transaction: async () => { throw new Error('synthetic database failure'); } });
    await assert.rejects(() => store.importTenderDocument(44, [{ fileName: 'new.md', markdown: 'NEW WORKING COPY', parserLabel: 'synthetic', chars: 16, hash: 'synthetic', fallbackToLocal: true }]), /synthetic database failure/);
    const content = await fs.readFile(layout.technicalPlanTenderMarkdownPath, 'utf8');
    const previousFileExists = await fs.access(previousFile).then(() => true, () => false);
    assert.match(content, /NEW WORKING COPY/); assert.equal(previousFileExists, false);
    return { operation: 'failed', workingCopyAfterFailure: content.trim(), oldPerSourceMarkdownStillExists: previousFileExists, originalDocumentSourceBytes: 'not part of this probe; immutable originals are retained by the separate source subsystem' };
  });

  await observe('R07-task-error-persistence', async () => {
    const { TaskService } = await source('tasks/service.ts');
    const { db } = databaseDouble(); let state: any = {};
    const store = { loadTechnicalPlan: async () => state, updateTechnicalPlan: async (_id: number, partial: any) => {
      if (partial.bidAnalysisTask?.status === 'error') throw new Error('synthetic task persistence unavailable');
      state = { ...state, ...partial }; return state;
    } };
    const service = new TaskService({ prisma: db, aiService: {}, technicalPlanStore: store });
    service.registerRunner('bid-analysis', async () => { throw new Error('synthetic runner failure'); });
    let captured = '';
    const handler = (error: any) => { captured = error?.message || String(error); };
    process.on('unhandledRejection', handler);
    try {
      await service.startBidAnalysis(42, { __actorUserId: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(captured, 'synthetic task persistence unavailable');
      return { unhandledRejection: captured, defaultNode22Behavior: 'process termination when no rejection handler is installed', probeInstalledTemporaryHandler: true };
    } finally { process.off('unhandledRejection', handler); }
  });

  await observe('R08-duplicate-parse-queue', async () => {
    const { runDuplicateAnalysisTask } = await source('tasks/runners/duplicate-analysis.ts');
    const { createWorkspacePaths } = await source('document/paths.ts');
    const { parseQueue } = await source('resources/queue.ts');
    const layout = createWorkspacePaths(45); await fs.mkdir(layout.duplicateCheckSourcesDir, { recursive: true });
    const files = ['a', 'b'].map((name) => ({ id: name, file_name: `${name}.md`, file_path: `duplicate-check/sources/${name}.md`, extension: '.md', size: 100 }));
    for (const file of files) await fs.writeFile(layout.resolve(file.file_path), '# Synthetic section\n\nThis synthetic requirement appears in both documents.\n');
    let state: any = { bidFiles: files, tenderFiles: [] }; let task: any = {};
    const store = { loadDuplicateCheck: async () => state, updateDuplicateCheck: async (partial: any) => { state = { ...state, ...partial }; return state; } };
    let release!: () => void;
    const blocker = parseQueue.run(() => new Promise<void>((resolve) => { release = resolve; }));
    try {
      await security.withProcessingScope({ kind: 'project', projectId: 45, userId: 1 }, () => runDuplicateAnalysisTask({ projectId: 45, payload: { bidFiles: files, tenderFiles: [] }, workspaceStore: store, updateTask: async (partial: any) => { task = { ...task, ...partial }; return task; } }));
      const generated = await fs.readdir(layout.duplicateCheckContentDir);
      assert.equal(parseQueue.status().active, 1); assert.deepEqual(generated.sort(), ['a.md', 'b.md']);
      return { occupiedParseSlots: parseQueue.status().active, configuredParseLimit: parseQueue.status().limit, producedWhileSlotOccupied: generated, taskStatus: task.status, input: 'two tiny synthetic Markdown documents; no load or exhaustion test' };
    } finally { release(); await blocker; }
  });

  await observe('R09-active-project-config', async () => {
    const { buildMerged } = await source('config/store.ts');
    const { db } = databaseDouble();
    const config = await buildMerged(db, 1);
    assert.equal(config.activeProjectId, undefined);
    return { persistedUserConfigProjectId: 42, returnedConfigContainsProjectId: Object.hasOwn(config, 'activeProjectId') };
  });
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ sourceCommit: '5a926ae64fc5983a3219bd3f9aa10cc113af144a', evidenceKind: 'synthetic behavioral probes, not business acceptance', observations }, null, 2));
