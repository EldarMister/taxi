import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateFare, calculateWaiting, haversine, assertDriverTransition, historySince } from '../src/domain';
test('fare rounds to integer som; commission is separate and deterministic',()=>{
  const fare=calculateFare({basePrice:60,pricePerKm:14,pricePerMinute:2,minimumPrice:100,commissionBps:1000},3210,550);
  assert.deepEqual(fare,{price:124,commission:13});
  assert.equal(calculateFare({basePrice:60,pricePerKm:14,pricePerMinute:2,minimumPrice:100,commissionBps:1000},100,20).price,100);
  assert.throws(()=>calculateFare({basePrice:60,pricePerKm:14,pricePerMinute:2,minimumPrice:100,commissionBps:1000},NaN,20));
});
test('route proximity uses metres and supports equal coordinates',()=>{
  assert.equal(haversine({latitude:42.875,longitude:74.603},{latitude:42.875,longitude:74.603}),0);
  assert.ok(haversine({latitude:42.875,longitude:74.603},{latitude:42.885,longitude:74.603})>1100);
});

test('long taxi routes select the full-route fare immediately above the threshold',()=>{
  const tariff={kind:'RIDE',basePrice:60,pricePerKm:14,pricePerMinute:2,minimumPrice:100,commissionBps:1000,
    longDistanceEnabled:true,longDistanceThresholdKm:5,longDistanceBasePrice:100,longDistancePricePerKm:40};
  assert.deepEqual(calculateFare(tariff,5000,600),{price:150,commission:15});
  assert.deepEqual(calculateFare(tariff,5001,600),{price:301,commission:31});
  assert.deepEqual(calculateFare(tariff,5500,600),{price:320,commission:32});
  assert.deepEqual(calculateFare(tariff,6000,600),{price:340,commission:34});
  assert.deepEqual(calculateFare(tariff,10000,1200),{price:500,commission:50});
  assert.deepEqual(calculateFare(tariff,15000,1800),{price:700,commission:70});
  assert.equal(calculateFare(tariff,15001,1800).price,701);
  assert.equal(calculateFare(tariff,20000,2400).price,900);
  assert.equal(calculateFare({...tariff,pricePerMinute:100,minimumPrice:9999},10000,1200).price,500);
});

test('long-distance settings can change or disable the policy without affecting delivery',()=>{
  const tariff={kind:'RIDE',basePrice:60,pricePerKm:14,pricePerMinute:2,minimumPrice:100,commissionBps:1000,
    longDistanceEnabled:true,longDistanceThresholdKm:8,longDistanceBasePrice:120,longDistancePricePerKm:50};
  assert.equal(calculateFare(tariff,8000,600).price,192);
  assert.equal(calculateFare(tariff,10000,1200).price,620);
  assert.equal(calculateFare({...tariff,longDistanceEnabled:false},10000,1200).price,240);
  assert.equal(calculateFare({...tariff,longDistanceBasePrice:0,longDistancePricePerKm:0},10000,1200).price,0);
  for(const kind of ['DELIVERY_CAR','DELIVERY_TRUCK'])assert.equal(calculateFare({...tariff,kind},10000,1200).price,240);
});
test('waiting starts after one minute, stays free for five, then bills started minutes',()=>{
  const arrival=new Date('2026-09-24T06:00:00Z');
  const policy={waitingGraceMinutes:1,freeWaitingMinutes:5,waitingPricePerMinute:4};
  const at=(seconds:number)=>calculateWaiting(arrival,new Date(arrival.getTime()+seconds*1000),policy);
  assert.deepEqual({phase:at(0).phase,remaining:at(0).remainingSeconds,charge:at(0).charge},{phase:'BEFORE_FREE',remaining:60,charge:0});
  assert.deepEqual({phase:at(60).phase,remaining:at(60).remainingSeconds,charge:at(60).charge},{phase:'FREE',remaining:300,charge:0});
  assert.equal(at(360).charge,0);
  assert.deepEqual({phase:at(361).phase,minutes:at(361).billedMinutes,charge:at(361).charge},{phase:'PAID',minutes:1,charge:4});
  assert.equal(at(421).charge,8);
});
test('driver lifecycle rejects skipping arrival and client role changes',()=>{
  assert.doesNotThrow(()=>assertDriverTransition('DRIVER','ASSIGNED','ARRIVED'));
  assert.throws(()=>assertDriverTransition('DRIVER','ASSIGNED','COMPLETED'));
  assert.throws(()=>assertDriverTransition('CLIENT','ARRIVED','IN_PROGRESS'));
});
test('history boundaries follow Bishkek even before UTC midnight',()=>{
  assert.equal(historySince('today',new Date('2026-09-05T20:00:00Z'))?.toISOString(),'2026-09-05T18:00:00.000Z');
  assert.equal(historySince('week',new Date('2026-09-05T20:00:00Z'))?.toISOString(),'2026-08-30T18:00:00.000Z');
  assert.equal(historySince('month',new Date('2026-09-30T20:00:00Z'))?.toISOString(),'2026-09-30T18:00:00.000Z');
  assert.equal(historySince('month',new Date('2026-01-31T20:00:00Z'))?.toISOString(),'2026-01-31T18:00:00.000Z');
  assert.equal(historySince('all'),undefined);
});
