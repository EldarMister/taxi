import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextDriver, OFFER_SECONDS } from '../src/dispatch-ranking';

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
