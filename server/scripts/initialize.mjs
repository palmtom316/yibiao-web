import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
// A failed migration stops initialization. Compose waits for this job's successful exit.
for (const args of [
  [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', ...(process.argv.includes('--schema') ? ['--schema', process.argv[process.argv.indexOf('--schema') + 1]] : [])],
  ['--import', 'tsx', 'src/db/seed.ts'],
  ['--import', 'tsx', 'prisma/seed-docs.ts'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
