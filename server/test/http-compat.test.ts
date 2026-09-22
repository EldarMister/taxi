import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripLegacyCacheQuery } from '../src/http';

test('only legacy Android cache keys are removed from a GET URL',()=>{
  assert.equal(stripLegacyCacheQuery('/api/orders/history?period=today&_=123'),'/api/orders/history?period=today');
  assert.equal(stripLegacyCacheQuery('/api/orders/history?period=today&_fresh=123'),'/api/orders/history?period=today');
  assert.equal(stripLegacyCacheQuery('/api/places/reverse?latitude=42.87&longitude=74.57&_=123'),'/api/places/reverse?latitude=42.87&longitude=74.57');
  assert.equal(stripLegacyCacheQuery('/api/orders/history?_=123'),'/api/orders/history');
  assert.equal(stripLegacyCacheQuery('/api/orders/history?period=today&unexpected=1'),'/api/orders/history?period=today&unexpected=1');
});
