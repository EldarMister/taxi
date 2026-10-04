import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PushService } from '../src/providers';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function setup(role = 'CLIENT') {
  const jobs: any[] = [];
  const db = {
    pushJob: {
      findMany: async ({ where }: any) => jobs.filter(job => !job.sentAt && job.availableAt <= new Date()
        && !(where.userId?.notIn || []).includes(job.userId)).map(job => ({ ...job })),
      updateMany: async ({ where, data }: any) => {
        const job = jobs.find(job => job.id === where.id && !job.sentAt && job.availableAt <= new Date());
        if (!job) return { count: 0 };
        job.availableAt = data.availableAt; job.attempts++;
        return { count: 1 };
      },
      update: async ({ where, data }: any) => Object.assign(jobs.find(job => job.id === where.id), data),
    },
    user: { findUnique: async ({ where }: any) => ({ notifications: true, role, pushTokens: [{ id: where.id, token: where.id }] }) },
    pushToken: { deleteMany: async () => ({ count: 0 }) },
  };
  const add = (id: string, userId = id, event = 'chat:message') => jobs.push({ id, userId, event, orderId: 'order', payload: null,
    createdAt: new Date(), availableAt: new Date(), sentAt: null, attempts: 0 });
  return { jobs, add, service: new PushService(db as never, { pushProvider: 'expo' } as never),
    secondWorker: () => new PushService(db as never, { pushProvider: 'expo' } as never) };
}
const accepted = () => new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } }), { status: 200 });

test('a slow phone cannot block other recipients or later polling cycles', async t => {
  const h = setup(), slow = deferred(), sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: any) => {
    const token = JSON.parse(init.body).to; sent.push(token);
    if (token === 'slow') await slow.promise;
    return accepted();
  });
  h.add('slow'); h.add('fast');
  const first = h.service.deliverPending();
  await turn();
  assert.ok(h.jobs.find(job => job.id === 'fast').sentAt);
  assert.equal(h.jobs.find(job => job.id === 'slow').sentAt, null);
  h.add('later');
  await h.service.deliverPending();
  assert.ok(h.jobs.find(job => job.id === 'later').sentAt, 'new work refills a free slot before the slow request ends');
  slow.resolve(); await first;
  assert.deepEqual(sent, ['slow', 'fast', 'later']);
});

test('delivery concurrency is bounded and one recipient retains event order', async t => {
  const h = setup(), release = deferred(); let active = 0, peak = 0;
  const sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: any) => {
    const data = JSON.parse(init.body); sent.push(data.data.eventId);
    active++; peak = Math.max(peak, active); await release.promise; active--; return accepted();
  });
  h.add('first', 'same'); h.add('second', 'same');
  for (let i = 0; i < 9; i++) h.add(`other-${i}`);
  const first = h.service.deliverPending(); await turn();
  await h.service.deliverPending();
  assert.equal(peak, 6);
  assert.equal(sent.includes('second'), false);
  release.resolve(); await first;
  await h.service.deliverPending();
  assert.ok(sent.indexOf('second') > sent.indexOf('first'));
  assert.equal(h.jobs.every(job => !!job.sentAt), true);
});

test('atomic claims prevent duplicate provider sends across overlapping workers', async t => {
  const h = setup(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return accepted(); });
  h.add('one');
  await Promise.all([h.service.deliverPending(), h.secondWorker().deliverPending()]);
  assert.equal(calls, 1);
  assert.equal(h.jobs[0].attempts, 1);
});

test('obsolete queued notifications are consumed without contacting the provider for either role', async t => {
  const sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: any) => {
    sent.push(JSON.parse(init.body).data.event); return accepted();
  });
  for (const role of ['CLIENT', 'DRIVER']) {
    const h = setup(role);
    for (const event of ['order:created', 'order:updated', 'trip:started']) h.add(event, 'same', event);
    h.add('message', 'same');
    // One recipient is processed in order, one job per polling cycle.
    for (let cycle = 0; cycle < h.jobs.length; cycle++) await h.service.deliverPending();
    assert.equal(h.jobs.every(job => !!job.sentAt), true);
    await h.service.deliverPending();
    assert.equal(h.jobs.every(job => job.attempts === 1), true, 'silent jobs are not retried');
  }
  assert.deepEqual(sent, ['chat:message', 'chat:message']);
});
