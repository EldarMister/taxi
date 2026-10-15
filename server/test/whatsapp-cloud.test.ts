import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppConfig } from '../src/config';
import { OtpDelivery } from '../src/otp-delivery';
import { acceptedCloudMessage, cloudDeliveryReports, cloudOtpPayload, validMetaSignature, WhatsAppCloudWebhook, whatsappWebhookBodyParser } from '../src/whatsapp-cloud';
import { PrismaService } from '../src/prisma.service';

const phone='+996700123456',code='654321';
const config={smsProvider:'whatsapp_cloud',whatsappCloudToken:'test-cloud-token',whatsappCloudPhoneId:'100000000000001',
  whatsappCloudWabaId:'700000000000001',whatsappCloudTemplate:'atlas',whatsappCloudLanguage:'ru',whatsappCloudVersion:'v25.0',
  whatsappCloudAppSecret:'test-app-secret',whatsappCloudVerifyToken:'separate-verify-token',telegramGatewayToken:''} as AppConfig;
const accepted={messaging_product:'whatsapp',contacts:[{input:phone.slice(1),wa_id:phone.slice(1)}],messages:[{id:'wamid.test-id',message_status:'accepted'}]};
const event=(status='delivered')=>({object:'whatsapp_business_account',entry:[{id:config.whatsappCloudWabaId,changes:[{field:'messages',value:{
  messaging_product:'whatsapp',metadata:{phone_number_id:config.whatsappCloudPhoneId},statuses:[{id:'wamid.test-id',recipient_id:phone.slice(1),status}],
}}]}]});
const sign=(raw:Buffer)=>`sha256=${createHmac('sha256',config.whatsappCloudAppSecret).update(raw).digest('hex')}`;

test('Actual Nest HTTP callback verifies raw bytes and returns the Meta challenge without login',async()=>{
  let writes=0;
  const module=await Test.createTestingModule({controllers:[WhatsAppCloudWebhook],providers:[
    {provide:AppConfig,useValue:config},{provide:PrismaService,useValue:{otpDeliveryAttempt:{updateMany:async()=>{writes++;return {count:1};}}}},
  ]}).compile();
  const app=module.createNestApplication({bodyParser:false,logger:false});
  app.use(whatsappWebhookBodyParser());app.setGlobalPrefix('api');await app.init();
  try {
    const http=app.getHttpServer(),path='/api/auth/whatsapp/webhook';
    const raw=Buffer.from(JSON.stringify(event(),null,2));
    await request(http).get(path).query({'hub.mode':'subscribe','hub.verify_token':config.whatsappCloudVerifyToken,'hub.challenge':'12345'}).expect(200,'12345');
    await request(http).get(path).query({'hub.mode':'subscribe','hub.verify_token':'wrong','hub.challenge':'12345'}).expect(403);
    await request(http).post(path).set('Content-Type','application/json').set('X-Hub-Signature-256',sign(raw)).send(raw.toString()).expect(200,{received:true});
    assert.equal(writes,1);
    await request(http).post(path).set('Content-Type','application/json').send(raw.toString()).expect(403);
    await request(http).post(path).set('Content-Type','application/json').set('X-Hub-Signature-256',sign(raw)).send(raw.toString()+' ').expect(403);
    assert.equal(writes,1);
  }finally{await app.close();}
});

test('Cloud API sends the same server code in the body and autofill button using Bearer auth',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url:any,options:any)=>{
    calls++;assert.equal(url,'https://graph.facebook.com/v25.0/100000000000001/messages');
    assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal);
    assert.equal(options.headers.Authorization,'Bearer test-cloud-token');
    assert.deepEqual(JSON.parse(options.body),{messaging_product:'whatsapp',recipient_type:'individual',to:phone.slice(1),type:'template',template:{
      name:'atlas',language:{code:'ru'},components:[{type:'body',parameters:[{type:'text',text:code}]},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:code}]}],
    }});
    return Response.json(accepted);
  });
  assert.equal(await new OtpDelivery(config).send(phone,code),'whatsapp');assert.equal(calls,1);
});

test('Cloud receipts must match the recipient, accepted state and actual WhatsApp message ID',()=>{
  assert.equal(acceptedCloudMessage(accepted,phone),'wamid.test-id');
  for(const body of [null,{}, {...accepted,error:{code:10}}, {...accepted,contacts:[]}, {...accepted,messages:[]},
    {...accepted,contacts:[{input:phone.slice(1),wa_id:'996700000000'}]}, {...accepted,messages:[{id:'wamid.test-id',message_status:'held_for_quality_assessment'}]},
    {...accepted,messages:[{id:'not-a-whatsapp-id'}]}, {...accepted,messages:[...accepted.messages,...accepted.messages]}]) assert.equal(acceptedCloudMessage(body,phone),null);
});

test('Cloud API errors and ambiguous timeouts fail safely without automatic paid retries',async t=>{
  for(const response of [new Response(null,{status:401}),new Response(null,{status:429}),Response.json({error:{message:'private-token'}}),new Response('invalid-json'),null]) {
    let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;if(!response)throw Error('private-token');return response;});
    await assert.rejects(new OtpDelivery(config).send(phone,code),(error:unknown)=>error instanceof ServiceUnavailableException
      && error.message==='Не удалось отправить код в WhatsApp. Попробуйте позже.');assert.equal(calls,1);
  }
});

test('Cloud payload rejects non-Kyrgyz numbers and invalid codes before provider billing',()=>{
  for(const invalid of ['+17001234567','996700123456','+99670012345']) assert.throws(()=>cloudOtpPayload(config,invalid,code));
  for(const invalid of ['65432','6543217','１２３４５６','abcdef']) assert.throws(()=>cloudOtpPayload(config,phone,invalid));
});

test('Meta signature uses exact request bytes and the app secret, never the verification token',()=>{
  const raw=Buffer.from(JSON.stringify(event()));assert.equal(validMetaSignature(raw,sign(raw),config.whatsappCloudAppSecret),true);
  for(const [data,header,secret] of [[Buffer.concat([raw,Buffer.from(' ')]),sign(raw),config.whatsappCloudAppSecret],
    [raw,sign(raw),config.whatsappCloudVerifyToken],[undefined,sign(raw),config.whatsappCloudAppSecret],[raw,'sha256=00',config.whatsappCloudAppSecret],[raw,undefined,config.whatsappCloudAppSecret],[raw,sign(raw),'']])
    assert.equal(validMetaSignature(data as Buffer|undefined,header,secret as string),false);
});

test('Cloud reports accept only our WABA, phone ID, recipient and delivery statuses',()=>{
  for(const status of ['delivered','read','failed']) assert.deepEqual(cloudDeliveryReports(event(status),config),[{id:'wamid.test-id',phone,delivered:status!=='failed'}]);
  for(const status of ['sent','unknown']) assert.deepEqual(cloudDeliveryReports(event(status),config),[]);
  for(const mutate of [(body:any)=>body.entry[0].id='other', (body:any)=>body.entry[0].changes[0].value.metadata.phone_number_id='other',
    (body:any)=>body.entry[0].changes[0].value.statuses[0].recipient_id='17001234567',(body:any)=>body.entry[0].changes[0].field='message_template_status_update']) {
    const body=event();mutate(body);assert.deepEqual(cloudDeliveryReports(body,config),[]);
  }
});

test('Webhook verification returns the original challenge only for the separate correct verification token',()=>{
  const controller=new WhatsAppCloudWebhook(config,{} as PrismaService);let challenge='';
  const response={type:(type:string)=>{assert.equal(type,'text/plain');return response;},send:(value:string)=>{challenge=value;}};
  controller.verify('subscribe',config.whatsappCloudVerifyToken,'12345',response as any);assert.equal(challenge,'12345');
  for(const [mode,token,value] of [['subscribe','wrong','12345'],['unsubscribe',config.whatsappCloudVerifyToken,'12345'],['subscribe',config.whatsappCloudVerifyToken,'<script>']])
    assert.throws(()=>controller.verify(mode,token,value,response as any),ForbiddenException);
});

test('A delivered webhook updates only the matching pending unexpired attempt and erases ciphertext',async()=>{
  let query:any;const db={otpDeliveryAttempt:{updateMany:async(value:any)=>{query=value;return {count:1};}}};
  const controller=new WhatsAppCloudWebhook(config,db as any),body=event(),raw=Buffer.from(JSON.stringify(body));
  assert.deepEqual(await controller.receive({rawBody:raw,headers:{'x-hub-signature-256':sign(raw)}} as any,body),{received:true});
  assert.equal(query.where.whatsappMessageId,'wamid.test-id');assert.equal(query.where.phone,phone);
  assert.deepEqual(query.where.state,{in:['whatsapp_pending','whatsapp_failed']});assert.ok(query.where.expiresAt.gt instanceof Date);
  assert.deepEqual(query.data,{state:'whatsapp_delivered',codeCiphertext:''});
});

test('A failed webhook does not claim a Telegram fallback when Gateway is disabled',async()=>{
  for(const token of ['', 'test-gateway-token']) {
    let query:any;const db={otpDeliveryAttempt:{updateMany:async(value:any)=>{query=value;return {count:1};}}};
    const cfg={...config,telegramGatewayToken:token} as AppConfig,controller=new WhatsAppCloudWebhook(cfg,db as any);
    const body=event('failed'),raw=Buffer.from(JSON.stringify(body));
    await controller.receive({rawBody:raw,headers:{'x-hub-signature-256':sign(raw)}} as any,body);
    assert.equal(query.data.state,token?'whatsapp_failed':'failed');
    if(!token)assert.equal(query.data.codeCiphertext,'');else assert.ok(query.data.nextCheckAt instanceof Date);
  }
});

test('Unsigned, tampered and foreign webhooks cannot mutate delivery state',async()=>{
  let calls=0;const controller=new WhatsAppCloudWebhook(config,{otpDeliveryAttempt:{updateMany:async()=>{calls++;}}} as any);
  const body=event(),raw=Buffer.from(JSON.stringify(body));
  await assert.rejects(controller.receive({rawBody:raw,headers:{}} as any,body),ForbiddenException);
  await assert.rejects(controller.receive({rawBody:Buffer.concat([raw,Buffer.from(' ')]),headers:{'x-hub-signature-256':sign(raw)}} as any,body),ForbiddenException);
  body.entry[0].id='other';const foreign=Buffer.from(JSON.stringify(body));
  await controller.receive({rawBody:foreign,headers:{'x-hub-signature-256':sign(foreign)}} as any,body);assert.equal(calls,0);
});

test('Cloud status does not invoke a nonexistent polling API',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{assert.fail('Cloud delivery is reported through webhooks');});
  assert.equal(await new OtpDelivery(config).whatsappStatus('wamid.test-id',phone),'pending');
});

test('Cloud configuration cannot activate without all server credentials and valid IDs',()=>{
  const original={...process.env};try {
    Object.assign(process.env,{NODE_ENV:'development',JWT_SECRET:'j'.repeat(32),OTP_SECRET:'o'.repeat(32),DATABASE_URL:'postgresql://unused/test',
      SMS_PROVIDER:'whatsapp_cloud',PUSH_PROVIDER:'development',DEV_AUTH_ENABLED:'true',NOMINATIM_BASE_URL:'',PHOTON_BASE_URL:'',
      WHATSAPP_CLOUD_TOKEN:config.whatsappCloudToken,WHATSAPP_CLOUD_PHONE_ID:config.whatsappCloudPhoneId,WHATSAPP_CLOUD_WABA_ID:config.whatsappCloudWabaId,
      WHATSAPP_CLOUD_TEMPLATE:'atlas',WHATSAPP_CLOUD_LANGUAGE:'ru',WHATSAPP_CLOUD_VERSION:'v25.0',
      WHATSAPP_CLOUD_APP_SECRET:config.whatsappCloudAppSecret,WHATSAPP_CLOUD_VERIFY_TOKEN:config.whatsappCloudVerifyToken,TELEGRAM_GATEWAY_TOKEN:''});
    assert.equal(new AppConfig().devAuth,false);
    for(const key of ['WHATSAPP_CLOUD_TOKEN','WHATSAPP_CLOUD_PHONE_ID','WHATSAPP_CLOUD_WABA_ID','WHATSAPP_CLOUD_APP_SECRET','WHATSAPP_CLOUD_VERIFY_TOKEN','WHATSAPP_CLOUD_TEMPLATE']) {
      const saved=process.env[key];process.env[key]='';assert.throws(()=>new AppConfig(),new RegExp(key));process.env[key]=saved;
    }
    process.env.WHATSAPP_CLOUD_VERSION='v25.0/other';assert.throws(()=>new AppConfig(),/WHATSAPP_CLOUD_VERSION/);
  }finally{for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
