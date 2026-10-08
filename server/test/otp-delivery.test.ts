import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AppConfig } from '../src/config';
import { OtpFallback } from '../src/otp-fallback';
import { AuthService, RateLimits } from '../src/auth';
import { OtpDelivery, acceptedWhatsappMessage } from '../src/otp-delivery';
import { PrismaService } from '../src/prisma.service';
import { RealtimeEvents } from '../src/events';

const phone = '+996700123456';
const config = {
  smsProvider: 'messaggio', devAuth: false, devCode: '123456',
  otpSecret: 'otp-test-secret-distinct-32-characters', jwtSecret: 'jwt-test-secret-distinct-32-characters',
  accessSeconds: 900, refreshDays: 30,
  messaggioLogin: 'test-project-login', messaggioWhatsappSender: 'test-sender-code',
  messaggioWhatsappTemplate: 'atlas_login', messaggioWhatsappLanguage: 'ru',
} as AppConfig;
const accepted = { accepted_at: '2026-10-09T12-00-00Z', messages: [{ recipient: { phone: phone.slice(1) }, message_id: 'provider-message-id' }] };

function fakeFetch(t: Parameters<Parameters<typeof test>[1]>[0], handler: typeof fetch) {
  t.mock.method(globalThis, 'fetch', handler);
}

function authHarness(delivery: OtpDelivery, cfg = config) {
  let challenge: any = null;
  const limits: string[] = [];
  const user = { id: 'user-id', role: 'CLIENT', phone };
  const db: any = {
    user: { findUnique: async () => null, upsert: async () => user },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: any) => unknown) => fn(db),
    refreshSession: { create: async () => ({ id: 'session-id' }) },
    smsChallenge: {
      upsert: async (query: any) => { challenge = challenge ? { ...challenge, ...query.update } : { attempts: 0, ...query.create }; return challenge; },
      findUnique: async () => challenge,
      updateMany: async (query: any) => {
        if (!challenge || challenge.codeHash !== query.where.codeHash || +challenge.consumedAt !== +query.where.consumedAt) return { count: 0 };
        Object.assign(challenge, query.data); return { count: 1 };
      },
      update: async (query: any) => {
        if (query.data.attempts) challenge.attempts += query.data.attempts.increment;
        else Object.assign(challenge, query.data);
        return challenge;
      },
    },
  };
  const service = new AuthService(db as PrismaService, new JwtService(), cfg,
    { take: async (key: string) => { limits.push(key); } } as unknown as RateLimits, {} as RealtimeEvents, delivery, {} as OtpFallback);
  service.user = async () => user as any;
  return { service, limits, challenge: () => challenge };
}

test('WhatsApp sends the approved template and the same code in body/copy button; no SMS fallback', async t => {
  let calls = 0;
  fakeFetch(t, async (url, options) => {
    calls++;
    assert.equal(url, 'https://msg.messaggio.com/api/v1/send');
    assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error');
    assert.equal((options?.headers as Record<string,string>)['Messaggio-Login'], config.messaggioLogin);
    assert.ok(options?.signal);
    const payload = JSON.parse(options?.body as string);
    assert.deepEqual(payload.recipients, [{ phone: '996700123456' }]);
    assert.deepEqual(payload.channels, ['whatsapp']); assert.equal(payload.options.ttl, 300);
    assert.match(payload.options.external_id, /^[a-f0-9-]{36}$/);
    assert.deepEqual(payload.whatsapp, { from: 'test-sender-code', content: [{ type: 'template', template: {
      id: 'atlas_login', language: 'ru', body: { parameters: [{ text: '654321' }] }, buttons: [{ type: 'url', url_parameter: '654321' }],
    } }] });
    return Response.json(accepted);
  });
  assert.equal(await new OtpDelivery(config).send(phone, '654321'), 'whatsapp');
  assert.equal(calls, 1);
});

test('HTTP 200 must include acceptance of this exact recipient, without an error', () => {
  for (const response of [null, {}, { messages: [] }, { messages: [{ recipient: {phone: '996700000000'}, message_id: 'id' }] },
    { messages: [{ recipient: {phone: phone.slice(1)}, message_id: '' }] },
    { messages: [{ ...accepted.messages[0], error: { title: 'Rejected' } }] },
    { messages: [...accepted.messages, ...accepted.messages] }]) assert.equal(acceptedWhatsappMessage(response, phone), false);
  assert.equal(acceptedWhatsappMessage(accepted, phone), true);
});

test('provider rejection, invalid JSON and network timeout fail once with a safe client error', async t => {
  for (const result of [Response.json({title:'Secret provider error'}, {status:403}), Response.json({messages:[]}), new Response('invalid-json'), null]) {
    let calls = 0;
    fakeFetch(t, async () => { calls++; if (!result) throw new Error('secret-token-and-code'); return result; });
    await assert.rejects(new OtpDelivery(config).send(phone, '654321'), (error: unknown) =>
      error instanceof ServiceUnavailableException && error.message === 'Не удалось отправить код в WhatsApp. Попробуйте позже.');
    assert.equal(calls, 1, 'no duplicate sends or automatic fallback on ambiguous failure');
  }
});

test('request stores only a hash, activates after provider acceptance and verifies once', async t => {
  let sentCode = '';
  const h = authHarness(new OtpDelivery(config));
  fakeFetch(t, async (_, options) => {
    sentCode = JSON.parse(options?.body as string).whatsapp.content[0].template.body.parameters[0].text;
    assert.match(sentCode, /^\d{6}$/); assert.ok(h.challenge().consumedAt);
    assert.equal(h.challenge().codeHash, createHmac('sha256', config.otpSecret).update(`${phone}:${sentCode}`).digest('hex'));
    await assert.rejects(h.service.verifyCode(phone, sentCode, 'test-ip'), UnauthorizedException);
    return Response.json(accepted);
  });
  const result = await h.service.requestCode(phone, 'test-ip');
  assert.deepEqual(result, {sent:true,channel:'whatsapp',retryAfterSeconds:60});
  assert.equal(h.challenge().consumedAt, null);
  assert.equal('developmentCode' in result, false);
  assert.ok(h.limits.includes(`sms:phone-minute:${phone}`));
  const session = await h.service.verifyCode(phone, sentCode, 'test-ip');
  assert.equal(session.user.id, 'user-id'); assert.ok(session.accessToken);
  await assert.rejects(h.service.verifyCode(phone, sentCode, 'test-ip'), UnauthorizedException);
});

test('a failed send never leaves a valid replacement OTP or a fake success', async t => {
  let sentCode = '';
  fakeFetch(t, async (_, options) => {
    sentCode = JSON.parse(options?.body as string).whatsapp.content[0].template.body.parameters[0].text;
    return Response.json({messages:[{recipient:{phone:phone.slice(1)},error:{title:'Blocked sender'}}]});
  });
  const h = authHarness(new OtpDelivery(config));
  await assert.rejects(h.service.requestCode(phone, 'test-ip'), ServiceUnavailableException);
  assert.ok(h.challenge().consumedAt);
  await assert.rejects(h.service.verifyCode(phone, sentCode, 'test-ip'), UnauthorizedException);
});

test('verification keeps expiry and five incorrect attempt protection', async t => {
  let sentCode = '';
  fakeFetch(t, async (_, options) => { sentCode=JSON.parse(options?.body as string).whatsapp.content[0].template.body.parameters[0].text; return Response.json(accepted); });
  const h = authHarness(new OtpDelivery(config));
  await h.service.requestCode(phone, 'test-ip');
  const wrong = sentCode === '000000' ? '111111' : '000000';
  for (let i=0;i<5;i++) await assert.rejects(h.service.verifyCode(phone, wrong, 'test-ip'), UnauthorizedException);
  assert.equal(h.challenge().attempts,5);
  await assert.rejects(h.service.verifyCode(phone, sentCode, 'test-ip'), UnauthorizedException);
  h.challenge().attempts=0; h.challenge().expiresAt=new Date(Date.now()-1000);
  await assert.rejects(h.service.verifyCode(phone, sentCode, 'test-ip'), UnauthorizedException);
});

test('rate-limit rejection stops the provider before any billable request', async t => {
  fakeFetch(t, async () => { assert.fail('provider must not be called'); });
  const h=authHarness(new OtpDelivery(config));
  (h.service as any).limits={take:async()=>{throw new Error('throttled');}};
  await assert.rejects(h.service.requestCode(phone,'test-ip'), /throttled/);
  assert.equal(h.challenge(),null);
});

test('development OTP remains isolated; real providers ignore a leftover DEV_AUTH_ENABLED=true', () => {
  const original = {...process.env};
  try {
    Object.assign(process.env, { NODE_ENV:'development', JWT_SECRET:config.jwtSecret, OTP_SECRET:config.otpSecret,
      DATABASE_URL:'postgresql://unused/test', DEV_AUTH_ENABLED:'true', SMS_PROVIDER:'messaggio', PUSH_PROVIDER:'development',
      MESSAGGIO_LOGIN:'login', MESSAGGIO_WHATSAPP_SENDER:'sender', MESSAGGIO_WHATSAPP_TEMPLATE:'atlas_login',
      MESSAGGIO_WHATSAPP_LANGUAGE:'ru', NOMINATIM_BASE_URL:'', PHOTON_BASE_URL:'' });
    assert.equal(new AppConfig().devAuth,false);
    process.env.SMS_PROVIDER='development'; assert.equal(new AppConfig().devAuth,true);
    process.env.SMS_PROVIDER='messaggio'; process.env.MESSAGGIO_LOGIN='';
    assert.throws(()=>new AppConfig(),/MESSAGGIO_LOGIN/);
    process.env.MESSAGGIO_LOGIN='login'; process.env.MESSAGGIO_WHATSAPP_LANGUAGE='invalid language';
    assert.throws(()=>new AppConfig(),/MESSAGGIO_WHATSAPP_LANGUAGE/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env,original);
  }
});

test('development returns the explicit test code without contacting any provider', async t => {
  fakeFetch(t,async()=>{assert.fail('development must not send');});
  const cfg={...config,smsProvider:'development',devAuth:true} as AppConfig;
  const h=authHarness(new OtpDelivery(cfg),cfg);
  assert.deepEqual(await h.service.requestCode(phone,'test-ip'),{sent:true,channel:'development',retryAfterSeconds:60,development:true,developmentCode:'123456'});
});

test('existing HTTP SMS gateway remains compatible and never exposes the fixed development code', async t => {
  const cfg={...config,smsProvider:'http',require:(key:string)=>key==='SMS_GATEWAY_URL'?'https://sms.example.test/send':'test-token'} as AppConfig;
  fakeFetch(t,async (url,options)=>{
    assert.equal(url,'https://sms.example.test/send');
    assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer test-token');
    const body=JSON.parse(options?.body as string);assert.equal(body.phone,phone);
    assert.match(body.message,/^Код для входа в Atlas: \d{6}\./);
    return new Response(null,{status:204});
  });
  const h=authHarness(new OtpDelivery(cfg),cfg);
  assert.deepEqual(await h.service.requestCode(phone,'test-ip'),{sent:true,channel:'sms',retryAfterSeconds:60});
});
