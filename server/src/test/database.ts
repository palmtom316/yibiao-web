import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

export async function testDatabase(t: TestContext) {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', 'postgres-test'].includes(url.hostname));
  assert.match(url.pathname, /^\/yibiao_test/);
  const admin = new PrismaClient({ datasourceUrl: url.toString() });
  const name = `yibiao_test_${randomUUID().replaceAll('-', '')}`;
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-integration-'));
  const previous = process.env.YIBIAO_DATA_DIR; process.env.YIBIAO_DATA_DIR = dataDir;
  t.after(async () => {
    await prisma.$disconnect(); await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.$disconnect();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.YIBIAO_DATA_DIR; else process.env.YIBIAO_DATA_DIR = previous;
  });
  const migrated = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url.toString() } });
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  return { prisma, dataDir };
}
