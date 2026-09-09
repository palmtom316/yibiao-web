import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withUploadedFiles } from './multipart';
import { createAssetLibraryStore } from './store';
test('failed metadata commit removes only newly uploaded bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-upload-conflict-'));
  try {
    await fs.writeFile(path.join(root, 'original.txt'), 'existing-original');
    await assert.rejects(withUploadedFiles([{ filename: 'new.txt', mimetype: 'text/plain', buffer: Buffer.from('new-file') }], (id, ext) => path.join(root, id + ext), async () => { throw new Error('version conflict'); }), /version conflict/);
    assert.deepEqual(await fs.readdir(root), ['original.txt']);
    assert.equal(await fs.readFile(path.join(root, 'original.txt'), 'utf8'), 'existing-original');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('legacy personnel deletion is rejected before any database or filesystem mutation', async () => {
  const store = createAssetLibraryStore({ $transaction: () => { throw new Error('must not touch old records'); } } as any);
  for (const permanent of [false, true]) await assert.rejects(store.deleteItem('personnel', 'old-record', 1, 1, permanent), (error: any) => error.statusCode === 410);
});
