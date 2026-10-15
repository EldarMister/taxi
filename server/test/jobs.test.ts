import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundJobs } from '../src/jobs';

test('retention removes expired audit entries and preserves recent entries', async t => {
  const now = Date.UTC(2026, 9, 12, 12);
  t.mock.method(Date, 'now', () => now);
  const cutoff = now - 30 * 86400000;
  const entries = [
    { id: 'older', createdAt: new Date(cutoff - 1) },
    { id: 'expired', createdAt: new Date(cutoff) },
    { id: 'recent', createdAt: new Date(cutoff + 1) },
    { id: 'today', createdAt: new Date(now) },
  ];
  const deleted: string[] = [];
  const noop = async () => ({ count: 0 });
  const db = {
    rateLimit: { deleteMany: noop },
    smsChallenge: { updateMany: noop, deleteMany: noop },
    refreshSession: { deleteMany: noop },
    pushJob: { deleteMany: noop },
    adminAudit: {
      deleteMany: async ({ where }: { where: { createdAt: { lte: Date } } }) => {
        for (const entry of entries) {
          if (entry.createdAt <= where.createdAt.lte) deleted.push(entry.id);
        }
        return { count: deleted.length };
      },
    },
  };
  const jobs = new BackgroundJobs({} as never, {} as never, db as never, {} as never);
  await jobs.cleanup();
  assert.deepEqual(deleted, ['older', 'expired']);
});

test('a failed audit cleanup can be retried on the next scheduled run', async () => {
  const noop = async () => ({ count: 0 });
  let attempts = 0;
  const db = {
    rateLimit: { deleteMany: noop },
    smsChallenge: { updateMany: noop, deleteMany: noop },
    refreshSession: { deleteMany: noop },
    pushJob: { deleteMany: noop },
    adminAudit: { deleteMany: async () => {
      if (++attempts === 1) throw new Error('Temporary database failure');
      return { count: 1 };
    } },
  };
  const jobs = new BackgroundJobs({} as never, {} as never, db as never, {} as never);
  await jobs.cleanup();
  await jobs.cleanup();
  assert.equal(attempts, 2);
});
