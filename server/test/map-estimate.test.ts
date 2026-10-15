import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { MapEstimateDto, MapEstimateService } from '../src/map-estimate';
import type { Actor } from '../src/auth';
import { calculateFare } from '../src/domain';

const actor = {id:'client',role:'CLIENT'} as Actor;
const pickup = {latitude:42.87,longitude:74.60,address:'Начало'};
const dropoff = {latitude:42.88,longitude:74.61,address:'Конец'};
const tariff = {id:'economy',active:true,kind:'RIDE',requiredClass:'ECONOMY',basePrice:40,minimumPrice:80,pricePerKm:15,pricePerMinute:3,commissionBps:1000};
const driver = (userId:string, changes:Record<string,unknown> = {}) => ({userId,verified:true,online:true,deposit:500,transportClass:'ECONOMY',acceptsEconomy:true,
  acceptsComfort:false,acceptsDeliveryCar:false,acceptsDeliveryFood:false,acceptsDeliveryTruck:false,
  locationLatitude:42.865,locationLongitude:74.59,locationAccuracyM:10,locationMeasuredAt:new Date(),...changes});
function harness(drivers:ReturnType<typeof driver>[] = []) {
  const queries:any[] = [],routes:any[] = [],limits:any[] = [];
  const state = {busy:[] as string[],offered:[] as string[],tariff:tariff as typeof tariff|null,fail:false,failTrip:false,failPickup:false};
  const db = {
    tariff:{findFirst:async () => state.tariff},
    driverProfile:{findMany:async (query:any) => {queries.push(query);return drivers;}},
    order:{findMany:async () => state.busy.map(driverId=>({driverId}))},
    orderOffer:{findMany:async () => state.offered.map(driverId=>({driverId}))},
  };
  const routing = {route:async (from:any,to:any,timeout:any,language:any,options:any) => {
    routes.push({from,to,timeout,options});
    if (state.fail || state.failPickup && from.address === 'Водитель' || state.failTrip && from.address !== 'Водитель') throw new ServiceUnavailableException();
    return {distanceMeters:2400,durationSeconds:from.address === 'Водитель' ? from.longitude === 74.59 ? 601 : 239 : 301,geometry:[from,to],provider:'osrm',steps:[]};
  }};
  const service = new MapEstimateService(db as any,{minimumDeposit:100} as any,routing as any,{take:async (...args:any[])=>{limits.push(args);}} as any);
  return {service,state,queries,routes,limits};
}

test('preview uses road duration and the same fare policy, without creating a booking quote', async () => {
  const h = harness([driver('near'),driver('quicker',{locationLongitude:74.58})]);
  const result = await h.service.estimate(actor,{pickup,dropoff,tariffId:'economy'});
  assert.equal(result.hasAvailableDrivers,true);
  assert.equal(result.pickupEtaMinutes,4);
  assert.equal(result.trip?.durationMinutes,6);
  assert.equal(result.trip?.price,calculateFare(tariff,2400,301).price);
  assert.equal(h.routes.filter(route=>route.from.address==='Водитель').length,2);
  assert.equal(h.routes[0].from,pickup);
  assert.equal(h.routes[0].to,dropoff);
  assert.ok(h.routes.every(route=>route.timeout===4000&&route.options.fast));
  assert.deepEqual(h.limits[0],['map-estimate:client',60,60]);
  assert.deepEqual(Object.keys(result).sort(),['hasAvailableDrivers','pickupEtaMinutes','trip']);
  assert.ok(!JSON.stringify(result).includes('userId'));
});

test('unavailable, stale, invalid and incompatible drivers never produce a pickup ETA', async () => {
  const h = harness([
    driver('stale',{locationMeasuredAt:new Date(Date.now()-30*60*1000-1000)}),driver('future',{locationMeasuredAt:new Date(Date.now()+60000)}),
    driver('offline',{online:false}),driver('unverified',{verified:false}),driver('poor',{deposit:0}),
    driver('truck',{transportClass:'TRUCK'}),driver('opted-out',{acceptsEconomy:false}),
    driver('invalid',{locationLatitude:NaN}),
    driver('busy'),driver('offered'),
  ]);
  h.state.busy=['busy'];h.state.offered=['offered'];
  const result = await h.service.estimate(actor,{pickup,tariffId:'economy'});
  assert.deepEqual(result,{hasAvailableDrivers:false,pickupEtaMinutes:null,trip:null});
  assert.equal(h.routes.length,0);
  assert.deepEqual(h.queries[0].where.vehicle,{isNot:null});
  assert.equal(h.queries[0].where.online,true);
  assert.equal(h.queries[0].where.verified,true);
});

test('dispatchable idle drivers remain available while their pickup ETA awaits a fresh fix', async () => {
  const h = harness([driver('idle',{locationMeasuredAt:new Date(Date.now()-31_000)})]);
  const result = await h.service.estimate(actor,{pickup,dropoff,tariffId:'economy'});
  assert.equal(result.hasAvailableDrivers,true);
  assert.equal(result.pickupEtaMinutes,null);
  assert.equal(result.trip?.durationMinutes,6);
  assert.equal(h.routes.filter(route=>route.from.address==='Водитель').length,0);
  const age = Date.now()-h.queries[0].where.locationMeasuredAt.gte.getTime();
  assert.ok(age >= 30*60*1000 && age < 30*60*1000+1000);
});

test('coarse or missing accuracy prevents a made-up ETA without hiding a dispatchable car', async () => {
  for (const locationAccuracyM of [101,null]) {
    const h = harness([driver('ready',{locationAccuracyM})]);
    assert.deepEqual(await h.service.estimate(actor,{pickup,tariffId:'economy'}),
      {hasAvailableDrivers:true,pickupEtaMinutes:null,trip:null});
    assert.equal(h.routes.length,0);
  }
});

test('no driver still permits a trip preview and routing outages never invent a time or price', async () => {
  const h = harness();
  const unavailable = await h.service.estimate(actor,{pickup,dropoff,tariffId:'economy'});
  assert.equal(unavailable.hasAvailableDrivers,false);
  assert.equal(unavailable.pickupEtaMinutes,null);
  assert.ok(unavailable.trip);
  const failed = harness([driver('ready')]);failed.state.fail=true;
  assert.deepEqual(await failed.service.estimate(actor,{pickup,dropoff,tariffId:'economy'}),{hasAvailableDrivers:true,pickupEtaMinutes:null,trip:null});
  failed.state.fail=false;
  assert.equal((await failed.service.estimate(actor,{pickup,dropoff,tariffId:'economy'})).pickupEtaMinutes,11,'errors are not cached');
});

test('a failed trip route leaves pickup ETA usable, and failed pickup routes leave the trip usable', async () => {
  const tripFailure = harness([driver('ready')]);tripFailure.state.failTrip=true;
  assert.deepEqual(await tripFailure.service.estimate(actor,{pickup,dropoff,tariffId:'economy'}),{hasAvailableDrivers:true,pickupEtaMinutes:11,trip:null});
  const pickupFailure = harness([driver('ready')]);pickupFailure.state.failPickup=true;
  const result = await pickupFailure.service.estimate(actor,{pickup,dropoff,tariffId:'economy'});
  assert.equal(result.hasAvailableDrivers,true);
  assert.equal(result.pickupEtaMinutes,null);
  assert.equal(result.trip?.durationSeconds,301);
  assert.equal(result.trip?.price,calculateFare(tariff,2400,301).price);
});

test('short route cache deduplicates identical points while availability is checked again', async () => {
  const h = harness([driver('ready')]);
  const first = await h.service.estimate(actor,{pickup,dropoff,tariffId:'economy'});
  assert.equal(first.pickupEtaMinutes,11);
  await h.service.estimate(actor,{pickup,dropoff,tariffId:'economy'});
  assert.equal(h.routes.length,2);
  assert.equal(h.queries.length,2);
  h.state.busy=['ready'];
  const busy = await h.service.estimate(actor,{pickup,dropoff,tariffId:'economy'});
  assert.equal(busy.hasAvailableDrivers,false);
  assert.equal(busy.pickupEtaMinutes,null);
  assert.equal(h.routes.length,2);
  h.state.busy=[];
  h.state.offered=['ready'];
  assert.equal((await h.service.estimate(actor,{pickup,dropoff,tariffId:'economy'})).hasAvailableDrivers,false);
  h.state.offered=[];
  assert.equal((await h.service.estimate(actor,{pickup,dropoff,tariffId:'economy'})).hasAvailableDrivers,true);
  assert.equal(h.routes.length,2);
});

test('preview respects actor and tariff access and does not charge for coincident endpoints', async () => {
  const h = harness();
  await assert.rejects(()=>h.service.estimate({...actor,role:'DRIVER'},{pickup,tariffId:'economy'}),ForbiddenException);
  assert.equal(h.limits.length,0);
  h.state.tariff=null;
  await assert.rejects(()=>h.service.estimate(actor,{pickup,tariffId:'economy'}),NotFoundException);
  h.state.tariff=tariff;
  assert.equal((await h.service.estimate(actor,{pickup,dropoff:pickup,tariffId:'economy'})).trip,null);
});

test('preview validates optional destination, coordinate bounds and strict booking points', async () => {
  const pipe = new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
  const metadata = {type:'body' as const,metatype:MapEstimateDto};
  assert.equal((await pipe.transform({pickup,tariffId:'economy'},metadata)).pickup.latitude,pickup.latitude);
  assert.equal((await pipe.transform({pickup,dropoff,tariffId:'economy'},metadata)).dropoff.longitude,dropoff.longitude);
  for (const body of [
    {tariffId:'economy'}, {pickup:{...pickup,latitude:91},tariffId:'economy'},
    {pickup,dropoff:{...dropoff,longitude:181},tariffId:'economy'},
    {pickup:{...pickup,category:'supermarket'},tariffId:'economy'}, {pickup,tariffId:''},
  ]) await assert.rejects(()=>pipe.transform(body,metadata));
});

test('driver preview is bounded and requires enough balance for the actual trip commission', async () => {
  const h = harness(Array.from({length:8},(_,index)=>driver(`driver-${index}`,{locationLongitude:74.59-index*.001})));
  await h.service.estimate(actor,{pickup,tariffId:'economy'});
  assert.equal(h.routes.length,3);
  const expensive = harness([driver('low-balance',{deposit:101})]);
  expensive.state.tariff={...tariff,basePrice:2000};
  const estimate = await expensive.service.estimate(actor,{pickup,dropoff,tariffId:'economy'});
  assert.ok(estimate.trip!.price>2000);
  assert.equal(estimate.pickupEtaMinutes,null);
  assert.equal(estimate.hasAvailableDrivers,false);
  assert.ok(expensive.queries[0].where.deposit.gte>101);
});
