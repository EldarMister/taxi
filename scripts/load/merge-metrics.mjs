import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { LOAD_ROLES } from './roles.mjs';
const THRESHOLDS = [
  ['unexpected_429', 'rate', '==', 0], ['request_timeouts', 'rate', '==', 0], ['unexpected_responses', 'rate', '<', .01],
  ['http_req_duration{operation:read}', 'p(95)', '<', 500], ['dropped_iterations', 'count', '==', 0],
  ['order_create_success', 'rate', '>', .99], ['order_accept_success', 'rate', '>', .99], ['order_process_success', 'rate', '>', .99], ['idempotent_retry_success', 'rate', '==', 1],
];
export function assertHttpThresholds(summary) {
  const failed = [];
  for (const [name, field, comparison, limit] of THRESHOLDS) {
    const value = summary.metrics[name]?.values?.[field];
    if (!Number.isFinite(value) || !(comparison === '==' ? value === limit : comparison === '<' ? value < limit : value > limit)) failed.push(`${name} ${field}${comparison}${limit}`);
  }
  if (failed.length) throw new Error('HTTP aggregate thresholds failed: ' + failed.join(', '));
  return true;
}
const quantile = (values, q) => { const index = (values.length - 1) * q, low = Math.floor(index), high = Math.ceil(index); return values[low] + (values[high] - values[low]) * (index - low); };
export async function mergeRoleMetrics({ inputs, profile, startAt, finishedAt, combinedRawPath }) {
  if (inputs.length !== LOAD_ROLES.length || new Set(inputs.map(x => x.role)).size !== LOAD_ROLES.length || inputs.some(x => !LOAD_ROLES.includes(x.role))) throw new Error('All four unique role results and raw streams are mandatory.');
  const points = new Map(), startup = new Map(), types = new Map(), reports = [], gauges = {};
  const add = (map, name, value) => { const values = map.get(name) || []; values.push(value); map.set(name, values); };
  const combined = combinedRawPath ? createWriteStream(combinedRawPath, { flags: 'wx' }) : null;
  try { for (const input of inputs) {
    const report = JSON.parse(readFileSync(input.summaryPath, 'utf8'));
    if (report.role !== input.role || JSON.stringify(report.profile) !== JSON.stringify(profile) || report.measuredStartAt !== startAt) throw new Error('Role report candidate, fixture, scope or startup barrier mismatch.');
    const minimumDuration = input.role === 'booking' ? profile.durationSeconds - 60 : profile.durationSeconds;
    if (Date.parse(report.completedAt) - Date.parse(startAt) < minimumDuration * 1000) throw new Error('Incomplete mandatory role duration: ' + input.role);
    let requests = 0, durations = 0, profileRequests = 0;
    for await (const line of createInterface({ input: createReadStream(input.rawPath), crlfDelay: Infinity })) {
      if (!line) continue;
      if (combined && !combined.write(line + '\n')) await once(combined, 'drain');
      const row = JSON.parse(line);
      if (row.type === 'Metric') {
        const previous = types.get(row.metric);
        if (previous && previous !== row.data.type) throw new Error('Conflicting metric type across role streams.');
        types.set(row.metric, row.data.type); continue;
      }
      if (row.type !== 'Point' || !Number.isFinite(row.data.value)) throw new Error('Invalid raw metric point.');
      const isHttp = row.metric === 'http_reqs' || row.metric.startsWith('http_req_'), phase = row.data.tags.phase;
      if (isHttp && !['profile', 'startup'].includes(phase)) throw new Error('Unclassified HTTP metric phase.');
      if (row.metric === 'http_reqs') { requests += row.data.value; if (phase === 'profile') profileRequests += row.data.value; }
      if (row.metric === 'http_req_duration') durations++;
      add(phase === 'startup' ? startup : points, row.metric, row.data.value);
      if (phase === 'profile' && row.metric === 'http_req_duration' && row.data.tags.operation === 'read') add(points, 'http_req_duration{operation:read}', row.data.value);
    }
    if (!profileRequests || requests !== report.metrics.http_reqs?.values.count || durations !== requests) throw new Error('Incomplete mandatory raw HTTP stream or role execution: ' + input.role);
    gauges[input.role] = Object.fromEntries(Object.entries(report.metrics).filter(([name]) => types.get(name) === 'gauge'));
    reports.push({ role: input.role, rawPath: input.rawPath, summaryPath: input.summaryPath, totalRawRequests: requests, profileRequests, startupRequests: requests - profileRequests, gauges: gauges[input.role] });
  } } finally { if (combined) { combined.end(); await once(combined, 'finish'); } }
  types.set('http_req_duration{operation:read}', 'trend');
  // k6 emits this counter only when an arrival is dropped; absence in complete
  // role streams means zero, rather than a missing success-rate observation.
  if (!points.has('dropped_iterations')) { points.set('dropped_iterations', [0]); types.set('dropped_iterations', 'counter'); }
  const seconds = (Date.parse(finishedAt) - Date.parse(startAt)) / 1000;
  if (!(seconds >= profile.durationSeconds)) throw new Error('Incomplete measured profile duration.');
  function summarize(map) {
    const metrics = {};
    for (const [name, values] of map) {
      const type = types.get(name); if (!type) throw new Error('Raw metric definition is missing.');
      if (type === 'gauge') continue; // Per-role gauge values are retained above.
      let summary;
      if (type === 'counter') { const count = values.reduce((a, b) => a + b, 0); summary = { count, rate: count / seconds }; }
      else if (type === 'rate') { const passes = values.filter(x => x !== 0).length; summary = { passes, fails: values.length - passes, rate: passes / values.length }; }
      else if (type === 'trend') { values.sort((a, b) => a - b); summary = { count: values.length, min: values[0], max: values.at(-1), avg: values.reduce((a, b) => a + b, 0) / values.length, med: quantile(values, .5), 'p(90)': quantile(values, .9), 'p(95)': quantile(values, .95) }; }
      else throw new Error('Unsupported raw metric type.');
      metrics[name] = { type, values: summary };
    }
    return metrics;
  }
  const result = { profile, metrics: summarize(points), startupMetrics: summarize(startup), measuredStartAt: startAt, completedAt: finishedAt, roleReports: reports, quantiles: 'Exact linear quantiles across all raw profile points; percentiles are never averaged.', productionReady: false };
  try { assertHttpThresholds(result); result.thresholdsPassed = true; } catch (error) { result.thresholdsPassed = false; result.blocked = error.message; }
  return result;
}
