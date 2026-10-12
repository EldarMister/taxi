export function socketAcceptance(metrics, accounts) {
  const blocked = [];
  if (!(metrics.attempted > 0) || metrics.ready !== metrics.attempted || accounts.length !== metrics.attempted) blocked.push('initial readiness');
  if (!(metrics.expectedReconnects > 0)) blocked.push('no forced reconnects measured');
  if (!(metrics.events > 0)) blocked.push('no protected application events measured');
  for (const key of ['unexpectedDisconnects', 'connectErrors', 'connectTimeouts', 'unavailable', 'expired', 'snapshotsFailed', 'snapshotTimeouts', 'unexpected429', 'canonicalResyncFailed', 'pendingSyncs']) if (metrics[key] !== 0) blocked.push(key);
  for (const account of accounts) {
    if (!account.ready || !account.initialSyncSucceeded || account.expectedReconnects < 1
      || account.reconnectReady < account.expectedReconnects || account.reconnectSyncSucceeded < account.expectedReconnects
      || account.canonicalSyncSucceeded !== account.readyEvents) blocked.push(`incomplete canonical synchronization for account ${account.index}`);
  }
  return { passed: blocked.length === 0, blocked };
}
