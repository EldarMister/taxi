import { readFileSync } from 'node:fs';
import { assertOrderEvidence } from './order-acceptance.mjs';
export function assertLoadResults(http, socket, database) {
  const value = (name, field = 'count') => http.metrics[name]?.values?.[field] ?? 0;
  const blocked = [];
  for (const name of ['unexpected_429', 'request_timeouts', 'unexpected_responses']) if (value(name, 'rate') !== 0) blocked.push(name);
  if (value('dropped_iterations') !== 0) blocked.push('dropped_iterations');
  if (value('executor_boundary_iterations') > 1) blocked.push('executor boundary iterations');
  for (const name of ['order_create_success', 'order_accept_success', 'order_process_success', 'idempotent_retry_success']) if (value(name, 'rate') < .99) blocked.push(name);
  const created = value('orders_created'), accepted = value('orders_accepted'), completed = value('orders_completed');
  if (created < 1 || accepted / created < .99 || completed / created < .99) blocked.push('order end-to-end completion');
  const scheduledBookings = Math.ceil(Math.floor(http.profile.activeUsers * .8) * (http.profile.durationSeconds - 60) / 120);
  if (!Number.isSafeInteger(scheduledBookings) || created !== scheduledBookings) blocked.push('scheduled booking count');
  if (!socket.passed) blocked.push('Socket.IO acceptance');
  if (http.profile.candidate.commit !== socket.profile.candidate.commit || http.profile.candidate.sourceDigest !== socket.profile.candidate.sourceDigest
    || http.profile.fixtureRunId !== socket.profile.fixtureRunId) blocked.push('candidate/fixture mismatch');
  if (blocked.length) throw new Error(`Load acceptance blocked: ${blocked.join(', ')}.`);
  const uniqueDatabase = assertOrderEvidence(database, { created, accepted, completed });
  return { created, accepted, completed, completionRatio: completed / created, uniqueDatabase, productionReady: false };
}
if (process.argv[1]?.endsWith('assert-results.mjs')) {
  const http = JSON.parse(readFileSync(process.argv[2], 'utf8')), socket = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const evidence = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  console.log(JSON.stringify(assertLoadResults(http, socket, evidence.database), null, 2));
}
