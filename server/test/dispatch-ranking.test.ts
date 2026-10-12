import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextDriver, OFFER_SECONDS, IDLE_POSITION_MAX_AGE_MS } from '../src/dispatch-ranking';
import { driverCanTake, type DispatchProfile } from '../src/driver-eligibility';

test('nearest driver wins outside the nearby range; rating breaks near-distance priority',()=>{
  const now=Date.now();
  const driver=(userId:string,longitude:number)=>({userId,locationLatitude:42.8756,locationLongitude:longitude,locationMeasuredAt:new Date(now)});
  const pickup={latitude:42.8756,longitude:74.6040};
  const close=driver('close',74.6042),near=driver('near',74.6055),far=driver('far',74.6150);
  assert.equal(nextDriver(pickup,[close,near,far],new Map([['close',4],['near',4.9],['far',5]]),now),'near');
  assert.equal(nextDriver(pickup,[close,far],new Map([['close',4],['far',5]]),now),'close');
  assert.equal(nextDriver(pickup,[close,near],new Map(),now),'close');
  assert.equal(nextDriver(pickup,[{...close,locationMeasuredAt:new Date(now-30001)},near],new Map(),now),'near');
  assert.equal(OFFER_SECONDS,30);
});
test('an online driver with a recent idle position remains eligible when no fresh driver is available',()=>{
  const now=Date.now(),pickup={latitude:42.8756,longitude:74.6040};
  const idle={userId:'idle',locationLatitude:pickup.latitude,locationLongitude:pickup.longitude,locationMeasuredAt:new Date(now-3*60*1000)};
  assert.equal(nextDriver(pickup,[idle],new Map(),now),null);
  assert.equal(nextDriver(pickup,[idle],new Map(),now,IDLE_POSITION_MAX_AGE_MS),'idle');
  assert.equal(nextDriver(pickup,[{...idle,locationMeasuredAt:new Date(now-IDLE_POSITION_MAX_AGE_MS-1)}],new Map(),now,IDLE_POSITION_MAX_AGE_MS),null);
});

test('driver class and preferences isolate ride and delivery offers',()=>{
  const profile=(transportClass:DispatchProfile['transportClass'],overrides:Partial<DispatchProfile>={}):DispatchProfile=>({transportClass,acceptsEconomy:false,acceptsComfort:false,acceptsDeliveryCar:false,acceptsDeliveryTruck:false,...overrides});
  const economy=profile('ECONOMY',{acceptsEconomy:true,acceptsDeliveryCar:true});
  const comfort=profile('COMFORT',{acceptsEconomy:true,acceptsComfort:true,acceptsDeliveryCar:true});
  const truck=profile('TRUCK',{acceptsDeliveryTruck:true});
  assert.equal(driverCanTake(economy,'RIDE','ECONOMY'),true);
  assert.equal(driverCanTake(economy,'RIDE','COMFORT'),false);
  assert.equal(driverCanTake(comfort,'RIDE','COMFORT'),true);
  assert.equal(driverCanTake(comfort,'RIDE','ECONOMY'),true);
  assert.equal(driverCanTake(economy,'DELIVERY_CAR','ECONOMY'),true);
  assert.equal(driverCanTake(truck,'DELIVERY_CAR','ECONOMY'),false);
  assert.equal(driverCanTake(truck,'DELIVERY_TRUCK','TRUCK'),true);
  assert.equal(driverCanTake(comfort,'DELIVERY_TRUCK','TRUCK'),false);
});
