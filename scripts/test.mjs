import { readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Discover tests explicitly: shell globs and Node's implicit discovery differ by platform.
const integration = process.argv.includes('--integration');
function discover(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return discover(file);
    return /\.test\.(?:ts|mjs|cjs)$/.test(file)
      && file.includes('.integration.test.') === integration ? [file] : [];
  }).sort();
}
const files = discover(path.resolve('src'));
if (!files.length) {
  console.error(`No ${integration ? 'integration' : 'unit'} tests discovered`);
  process.exit(1);
}
if (integration) {
  const url = new URL(process.env.TEST_DATABASE_URL || 'postgresql://invalid/invalid');
  if (!['127.0.0.1', 'localhost', 'postgres-test'].includes(url.hostname)
    || !/^\/yibiao_test(?:_[a-z0-9_]+)?$/.test(url.pathname)) {
    throw new Error('TEST_DATABASE_URL must point to a local yibiao_test database');
  }
}
const dataDir = mkdtempSync(path.join(tmpdir(), 'yibiao-tests-'));
try {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=2', ...files], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: integration ? process.env.TEST_DATABASE_URL : 'postgresql://test:test@127.0.0.1:1/yibiao_test',
      YIBIAO_DATA_DIR: dataDir,
      JWT_SECRET: 'synthetic-test-secret-at-least-32-characters',
    },
  });
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0 && process.argv[reportIndex + 1]) writeFileSync(process.argv[reportIndex + 1], result.stdout || '', { mode: 0o600 });
  if (process.argv.includes('--summary')) {
    process.stdout.write((result.stdout || '').split('\n').filter((line) => /^# (tests|pass|fail|cancelled|skipped|duration_ms)|^not ok/.test(line)).join('\n') + '\n');
  } else process.stdout.write(result.stdout || '');
  if (result.error) console.error(result.error);
  process.exitCode = result.status ?? 1;
  // Some restricted runtimes silently lose child test IPC and report only file success.
  const registeredTests = (result.stdout || '').split('\n')
    .filter((line) => line.startsWith('# Subtest: ') && !/\.test\.(?:ts|mjs|cjs)$/.test(line));
  if (!registeredTests.length) {
    console.error('No individual test results received; check child-process IPC permissions.');
    process.exitCode = 1;
  }
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
