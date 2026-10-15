import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth';
import { PublicAccountDeletionController } from '../src/profile-self-service';

test('public deletion verifies an existing driver with OTP and returns no login credentials', async () => {
  const calls: unknown[][] = [];
  const auth = { verifyCode: async (...args: unknown[]) => {
    calls.push(args);
    return { userId: 'driver-id', accessToken: 'must-stay-on-server', refreshToken: 'must-stay-on-server' };
  } };
  const service = { removeAccount: async (actor: unknown) => {
    calls.push([actor]);
    return { ok: true };
  } };
  const controller = new PublicAccountDeletionController(service as any, auth as any);
  const result = await controller.confirm({ phone: '+996700123456', code: '123456', appVariant: 'driver' } as any, { ip: '203.0.113.42', headers: {} } as any);
  assert.deepEqual(calls[0], ['+996700123456', '123456', '203.0.113.42', 'driver', true]);
  assert.deepEqual(calls[1], [{ id: 'driver-id', role: 'DRIVER', sessionId: '', familyId: '', expiresAt: 0 }]);
  assert.deepEqual(result, { ok: true });
});

test('public deletion does not remove an account when OTP verification fails', async () => {
  let removed = false;
  const controller = new PublicAccountDeletionController({ removeAccount: async () => { removed = true; } } as any,
    { verifyCode: async () => { throw new UnauthorizedException('Неверный код'); } } as any);
  await assert.rejects(controller.confirm({ phone: '+996700123456', code: '000000', appVariant: 'client' } as any, { ip: '203.0.113.42', headers: {} } as any), UnauthorizedException);
  assert.equal(removed, false);
});

test('a valid deletion code cannot create an account for an unknown number', async () => {
  const phone = '+996700123456', code = '123456', secret = 'test-only-otp-secret';
  let upserts = 0;
  const tx = {
    $queryRaw: async () => [],
    smsChallenge: {
      findUnique: async () => ({ phone, role: 'CLIENT', codeHash: createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex'), provider: 'local', consumedAt: null, expiresAt: new Date(Date.now() + 60000), attempts: 0 }),
      update: async () => ({}),
    },
    user: { findUnique: async () => null, upsert: async () => { upserts++; throw new Error('Account must not be created'); } },
  };
  const auth = new AuthService({ $transaction: async (run: (value: typeof tx) => unknown) => run(tx) } as any,
    {} as any, { otpSecret: secret } as any, { take: async () => {} } as any, {} as any, {} as any, {} as any);
  await assert.rejects(auth.verifyCode(phone, code, '203.0.113.42', 'client', true), UnauthorizedException);
  assert.equal(upserts, 0);
});
