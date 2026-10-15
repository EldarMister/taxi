import 'reflect-metadata';
import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {UnauthorizedException} from '@nestjs/common';
import {Test} from '@nestjs/testing';
import request from 'supertest';
const {AppModule}=require('../dist/src/app.module');
const {BackgroundJobs}=require('../dist/src/jobs');
const {AuthService}=require('../dist/src/auth');
const {apiValidation,ApiExceptionFilter}=require('../dist/src/http');
const db=new PrismaClient(),run=randomUUID(),phones=new Set<string>(),tariff=`auth-${run}`;
const point={address:'Auth history fixture',latitude:42.87,longitude:74.57};
let app:any,api:ReturnType<typeof request>,auth:any,safe=false;
const headers=(session:any)=>({Authorization:`Bearer ${session.accessToken}`});
const phone=()=>{const value=`+996${BigInt('0x'+randomUUID().replaceAll('-','').slice(0,11)).toString().padStart(9,'0').slice(-9)}`;phones.add(value);return value;};
async function requestCode(number:string,appVariant:'client'|'driver'='client') {
  // Expire only this fixture phone's one-minute window. Hour/IP checks remain real.
  await db.rateLimit.deleteMany({where:{key:`sms:phone-minute:${number}`}});
  return (await api.post('/api/auth/request-code').set('X-Forwarded-For',run).send({phone:number,appVariant}).expect(201)).body;
}
async function login(number:string,appVariant:'client'|'driver'='client') {
  const sent=await requestCode(number,appVariant);
  return (await api.post('/api/auth/verify-code').send({phone:number,appVariant,code:sent.developmentCode}).expect(201)).body;
}
before(async()=>{
  const url=new URL(process.env.DATABASE_URL||'http://invalid');
  assert.equal(process.env.TEST_DATABASE_RESET,'true');assert.equal(process.env.NODE_ENV,'development');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55432');assert.equal(url.pathname,'/taxi_test');safe=true;
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(BackgroundJobs).useValue({}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalPipes(apiValidation());app.useGlobalFilters(new ApiExceptionFilter());await app.init();api=request(app.getHttpServer());auth=app.get(AuthService);
  await db.rateLimit.deleteMany({where:{key:{in:['sms:ip:::ffff:127.0.0.1','verify:ip:::ffff:127.0.0.1','refresh:::ffff:127.0.0.1','sms:ip:127.0.0.1','verify:ip:127.0.0.1','refresh:127.0.0.1']}}});
  await db.tariff.create({data:{id:tariff,name:'Auth history fixture',description:'',basePrice:10,pricePerKm:1,pricePerMinute:1,minimumPrice:10,commissionBps:1000}});
});
after(async()=>{
  await app?.close();
  if(safe) {
    const users=await db.user.findMany({where:{phone:{in:[...phones]}},select:{id:true}}),ids=users.map(row=>row.id);
    await db.$transaction(async tx=>{
      await tx.pushJob.deleteMany({where:{userId:{in:ids}}});await tx.pushToken.deleteMany({where:{userId:{in:ids}}});await tx.refreshSession.deleteMany({where:{userId:{in:ids}}});
      await tx.order.deleteMany({where:{clientId:{in:ids}}});await tx.quote.deleteMany({where:{userId:{in:ids}}});await tx.tariff.deleteMany({where:{id:tariff}});
      await tx.performerApplication.deleteMany({where:{userId:{in:ids}}});await tx.vehicle.deleteMany({where:{driverId:{in:ids}}});await tx.driverProfile.deleteMany({where:{userId:{in:ids}}});await tx.user.deleteMany({where:{id:{in:ids}}});
      await tx.smsChallenge.deleteMany({where:{phone:{in:[...phones]}}});await tx.otpDeliveryAttempt.deleteMany({where:{phone:{in:[...phones]}}});
      await tx.rateLimit.deleteMany({where:{OR:[...phones].flatMap(number=>['sms:phone-hour:','sms:phone-minute:','verify:phone:'].map(prefix=>({key:`${prefix}${number}`})))}});
    });
  }
  await db.$disconnect();
});
test('one phone has separate client/driver UUIDs, profiles, tokens and sessions; old ID survives',async()=>{
  const number=phone(),existing=await db.user.create({data:{phone:number,role:'CLIENT',name:'Existing customer'}});
  const route={pickup:point,dropoff:point,geometry:[point],distanceMeters:1000,durationSeconds:300,price:100,commission:10};
  const peerDriver=await db.user.create({data:{phone:phone(),role:'DRIVER'}});
  const quote=await db.quote.create({data:{userId:existing.id,tariffId:tariff,...route,routeProvider:'fixture',expiresAt:new Date()}});
  const trip=await db.order.create({data:{clientId:existing.id,driverId:peerDriver.id,quoteId:quote.id,...route,idempotencyKey:run,status:'COMPLETED',searchExpiresAt:new Date(),completedAt:new Date()}});
  const originalTrip=await db.order.findUniqueOrThrow({where:{id:trip.id}});
  const client=await login(number),driver=await login(number,'driver');
  assert.equal(client.user.id,existing.id);assert.notEqual(driver.user.id,existing.id);assert.equal(driver.user.role,'DRIVER');assert.equal(client.user.role,'CLIENT');
  assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:trip.id}}),originalTrip);
  assert.deepEqual((await db.order.findMany({where:{clientId:existing.id}})).map(row=>row.id),[trip.id]);
  await api.patch('/api/users/me').set(headers(client)).send({firstName:'  Асан ',lastName:' Ибраев '}).expect(200);
  assert.equal((await api.get('/api/users/me').set(headers(client)).expect(200)).body.name,'Асан Ибраев');
  assert.equal((await api.get('/api/users/me').set(headers(driver)).expect(200)).body.name,'');
  await api.get('/api/driver/balance').set(headers(client)).expect(403);
  await api.patch('/api/users/me').set(headers(client)).send({firstName:'Асан'}).expect(400);
  await api.patch('/api/users/me').set(headers(client)).send({firstName:'Асан',lastName:'Ибраев',role:'DRIVER'}).expect(400);
  assert.equal((await auth.authenticate(client.accessToken)).id,existing.id);assert.equal((await auth.authenticate(driver.accessToken)).id,driver.user.id);
  await api.post('/api/auth/logout').set(headers(client)).send({refreshToken:client.refreshToken}).expect(201);
  await api.get('/api/users/me').set(headers(client)).expect(401);await api.get('/api/users/me').set(headers(driver)).expect(200);
  const rotated=(await api.post('/api/auth/refresh').send({refreshToken:driver.refreshToken}).expect(201)).body;assert.equal(rotated.user.id,driver.user.id);
});
test('OTP cannot switch apps or be replayed; request/verify defaults are client compatible',async()=>{
  const number=phone(),sent=await requestCode(number,'driver');
  await api.post('/api/auth/verify-code').send({phone:number,code:sent.developmentCode,appVariant:'client'}).expect(401);
  assert.equal((await db.smsChallenge.findUniqueOrThrow({where:{phone:number}})).consumedAt,null);
  assert.equal(await db.user.count({where:{phone:number}}),0);
  const verified=(await api.post('/api/auth/verify-code').send({phone:number,code:sent.developmentCode,appVariant:'driver'}).expect(201)).body;
  assert.equal(verified.user.role,'DRIVER');await api.post('/api/auth/verify-code').send({phone:number,code:sent.developmentCode,appVariant:'driver'}).expect(401);
  const legacyNumber=phone();const legacySent=(await api.post('/api/auth/request-code').send({phone:legacyNumber}).expect(201)).body;
  assert.equal((await api.post('/api/auth/verify-code').send({phone:legacyNumber,code:legacySent.developmentCode}).expect(201)).body.user.role,'CLIENT');
});
test('concurrent verifies serialize challenge consumption and create only one UUID/session',async()=>{
  const number=phone(),sent=await requestCode(number,'driver');
  const outcomes=await Promise.allSettled(Array.from({length:6},()=>auth.verifyCode(number,sent.developmentCode,`identity:${run}`,'driver')));
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);
  for(const row of outcomes)if(row.status==='rejected')assert.ok(row.reason instanceof UnauthorizedException);
  const users=await db.user.findMany({where:{phone:number}});assert.equal(users.length,1);assert.equal(users[0].role,'DRIVER');assert.equal(await db.refreshSession.count({where:{userId:users[0].id}}),1);
});
test('admin phone is excluded from both public apps, including challenge verified before admin creation',async()=>{
  const number=phone(),sent=await requestCode(number);
  await db.user.create({data:{phone:number,role:'ADMIN'}});
  await api.post('/api/auth/verify-code').send({phone:number,code:sent.developmentCode}).expect(401);
  for(const appVariant of ['client','driver']) {
    await db.rateLimit.deleteMany({where:{key:`sms:phone-minute:${number}`}});
    await api.post('/api/auth/request-code').send({phone:number,appVariant}).expect(401);
  }
  assert.equal(await db.user.count({where:{phone:number}}),1);
});
test('driver login recovers only an unactivated legacy registration and preserves client identity/session',async()=>{
  const number=phone(),client=await login(number);
  const application=await db.performerApplication.create({data:{userId:client.user.id,status:'APPROVED',data:{personal:{firstName:'Driver',lastName:'Applicant'}},roles:{create:{role:'TAXI_DRIVER',status:'APPROVED'}}}});
  await db.driverProfile.create({data:{userId:client.user.id,verified:true,online:false,registrationManaged:true,vehicle:{create:{make:'Toyota',color:'White',plate:`AUTH-${run}`}}}});
  const driver=await login(number,'driver');
  assert.equal((await db.performerApplication.findUniqueOrThrow({where:{id:application.id}})).userId,driver.user.id);
  assert.equal((await db.vehicle.findUniqueOrThrow({where:{driverId:driver.user.id}})).plate,`AUTH-${run}`);
  assert.equal(await db.driverProfile.findUnique({where:{userId:client.user.id}}),null);
  assert.equal((await api.get('/api/users/me').set(headers(client)).expect(200)).body.id,client.user.id);
  assert.equal(driver.user.name,'Driver Applicant');
  await api.get('/api/driver/registration').set(headers(client)).expect(403);
  const number2=phone(),activeClient=await login(number2);
  const active=await db.performerApplication.create({data:{userId:activeClient.user.id,activatedAt:new Date(),data:{}}});
  await login(number2,'driver');assert.equal((await db.performerApplication.findUniqueOrThrow({where:{id:active.id}})).userId,activeClient.user.id);
});
test('deleting one app account leaves sibling profile/session and OTP challenge available',async()=>{
  const number=phone(),client=await login(number),driver=await login(number,'driver'),sent=await requestCode(number,'driver');
  await api.delete('/api/users/me').set(headers(client)).expect(200);
  assert.equal(await db.user.findUnique({where:{id:client.user.id}}),null);
  await api.get('/api/users/me').set(headers(driver)).expect(200);
  const challenge=await db.smsChallenge.findUniqueOrThrow({where:{phone:number}});assert.equal(challenge.role,'DRIVER');assert.equal(challenge.consumedAt,null);
  assert.equal((await api.post('/api/auth/verify-code').send({phone:number,appVariant:'driver',code:sent.developmentCode}).expect(201)).body.user.id,driver.user.id);
});
test('client deletion racing driver verification never changes identity or deadlocks the legacy claim',async()=>{
  const number=phone(),client=await login(number);
  await db.performerApplication.create({data:{userId:client.user.id,data:{personal:{firstName:'Pending',lastName:'Applicant'}}}});
  const sent=await requestCode(number,'driver');
  const results=await Promise.all([
    api.delete('/api/users/me').set(headers(client)),
    api.post('/api/auth/verify-code').send({phone:number,appVariant:'driver',code:sent.developmentCode}),
  ]);
  assert.equal(results[0].status,200,JSON.stringify(results[0].body));assert.equal(results[1].status,201,JSON.stringify(results[1].body));
  assert.equal(results[1].body.user.role,'DRIVER');assert.notEqual(results[1].body.user.id,client.user.id);
  assert.equal(await db.user.findUnique({where:{id:client.user.id}}),null);await api.get('/api/users/me').set(headers(results[1].body)).expect(200);
});
test('legacy claim skips a destination whose phone changed, was deleted, or already has driver history',async()=>{
  for(const mode of ['changed-phone','deleted','history']) {
    const number=phone(),client=await db.user.create({data:{phone:number,role:'CLIENT'}}),driver=await db.user.create({data:{phone:number,role:'DRIVER'}});
    const pending=await db.performerApplication.create({data:{userId:client.id,data:{personal:{firstName:'Pending',lastName:'Applicant'}}}});
    if(mode==='changed-phone')await db.user.update({where:{id:driver.id},data:{phone:phone()}});
    if(mode==='deleted')await db.user.update({where:{id:driver.id},data:{deletedAt:new Date()}});
    if(mode==='history') {
      const route={pickup:point,dropoff:point,geometry:[point],distanceMeters:1000,durationSeconds:300,price:100,commission:10};
      const quote=await db.quote.create({data:{userId:client.id,tariffId:tariff,...route,routeProvider:'fixture',expiresAt:new Date()}});
      await db.order.create({data:{clientId:client.id,driverId:driver.id,quoteId:quote.id,...route,idempotencyKey:run,status:'COMPLETED',searchExpiresAt:new Date(),completedAt:new Date()}});
    }
    await db.$transaction(tx=>auth.claimLegacyRegistration(tx,driver.id,number));
    assert.equal((await db.performerApplication.findUniqueOrThrow({where:{id:pending.id}})).userId,client.id,mode);
    assert.equal((await db.user.findUniqueOrThrow({where:{id:driver.id}})).name,'',mode);
  }
});
