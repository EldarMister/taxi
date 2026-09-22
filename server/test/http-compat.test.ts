import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripLegacyFreshQuery } from '../src/http';

test('only the legacy Android 304 cache key is removed from a GET URL',()=>{
  assert.equal(stripLegacyFreshQuery('/api/orders/history?period=today&_fresh=123'),'/api/orders/history?period=today');
  assert.equal(stripLegacyFreshQuery('/api/places/reverse?latitude=42.87&longitude=74.57&_fresh=123'),'/api/places/reverse?latitude=42.87&longitude=74.57');
  assert.equal(stripLegacyFreshQuery('/api/orders/history?_fresh=123'),'/api/orders/history');
  assert.equal(stripLegacyFreshQuery('/api/orders/history?period=today&unexpected=1'),'/api/orders/history?period=today&unexpected=1');
});
