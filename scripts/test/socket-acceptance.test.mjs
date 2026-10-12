import assert from 'node:assert/strict';
import { test } from 'node:test';
import { socketAcceptance } from '../load/socket-acceptance.mjs';
const good = () => ({
  metrics: { attempted: 2, ready: 2, expectedReconnects: 2, events: 3, unexpectedDisconnects: 0, connectErrors: 0, connectTimeouts: 0, unavailable: 0, expired: 0, snapshotsFailed: 0, snapshotTimeouts: 0, unexpected429: 0, canonicalResyncFailed: 0, pendingSyncs: 0 },
  accounts: [0, 1].map(index => ({ index, ready: true, initialSyncSucceeded: true, expectedReconnects: 1, reconnectReady: 1, reconnectSyncSucceeded: 1, readyEvents: 2, canonicalSyncSucceeded: 2 })),
});
test('Socket.IO acceptance requires completed canonical resync for every account and reconnect', () => {
  const valid = good(); assert.equal(socketAcceptance(valid.metrics, valid.accounts).passed, true);
  for (const change of [item => item.accounts[0].reconnectSyncSucceeded = 0, item => item.accounts[0].initialSyncSucceeded = false,
    item => item.metrics.pendingSyncs = 1, item => item.metrics.snapshotTimeouts = 1, item => item.metrics.events = 0,
    item => item.accounts[0].canonicalSyncSucceeded = 1, item => item.accounts[0].reconnectReady = 0]) {
    const invalid = good(); change(invalid); assert.equal(socketAcceptance(invalid.metrics, invalid.accounts).passed, false);
  }
});
test('one account extra successful snapshots cannot hide another account missing reconnect resync', () => {
  const value = good(); value.accounts[0].reconnectSyncSucceeded = 0; value.accounts[1].reconnectSyncSucceeded = 2;
  assert.equal(socketAcceptance(value.metrics, value.accounts).passed, false);
});
