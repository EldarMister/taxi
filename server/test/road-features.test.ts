import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoadFeaturesService, selectRoadFeatures } from '../src/road-features';

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
    'traffic_light', 'stop', 'speed_limit_60', 'pedestrian_crossing', 'speed_camera', 'pedestrian_crossing',
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
