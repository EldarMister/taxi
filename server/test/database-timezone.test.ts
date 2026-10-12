import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDatabaseUtcClock, PrismaService } from '../src/prisma.service';

function fakeClient(rows: unknown = [{ timezone: 'UTC', offsetSeconds: 0 }], failure?: 'connect' | 'query' | 'disconnect') {
  const operations: string[] = [];
  const privateFailure = new Error('synthetic connection data: postgresql://fixture:private@invalid.example/test');
  const client = {
    async $connect() { operations.push('connect'); if (failure === 'connect') throw privateFailure; },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      operations.push('query');
      assert.equal(strings.join(''), 'SELECT current_setting(\'TimeZone\') AS "timezone", EXTRACT(TIMEZONE FROM CURRENT_TIMESTAMP)::int AS "offsetSeconds"');
      assert.deepEqual(values, []);
      if (failure === 'query') throw privateFailure;
      return rows;
    },
    async $disconnect() { operations.push('disconnect'); if (failure === 'disconnect') throw privateFailure; },
  };
  return { client, operations };
}
const initialize = (client: object) => PrismaService.prototype.onModuleInit.call(client as PrismaService);

test('clock validation accepts fixed UTC and GMT zero aliases with a numeric zero offset', () => {
  for (const timezone of ['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'GMT0', 'GMT+0', 'GMT-0', 'Etc/GMT0', 'Etc/GMT+0', 'Etc/GMT-0', 'utc']) {
    assert.doesNotThrow(() => assertDatabaseUtcClock({ timezone, offsetSeconds: 0 }));
  }
});

test('clock validation rejects nonzero offsets and regional names even when currently zero', () => {
  for (const clock of [
    { timezone: 'Asia/Almaty', offsetSeconds: 18000 },
    { timezone: 'Europe/London', offsetSeconds: 0 },
    { timezone: 'Africa/Abidjan', offsetSeconds: 0 },
    { timezone: 'America/New_York', offsetSeconds: -14400 },
    { timezone: 'UTC', offsetSeconds: 3600 },
    { timezone: '+00:00', offsetSeconds: 0 },
  ]) assert.throws(() => assertDatabaseUtcClock(clock), /Configure.*TimeZone to UTC/);
});

test('clock validation rejects missing or malformed results', () => {
  for (const clock of [undefined, null, {}, { timezone: 'UTC' }, { offsetSeconds: 0 },
    { timezone: 'UTC', offsetSeconds: '0' }, { timezone: 'UTC', offsetSeconds: NaN },
    { timezone: ' UTC ', offsetSeconds: 0 }, { timezone: 0, offsetSeconds: 0 }]) {
    assert.throws(() => assertDatabaseUtcClock(clock), /Database clock check failed/);
  }
});

test('startup connects, checks the clock with a read-only query and retains a healthy connection', async () => {
  const { client, operations } = fakeClient();
  await initialize(client);
  assert.deepEqual(operations, ['connect', 'query']);
  await PrismaService.prototype.onModuleDestroy.call(client as unknown as PrismaService);
  assert.deepEqual(operations, ['connect', 'query', 'disconnect']);
});

test('startup disconnects on unsafe, missing or unexpected clock rows', async () => {
  for (const rows of [[{ timezone: 'Asia/Almaty', offsetSeconds: 18000 }], [{ timezone: 'Europe/London', offsetSeconds: 0 }], [], [{}], null,
    [{ timezone: 'UTC', offsetSeconds: 0 }, { timezone: 'UTC', offsetSeconds: 0 }]]) {
    const { client, operations } = fakeClient(rows);
    await assert.rejects(initialize(client), /Configure.*TimeZone to UTC/);
    assert.deepEqual(operations, ['connect', 'query', 'disconnect']);
  }
});

test('connection and query failures attempt disconnect and expose no connection data', async () => {
  for (const failure of ['connect', 'query'] as const) {
    const { client, operations } = fakeClient(undefined, failure);
    await assert.rejects(initialize(client), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Configure.*TimeZone to UTC/);
      assert.doesNotMatch(error.message, /postgresql|fixture|private|invalid.example/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(operations, failure === 'connect' ? ['connect', 'disconnect'] : ['connect', 'query', 'disconnect']);
  }
});

test('disconnect failure preserves the safe clock configuration error', async () => {
  const { client, operations } = fakeClient([], 'disconnect');
  await assert.rejects(initialize(client), error => error instanceof Error && /TimeZone to UTC/.test(error.message) && !/private/.test(error.message));
  assert.deepEqual(operations, ['connect', 'query', 'disconnect']);
});
