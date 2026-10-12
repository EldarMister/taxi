import 'reflect-metadata';
import { requireTestDatabase } from './test-database';
requireTestDatabase();
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DEMO_FOOD_RESTAURANTS } from '../src/food-catalog';
import { hashAdminPassword } from '../src/admin.security';

// Compiled Nest classes preserve the decorator metadata required for DI.
const {AppModule}=require('../dist/src/app.module.js');
const {ApiExceptionFilter,apiValidation}=require('../dist/src/http.js');
const {PrismaService}=require('../dist/src/prisma.service.js');
const {AuthService}=require('../dist/src/auth.js');
const {RestaurantAuthService}=require('../dist/src/restaurant-auth.js');
const {TaxiGateway}=require('../dist/src/gateway.js');
const {RealtimeEvents}=require('../dist/src/events.js');
const {BackgroundJobs}=require('../dist/src/jobs.js');
const {JwtService}=require('@nestjs/jwt');
const db=new PrismaClient();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const suffix=randomUUID().replace(/\D/g,'').padEnd(9,'0').slice(0,9);
const phones=[`+996${suffix}`,`+995${suffix}`,`+994${suffix}`,`+993${suffix}`];
const restaurantIds=[`security-restaurant-${randomUUID()}`,`security-restaurant-${randomUUID()}`];
const tariffId=`security-tariff-${randomUUID()}`;
const password=`local-security-${randomUUID()}`;
let app:any,api:ReturnType<typeof request>,prisma:any,mobileAuth:any,restaurantAuth:any,baseUrl:string;
let owner:any,manager:any,client:any,otherClient:any,driver:any,ownerLogin:any,managerLogin:any,clientToken:string,otherToken:string,driverToken:string,orderId:string,quoteId:string;
const sockets:Socket[]=[];
const tokenHeaders=(token:string)=>({Authorization:`Bearer ${token}`});
const priorTestPhones=process.env.TEST_AUTH_PHONES,priorTestCode=process.env.TEST_AUTH_CODE,priorDevAuth=process.env.DEV_AUTH_ENABLED;
function signal<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function accessToken(userId:string) {
  const familyId=randomUUID(),refresh=randomUUID()+randomUUID();
  const session=await db.refreshSession.create({data:{userId,familyId,tokenHash:hash(refresh),expiresAt:new Date(Date.now()+600000)}});
  const token=await app.get(JwtService).signAsync({sub:userId,sid:session.id,fid:familyId},{secret:process.env.JWT_SECRET,issuer:'taxi-api',audience:'taxi-mobile',expiresIn:600});
  return token;
}
function event(socket:Socket,name:string) {
  return new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>{socket.off(name,done);reject(new Error(`Timed out waiting for ${name}`));},5000);const done=(data:any)=>{clearTimeout(timeout);resolve(data);};socket.once(name,done);});
}

before(async()=>{
  process.env.TEST_AUTH_PHONES=phones[0];process.env.TEST_AUTH_CODE='654321';process.env.DEV_AUTH_ENABLED='false';
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(BackgroundJobs).useValue({}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalPipes(apiValidation());app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0,'127.0.0.1');baseUrl=await app.getUrl();api=request(app.getHttpServer());prisma=app.get(PrismaService);mobileAuth=app.get(AuthService);restaurantAuth=app.get(RestaurantAuthService);
  client=await db.user.create({data:{phone:phones[0],role:'CLIENT'}});otherClient=await db.user.create({data:{phone:phones[1],role:'CLIENT'}});driver=await db.user.create({data:{phone:phones[2],role:'DRIVER'}});
  const catalog=structuredClone(DEMO_FOOD_RESTAURANTS[0]);
  for(const id of restaurantIds)await db.foodRestaurant.create({data:{id,catalog:{...catalog,id} as any,isDemo:true}});
  owner=await db.restaurantAccount.create({data:{phone:phones[0],passwordHash:await hashAdminPassword(password),memberships:{create:{restaurantId:restaurantIds[0],role:'OWNER'}}}});
  manager=await db.restaurantAccount.create({data:{phone:phones[1],passwordHash:await hashAdminPassword(password),memberships:{create:{restaurantId:restaurantIds[0],role:'MANAGER',permissions:['orders.read','orders.manage']}}}});
  ownerLogin=await restaurantAuth.login(owner.phone,password,'security-fixture');managerLogin=await restaurantAuth.login(manager.phone,password,'security-fixture');
  clientToken=await accessToken(client.id);otherToken=await accessToken(otherClient.id);driverToken=await accessToken(driver.id);
  const tariff=await db.tariff.create({data:{id:tariffId,name:'Synthetic',description:'Synthetic',basePrice:100,pricePerKm:0,pricePerMinute:0,minimumPrice:100,commissionBps:1000}});
  const point={latitude:42.8,longitude:74.5,address:'Synthetic test point'},geometry={type:'LineString',coordinates:[[74.5,42.8],[74.6,42.9]]};
  const quote=await db.quote.create({data:{userId:client.id,tariffId:tariff.id,pickup:point,dropoff:point,geometry,distanceMeters:1000,durationSeconds:300,price:100,commission:10,routeProvider:'test',expiresAt:new Date(Date.now()+600000)}});quoteId=quote.id;
  const order=await db.order.create({data:{clientId:client.id,driverId:driver.id,quoteId,idempotencyKey:randomUUID(),status:'ASSIGNED',pickup:point,dropoff:point,geometry,distanceMeters:1000,durationSeconds:300,price:100,commission:10,searchExpiresAt:new Date(Date.now()+600000)}});orderId=order.id;
});
after(async()=>{
  for(const socket of sockets)socket.disconnect();
  await app?.close();
  if(orderId){await db.orderEventOutbox.deleteMany({where:{aggregateId:orderId}});await db.order.deleteMany({where:{id:orderId}});}
  if(quoteId)await db.quote.deleteMany({where:{id:quoteId}});
  await db.tariff.deleteMany({where:{id:tariffId}});
  await db.restaurantAccount.deleteMany({where:{phone:{in:phones}}});
  await db.foodRestaurant.deleteMany({where:{id:{in:restaurantIds}}});
  const userIds=[client?.id,otherClient?.id,driver?.id].filter(Boolean);
  await db.refreshSession.deleteMany({where:{userId:{in:userIds}}});await db.smsChallenge.deleteMany({where:{phone:{in:phones}}});await db.user.deleteMany({where:{id:{in:userIds}}});
  await db.$disconnect();
  for(const [key,value] of [['TEST_AUTH_PHONES',priorTestPhones],['TEST_AUTH_CODE',priorTestCode],['DEV_AUTH_ENABLED',priorDevAuth]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;
});

test('actual PG locks serialize refresh/logout so a concurrent successor cannot survive logout',async()=>{
  const login=await restaurantAuth.login(owner.phone,password,'security-race');
  const entered=signal(),release=signal();const session=restaurantAuth.session;
  restaurantAuth.session=async(...args:any[])=>{entered.resolve();await release.promise;return session.apply(restaurantAuth,args);};
  try {
    const refresh=restaurantAuth.refresh(login.refreshToken);await entered.promise;
    const logout=restaurantAuth.logout(login.refreshToken);
    // Confirm the concurrent statement reached a real PostgreSQL lock wait.
    let waiting=false;
    for(let attempt=0;attempt<100;attempt++) {
      const rows=await db.$queryRaw<Array<{count:number}>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`;
      if(rows[0].count>0){waiting=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true,'logout must wait for in-flight refresh account lock');release.resolve();
    const rotated=await refresh;await logout;
    const successor=await db.restaurantSession.findUniqueOrThrow({where:{tokenHash:hash(rotated.refreshToken)}});
    assert.ok(successor.revokedAt);await api.get('/api/restaurant/me').set(tokenHeaders(rotated.accessToken)).expect(401);
  }finally{release.resolve();restaurantAuth.session=session;}
});

test('PG rolls back restaurant and mobile refresh if profile loading fails before response',async()=>{
  const login=await restaurantAuth.login(owner.phone,password,'security-profile');const profile=restaurantAuth.profile;
  restaurantAuth.profile=async()=>{throw new ServiceUnavailableException('Synthetic profile outage');};
  try{await api.post('/api/restaurant/auth/refresh').send({refreshToken:login.refreshToken}).expect(503);}finally{restaurantAuth.profile=profile;}
  assert.equal((await db.restaurantSession.findUniqueOrThrow({where:{tokenHash:hash(login.refreshToken)}})).revokedAt,null);
  await api.post('/api/restaurant/auth/refresh').send({refreshToken:login.refreshToken}).expect(201);
  await api.post('/api/auth/request-code').send({phone:phones[0]}).expect(201);
  const mobile=(await api.post('/api/auth/verify-code').send({phone:phones[0],code:'654321'}).expect(201)).body;
  const user=mobileAuth.user;mobileAuth.user=async()=>{throw new ServiceUnavailableException('Synthetic profile outage');};
  try{await api.post('/api/auth/refresh').send({refreshToken:mobile.refreshToken}).expect(503);}finally{mobileAuth.user=user;}
  assert.equal((await db.refreshSession.findUniqueOrThrow({where:{tokenHash:hash(mobile.refreshToken)}})).revokedAt,null);
  await api.post('/api/auth/refresh').send({refreshToken:mobile.refreshToken}).expect(201);
});

test('store login code remains exact while role changes and foreign data access are rejected',async()=>{
  await db.rateLimit.deleteMany({where:{key:{contains:phones[0]}}});
  const requested=(await api.post('/api/auth/request-code').send({phone:phones[0]}).expect(201)).body;
  assert.equal(requested.developmentCode,'654321');
  const login=(await api.post('/api/auth/verify-code').send({phone:phones[0],code:'654321'}).expect(201)).body;
  assert.equal(login.user.role,'CLIENT');
  await api.patch('/api/users/me').set(tokenHeaders(login.accessToken)).send({role:'ADMIN'}).expect(400);
  await api.get('/api/admin/restaurant-accounts').set(tokenHeaders(login.accessToken)).expect(403);
  await api.get(`/api/orders/${orderId}`).set(tokenHeaders(otherToken)).expect(403);
  await api.get(`/api/restaurant/${restaurantIds[1]}`).set(tokenHeaders(ownerLogin.accessToken)).expect(403);
  await api.post('/api/auth/request-code').send({phone:phones[3]}).expect(503);
  await api.post('/api/auth/verify-code').send({phone:phones[3],code:'654321'}).expect(401);
});

test('HTTP auth database faults return 503, no protected result and valid token remains usable after recovery',async()=>{
  for(const [delegate,token,path] of [[prisma.refreshSession,clientToken,'/api/users/me'],[prisma.restaurantSession,ownerLogin.accessToken,'/api/restaurant/me']] as const) {
    const find=delegate.findUnique;delegate.findUnique=async()=>{throw new Error('Synthetic DB outage');};
    try{await api.get(path).set(tokenHeaders(token)).expect(503);}finally{delegate.findUnique=find;}
    await api.get(path).set(tokenHeaders(token)).expect(200);
  }
});

test('real multipart routes deny unauthorized bodies before parsing and cap parts/fields for authorized actors',async()=>{
  const fake=Buffer.alloc(16,'x');
  await api.post(`/api/restaurant/${restaurantIds[1]}/media`).set(tokenHeaders(ownerLogin.accessToken)).attach('file',fake,{filename:'x.png',contentType:'image/png'}).expect(403);
  await api.post(`/api/restaurant/${restaurantIds[0]}/media`).set(tokenHeaders(managerLogin.accessToken)).attach('file',fake,{filename:'x.png',contentType:'image/png'}).expect(403);
  await api.post(`/api/orders/${orderId}/messages/photo`).set(tokenHeaders(otherToken)).attach('image',fake,{filename:'x.png',contentType:'image/png'}).expect(403);
  await api.post('/api/users/me/avatar').set(tokenHeaders(clientToken)).attach('avatar',fake,{filename:'x.png',contentType:'image/png'}).expect(403);
  await api.post('/api/users/me/avatar').set(tokenHeaders(driverToken)).field('unexpected','data').attach('avatar',fake,{filename:'x.png',contentType:'image/png'}).expect(400);
  await api.post(`/api/restaurant/${restaurantIds[0]}/media`).set(tokenHeaders(ownerLogin.accessToken)).field('unexpected','data').attach('file',fake,{filename:'x.png',contentType:'image/png'}).expect(400);
});

test('real Socket.IO preserves session on auth DB failure, denies event/action and signals resync after recovery',async()=>{
  const socket=io(baseUrl,{auth:{token:clientToken},transports:['websocket'],autoConnect:false,reconnection:false});sockets.push(socket);
  let expired=0,orderEvents=0;socket.on('session:expired',()=>expired++);socket.on('order:updated',()=>orderEvents++);
  const ready=event(socket,'session:ready');socket.connect();assert.equal((await ready).resyncRequired,true);
  const find=prisma.refreshSession.findUnique;prisma.refreshSession.findUnique=async()=>{throw new Error('Synthetic DB outage');};
  const unavailable=event(socket,'session:unavailable');
  try {
    await assert.rejects(()=>app.get(RealtimeEvents).dispatch({userIds:[client.id],name:'order:updated',payload:{id:orderId}}));
    assert.equal((await unavailable).statusCode,503);
    const ack=await new Promise<any>(resolve=>socket.emit('tracking:subscribe',{orderId},resolve));assert.equal(ack.ok,false);
    assert.equal(socket.connected,true);assert.equal(expired,0);assert.equal(orderEvents,0);
  }finally{prisma.refreshSession.findUnique=find;}
  const recovered=event(socket,'session:ready');await (app.get(TaxiGateway) as any).audit();assert.equal((await recovered).resyncRequired,true);
  await api.get('/api/orders/active').set(tokenHeaders(clientToken)).expect(200);
  socket.disconnect();
});
