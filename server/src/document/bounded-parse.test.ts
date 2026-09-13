import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseQueue } from '../resources/queue';
import { parseFileInBoundedWorker } from './bounded-parse';
import { runDuplicateAnalysisTask } from '../tasks/runners/duplicate-analysis';
import { withProcessingScope } from '../security/processing';

test('R08 duplicate parse waits for the shared parse slot', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-dup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previous = process.env.YIBIAO_DATA_DIR;
  process.env.YIBIAO_DATA_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.YIBIAO_DATA_DIR;
    else process.env.YIBIAO_DATA_DIR = previous;
  });

  const projectId = 45;
  const layout = (await import('./paths')).createWorkspacePaths(projectId);
  await fs.mkdir(layout.duplicateCheckSourcesDir, { recursive: true });
  const files = ['a', 'b'].map((name) => ({
    id: name,
    file_name: `${name}.md`,
    file_path: `duplicate-check/sources/${name}.md`,
    extension: '.md',
    size: 100,
  }));
  for (const file of files) {
    await fs.writeFile(layout.resolve(file.file_path), '# Synthetic section\n\nThis synthetic requirement appears in both documents.\n');
  }

  let state: any = { bidFiles: files, tenderFiles: [] };
  let task: any = {};
  const store = {
    loadDuplicateCheck: async () => state,
    updateDuplicateCheck: async (partial: any) => { state = { ...state, ...partial }; return state; },
  };
  let release!: () => void;
  const blocker = parseQueue.run(() => new Promise<void>((resolve) => { release = resolve; }));
  const running = withProcessingScope({ kind: 'project', projectId, userId: 1 }, () => runDuplicateAnalysisTask({
    projectId,
    payload: { bidFiles: files, tenderFiles: [] },
    workspaceStore: store,
    updateTask: async (partial: any) => { task = { ...task, ...partial }; return task; },
    prisma: {} as never,
    aiService: {} as never,
    agentService: undefined,
    knowledgeBaseService: {},
    config: {},
    taskControl: { queueScopeId: 'dup', pauseRequested: false, isPauseRequested: () => false, requestPause: async () => task },
    previousState: {},
  } as never));

  await new Promise((resolve) => setTimeout(resolve, 80));
  const generatedWhileBlocked = await fs.readdir(layout.duplicateCheckContentDir).catch(() => []);
  assert.equal(parseQueue.status().active, 1);
  assert.equal(generatedWhileBlocked.length, 0, 'duplicate parse must not bypass the occupied parse slot');
  release();
  await blocker;
  await running;
  const generated = await fs.readdir(layout.duplicateCheckContentDir);
  assert.deepEqual(generated.sort(), ['a', 'b']);
  assert.equal(task.status, 'success');
});

test('bounded worker writes markdown without inlining image bytes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-worker-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'note.md');
  const output = path.join(dir, 'out');
  await fs.writeFile(source, '# Title\n\nbody\n');
  const result = await parseFileInBoundedWorker(source, output);
  assert.match(result.markdown, /body/);
  assert.equal(result.markdown.includes('data:image'), false);
  assert.equal(await fs.readFile(path.join(output, 'content.md'), 'utf8').then((text) => text.includes('body')), true);
});
