import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateFare, haversine, assertDriverTransition, historySince } from '../src/domain';
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
test('driver lifecycle rejects skipping arrival and client role changes',()=>{
  assert.doesNotThrow(()=>assertDriverTransition('DRIVER','ASSIGNED','ARRIVED'));
  assert.throws(()=>assertDriverTransition('DRIVER','ASSIGNED','COMPLETED'));
  assert.throws(()=>assertDriverTransition('CLIENT','ARRIVED','IN_PROGRESS'));
});
test('history boundaries follow Bishkek even before UTC midnight',()=>{
  assert.equal(historySince('today',new Date('2026-09-05T20:00:00Z'))?.toISOString(),'2026-09-05T18:00:00.000Z');
  assert.equal(historySince('week',new Date('2026-09-05T20:00:00Z'))?.toISOString(),'2026-08-30T18:00:00.000Z');
  assert.equal(historySince('all'),undefined);
});
