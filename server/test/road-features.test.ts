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

test('road warning snapshot loads and searches a real Kyrgyzstan route', () => {
  const service = new RoadFeaturesService();
  assert.ok(service.generatedAt);
  const signal = service.along([
    { latitude: 42.874, longitude: 74.61 },
    { latitude: 42.88, longitude: 74.61 },
  ], 0);
  assert.ok(Array.isArray(signal));
});
