import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const cli = require.resolve('prisma/build/index.js');
const run = (args) => spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: process.env });
const drift = run(['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/baseline.prisma', '--exit-code']);
if (drift.status !== 0) {
  console.error('Baseline refused: existing database differs from the frozen baseline. Review the diff on a restored copy.');
  process.exit(drift.status || 1);
}
if (!process.argv.includes('--apply')) {
  console.log('Schema matches. No changes applied. After backup and copy validation, run with --apply --backup-manifest <path>.');
  process.exit(0);
}
const manifestPath = process.argv[process.argv.indexOf('--backup-manifest') + 1];
if (!process.argv.includes('--backup-manifest')) throw new Error('A verified backup manifest is required');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!manifest.backupId || !manifest.files?.['database.dump'] || !manifest.files?.['data.tar.gz'] || !manifest.validatedOnCopy) {
  throw new Error('Manifest must include database/files hashes and a successful restored-copy validation');
}
const resolved = run(['migrate', 'resolve', '--applied', '202609080001_baseline']);
process.exit(resolved.status || 0);
