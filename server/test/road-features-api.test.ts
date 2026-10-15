import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard, RateLimits } from '../src/auth';
import { RoutesController } from '../src/routes';
import { RoadFeaturesService, type RoadFeature, type MapRoadFeature } from '../src/road-features';
import { RoutingService } from '../src/routing';

// The source test runner does not emit TypeScript constructor metadata.
Reflect.defineMetadata('design:paramtypes', [RoutingService, RateLimits, RoadFeaturesService], RoutesController);

test('HTTP road feature negotiation preserves legacy APKs and exposes full features to the new APKs', async () => {
  const point = { latitude: 42.87, longitude: 74.59 };
  const warnings: RoadFeature[] = [
    { id: 'crossing', kind: 'pedestrian_crossing', ...point, along: 20 },
    { id: 'radar', kind: 'speed_camera', ...point, along: 30 },
    { id: 'sign60', kind: 'speed_limit', speedLimit: 60, ...point, along: 40 },
    { id: 'sign40', kind: 'speed_limit', speedLimit: 40, ...point, along: 50 },
    { id: 'road60', kind: 'speed_limit', speedLimit: 60, ...point, along: 0, endAlong: 150 },
  ];
  const mapped: MapRoadFeature[] = [
    { id: 'crossing', kind: 'pedestrian_crossing', ...point, bearing: 0 },
    { id: 'light', kind: 'traffic_light', ...point },
  ];
  const module = await Test.createTestingModule({
    controllers: [RoutesController], providers: [
      { provide: RoutingService, useValue: {} },
      { provide: RateLimits, useValue: { take: async () => undefined } },
      { provide: RoadFeaturesService, useValue: { currentMapFeatures: async () => mapped, currentAlong: async () => warnings, generatedAt: 'fixture' } },
    ],
  }).overrideGuard(AuthGuard).useValue({ canActivate(context: any) {
    context.switchToHttp().getRequest().actor = { id: 'driver-fixture', role: 'DRIVER' }; return true;
  } }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  try {
    await app.init();
    const url = '/api/routes/map-features?south=42.86&north=42.88&west=74.58&east=74.60';
    const oldMap = await request(app.getHttpServer()).get(url).expect(200);
    assert.deepEqual(oldMap.body.features.map((f: any) => f.kind), ['pedestrian_crossing', 'traffic_light']);
    const newMap = await request(app.getHttpServer()).get(url).set('X-Atlas-Capabilities', 'food-modifiers-v2, road-features-v2').expect(200);
    assert.equal(newMap.body.features.length, 2);
    const body = { startAlong: 0, points: [point, { latitude: 42.871, longitude: 74.59 }] };
    const oldWarnings = await request(app.getHttpServer()).post('/api/routes/road-features').send(body).expect(201);
    assert.deepEqual(oldWarnings.body.features.map((f: any) => f.kind), ['pedestrian_crossing', 'speed_camera', 'speed_limit_60']);
    const newWarnings = await request(app.getHttpServer()).post('/api/routes/road-features').set('X-Atlas-Capabilities', 'road-features-v2').send(body).expect(201);
    assert.equal(newWarnings.body.features.length, 5);
    assert.equal(newWarnings.body.features.find((f: any) => f.id === 'sign40').speedLimit, 40);
    assert.equal(newWarnings.body.features.find((f: any) => f.id === 'road60').endAlong, 150);
  } finally { await app.close(); }
});
