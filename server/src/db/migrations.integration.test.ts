import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
test('migration baseline, repeat initialization, old data, drift and failure gates on real PostgreSQL', async (t) => {
  const parentUrl = new URL(process.env.TEST_DATABASE_URL!);
  assert.match(parentUrl.pathname, /^\/yibiao_test/);
  const admin = new PrismaClient({ datasourceUrl: parentUrl.toString() });
  const dbName = `yibiao_test_migration_${randomUUID().replaceAll('-', '')}`;
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  const url = new URL(parentUrl); url.pathname = `/${dbName}`;
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-migration-'));
  t.after(async () => {
    await prisma.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.$disconnect(); fs.rmSync(temp, { recursive: true, force: true });
  });
  const run = (args: string[]) => spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url.toString() }, maxBuffer: 4 * 1024 * 1024 });
  const ok = (args: string[]) => { const r = run(args); assert.equal(r.status, 0, r.stdout + r.stderr); return r; };
  await t.test('empty database initializes; repeated initialization preserves password and edited docs', async () => {
    ok(['scripts/initialize.mjs']);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await prisma.user.update({ where: { id: user.id }, data: { password: 'synthetic-custom-hash', mustChangePassword: false } });
    await prisma.docsArticle.update({ where: { id: 'usage-01' }, data: { title: '自定义标题', content: '管理员自定义内容', updatedById: user.id } });
    await prisma.appConfig.create({ data: { id: 1, data: { internalSetting: 'preserve' } } });
    await prisma.assetItem.create({ data: { library: 'company', name: '合成附件', files: [{ fileId: 'synthetic-file', originalName: '凭证.pdf', ext: '.pdf', size: 10 }] } });
    ok(['scripts/initialize.mjs']);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).password, 'synthetic-custom-hash');
    assert.equal((await prisma.docsArticle.findUniqueOrThrow({ where: { id: 'usage-01' } })).content, '管理员自定义内容');
    assert.equal(await prisma.user.count(), 1);
  });
  await t.test('db-push-style existing database refuses deploy until drift checked and baseline resolved', async () => {
    // Recreate an actual pre-migration schema, instead of merely removing migration history from the new schema.
    await prisma.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    ok([cli, 'db', 'execute', '--file', 'prisma/migrations/202609080001_baseline/migration.sql', '--schema', 'prisma/baseline.prisma']);
    await prisma.$executeRaw`INSERT INTO users (username,password,role,status,"updatedAt") VALUES ('admin','synthetic-custom-hash','admin','active',NOW())`;
    await prisma.$executeRaw`INSERT INTO docs_articles (id,section,title,content,"updatedAt") VALUES ('usage-01','usage','自定义标题','管理员自定义内容',NOW())`;
    await prisma.$executeRaw`INSERT INTO app_config (id,data,"updatedAt") VALUES (1,'{"internalSetting":"preserve"}'::jsonb,NOW())`;
    await prisma.$executeRaw`INSERT INTO asset_items (id,library,name,files,"updatedAt") VALUES ('synthetic-legacy','company','合成附件','[{"fileId":"synthetic-file","originalName":"凭证.pdf","ext":".pdf","size":10}]'::jsonb,NOW())`;
    assert.notEqual(run([cli, 'migrate', 'deploy']).status, 0);
    ok(['scripts/baseline.mjs']);
    assert.notEqual(run(['scripts/baseline.mjs', '--apply']).status, 0);
    const manifest = path.join(temp, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ backupId: 'synthetic-copy-check', files: { 'database.dump': 'synthetic-hash', 'data.tar.gz': 'synthetic-hash' }, validatedOnCopy: true }));
    ok(['scripts/baseline.mjs', '--apply', '--backup-manifest', manifest]);
    ok(['scripts/initialize.mjs']);
    assert.equal(await prisma.assetItem.count(), 1);
    assert.deepEqual((await prisma.appConfig.findUniqueOrThrow({ where: { id: 1 } })).data, { internalSetting: 'preserve' });
    assert.equal((await prisma.docsArticle.findUniqueOrThrow({ where: { id: 'usage-01' } })).title, '自定义标题');
  });
  await t.test('schema drift is refused', async () => {
    await prisma.$executeRawUnsafe('CREATE TABLE unexpected_drift (id integer)');
    assert.notEqual(run(['scripts/baseline.mjs']).status, 0);
    await prisma.$executeRawUnsafe('DROP TABLE unexpected_drift');
  });
  await t.test('failed migration exits initialization before seed and leaves no committed artifact', async () => {
    fs.copyFileSync('prisma/schema.prisma', path.join(temp, 'schema.prisma'));
    fs.cpSync('prisma/migrations', path.join(temp, 'migrations'), { recursive: true });
    const failed = path.join(temp, 'migrations/999999999999_failure'); fs.mkdirSync(failed);
    fs.writeFileSync(path.join(failed, 'migration.sql'), 'BEGIN; CREATE TABLE should_rollback (id integer); SELECT 1/0; COMMIT;');
    await prisma.docsArticle.delete({ where: { id: 'config-04' } });
    assert.notEqual(run(['scripts/initialize.mjs', '--schema', path.join(temp, 'schema.prisma')]).status, 0);
    assert.equal(await prisma.docsArticle.count({ where: { id: 'config-04' } }), 0);
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_name='should_rollback'`;
    assert.equal(tables.length, 0);
  });
});
