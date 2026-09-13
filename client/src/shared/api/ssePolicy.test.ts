import test from 'node:test';
import assert from 'node:assert/strict';
import { isFatalSseStatus, shouldOpenSseConnection, shouldReconnectAfterClose, sseRetryDelayMs } from './ssePolicy';

test('R03 clean EOF reconnects only for the current project connection', () => {
  assert.equal(isFatalSseStatus(200), false);
  assert.equal(isFatalSseStatus(401), true);
  assert.equal(isFatalSseStatus(403), true);
  assert.equal(isFatalSseStatus(404), true);
  assert.equal(isFatalSseStatus(400), true);
  assert.equal(shouldOpenSseConnection({ token: 't', projectId: null, stopped: false }), false);
  assert.equal(shouldOpenSseConnection({ token: 't', projectId: 8, stopped: false }), true);
  assert.equal(shouldReconnectAfterClose({ stopped: false, projectId: 8, connectionGeneration: 2, currentGeneration: 2 }), true);
  assert.equal(shouldReconnectAfterClose({ stopped: true, projectId: 8, connectionGeneration: 2, currentGeneration: 2 }), false);
  assert.equal(shouldReconnectAfterClose({ stopped: false, projectId: 8, connectionGeneration: 2, currentGeneration: 3 }), false, 'old EOF must not reopen after project switch');
  assert.equal(shouldReconnectAfterClose({ stopped: false, projectId: null, connectionGeneration: 2, currentGeneration: 2 }), false);
  assert.equal(sseRetryDelayMs(0), 1000);
  assert.ok(sseRetryDelayMs(8) <= 15_000);
});
