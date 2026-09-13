import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertUsableJwtSecret } from './middleware';

// O09：示例/占位 JWT_SECRET 必须在启动时被拒绝（否则任何人可自签管理员令牌）。
test('rejects documented example and placeholder secrets', () => {
  const rejected = [
    'replace-with-at-least-32-random-characters',
    'REPLACE-WITH-AT-LEAST-32-RANDOM-CHARACTERS',
    'please-change-me-to-a-random-secret-value',
    'your-secret-key-for-this-deployment-1234',
    'example-jwt-secret-for-local-development',
    'placeholder-value-that-is-long-enough-ok',
  ];
  for (const secret of rejected) {
    assert.throws(() => assertUsableJwtSecret(secret), /example or placeholder/, secret);
  }
});

test('rejects short secrets', () => {
  assert.throws(() => assertUsableJwtSecret('too-short'), /at least 32 characters/);
});

test('accepts high-entropy secrets used by tests and tooling', () => {
  const accepted = [
    'synthetic-test-secret-at-least-32-characters',
    'test-only-secret-that-is-at-least-32-characters',
    'a3f1c9d47b2e805f6a4d1c3b9e7f2058d6a4c2b1e9f7d3a5084c6b2e1f9d7a3c5',
  ];
  for (const secret of accepted) assert.equal(assertUsableJwtSecret(secret), secret);
});
