import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTechnicalPlanStore } from './store';
import { createWorkspacePaths } from '../document/paths';

test('R06 import keeps the previous working copy when the database transaction fails', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-import-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const previous = process.env.YIBIAO_DATA_DIR;
  process.env.YIBIAO_DATA_DIR = dataDir;
  t.after(() => {
    if (previous === undefined) delete process.env.YIBIAO_DATA_DIR;
    else process.env.YIBIAO_DATA_DIR = previous;
  });

  const projectId = 44;
  const layout = createWorkspacePaths(projectId);
  await fs.mkdir(layout.technicalPlanTenderFilesDir, { recursive: true });
  await fs.writeFile(layout.technicalPlanTenderMarkdownPath, 'OLD WORKING COPY\n');
  await fs.writeFile(layout.technicalPlanTenderOriginalMarkdownPath, 'OLD ORIGINAL MARKDOWN\n');
  const previousFile = path.join(layout.technicalPlanTenderFilesDir, 'old.md');
  await fs.writeFile(previousFile, 'OLD SOURCE MARKDOWN\n');

  const store = createTechnicalPlanStore({
    technicalPlanTask: { findFirst: async () => null },
    $transaction: async () => { throw new Error('synthetic database failure'); },
  } as never);

  await assert.rejects(
    () => store.importTenderDocument(projectId, [{
      fileName: 'new.md', markdown: 'NEW WORKING COPY', parserLabel: 'synthetic', chars: 16, hash: 'synthetic', fallbackToLocal: true,
    } as never]),
    /synthetic database failure/,
  );

  assert.equal((await fs.readFile(layout.technicalPlanTenderMarkdownPath, 'utf8')).trim(), 'OLD WORKING COPY');
  assert.equal((await fs.readFile(layout.technicalPlanTenderOriginalMarkdownPath, 'utf8')).trim(), 'OLD ORIGINAL MARKDOWN');
  assert.equal(await fs.access(previousFile).then(() => true, () => false), true);
  const leftovers = await fs.readdir(layout.technicalPlanDir);
  assert.equal(leftovers.some((name) => name.startsWith('.import-staging-')), false);
  const importKids = await fs.readdir(path.join(layout.technicalPlanDir, 'imports')).catch(() => []);
  assert.equal(importKids.length, 0);
});

test('R06 import publishes the new version only after the database commit', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-import-ok-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const previous = process.env.YIBIAO_DATA_DIR;
  process.env.YIBIAO_DATA_DIR = dataDir;
  t.after(() => {
    if (previous === undefined) delete process.env.YIBIAO_DATA_DIR;
    else process.env.YIBIAO_DATA_DIR = previous;
  });

  const projectId = 45;
  const layout = createWorkspacePaths(projectId);
  await fs.mkdir(layout.technicalPlanTenderFilesDir, { recursive: true });
  await fs.writeFile(layout.technicalPlanTenderMarkdownPath, 'OLD WORKING COPY\n');
  const meta: Record<string, unknown> = { projectId, tenderMarkdownPath: 'technical-plan/tender.md' };
  const prisma: any = {
    technicalPlanMeta: {
      findUnique: async () => meta,
      create: async ({ data }: any) => Object.assign(meta, data),
      update: async ({ data }: any) => Object.assign(meta, data),
    },
    technicalPlanTask: { findFirst: async () => null, findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    chapterReference: { updateMany: async () => ({ count: 0 }) },
    technicalPlanBidItem: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    technicalPlanReferenceDoc: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    technicalPlanOutlineNode: { deleteMany: async () => ({ count: 0 }), findMany: async () => [] },
    technicalPlanGlobalFactGroup: { deleteMany: async () => ({ count: 0 }), findMany: async () => [] },
    technicalPlanContentSection: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    technicalPlanContentPlan: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    $transaction: async (fn: any) => fn(prisma),
  };
  const store = createTechnicalPlanStore(prisma);
  const result = await store.importTenderDocument(projectId, [{
    fileName: 'new.md', markdown: 'NEW WORKING COPY', parserLabel: 'synthetic', chars: 16, hash: 'new-hash', fallbackToLocal: true,
  } as never]);
  assert.equal(result.success, true);
  const published = await fs.readFile(layout.resolve(String(meta.tenderMarkdownPath)), 'utf8');
  assert.match(published, /NEW WORKING COPY/);
  assert.equal(await fs.access(layout.technicalPlanTenderMarkdownPath).then(() => true, () => false), true);
});
