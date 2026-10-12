import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTestDatabase } from '../lib/database-target.mjs';
const env = { NODE_ENV: 'development', TEST_DATABASE_RESET: 'true' };
test('accepts the exact audit and CI disposable endpoints', () => {
  assert.equal(assertTestDatabase('postgresql://user:password@127.0.0.1:55448/taxi_security_test?schema=public', env).database, 'taxi_security_test');
  assert.equal(assertTestDatabase('postgresql://user:password@127.0.0.1:5432/taxi_test', env).port, 5432);
  assert.equal(assertTestDatabase('postgresql://user:password@127.0.0.1:55448/taxi_security_test?schema=public&connection_limit=10&pool_timeout=5', env).port, 55448);
});
test('rejects remote, ambiguous, production-like and query-override endpoints', () => {
  for (const url of [undefined, 'postgresql://u:p@db.example/taxi_test', 'postgresql://u:p@localhost:55448/taxi_security_test',
    'postgresql://u:p@127.0.0.1:55448/taxi_test', 'postgresql://u:p@127.0.0.1:5432/production_taxi_test',
    'postgresql://u:p@127.0.0.1:5432/taxi_test?host=db.example', 'http://127.0.0.1:5432/taxi_test',
    'postgresql://u:p@127.0.0.1:55448/taxi_security_test?connection_limit=0',
    'postgresql://u:p@127.0.0.1:55448/taxi_security_test?pool_timeout=61',
    'postgresql://u:p@127.0.0.1:55448/taxi_security_test?schema=public&schema=public']) {
    assert.throws(() => assertTestDatabase(url, env));
  }
  assert.throws(() => assertTestDatabase('postgresql://127.0.0.1:5432/taxi_test', { ...env, TEST_DATABASE_RESET: 'false' }));
  assert.throws(() => assertTestDatabase('postgresql://127.0.0.1:5432/taxi_test', { ...env, NODE_ENV: 'production' }));
});
