import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseSpeedLimit, RoadFeaturesService, selectMapFeatures, selectRoadFeatures, selectSpeedLimits, type OsmNode } from '../src/road-features';

const points = [{ latitude: 42.87, longitude: 74.59 }, { latitude: 42.88, longitude: 74.59 }];
const node = (id: number, latitude: number, longitude: number, tags: Record<string, string>) => ({ id, latitude, longitude, tags });

test('road warnings follow the route, ignore the parallel road and never invent a 60 sign', () => {
  const features = selectRoadFeatures([
    node(1, 42.872, 74.59, { highway: 'traffic_signals' }),
    node(2, 42.87202, 74.59001, { highway: 'traffic_signals' }),
    node(3, 42.873, 74.59, { highway: 'stop' }),
    node(4, 42.874, 74.5905, { highway: 'give_way' }),
    node(5, 42.875, 74.5902, { traffic_sign: 'maxspeed', maxspeed: '60' }),
    node(6, 42.876, 74.59, { highway: 'crossing' }),
    node(7, 42.877, 74.59, { highway: 'speed_camera' }),
    node(8, 42.878, 74.59, { highway: 'crossing', maxspeed: '60' }),
  ], points, 100);
  assert.deepEqual(features.map(feature => feature.kind), [
    'traffic_light', 'stop', 'speed_limit', 'pedestrian_crossing', 'speed_camera', 'pedestrian_crossing',
  ]);
  assert.ok(features.every(feature => feature.along >= 100));
});

test('road anchors reject a side-street stop while keeping a crossing and a roadside radar', () => {
  const features = selectRoadFeatures([
    { ...node(11, 42.875, 74.5901, { highway: 'stop' }), roads: [{ latitude: 42.875, longitude: 74.5901, bearing: 90, distance: 0 }] },
    { ...node(12, 42.876, 74.59, { highway: 'crossing', crossing: 'traffic_signals' }), roads: [{ latitude: 42.876, longitude: 74.59, bearing: 0, distance: 0 }] },
    { ...node(13, 42.877, 74.59025, { highway: 'speed_camera' }), roads: [{ latitude: 42.877, longitude: 74.59, bearing: 0, distance: 20 }] },
    { ...node(14, 42.878, 74.5901, { highway: 'give_way' }), roads: [{ latitude: 42.878, longitude: 74.5901, bearing: 0, distance: 0 }] },
  ], points, 0);
  assert.deepEqual(features.map(item => item.kind).sort(), ['traffic_light', 'pedestrian_crossing', 'speed_camera'].sort());
});

test('road warning snapshot loads and searches a real Kyrgyzstan route', () => {
  const service = new RoadFeaturesService();
  assert.ok(service.generatedAt);
  const signal = service.along([
    { latitude: 42.874, longitude: 74.61 },
    { latitude: 42.88, longitude: 74.61 },
  ], 0);
  assert.ok(Array.isArray(signal));
});

test('map features include mapped crossings and signals only inside the requested area', () => {
  const service = new RoadFeaturesService();
  const bounds = { south: 42.88, west: 74.58, north: 42.89, east: 74.61 };
  const features = service.mapFeatures(bounds);
  assert.ok(features.some(feature => feature.kind === 'traffic_light'));
  assert.ok(features.some(feature => feature.kind === 'pedestrian_crossing'));
  assert.ok(features.filter(feature => feature.kind === 'pedestrian_crossing' && feature.bearing != null)
    .every(feature => Number.isFinite(feature.bearing) && feature.bearing! >= 0 && feature.bearing! < 360));
  assert.ok(features.every(feature => feature.latitude >= bounds.south && feature.latitude <= bounds.north
    && feature.longitude >= bounds.west && feature.longitude <= bounds.east));
  assert.equal(new Set(features.map(feature => feature.id)).size, features.length);
});

test('uncontrolled crossings remain on the map and in alerts, even without a road anchor', () => {
  const nodes = [node(21, 42.875, 74.59, { highway: 'crossing', crossing: 'uncontrolled' }),
    { ...node(22, 42.876, 74.59, { highway: 'crossing', crossing: 'unmarked' }), roads: [] }];
  const mapped = selectMapFeatures(nodes, { south: 42.87, west: 74.58, north: 42.88, east: 74.6 });
  assert.equal(mapped.length, 2);
  assert.ok(mapped.every(feature => feature.kind === 'pedestrian_crossing' && feature.widthMeters! >= 5));
  assert.equal(selectRoadFeatures(nodes, points, 0).filter(feature => feature.kind === 'pedestrian_crossing').length, 2);
});

test('map shows crossings and real signals only; cameras and signs remain route warnings', () => {
  const nodes = [node(31, 42.872, 74.59, { enforcement: 'traffic_signals;maxspeed', maxspeed: '40' }),
    node(32, 42.873, 74.59, { highway: 'crossing', crossing: 'traffic_signals' }),
    node(33, 42.874, 74.59, { traffic_sign: 'KG:3.24[30]' }),
    node(34, 42.875, 74.59, { traffic_sign: 'maxspeed', maxspeed: '80' }),
    node(35, 42.876, 74.59, { highway: 'traffic_signals' }),
    node(36, 42.877, 74.59, { highway: 'crossing', crossing: 'uncontrolled' }),
    node(37, 42.878, 74.59, { highway: 'crossing', 'crossing:signals': 'yes' }),
    node(38, 42.879, 74.59, { highway: 'traffic_signals;crossing' })];
  const mapped = selectMapFeatures(nodes, { south: 42.87, west: 74.58, north: 42.88, east: 74.6 });
  assert.deepEqual(mapped.map(item => item.kind), ['pedestrian_crossing', 'traffic_light', 'pedestrian_crossing', 'pedestrian_crossing', 'traffic_light', 'pedestrian_crossing']);
  assert.equal(selectRoadFeatures(nodes, points, 0).find(item => item.kind === 'speed_camera')?.speedLimit, 40);
});

test('speed limits parse explicit values and units without inventing unsigned road defaults', () => {
  assert.equal(parseSpeedLimit('40'), 40);
  assert.equal(parseSpeedLimit('80 km/h'), 80);
  assert.equal(parseSpeedLimit('30 mph'), 48);
  for (const value of [undefined, '', 'signals', 'none', 'KG:urban', '40;60', '0']) assert.equal(parseSpeedLimit(value), undefined);
});

test('road way speed limits cover the current section and change at real tagged road boundaries', () => {
  const ways = [
    { id: 41, geometry: [{ latitude: 42.87, longitude: 74.59 }, { latitude: 42.875, longitude: 74.59 }], tags: { maxspeed: '40' } },
    { id: 42, geometry: [{ latitude: 42.875, longitude: 74.59 }, { latitude: 42.88, longitude: 74.59 }], tags: { maxspeed: '80' } },
    { id: 43, geometry: [{ latitude: 42.87, longitude: 74.5905 }, { latitude: 42.88, longitude: 74.5905 }], tags: { maxspeed: '100' } },
  ];
  const limits = selectSpeedLimits(ways, points, 100);
  assert.deepEqual(limits.map(feature => feature.speedLimit), [40, 80]);
  assert.equal(limits[0].along, 100);
  assert.ok(Math.abs(limits[0].endAlong! - limits[1].along) < 2);
  assert.ok(limits[1].endAlong! > 1100);
});

test('road speed limits honor direction and stop after an untagged section', () => {
  const ways = [{ id: 51, geometry: [{ latitude: 42.87, longitude: 74.59 }, { latitude: 42.875, longitude: 74.59 }],
    tags: { 'maxspeed:forward': '30', 'maxspeed:backward': '50' } }];
  const forward = selectSpeedLimits(ways, points, 0), backward = selectSpeedLimits(ways, [...points].reverse(), 0);
  assert.equal(forward[0].speedLimit, 30);
  assert.ok(forward[0].endAlong! < 580);
  assert.equal(backward[0].speedLimit, 50);
  assert.ok(backward[0].along > 500);
  assert.deepEqual(selectSpeedLimits([{ ...ways[0], tags: { maxspeed: '60', oneway: 'yes' } }], [...points].reverse(), 0), []);
});

test('an untagged frontage road never borrows a nearby parallel road speed limit', () => {
  const ways = [
    { id: 61, geometry: points, tags: {} },
    { id: 62, geometry: points.map(point => ({ ...point, longitude: point.longitude + .00008 })), tags: { maxspeed: '80' } },
  ];
  assert.deepEqual(selectSpeedLimits(ways, points, 0), []);
  const taggedRoad = selectSpeedLimits(ways, ways[1].geometry, 0);
  assert.equal(taggedRoad[0]?.speedLimit, 80);
});

test('regenerated snapshot serves relation cameras and real non-60 road limits through the indexed service', () => {
  const service = new RoadFeaturesService();
  const camera = service.mapFeatures({ south: 42.867, north: 42.868, west: 74.587, east: 74.588 });
  assert.ok(camera.every(item => item.kind === 'traffic_light' || item.kind === 'pedestrian_crossing'));
  const snapshot = JSON.parse(readFileSync('data/road-features-kg.json', 'utf8'));
  const way = snapshot.speedWays.find((item: { tags: Record<string, string> }) => item.tags.maxspeed === '40');
  assert.ok(way, 'the extraction must retain maxspeed-tagged road ways');
  const features = service.along(way.geometry.slice(0, 8), 0);
  assert.ok(features.some(item => item.kind === 'speed_limit' && item.speedLimit === 40 && item.endAlong! > item.along));
  const mapped = service.mapFeatures({ south: 42.854, north: 42.863, west: 74.563, east: 74.574 });
  assert.ok(mapped.every(item => item.kind === 'traffic_light' || item.kind === 'pedestrian_crossing'));
  const broad = service.mapFeatures({ south: 42.86, west: 74.57, north: 42.9, east: 74.63 });
  assert.ok(broad.some(item => item.kind === 'pedestrian_crossing'));
  assert.ok(broad.some(item => item.kind === 'traffic_light'));
  const radar = snapshot.elements.find((item: OsmNode) => item.id === 244468520);
  assert.ok(service.along([{ latitude: radar.latitude - .00005, longitude: radar.longitude },
    { latitude: radar.latitude + .00005, longitude: radar.longitude }], 0).some(item => item.kind === 'speed_camera'));
});

test('dense viewport retains edge crossings and independent traffic signals only eight metres apart', () => {
  const service = new RoadFeaturesService();
  const cells = (service as unknown as { cells: Map<string, OsmNode[]> }).cells;
  cells.clear();
  const nodes = Array.from({ length: 2100 }, (_, index) => node(index, 42.87 + Math.floor(index / 50) * .00006,
    74.59 + (index % 50) * .00006, { highway: 'crossing', crossing: 'uncontrolled' }));
  nodes.push(node(2101, 42.874, 74.59, { highway: 'traffic_signals' }),
    node(2102, 42.87407, 74.59, { highway: 'traffic_signals' }));
  for (const node of nodes) {
    const key = `${Math.floor(node.latitude * 100)}:${Math.floor(node.longitude * 100)}`;
    cells.set(key, [...(cells.get(key) ?? []), node]);
  }
  const result = service.mapFeatures({ south: 42.86, north: 42.88, west: 74.58, east: 74.60 });
  assert.equal(result.filter(item => item.kind === 'pedestrian_crossing').length, 2100);
  assert.equal(result.filter(item => item.kind === 'traffic_light').length, 2);
});
