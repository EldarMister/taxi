import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppConfig } from '../src/config';
import { OtpDelivery } from '../src/otp-delivery';
import { OtpFallback, sealOtp, unsealOtp } from '../src/otp-fallback';
import { PrismaService } from '../src/prisma.service';

const phone='+996700123456',code='654321',codeHash='test-code-hash';
const config={smsProvider:'messaggio',telegramGatewayToken:'gateway-secret',otpSecret:'another-32-character-secret-for-otp'} as AppConfig;

function harness(options:{whatsapp?:()=>Promise<string>;status?:()=>Promise<'delivered'|'pending'|'failed'>;telegram?:()=>Promise<string>}={}) {
  const jobs=new Map<string,any>(),calls:string[]=[];
  const challenge={codeHash,consumedAt:null as Date|null,expiresAt:new Date(Date.now()+300000)};
  function matches(job:any,where:any):boolean {
    return Object.entries(where).every(([key,value]:[string,any])=>{
      const actual=job[key];
      if(value instanceof Date)return +actual===+value;
      if(value&&typeof value==='object')return (!value.in||value.in.includes(actual))
        && (!('not' in value)||actual!==value.not)&&(!value.gt||actual>value.gt)&&(!value.lte||actual<=value.lte)&&(!value.lt||actual<value.lt);
      return actual===value;
    });
  }
  const db={
    smsChallenge:{findUnique:async()=>challenge},
    otpDeliveryAttempt:{
      create:async({data}:any)=>{const job={channel:'whatsapp',state:'sending_whatsapp',createdAt:new Date(),nextCheckAt:new Date(),whatsappMessageId:null,telegramRequestId:null,...data};jobs.set(job.id,job);return {...job};},
      findUnique:async({where}:any)=>jobs.get(where.id),
      findMany:async({where}:any)=>[...jobs.values()].filter(job=>matches(job,where)).map(job=>({...job})),
      update:async({where,data}:any)=>{const job=jobs.get(where.id);Object.assign(job,data);return {...job};},
      updateMany:async({where,data}:any)=>{let count=0;for(const job of jobs.values())if(matches(job,where)){Object.assign(job,data);count++;}return {count};},
      deleteMany:async()=>({count:0}),
    },
  };
  const delivery={
    sendWhatsapp:async()=>{calls.push('whatsapp');return options.whatsapp?options.whatsapp():'wa-id';},
    whatsappStatus:async()=>{calls.push('status');return options.status?options.status():'pending';},
    sendTelegram:async(receivedPhone:string,receivedCode:string,ttl:number)=>{calls.push('telegram');assert.equal(receivedPhone,phone);assert.equal(receivedCode,code);assert.ok(ttl>=30&&ttl<=300);return options.telegram?options.telegram():'tg-id';},
  } as unknown as OtpDelivery;
  const service=new OtpFallback(db as unknown as PrismaService,config,delivery);
  return {service,db,delivery,challenge,calls,job:()=>[...jobs.values()][0]};
}

test('fallback ciphertext is authenticated and bound to this challenge',()=>{
  const value=sealOtp(code,config.otpSecret,'attempt-id');
  assert.equal(unsealOtp(value,config.otpSecret,'attempt-id'),code);
  assert.equal(value.includes(code),false);
  assert.throws(()=>unsealOtp(value,config.otpSecret,'other-attempt'));
  assert.throws(()=>unsealOtp(value,'wrong-secret','attempt-id'));
});

test('WhatsApp is always first; delivered WhatsApp prevents Telegram and removes ciphertext',async()=>{
  const h=harness({status:async()=>'delivered'});
  const receipt=await h.service.start(phone,code,codeHash);
  assert.equal(receipt.channel,'whatsapp');assert.deepEqual(h.calls,['whatsapp']);
  const status=await h.service.status(receipt.deliveryId);
  assert.deepEqual(status,{channel:'whatsapp',state:'whatsapp_pending'});
  await h.service.processPending();
  assert.deepEqual(h.calls,['whatsapp','status']);assert.equal(h.job().state,'whatsapp_delivered');assert.equal(h.job().codeCiphertext,'');
});

test('synchronous WhatsApp rejection immediately falls back using the same code',async()=>{
  const h=harness({whatsapp:async()=>{throw Error('unavailable');}});
  const receipt=await h.service.start(phone,code,codeHash);
  assert.equal(receipt.channel,'telegram');assert.deepEqual(h.calls,['whatsapp','telegram']);
  assert.equal(h.job().state,'telegram_accepted');assert.equal(h.job().telegramRequestId,'tg-id');assert.equal(h.job().codeCiphertext,'');
});

test('asynchronous WhatsApp unavailable status triggers a durable Telegram fallback',async()=>{
  const h=harness({status:async()=>'failed'});
  const receipt=await h.service.start(phone,code,codeHash);
  await h.service.processPending();await h.service.processPending();
  assert.deepEqual(h.calls,['whatsapp','status','telegram']);
  assert.deepEqual(await h.service.status(receipt.deliveryId),{channel:'telegram',state:'telegram_accepted'});
});

test('pending delivery waits, then switches after one minute, including after a restart',async()=>{
  const h=harness();await h.service.start(phone,code,codeHash);await h.service.processPending();
  assert.equal(h.calls.includes('telegram'),false);
  h.job().createdAt=new Date(Date.now()-61000);h.job().nextCheckAt=new Date(Date.now()-1000);
  const restarted=new OtpFallback(h.db as unknown as PrismaService,config,h.delivery);
  await restarted.processPending();assert.equal(h.calls.filter(value=>value==='telegram').length,1);
});

test('two workers cannot double-charge Telegram for the same attempt',async()=>{
  const h=harness({status:async()=>'failed'});await h.service.start(phone,code,codeHash);
  const second=new OtpFallback(h.db as unknown as PrismaService,config,h.delivery);
  await Promise.all([h.service.processPending(),second.processPending()]);
  assert.equal(h.calls.filter(value=>value==='telegram').length,1);
});

test('verified, superseded and expired challenges never send Telegram',async()=>{
  for(const mode of ['verified','superseded','expired']) {
    const h=harness({status:async()=>'failed'});await h.service.start(phone,code,codeHash);
    if(mode==='verified')h.challenge.consumedAt=new Date();
    if(mode==='superseded')h.challenge.codeHash='new-challenge';
    if(mode==='expired'){h.challenge.expiresAt=new Date(Date.now()-1000);h.job().expiresAt=h.challenge.expiresAt;}
    await h.service.processPending();
    assert.equal(h.calls.includes('telegram'),false);assert.equal(h.job().codeCiphertext,'');
  }
});

test('both channels failing returns an error; ambiguous Telegram failure is never retried',async()=>{
  const h=harness({whatsapp:async()=>{throw Error('timeout');},telegram:async()=>{throw Error('timeout');}});
  await assert.rejects(h.service.start(phone,code,codeHash),ServiceUnavailableException);
  await h.service.processPending();assert.deepEqual(h.calls,['whatsapp','telegram']);
  assert.equal(h.job().state,'failed');assert.equal(h.job().codeCiphertext,'');
});

test('Gateway uses the server OTP directly, without a separately charged availability check',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url:any,options:any)=>{
    calls++;assert.equal(url,'https://gatewayapi.telegram.org/sendVerificationMessage');
    assert.equal(options.headers.Authorization,'Bearer gateway-secret');
    assert.deepEqual(JSON.parse(options.body),{phone_number:phone,code,ttl:240});
    return Response.json({ok:true,result:{request_id:'gateway-id',phone_number:phone,delivery_status:{status:'sent'}}});
  });
  assert.equal(await new OtpDelivery(config).sendTelegram(phone,code,240),'gateway-id');assert.equal(calls,1);
});

test('Gateway ok=false, wrong recipient, missing receipt and HTTP errors are rejected',async t=>{
  for(const response of [{ok:false,error:'PHONE_NUMBER_INVALID'},{ok:true,result:{}},{ok:true,result:{request_id:'id',phone_number:'+996700000000'}},{ok:true,result:{request_id:'id',phone_number:phone,delivery_status:{status:'expired'}}}]) {
    t.mock.method(globalThis,'fetch',async()=>Response.json(response));
    await assert.rejects(new OtpDelivery(config).sendTelegram(phone,code,240));
  }
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:429}));
  await assert.rejects(new OtpDelivery(config).sendTelegram(phone,code,240));
});

test('WhatsApp status matching requires this message and recipient; 91 means unavailable',async t=>{
  const cfg={...config,messaggioLogin:'login',messaggioWhatsappSender:'sender'} as AppConfig;
  let recipient=phone.slice(1),value=91;
  t.mock.method(globalThis,'fetch',async(url:any,options:any)=>{
    assert.equal(url,'https://msg.messaggio.com/api/v1/statuses');
    assert.deepEqual(JSON.parse(options.body),{recipients:[{id:'wa-id'}],channels:['whatsapp'],whatsapp:[{from:'sender'}]});
    return Response.json({statuses:[{message_id:'wa-id',type:'status',status:{channel:'whatsapp',recipient:{phone:recipient},status:value}}]});
  });
  const service=new OtpDelivery(cfg);
  assert.equal(await service.whatsappStatus('wa-id',phone),'failed');
  value=100;assert.equal(await service.whatsappStatus('wa-id',phone),'pending');
  value=70;assert.equal(await service.whatsappStatus('wa-id',phone),'delivered');
  recipient='996700000000';assert.equal(await service.whatsappStatus('wa-id',phone),'pending');
});
