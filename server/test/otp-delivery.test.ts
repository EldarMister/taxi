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
import { sealNikitaToken, unsealNikitaToken } from '../src/nikita-otp';

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

function authHarness(delivery: OtpDelivery, cfg = config, existingUser: any = null) {
  let challenge: any = null;
  const limits: string[] = [];
  const user = { id: 'user-id', role: 'CLIENT', phone };
  const db: any = {
    user: { findUnique: async () => existingUser, upsert: async () => user },
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
        const {attempts,...fields}=query.data;
        if (attempts) challenge.attempts += attempts.increment;
        Object.assign(challenge,fields);
        return challenge;
      },
    },
  };
  const service = new AuthService(db as PrismaService, new JwtService(), cfg,
    { take: async (key: string) => { limits.push(key); }, takeAll: async (values: Array<{key:string}>) => { limits.push(...values.map(x=>x.key)); } } as unknown as RateLimits, {} as RealtimeEvents, delivery, {} as OtpFallback);
  service.user = async () => user as any;
  return { service, limits, challenge: () => challenge };
}

const nikitaConfig = {...config,smsProvider:'nikita',nikitaApiKey:'0123456789abcdef0123456789abcdef'} as AppConfig;
const providerToken='fedcba9876543210fedcba9876543210';

test('Nikita sends exactly one JSON OTP request with unique 32-character ID and no WhatsApp/Telegram',async t=>{
  const ids=new Set<string>();
  fakeFetch(t,async(url,options)=>{
    assert.equal(url,'https://smspro.nikita.kg/api/otp/send');
    assert.equal(options?.method,'POST');assert.equal(options?.redirect,'error');assert.ok(options?.signal);
    assert.equal((options?.headers as Record<string,string>)['X-API-KEY'],nikitaConfig.nikitaApiKey);
    const body=JSON.parse(options?.body as string);
    assert.equal(body.phone,phone.slice(1));assert.match(body.transaction_id,/^[a-f0-9]{32}$/);
    assert.equal('code' in body,false);assert.equal(ids.has(body.transaction_id),false);ids.add(body.transaction_id);
    return Response.json({status:0,token:providerToken});
  });
  const delivery=new OtpDelivery(nikitaConfig);
  assert.equal(await delivery.startNikita(phone),providerToken);
  await delivery.startNikita(phone);assert.equal(ids.size,2);
});

test('Nikita request activates only after acceptance; encrypted token survives restart and successful verification is single-use',async t=>{
  const h=authHarness(new OtpDelivery(nikitaConfig),nikitaConfig);
  let verifyCalls=0;
  fakeFetch(t,async(url,options)=>{
    if(String(url).endsWith('/send')) {
      assert.ok(h.challenge().consumedAt);assert.equal(h.challenge().providerTokenCiphertext,null);
      return Response.json({status:0,token:providerToken});
    }
    verifyCalls++;
    assert.equal(url,'https://smspro.nikita.kg/api/otp/verify');
    assert.deepEqual(JSON.parse(options?.body as string),{token:providerToken,code:'654321'});
    return Response.json({status:'0'});
  });
  assert.deepEqual(await h.service.requestCode(phone,'test-ip'),{sent:true,channel:'sms',retryAfterSeconds:60});
  assert.equal(h.challenge().provider,'nikita');assert.equal(h.challenge().consumedAt,null);
  assert.ok(!h.challenge().providerTokenCiphertext.includes(providerToken));
  // A new delivery instance can decrypt/verify the persisted challenge after a process restart.
  (h.service as any).delivery=new OtpDelivery(nikitaConfig);
  assert.ok((await h.service.verifyCode(phone,'654321','test-ip')).accessToken);
  assert.equal(h.challenge().providerTokenCiphertext,null);
  await assert.rejects(h.service.verifyCode(phone,'654321','test-ip'),UnauthorizedException);
  assert.equal(verifyCalls,1);
});

test('Nikita rejects malformed acceptance and provider errors without a usable challenge, retries, or leaked descriptions',async t=>{
  for(const response of [Response.json({status:5,description:'secret body'}),Response.json({status:0}),
    Response.json({status:false,token:providerToken}),Response.json({status:null,token:providerToken}),
    Response.json({status:0,token:'bad\nheader'}),new Response('invalid JSON'),new Response('',{status:500}),null]) {
    let calls=0;
    fakeFetch(t,async()=>{calls++;if(!response)throw Error('secret transport body');return response;});
    const h=authHarness(new OtpDelivery(nikitaConfig),nikitaConfig);
    await assert.rejects(h.service.requestCode(phone,'test-ip'),(error:unknown)=>error instanceof ServiceUnavailableException && !error.message.includes('secret'));
    assert.ok(h.challenge().consumedAt);assert.equal(h.challenge().providerTokenCiphertext,null);
    await assert.rejects(h.service.verifyCode(phone,'654321','test-ip'),UnauthorizedException);assert.equal(calls,1);
  }
});

test('Nikita accepts different Kyrgyzstan numbers and preserves country validation',async t=>{
  const sent:string[]=[];
  fakeFetch(t,async(_url,options)=>{sent.push(JSON.parse(options?.body as string).phone);return Response.json({status:0,token:providerToken});});
  const delivery=new OtpDelivery(nikitaConfig);
  await delivery.startNikita(phone);
  await delivery.startNikita('+996220203083');
  assert.deepEqual(sent,[phone.slice(1),'996220203083']);
  await assert.rejects(delivery.startNikita('+77001234567'),ServiceUnavailableException);
});

test('Nikita commits five wrong attempts and never calls the provider after the fifth',async t=>{
  let calls=0;
  fakeFetch(t,async url=>{
    if(String(url).endsWith('/send'))return Response.json({status:0,token:providerToken});
    calls++;return Response.json({status:14});
  });
  const h=authHarness(new OtpDelivery(nikitaConfig),nikitaConfig);await h.service.requestCode(phone,'test-ip');
  for(let i=0;i<5;i++)await assert.rejects(h.service.verifyCode(phone,'000000','test-ip'),UnauthorizedException);
  assert.equal(h.challenge().attempts,5);assert.equal(h.challenge().providerTokenCiphertext,null);
  await assert.rejects(h.service.verifyCode(phone,'654321','test-ip'),UnauthorizedException);assert.equal(calls,5);
});

test('Nikita expired/revoked provider tokens are discarded without creating a session',async t=>{
  for(const status of [12,13]) {
    fakeFetch(t,async url=>String(url).endsWith('/send')?Response.json({status:0,token:providerToken}):Response.json({status}));
    const h=authHarness(new OtpDelivery(nikitaConfig),nikitaConfig);await h.service.requestCode(phone,'test-ip');
    await assert.rejects(h.service.verifyCode(phone,'654321','test-ip'),UnauthorizedException);
    assert.ok(h.challenge().consumedAt);assert.equal(h.challenge().providerTokenCiphertext,null);
  }
});

test('Nikita local expiry blocks verification, including when expiry occurs during a successful provider response',async t=>{
  const h=authHarness(new OtpDelivery(nikitaConfig),nikitaConfig);let calls=0;
  fakeFetch(t,async url=>{
    if(String(url).endsWith('/send'))return Response.json({status:0,token:providerToken});
    calls++;h.challenge().expiresAt=new Date(Date.now()-1000);return Response.json({status:0});
  });
  await h.service.requestCode(phone,'test-ip');h.challenge().expiresAt=new Date(Date.now()-1000);
  await assert.rejects(h.service.verifyCode(phone,'654321','test-ip'),UnauthorizedException);assert.equal(calls,0);
  h.challenge().expiresAt=new Date(Date.now()+60000);
  await assert.rejects(h.service.verifyCode(phone,'654321','test-ip'),UnauthorizedException);assert.equal(calls,1);
  assert.ok(h.challenge().consumedAt);
});

test('Nikita verification transport/configuration errors do not count as an incorrect user code',async t=>{
  for(const response of [Response.json({status:2}),Response.json({status:3}),Response.json({status:false}),new Response('bad JSON'),null]) {
    let calls=0;
    fakeFetch(t,async url=>{
      if(String(url).endsWith('/send'))return Response.json({status:0,token:providerToken});
      calls++;if(!response)throw Error('sensitive data');return response;
    });
    const h=authHarness(new OtpDelivery(nikitaConfig),nikitaConfig);await h.service.requestCode(phone,'test-ip');
    await assert.rejects(h.service.verifyCode(phone,'654321','test-ip'),ServiceUnavailableException);
    assert.equal(h.challenge().attempts,0);assert.equal(h.challenge().consumedAt,null);assert.equal(calls,1);
  }
});

test('Nikita resend replaces the provider token and switching providers clears stale credentials',async t=>{
  let sends=0;
  const cfg={...nikitaConfig};const h=authHarness(new OtpDelivery(cfg),cfg);
  fakeFetch(t,async(_,options)=>{
    const body=JSON.parse(options?.body as string);
    if(body.transaction_id)return Response.json({status:0,token:++sends===1?providerToken:'0123456789abcdef0123456789abcdef'});
    if(body.token) {assert.equal(body.token,'0123456789abcdef0123456789abcdef');return Response.json({status:14});}
    return Response.json(accepted);
  });
  await h.service.requestCode(phone,'test-ip');const old=h.challenge().providerTokenCiphertext;
  await h.service.requestCode(phone,'test-ip');assert.notEqual(h.challenge().providerTokenCiphertext,old);
  await assert.rejects(h.service.verifyCode(phone,'654321','test-ip'),UnauthorizedException);
  cfg.smsProvider='messaggio';await h.service.requestCode(phone,'test-ip');
  assert.equal(h.challenge().provider,'local');assert.equal(h.challenge().providerTokenCiphertext,null);
});

test('Nikita token encryption rejects tampering, another phone, challenge, or secret',()=>{
  const identity=`${phone}:test-challenge`,sealed=sealNikitaToken(providerToken,nikitaConfig.otpSecret,identity);
  assert.equal(unsealNikitaToken(sealed,nikitaConfig.otpSecret,identity),providerToken);
  assert.throws(()=>unsealNikitaToken(sealed,nikitaConfig.otpSecret,'another-phone:test-challenge'));
  assert.throws(()=>unsealNikitaToken(sealed,nikitaConfig.otpSecret,`${phone}:another-challenge`));
  assert.throws(()=>unsealNikitaToken(sealed,'different-secret',identity));
  const bytes=Buffer.from(sealed,'base64');bytes[12]^=1;
  assert.throws(()=>unsealNikitaToken(bytes.toString('base64'),nikitaConfig.otpSecret,identity));
});

test('Nikita configuration requires the OTP API key and disables a leftover development login',()=>{
  const original={...process.env};
  try {
    Object.assign(process.env,{NODE_ENV:'development',DATABASE_URL:'postgresql://unused/test',JWT_SECRET:config.jwtSecret,OTP_SECRET:config.otpSecret,
      SMS_PROVIDER:'nikita',PUSH_PROVIDER:'development',DEV_AUTH_ENABLED:'true',NIKITA_API_KEY:nikitaConfig.nikitaApiKey,TEST_AUTH_PHONES:'',TEST_AUTH_CODE:'123456',
      NOMINATIM_BASE_URL:'',PHOTON_BASE_URL:''});
    assert.equal(new AppConfig().devAuth,false);
    process.env.NIKITA_API_KEY='';assert.throws(()=>new AppConfig(),/NIKITA_API_KEY/);
    process.env.NIKITA_API_KEY=nikitaConfig.nikitaApiKey;process.env.TEST_AUTH_PHONES='+77001234567';
    assert.throws(()=>new AppConfig(),/TEST_AUTH_PHONES/);
  } finally {
    for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);
  }
});

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
  (h.service as any).limits={takeAll:async()=>{throw new Error('throttled');}};
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

test('Cloud authentication uses durable delivery, activates only after acceptance and verifies once',async t=>{
  const cfg={...config,smsProvider:'whatsapp_cloud',telegramGatewayToken:'',whatsappCloudToken:'test-token',whatsappCloudPhoneId:'100000000000001',
    whatsappCloudWabaId:'700000000000001',whatsappCloudTemplate:'atlas',whatsappCloudLanguage:'ru',whatsappCloudVersion:'v25.0'} as AppConfig;
  const delivery=new OtpDelivery(cfg),h=authHarness(delivery,cfg);let sentCode='';
  (h.service as any).fallback={start:async(receivedPhone:string,receivedCode:string)=>{
    assert.equal(receivedPhone,phone);assert.ok(h.challenge().consumedAt);
    await delivery.sendWhatsapp(receivedPhone,receivedCode);return {channel:'whatsapp',deliveryId:'test-attempt-id'};
  }};
  fakeFetch(t,async(_,options)=>{
    sentCode=JSON.parse(options?.body as string).template.components[0].parameters[0].text;
    await assert.rejects(h.service.verifyCode(phone,sentCode,'test-ip'),UnauthorizedException);
    return Response.json({messaging_product:'whatsapp',contacts:[{input:phone.slice(1),wa_id:phone.slice(1)}],messages:[{id:'wamid.test-id'}]});
  });
  assert.deepEqual(await h.service.requestCode(phone,'test-ip'),{sent:true,channel:'whatsapp',deliveryId:'test-attempt-id',retryAfterSeconds:60});
  assert.equal(h.challenge().codeHash,createHmac('sha256',cfg.otpSecret).update(`${phone}:${sentCode}`).digest('hex'));
  assert.equal(h.challenge().consumedAt,null);
  assert.ok((await h.service.verifyCode(phone,sentCode,'test-ip')).accessToken);
  await assert.rejects(h.service.verifyCode(phone,sentCode,'test-ip'),UnauthorizedException);
});

 test('explicit existing test accounts use local single-use codes without contacting Nikita',async t=>{
  fakeFetch(t,async()=>assert.fail('test account must not send SMS'));
  const cfg={...nikitaConfig,testAuthPhones:[phone],testAuthCode:'123456'} as AppConfig;
  const h=authHarness(new OtpDelivery(cfg),cfg,{role:'CLIENT',deletedAt:null});
  assert.deepEqual(await h.service.requestCode(phone,'test-ip'),{sent:true,channel:'development',retryAfterSeconds:60,development:true,developmentCode:'123456',testPhone:phone});
  assert.equal(h.challenge().provider,'local');
  await assert.rejects(h.service.verifyCode(phone,'000000','test-ip'),UnauthorizedException);
  assert.ok((await h.service.verifyCode(phone,'123456','test-ip')).accessToken);
  await assert.rejects(h.service.verifyCode(phone,'123456','test-ip'),UnauthorizedException);
 });
 test('test account allowlist never bypasses SMS for deleted or other users, and never grants admin access',async t=>{
  let calls=0;fakeFetch(t,async()=>{calls++;return Response.json({status:0,token:providerToken});});
  const cfg={...nikitaConfig,testAuthPhones:[phone],testAuthCode:'123456'} as AppConfig;
  for(const existing of [{role:'CLIENT',deletedAt:new Date()}]) {
    const h=authHarness(new OtpDelivery(cfg),cfg,existing);
    const result=await h.service.requestCode(phone,'test-ip');
    assert.equal(result.channel,'sms');assert.equal('testPhone' in result,false);assert.equal('developmentCode' in result,false);
    assert.equal(h.challenge().provider,'nikita');
  }
  const normalCfg={...cfg,testAuthPhones:['+996220203084']} as AppConfig;
  const h=authHarness(new OtpDelivery(normalCfg),normalCfg,{role:'CLIENT',deletedAt:null});
  const ordinaryResult=await h.service.requestCode(phone,'test-ip');
  assert.equal(ordinaryResult.channel,'sms');assert.equal('testPhone' in ordinaryResult,false);assert.equal('developmentCode' in ordinaryResult,false);assert.equal(calls,2);
  const admin=authHarness(new OtpDelivery(cfg),cfg,{role:'ADMIN',deletedAt:null});
  await assert.rejects(admin.service.requestCode(phone,'test-ip'),UnauthorizedException);assert.equal(calls,2);
 });

 test('explicit test number supports first login and registration without sending SMS',async t=>{
  fakeFetch(t,async()=>assert.fail('explicit test number must not send SMS'));
  const cfg={...nikitaConfig,testAuthPhones:[phone],testAuthCode:'123456'} as AppConfig;
  const h=authHarness(new OtpDelivery(cfg),cfg);
  const result=await h.service.requestCode(phone,'test-ip');assert.equal(result.channel,'development');assert.equal(result.testPhone,phone);
  assert.ok((await h.service.verifyCode(phone,'123456','test-ip')).accessToken);
 });
