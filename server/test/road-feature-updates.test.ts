import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoadOverlay, RoadFeatureUpdates } from '../src/road-feature-updates';
import { RoadFeaturesService, selectMapFeatures, type OsmNode } from '../src/road-features';

const fixture = JSON.parse(readFileSync('test/fixtures/shamaldy-road-features.json', 'utf8'));
const bounds = { south: 41.187, north: 41.207, west: 72.168, east: 72.191 };
const response = (value = fixture) => new Response(JSON.stringify(value), { status: 200 });

test('current Shamaldy data includes ordinary crossings from the screenshots and both real signals', () => {
  const overlay = parseRoadOverlay(fixture, bounds, 1);
  const mapped = selectMapFeatures(overlay.nodes, bounds);
  for (const id of [14232441042, 14232441060, 14232441071, 14284580895, 14284580896, 14214775366])
    assert.ok(mapped.some(f => f.id === `${id}:pedestrian_crossing`), `Missing crossing ${id}`);
  for (const id of [2280557714, 1931790637]) assert.ok(mapped.some(f => f.id === `${id}:traffic_light`));
  for (const id of [14210086577, 14210086578, 14210086579, 14210086580]) {
    const zebra = mapped.find(f => f.id === `${id}:pedestrian_crossing`);
    assert.ok(zebra && Number.isFinite(zebra.bearing));
    assert.ok(!mapped.some(f => f.id === `${id}:traffic_light`), 'a controlled crossing must not duplicate its light');
  }
  assert.ok(!mapped.some(f => f.id === '1931790645:pedestrian_crossing'), 'a railway crossing is not a pedestrian crossing');
});

test('current overlay replaces stale/removed features without removing navigation cameras or limits', () => {
  const service = new RoadFeaturesService(), cells = (service as unknown as { cells: Map<string, OsmNode[]> }).cells;
  cells.clear();
  const point = { latitude: 41.19732, longitude: 72.17965 };
  cells.set('4119:7217', [
    { id: 999, ...point, tags: { highway: 'traffic_signals' } },
    { id: 998, ...point, tags: { highway: 'speed_camera' } },
  ]);
  const overlay = parseRoadOverlay(fixture, bounds, 1), map = service.mapFeatures(bounds, overlay);
  assert.ok(!map.some(f => f.id.startsWith('999:')));
  assert.ok(map.some(f => f.id === '14284580895:pedestrian_crossing'));
  const warnings = service.along([{ latitude: 41.197, longitude: 72.17965 }, { latitude: 41.198, longitude: 72.17965 }], 0, overlay);
  assert.ok(warnings.some(f => f.kind === 'pedestrian_crossing'));
  assert.ok(warnings.some(f => f.kind === 'speed_camera' && f.id === '998:speed_camera'));
});

test('parallel viewports share one update; the hourly cache revalidates additions and deletions', async () => {
  let calls = 0, now = 100, payload = fixture;
  const reader = new RoadFeatureUpdates((async () => { calls++; return response(payload); }) as typeof fetch, () => now);
  const [a, b] = await Promise.all([reader.get(bounds), reader.get(bounds)]);
  assert.equal(calls, 1); assert.equal(a, b); assert.ok(a!.nodes.length > 5);
  now += 3599999; assert.equal(await reader.get(bounds), a); assert.equal(calls, 1);
  now += 2; payload = { ...fixture, elements: [] };
  const updated = await reader.get(bounds); assert.equal(calls, 2); assert.equal(updated!.nodes.length, 0);
});

test('timeouts, incomplete queries and overload keep the last valid overlay and back off', async () => {
  let calls = 0, now = 100;
  const reader = new RoadFeatureUpdates((async () => { calls++; return calls === 1 ? response() : response({ ...fixture, remark: 'timeout' }); }) as typeof fetch, () => now);
  const valid = await reader.get(bounds); now += 3600001;
  assert.equal(await reader.get(bounds), valid); assert.equal(calls, 2);
  assert.equal(await reader.get(bounds), valid); assert.equal(calls, 2);
  const offline = new RoadFeatureUpdates((async () => { throw Error('offline'); }) as typeof fetch);
  assert.equal(await offline.get(bounds), null);
  assert.throws(() => parseRoadOverlay({ elements: [] }, bounds, now));
  assert.throws(() => parseRoadOverlay({ ...fixture, remark: 'partial' }, bounds, now));
});

test('fresh local snapshot contains the current Lenina crossings and the Kyrgyzstan signal', () => {
  const service = new RoadFeaturesService(), map = service.mapFeatures(bounds);
  assert.ok(service.sourceTimestamp && service.sourceTimestamp >= '2026-10-13');
  for (const id of [14232441042, 14232441071, 14284580895, 14284580896])
    assert.ok(map.some(f => f.id === `${id}:pedestrian_crossing`));
  assert.ok(map.some(f => f.id === '2280557714:traffic_light'));
  assert.equal(map.filter(f => f.kind === 'traffic_light').length, 2);
});
