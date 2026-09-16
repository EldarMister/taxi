import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { DEMO_FOOD_RESTAURANTS } from '../src/food-catalog';
import { hashAdminPassword } from '../src/admin.security';
import { osrmFixture } from './maps.fixture';
// Load TypeScript-compiled Nest modules: tsx intentionally does not emit decorator metadata.
const {AppModule}=require('../dist/src/app.module.js');
const {apiValidation,ApiExceptionFilter,detectAvatarMime,MAX_AVATAR_BYTES}=require('../dist/src/http.js');
const {OrdersService}=require('../dist/src/orders.js');
const {FoodService}=require('../dist/src/food.js');
const {RoutingService,parseOsrmRoute}=require('../dist/src/routing.js');
const db=new PrismaClient();
let app:any,api:ReturnType<typeof request>,baseUrl:string;
type Session={accessToken:string;refreshToken:string;user:{id:string;role:string}};
let client:Session,client2:Session,driver1:Session,driver2:Session,admin:Session;
const sockets:Socket[]=[];
const adminPassword=randomUUID()+randomUUID();
const headers=(session:Session)=>({Authorization:`Bearer ${session.accessToken}`});
const pickup={latitude:42.8756,longitude:74.6040,address:'Площадь Ала-Тоо'};
const dropoff={latitude:42.8528,longitude:74.5840,address:'Парк Ататюрк'};
const pngAvatar=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function login(phone:string) {
  await api.post('/api/auth/request-code').send({phone}).expect(201);
  const response=await api.post('/api/auth/verify-code').send({phone,code:process.env.DEV_OTP_CODE??'123456'}).expect(201);
  return response.body as Session;
}
async function quoted(session:Session) {
  await db.driverProfile.updateMany({where:{online:true,locationLatitude:{not:null}},data:{locationMeasuredAt:new Date()}});
  return (await api.post('/api/orders/quote').set(headers(session)).send({pickup,dropoff,tariffId:'economy'}).expect(201)).body;
}
async function create(session=client) {
  const quote=await quoted(session);
  return (await api.post('/api/orders').set(headers(session)).send({quoteId:quote.id,idempotencyKey:randomUUID()}).expect(201)).body;
}
async function setOnline(session:Session, online=true) {
  await api.patch('/api/driver/online').set(headers(session)).send({online}).expect(200);
  if(online){
    const longitude=session.user.id===driver1?.user.id?74.6042:74.6150;
    await api.patch('/api/driver/position').set(headers(session)).send({latitude:42.8756,longitude,accuracyM:8,measuredAtMs:Date.now()}).expect(200);
  }
}
async function socket(session:Session) {
  const connection=io(baseUrl,{auth:{token:session.accessToken},transports:['websocket'],reconnection:false});sockets.push(connection);
  await new Promise<void>((resolve,reject)=>{connection.once('session:ready',()=>resolve());connection.once('connect_error',reject);setTimeout(()=>reject(new Error('Socket timeout')),5000).unref();});
  return connection;
}
function once(connection:Socket,event:string) {
  return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),5000);connection.once(event,value=>{clearTimeout(timer);resolve(value);});});
}
before(async()=>{
  if(process.env.TEST_DATABASE_RESET!=='true'||!process.env.DATABASE_URL?.includes('taxi_test'))throw new Error('Use a disposable taxi_test database and TEST_DATABASE_RESET=true');
  await db.$executeRawUnsafe('TRUNCATE TABLE "AdminAudit", "AdminCredential", "Banner", "MediaAsset", "FoodStatusHistory", "FoodOrder", "FoodRestaurant", "PushJob", "PushToken", "RateLimit", "SmsChallenge", "RefreshSession", "Rating", "Message", "StatusHistory", "OrderOffer", "LedgerEntry", "Order", "Quote", "Vehicle", "DriverProfile", "Tariff", "User" CASCADE');
  for(const [sortOrder,restaurant] of DEMO_FOOD_RESTAURANTS.entries())await db.foodRestaurant.create({data:{id:restaurant.id,catalog:JSON.parse(JSON.stringify(restaurant)),active:true,isDemo:true,sortOrder}});
  await db.tariff.create({data:{id:'economy',name:'Эконом',description:'Тестовый тариф',basePrice:60,pricePerKm:14,pricePerMinute:2,minimumPrice:100,commissionBps:1000}});
  for(const [phone,role] of [['+996700123456','CLIENT'],['+996700123457','CLIENT'],['+996700111111','DRIVER'],['+996700222222','DRIVER'],['+996700999999','ADMIN']] as const) {
    const user=await db.user.create({data:{phone,role,name:role}});
    if(role==='DRIVER')await db.driverProfile.create({data:{userId:user.id,verified:true,deposit:1000,vehicle:{create:{make:'Toyota',color:'Белый',plate:phone}}}});
    if(role==='ADMIN')await db.adminCredential.create({data:{userId:user.id,username:'integration-owner',passwordHash:await hashAdminPassword(adminPassword)}});
  }
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(RoutingService).useValue({route:async(start:any,finish:any)=>parseOsrmRoute(osrmFixture(start,finish),start,finish)}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalPipes(apiValidation());app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0,'127.0.0.1');baseUrl=await app.getUrl();api=request(app.getHttpServer());
  client=await login('+996700123456');client2=await login('+996700123457');driver1=await login('+996700111111');driver2=await login('+996700222222');
  admin=(await api.post('/api/admin/auth/login').send({username:'integration-owner',password:adminPassword}).expect(201)).body;
  await setOnline(driver1);await setOnline(driver2);
});
after(async()=>{for(const connection of sockets)connection.disconnect();await app?.close();await db.$disconnect();});

test('DTOs reject client price, role escalation and malformed nested route',async()=>{
  await api.patch('/api/users/me').set(headers(client)).send({role:'ADMIN'}).expect(400);
  await api.patch('/api/users/me').set(headers(client)).send({photoUrl:'https://example.com/client.jpg'}).expect(400);
  await api.patch('/api/users/me').set(headers(driver1)).send({photoUrl:'https://example.com/driver.jpg'}).expect(400);
  await api.post('/api/orders/quote').set(headers(client)).send({tariffId:'economy'}).expect(400);
  await api.post('/api/orders/quote').set(headers(client)).send({pickup,dropoff,tariffId:'economy',price:1}).expect(400);
  await api.get('/api/driver/balance').set(headers(client)).expect(403);
  await api.post(`/api/admin/drivers/${driver1.user.id}/topup`).set(headers(client)).send({amount:100,idempotencyKey:randomUUID(),note:'test'}).expect(403);
});
test('navigation routes require authentication, accept both apps and validate endpoints',async()=>{
  await api.post('/api/routes').send({pickup,dropoff}).expect(401);
  for(const session of [client,driver1]) {
    const response=await api.post('/api/routes').set(headers(session)).send({pickup,dropoff}).expect(201);
    assert.equal(response.body.provider,'osrm');assert.equal(response.body.steps[1].maneuver.modifier,'right');
    assert.deepEqual(response.body.geometry[0],{latitude:pickup.latitude,longitude:pickup.longitude});
  }
  await api.post('/api/routes').set(headers(client)).send({pickup}).expect(400);
  await api.post('/api/routes').set(headers(driver1)).send({pickup:{...pickup,latitude:91},dropoff}).expect(400);
  await api.post('/api/routes').set(headers(driver1)).send({pickup,dropoff,url:'https://bad.example'}).expect(400);
});
test('avatar upload is driver-only, validates bytes and serves versioned public images',async()=>{
  assert.equal(detectAvatarMime(Buffer.from([0xff,0xd8,0xff,0xe0])),'image/jpeg');
  assert.equal(detectAvatarMime(pngAvatar),'image/png');
  assert.equal(detectAvatarMime(Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBP')),'image/webp');
  assert.equal(detectAvatarMime(Buffer.from('not an image')),null);

  await api.post('/api/users/me/avatar').attach('avatar',pngAvatar,{filename:'avatar.png',contentType:'image/png'}).expect(401);
  await api.post('/api/users/me/avatar').set(headers(client)).attach('avatar',pngAvatar,{filename:'avatar.png',contentType:'image/png'}).expect(403);
  await api.post('/api/users/me/avatar').set(headers(driver1)).expect(400);
  await api.post('/api/users/me/avatar').set(headers(driver1)).attach('avatar',Buffer.from('not an image'),{filename:'avatar.jpg',contentType:'image/jpeg'}).expect(400);
  await api.post('/api/users/me/avatar').set(headers(driver1)).attach('avatar',pngAvatar,{filename:'avatar.jpg',contentType:'image/jpeg'}).expect(400);
  await api.post('/api/users/me/avatar').set(headers(driver1)).attach('avatar',Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10]),{filename:'broken.jpg',contentType:'image/jpeg'}).expect(400);
  const oversized=Buffer.alloc(MAX_AVATAR_BYTES+1);oversized[0]=0xff;oversized[1]=0xd8;oversized[2]=0xff;
  await api.post('/api/users/me/avatar').set(headers(driver1)).attach('avatar',oversized,{filename:'large.jpg',contentType:'image/jpeg'}).expect(413);
  const tooManyPixels=await sharp({create:{width:5000,height:5000,channels:3,background:'#ffffff'}}).png({compressionLevel:9}).toBuffer();
  assert.ok(tooManyPixels.length<MAX_AVATAR_BYTES);
  await api.post('/api/users/me/avatar').set(headers(driver1)).attach('avatar',tooManyPixels,{filename:'huge.png',contentType:'image/png'}).expect(400);

  const uploaded=await api.post('/api/users/me/avatar').set(headers(driver1)).attach('avatar',pngAvatar,{filename:'avatar.png',contentType:'image/png'});
  assert.equal(uploaded.status,201,JSON.stringify(uploaded.body));
  assert.match(uploaded.body.photoUrl,new RegExp(`^/avatars/${driver1.user.id}\\?v=\\d+$`));
  const stored=await db.user.findUniqueOrThrow({where:{id:driver1.user.id},select:{avatarData:true,avatarMime:true,avatarUpdatedAt:true}});
  const storedData=Buffer.from(stored.avatarData!);
  const storedMetadata=await sharp(storedData).metadata();
  assert.notDeepEqual(storedData,pngAvatar);assert.equal(stored.avatarMime,'image/jpeg');assert.ok(stored.avatarUpdatedAt);
  assert.equal(storedMetadata.format,'jpeg');assert.equal(storedMetadata.width,720);assert.equal(storedMetadata.height,720);assert.equal(storedMetadata.exif,undefined);

  const publicImage=await api.get(`/api${uploaded.body.photoUrl}`).expect(200).expect('Content-Type',/image\/jpeg/).expect('Cache-Control','public, max-age=31536000, immutable');
  assert.deepEqual(publicImage.body,storedData);
  await api.get(`/api/avatars/${driver1.user.id}`).expect(200).expect('Cache-Control','public, max-age=0, must-revalidate');
  await api.get(`/api/avatars/${randomUUID()}`).expect(404);

  const replaced=await api.post('/api/users/me/avatar').set(headers(driver1)).attach('avatar',pngAvatar,{filename:'avatar.png',contentType:'image/png'}).expect(201);
  assert.notEqual(replaced.body.photoUrl,uploaded.body.photoUrl);
});
test('driver tracking is scoped to the assigned passenger, rejects replay and ends with the trip', async()=>{
  await setOnline(driver1); await setOnline(driver2);
  const order=await create();
  assert.ok(Math.abs(Date.parse(order.searchExpiresAt)-Date.parse(order.createdAt)-30000)<1500);
  const path=`/api/orders/${order.id}/driver-location`;
  const fix={latitude:41.1987,longitude:72.1802,accuracy:8,heading:90,speed:12,timestamp:Date.now()};
  await api.patch(path).send(fix).expect(401);
  await api.patch(path).set(headers(driver1)).send(fix).expect(403);
  const accepted=await api.post(`/api/orders/${order.id}/accept`).set(headers(driver1)).expect(201);
  assert.match(accepted.body.assignmentId,/^[0-9a-f-]{36}$/i);
  const own=await socket(client), outsider=await socket(client2), otherDriver=await socket(driver2);
  const leaked:any[]=[]; outsider.on('driver:location',value=>leaked.push(value)); otherDriver.on('driver:location',value=>leaked.push(value));
  const delivered=once(own,'driver:location');
  await api.patch(path).set(headers(client)).send(fix).expect(403);
  await api.patch(path).set(headers(driver2)).send(fix).expect(403);
  await api.patch(path).set(headers(driver1)).send({...fix,latitude:91}).expect(400);
  await api.patch(path).set(headers(driver1)).send({...fix,timestamp:Date.now()-20000}).expect(400);
  await api.patch(path).set(headers(driver1)).send({...fix,driverId:driver2.user.id}).expect(403);
  await api.patch(path).set(headers(driver1)).send(fix).expect(200);
  const event=await delivered; assert.equal(event.orderId,order.id); assert.equal(event.location.latitude,fix.latitude);
  await api.get(path).set(headers(client2)).expect(403); await api.get(path).set(headers(driver2)).expect(403);
  const replay=await api.patch(path).set(headers(driver1)).send({...fix,timestamp:fix.timestamp-1,latitude:42}).expect(200);
  assert.equal(replay.body.location.latitude,fix.latitude);
  const measuredAt=Date.now();
  const sequenced={...fix,timestamp:measuredAt,measuredAt,accuracyM:fix.accuracy,speedMps:fix.speed,bearingDeg:fix.heading,
    driverId:driver1.user.id,tripId:order.id,trackingSessionId:'integration-session',sequence:1};
  await api.patch(path).set(headers(driver1)).send(sequenced).expect(200);
  const duplicate=await api.patch(path).set(headers(driver1)).send({...sequenced,timestamp:measuredAt+1,measuredAt:measuredAt+1,latitude:42}).expect(200);
  assert.equal(duplicate.body.location.latitude,fix.latitude,'the same sequence cannot replace the current point');
  const v1At=Math.max(Date.now(),measuredAt+2);
  const v1={schemaVersion:1,orderId:order.id,assignmentId:accepted.body.assignmentId,trackingSessionId:'integration-v1',
    trackingStartedAtMs:v1At-100,sequence:1,latitude:41.198700123,longitude:72.180200456,
    accuracyM:null,speedMps:0,courseDeg:0,measuredAtMs:v1At};
  const v1Response=await api.patch(path).set(headers(driver1)).send(v1).expect(200);
  assert.equal(v1Response.body.assignmentId,accepted.body.assignmentId);
  assert.equal(v1Response.body.location.latitude,v1.latitude);
  assert.equal(v1Response.body.location.longitude,v1.longitude);
  assert.equal(v1Response.body.location.speedMps,0);
  assert.equal(v1Response.body.location.courseDeg,0);
  assert.equal(v1Response.body.location.measuredAtMs,v1At);
  assert.ok(v1Response.body.location.receivedAtMs<=v1Response.body.serverTimeMs);
  assert.ok(v1Response.body.stateVersion>duplicate.body.stateVersion);
  const v1Snapshot=await api.get(path).set(headers(client)).expect(200).expect('Cache-Control','private, no-store');
  assert.equal(v1Snapshot.body.assignmentId,accepted.body.assignmentId);
  assert.equal(v1Snapshot.body.stateVersion,v1Response.body.stateVersion);
  await api.patch(path).set(headers(driver1)).send({...v1,assignmentId:randomUUID(),sequence:2,measuredAtMs:v1At+1}).expect(403);
  const duplicateV1=await api.patch(path).set(headers(driver1)).send({...v1,sequence:1,measuredAtMs:v1At+2,latitude:42}).expect(200);
  assert.equal(duplicateV1.body.location.latitude,v1.latitude);
  await api.patch(path).set(headers(driver1)).send({...sequenced,tripId:randomUUID()}).expect(400);
  for(const stage of ['arrive','start']) await api.post(`/api/orders/${order.id}/${stage}`).set(headers(driver1)).expect(201);
  assert.equal((await api.get(path).set(headers(client)).expect(200)).body.location.latitude,v1.latitude);
  await api.post(`/api/orders/${order.id}/complete`).set(headers(driver1)).expect(201);
  assert.equal((await api.get(path).set(headers(client)).expect(200)).body.location,null);
  assert.equal((await api.get(`/api/orders/${order.id}`).set(headers(client)).expect(200)).body.driverLocation,null);
  assert.equal((await db.order.findUniqueOrThrow({where:{id:order.id}})).driverLocation,null);
  await api.patch(path).set(headers(driver1)).send({...fix,timestamp:Date.now()}).expect(403);
  await new Promise(resolve=>setTimeout(resolve,60)); assert.equal(leaked.length,0);
  own.disconnect(); outsider.disconnect(); otherDriver.disconnect();
  const cancelled=await create(); await api.post(`/api/orders/${cancelled.id}/accept`).set(headers(driver1)).expect(201);
  await api.patch(`/api/orders/${cancelled.id}/driver-location`).set(headers(driver1)).send({...fix,timestamp:Date.now()}).expect(200);
  await api.post(`/api/orders/${cancelled.id}/cancel`).set(headers(driver1)).expect(201);
  await api.post(`/api/orders/${cancelled.id}/accept`).set(headers(driver2)).expect(201);
  assert.equal((await api.get(`/api/orders/${cancelled.id}/driver-location`).set(headers(client)).expect(200)).body.location,null);
  await api.patch(`/api/orders/${cancelled.id}/driver-location`).set(headers(driver1)).send({...fix,timestamp:Date.now()}).expect(403);
  await api.post(`/api/orders/${cancelled.id}/cancel`).set(headers(client)).expect(201);
});

test('concurrent creation offers only the nearest driver and accepts only that driver',async()=>{
  const quote=await quoted(client);const idempotencyKey=randomUUID();
  const requests=await Promise.all(Array.from({length:5},()=>api.post('/api/orders').set(headers(client)).send({quoteId:quote.id,idempotencyKey})));
  requests.forEach(response=>assert.equal(response.status,201));
  assert.equal(new Set(requests.map(response=>response.body.id)).size,1);
  const order=requests[0].body;
  const secondQuote=await quoted(client);
  await api.post('/api/orders').set(headers(client)).send({quoteId:secondQuote.id,idempotencyKey:randomUUID()}).expect(409);
  const offers=(await api.get('/api/driver/offers').set(headers(driver1)).expect(200)).body;
  assert.equal(offers[0].id,order.id);assert.equal(offers[0].client,undefined);
  assert.equal((await api.get('/api/driver/offers').set(headers(driver2)).expect(200)).body.length,0);
  const accepted=await Promise.all([driver1,driver2].map(driver=>api.post(`/api/orders/${order.id}/accept`).set(headers(driver))));
  assert.deepEqual(accepted.map(response=>response.status).sort(),[201,409]);
  const acceptedOrder=accepted.find(response=>response.status===201)!.body;
  assert.equal(acceptedOrder.price,quote.price);
  const winner=accepted[0].status===201?driver1:driver2;
  assert.equal((await db.order.findUniqueOrThrow({where:{id:order.id}})).driverId,winner.user.id);
  const pushJobs=await db.pushJob.findMany({where:{orderId:order.id},select:{userId:true,event:true}});
  assert.equal(pushJobs.filter(job=>job.userId===client.user.id&&job.event==='order:created').length,1);
  assert.deepEqual(pushJobs.filter(job=>job.event==='order:offer').map(job=>job.userId),[driver1.user.id]);
  assert.deepEqual(pushJobs.filter(job=>job.event==='order:assigned'),[{userId:client.user.id,event:'order:assigned'}]);
  await api.get(`/api/orders/${order.id}`).set(headers(client2)).expect(403);
  await api.get(`/api/orders/${order.id}/messages`).set(headers(client2)).expect(403);
  await api.post(`/api/orders/${order.id}/cancel`).set(headers(client)).expect(201);
});
test('skip and 30-second expiry hand the order to the next driver without reoffering',async()=>{
  await setOnline(driver1);await setOnline(driver2);
  const passenger=await login('+996700123459');
  const order=await create(passenger);
  assert.equal((await api.get('/api/driver/offers').set(headers(driver1)).expect(200)).body[0].id,order.id);
  assert.equal((await api.get('/api/driver/offers').set(headers(driver2)).expect(200)).body.length,0);
  await api.post(`/api/orders/${order.id}/skip`).set(headers(driver1)).expect(201);
  await api.post(`/api/orders/${order.id}/accept`).set(headers(driver1)).expect(403);
  assert.equal((await api.get('/api/driver/offers').set(headers(driver2)).expect(200)).body[0].id,order.id);
  const next=await db.orderOffer.findUniqueOrThrow({where:{orderId_driverId:{orderId:order.id,driverId:driver2.user.id}}});
  assert.ok(next.expiresAt.getTime()-next.createdAt.getTime()<=30000);
  await db.orderOffer.update({where:{id:next.id},data:{expiresAt:new Date(Date.now()-1000)}});
  await app.get(OrdersService).dispatchOrder(order.id);
  await api.post(`/api/orders/${order.id}/accept`).set(headers(driver2)).expect(409);
  assert.equal((await api.get(`/api/orders/${order.id}`).set(headers(passenger)).expect(200)).body.status,'NO_DRIVER');
});
test('stale or inaccurate online GPS does not qualify for nearest-driver dispatch',async()=>{
  const passenger=await login('+996700123460');
  const quote=await quoted(passenger);
  await db.driverProfile.update({where:{userId:driver1.user.id},data:{locationMeasuredAt:new Date(Date.now()-31000)}});
  await api.patch('/api/driver/position').set(headers(passenger)).send({latitude:pickup.latitude,longitude:pickup.longitude,accuracyM:8,measuredAtMs:Date.now()}).expect(403);
  await api.patch('/api/driver/position').set(headers(driver1)).send({latitude:pickup.latitude,longitude:pickup.longitude,accuracyM:101,measuredAtMs:Date.now()}).expect(400);
  const order=(await api.post('/api/orders').set(headers(passenger)).send({quoteId:quote.id,idempotencyKey:randomUUID()}).expect(201)).body;
  assert.equal((await api.get('/api/driver/offers').set(headers(driver2)).expect(200)).body[0].id,order.id);
  await api.post(`/api/orders/${order.id}/cancel`).set(headers(passenger)).expect(201);
  await setOnline(driver1);
});
test('higher-rated driver wins when both online drivers are within 250 metres of the nearest',async()=>{
  const passenger=await login('+996700123461');
  await setOnline(driver1,false);await setOnline(driver2);
  const rated=await create(passenger);
  await api.post(`/api/orders/${rated.id}/accept`).set(headers(driver2)).expect(201);
  for(const stage of ['arrive','start','complete'])await api.post(`/api/orders/${rated.id}/${stage}`).set(headers(driver2)).expect(201);
  await api.post(`/api/orders/${rated.id}/rating`).set(headers(passenger)).send({score:5}).expect(201);
  await setOnline(driver1);
  await db.driverProfile.update({where:{userId:driver2.user.id},data:{locationLatitude:42.8756,locationLongitude:74.6055,locationAccuracyM:8,locationMeasuredAt:new Date()}});
  const next=await create(passenger);
  assert.equal((await api.get('/api/driver/offers').set(headers(driver2)).expect(200)).body[0].id,next.id);
  assert.equal((await api.get('/api/driver/offers').set(headers(driver1)).expect(200)).body.length,0);
  await api.post(`/api/orders/${next.id}/cancel`).set(headers(passenger)).expect(201);
  await db.driverProfile.update({where:{userId:driver2.user.id},data:{locationLongitude:74.6150,locationMeasuredAt:new Date()}});
});
test('one driver cannot accept two different client orders concurrently',async()=>{
  await setOnline(driver1);
  const [one,two]=await Promise.all([create(client),create(client2)]);
  const results=await Promise.all([one,two].map(order=>api.post(`/api/orders/${order.id}/accept`).set(headers(driver1))));
  assert.deepEqual(results.map(response=>response.status).sort(),[201,409]);
  await api.post(`/api/orders/${one.id}/cancel`).set(headers(client)).expect(201);
  await api.post(`/api/orders/${two.id}/cancel`).set(headers(client2)).expect(201);
});
test('driver cancellation returns to search; client cancellation is permanent',async()=>{
  await setOnline(driver1);await setOnline(driver2);const order=await create();
  await api.post(`/api/orders/${order.id}/accept`).set(headers(driver1)).expect(201);
  await api.post(`/api/orders/${order.id}/messages`).set(headers(driver1)).send({text:'Сообщение предыдущего водителя',clientMessageId:randomUUID()}).expect(201);
  const cancelled=(await api.post(`/api/orders/${order.id}/cancel`).set(headers(driver1)).expect(201)).body;
  assert.equal(cancelled.status,'SEARCHING');assert.equal(cancelled.driver,null);
  await api.post(`/api/orders/${order.id}/accept`).set(headers(driver1)).expect(403);
  await api.post(`/api/orders/${order.id}/accept`).set(headers(driver2)).expect(201);
  await api.get(`/api/orders/${order.id}/messages`).set(headers(driver1)).expect(403);
  assert.equal((await api.get(`/api/orders/${order.id}/messages`).set(headers(driver2))).body.length,0);
  await api.post(`/api/orders/${order.id}/cancel`).set(headers(client)).expect(201);
  await api.post(`/api/orders/${order.id}/accept`).set(headers(driver1)).expect(409);
});
test('arrival, coming, chat, restoration, cash income and idempotent commission',async()=>{
  await setOnline(driver1);const order=await create();await api.post(`/api/orders/${order.id}/accept`).set(headers(driver1)).expect(201);
  const riderSocket=await socket(client);const otherSocket=await socket(client2);const driverSocket=await socket(driver1);
  await api.post(`/api/orders/${order.id}/complete`).set(headers(driver1)).expect(400);
  await api.post(`/api/orders/${order.id}/start`).set(headers(client)).expect(403);
  await api.post(`/api/orders/${order.id}/arrive`).set(headers(driver1)).expect(201);
  assert.deepEqual(await db.pushJob.findMany({where:{orderId:order.id,event:'trip:arrived'},select:{userId:true,event:true}}),[
    {userId:client.user.id,event:'trip:arrived'},
  ]);
  const comingEvent=once(driverSocket,'rider:coming');await api.post(`/api/orders/${order.id}/coming`).set(headers(client)).expect(201);
  assert.equal((await comingEvent).orderId,order.id);
  assert.equal((await api.get('/api/orders/active').set(headers(client))).body.status,'ARRIVED');
  const chatId=randomUUID();const messageEvent=once(driverSocket,'chat:message');
  await api.post(`/api/orders/${order.id}/messages`).set(headers(client)).send({text:'Сейчас выйду',clientMessageId:chatId}).expect(201);
  assert.equal((await messageEvent).text,'Сейчас выйду');
  await api.post(`/api/orders/${order.id}/messages`).set(headers(client)).send({text:'Сейчас выйду',clientMessageId:chatId}).expect(201);
  assert.equal(await db.message.count({where:{orderId:order.id}}),1);
  const replyEvent=once(riderSocket,'chat:message');
  await api.post(`/api/orders/${order.id}/messages`).set(headers(driver1)).send({text:'Жду у входа',clientMessageId:randomUUID()}).expect(201);
  assert.equal((await replyEvent).text,'Жду у входа');
  assert.deepEqual((await db.pushJob.findMany({where:{orderId:order.id,event:'chat:message'},select:{userId:true}})).map(job=>job.userId).sort(),[client.user.id,driver1.user.id].sort());
  riderSocket.disconnect();const reconnected=await socket(client);
  assert.equal((await api.get('/api/orders/active').set(headers(client))).body.id,order.id);
  await api.post(`/api/orders/${order.id}/start`).set(headers(driver1)).expect(201);
  await api.post(`/api/orders/${order.id}/cancel`).set(headers(client)).expect(400);
  const before=(await api.get('/api/driver/balance').set(headers(driver1))).body;
  const completions=await Promise.all(Array.from({length:5},()=>api.post(`/api/orders/${order.id}/complete`).set(headers(driver1))));
  completions.forEach(response=>assert.equal(response.status,201));
  const after=(await api.get('/api/driver/balance').set(headers(driver1))).body;
  const stored=await db.order.findUniqueOrThrow({where:{id:order.id}});
  assert.equal(after.deposit,before.deposit-stored.commission);assert.equal(after.cashIncome,before.cashIncome+stored.price);
  assert.equal(await db.ledgerEntry.count({where:{orderId:order.id,kind:'COMMISSION'}}),1);
  assert.deepEqual((await db.pushJob.findMany({where:{orderId:order.id,event:'trip:completed'},select:{userId:true}})).map(job=>job.userId).sort(),[client.user.id,driver1.user.id].sort());
  await api.post(`/api/orders/${order.id}/rating`).set(headers(client)).send({score:5}).expect(201);
  await api.post(`/api/orders/${order.id}/rating`).set(headers(client)).send({score:5}).expect(201);
  await api.post(`/api/orders/${order.id}/rating`).set(headers(client)).send({score:6}).expect(400);
  assert.equal(await db.rating.count({where:{orderId:order.id}}),1);
  assert.equal((await api.get('/api/orders/active').set(headers(client))).body,null);
  reconnected.disconnect();driverSocket.disconnect();otherSocket.disconnect();
});

test('another passenger is saved separately from the booking client and shown to the assigned driver',async()=>{
  const quote=await quoted(client2);
  const idempotencyKey=randomUUID();
  const payload={quoteId:quote.id,idempotencyKey,passenger:{name:' Айдана ',phone:'+996 700 123 456'}};
  await api.post('/api/orders').set(headers(client2)).send({...payload,passenger:{name:'Айдана',phone:'bad'}}).expect(400);
  const created=(await api.post('/api/orders').set(headers(client2)).send(payload).expect(201)).body;
  assert.deepEqual(created.passenger,{name:'Айдана',phone:'+996700123456'});
  assert.equal(created.client.id,client2.user.id);
  const offer=(await api.get('/api/driver/offers').set(headers(driver1)).expect(200)).body.find((item:any)=>item.id===created.id);
  assert.deepEqual(offer.passenger,{name:'Айдана'});
  await api.post('/api/orders').set(headers(client2)).send({...payload,passenger:{name:'Другой',phone:'+996700123456'}}).expect(409);
  await api.post('/api/orders').set(headers(client2)).send(payload).expect(201);
  const accepted=(await api.post(`/api/orders/${created.id}/accept`).set(headers(driver1)).expect(201)).body;
  assert.deepEqual(accepted.passenger,{name:'Айдана',phone:'+996700123456'});
  assert.equal(accepted.client.id,client2.user.id);
  for(const stage of ['arrive','start','complete'])await api.post(`/api/orders/${created.id}/${stage}`).set(headers(driver1)).expect(201);
  await api.post(`/api/orders/${created.id}/client-rating`).set(headers(driver1)).send({score:5}).expect(201);
  const completed=(await api.get(`/api/orders/${created.id}`).set(headers(driver1)).expect(200)).body;
  assert.equal(completed.driverRating,5);
  assert.equal(completed.clientRating,null,'the guest rating must not change the booking client rating');
});

test('passenger feedback stores a trimmed optional comment and rejects changed retries',async()=>{
  await setOnline(driver1);
  const order=await create();
  for(const stage of ['accept','arrive','start','complete'])await api.post(`/api/orders/${order.id}/${stage}`).set(headers(driver1)).expect(201);
  const path=`/api/orders/${order.id}/rating`;
  await api.post(path).set(headers(client)).send({score:5,comment:'x'.repeat(501)}).expect(400);
  const created=await api.post(path).set(headers(client)).send({score:5,comment:'  Отличная поездка!  '}).expect(201);
  assert.equal(created.body.comment,'Отличная поездка!');
  const retried=await api.post(path).set(headers(client)).send({score:5,comment:'Отличная поездка!'}).expect(201);
  assert.equal(retried.body.id,created.body.id);
  await api.post(path).set(headers(client)).send({score:5}).expect(409);
  await api.post(path).set(headers(client)).send({score:5,comment:'Другая оценка'}).expect(409);
  await api.post(path).set(headers(client)).send({score:4,comment:'Отличная поездка!'}).expect(409);
  assert.deepEqual(await db.rating.findUnique({where:{orderId:order.id},select:{score:true,comment:true}}),{score:5,comment:'Отличная поездка!'});
});

test('driver feedback rates a completed passenger and appears on their next offer',async()=>{
  await setOnline(driver1);
  const passenger=await login('+996700123458');
  const order=await create(passenger);
  const path=`/api/orders/${order.id}/client-rating`;
  for(const stage of ['accept','arrive','start'])await api.post(`/api/orders/${order.id}/${stage}`).set(headers(driver1)).expect(201);
  await api.post(path).set(headers(driver1)).send({score:4}).expect(400);
  await api.post(`/api/orders/${order.id}/complete`).set(headers(driver1)).expect(201);
  await api.post(path).set(headers(passenger)).send({score:4}).expect(403);
  await api.post(path).set(headers(driver2)).send({score:4}).expect(403);
  await api.post(path).set(headers(driver1)).send({score:6}).expect(400);
  const created=await api.post(path).set(headers(driver1)).send({score:4,comment:'  Вежливый пассажир  '}).expect(201);
  assert.equal(created.body.comment,'Вежливый пассажир');
  const retried=await api.post(path).set(headers(driver1)).send({score:4,comment:'Вежливый пассажир'}).expect(201);
  assert.equal(retried.body.id,created.body.id);
  await api.post(path).set(headers(driver1)).send({score:5,comment:'Вежливый пассажир'}).expect(409);
  const completed=(await api.get(`/api/orders/${order.id}`).set(headers(driver1)).expect(200)).body;
  assert.equal(completed.clientRating,4);
  assert.equal(completed.driverRating,4);
  const next=await create(passenger);
  const offers=(await api.get('/api/driver/offers').set(headers(driver1)).expect(200)).body;
  const offer=offers.find((item:any)=>item.id===next.id);
  assert.equal(offer.clientRating,4);
  assert.equal(offer.client,undefined);
  assert.equal(offer.driverRating,null);
  await api.post(`/api/orders/${next.id}/cancel`).set(headers(passenger)).expect(201);
});

test('offline drivers are excluded and search eventually reaches NO_DRIVER',async()=>{
  await setOnline(driver1,false);await setOnline(driver2,false);
  const order=await create();await api.post(`/api/orders/${order.id}/accept`).set(headers(driver1)).expect(403);
  assert.equal((await api.get('/api/driver/offers').set(headers(driver1))).body.length,0);
  await db.order.update({where:{id:order.id},data:{searchExpiresAt:new Date(Date.now()-1000)}});
  await app.get(OrdersService).dispatchOrder(order.id);
  assert.equal((await api.get(`/api/orders/${order.id}`).set(headers(client))).body.status,'NO_DRIVER');
  await setOnline(driver1);await setOnline(driver2);
});
test('administrator topups are exactly once and bind the idempotency key to request',async()=>{
  const before=(await api.get('/api/driver/balance').set(headers(driver1))).body.deposit;
  const data={amount:250,idempotencyKey:randomUUID(),note:'Cash deposit receipt 42'};
  const results=await Promise.all(Array.from({length:5},()=>api.post(`/api/admin/drivers/${driver1.user.id}/topup`).set(headers(admin)).send(data)));
  results.forEach(response=>assert.equal(response.status,201));
  assert.equal((await api.get('/api/driver/balance').set(headers(driver1))).body.deposit,before+250);
  await api.post(`/api/admin/drivers/${driver1.user.id}/topup`).set(headers(admin)).send({...data,amount:251}).expect(409);
});
const foodBody=()=>({requestId:randomUUID(),restaurantId:'sushi-roll',items:[{dishId:'philadelphia',quantity:2,optionIds:['soy','ginger']}],fulfillment:'DELIVERY',address:'ул. Киевская, 123',comment:'Без звонка',paymentMethod:'CASH'});

test('food catalog identifies demo content; orders validate nested input and require authenticated clients',async()=>{
  const catalog=(await api.get('/api/food/catalog').expect(200)).body;
  assert.deepEqual(catalog.restaurants.map((restaurant:any)=>restaurant.id),['sushi-roll','kfc','halva','ali-burger']);
  assert.ok(catalog.isDemo);assert.ok(catalog.restaurants.every((restaurant:any)=>restaurant.isDemo));
  assert.deepEqual(catalog.paymentMethods.filter((method:any)=>method.available).map((method:any)=>method.id),['CASH']);
  await api.post('/api/food/orders').send(foodBody()).expect(401);
  await api.get('/api/food/orders/active').expect(401);
  await api.post('/api/food/orders').set(headers(driver1)).send(foodBody()).expect(403);
  const invalid=[
    {total:1},{items:[]},{items:[{dishId:'philadelphia',quantity:0,optionIds:[]}]},
    {items:[{dishId:'philadelphia',quantity:1.5,optionIds:[]}]},
    {items:[{dishId:'philadelphia',quantity:1,optionIds:[],unitPrice:1}]},
    {items:[{dishId:'philadelphia',quantity:1,optionIds:['soy','soy']}]},
    {items:[{dishId:'philadelphia',quantity:1,optionIds:['not-allowed']}]},
    {address:'    '},{paymentMethod:'CARD'},{paymentMethod:'ONLINE'},
  ];
  for(const patch of invalid)await api.post('/api/food/orders').set(headers(client)).send({...foodBody(),...patch}).expect(400);
  assert.equal(await db.foodOrder.count(),0);
});

test('food concurrent retries persist once, reject changed request data, and keep own history private',async()=>{
  const data=foodBody();
  const responses=await Promise.all(Array.from({length:5},()=>api.post('/api/food/orders').set(headers(client)).send(data)));
  responses.forEach(response=>assert.equal(response.status,201,JSON.stringify(response.body)));
  assert.equal(new Set(responses.map(response=>response.body.id)).size,1);
  const order=responses[0].body;
  assert.equal(order.total,1040);assert.equal(order.subtotal,1040);assert.equal(order.deliveryFee,0);
  assert.equal(order.status,'PLACED');assert.equal(order.isDemo,true);assert.equal(order.items[0].options.length,2);
  assert.equal(await db.foodStatusHistory.count({where:{orderId:order.id}}),1);
  await api.post('/api/food/orders').set(headers(client)).send({...data,address:'ул. Киевская, 125'}).expect(409);
  await api.post('/api/food/orders').set(headers(client)).send(foodBody()).expect(409);
  await api.get(`/api/food/orders/${order.id}`).set(headers(client2)).expect(404);
  assert.deepEqual((await api.get('/api/food/orders/history').set(headers(client2)).expect(200)).body,[]);
  assert.equal((await api.get('/api/food/orders/active').set(headers(client)).expect(200)).body.id,order.id);
  // Reloading the service reads the durable order and does not advance restaurant progress.
  assert.deepEqual((await api.get(`/api/food/orders/${order.id}`).set(headers(client)).expect(200)).body,order);
  await api.patch(`/api/admin/food/orders/${order.id}/status`).set(headers(client)).send({status:'CONFIRMED'}).expect(403);
  await api.patch(`/api/admin/food/orders/${order.id}/status`).set(headers(driver1)).send({status:'CONFIRMED'}).expect(403);
  await api.patch(`/api/admin/food/orders/${order.id}/status`).set(headers(admin)).send({status:'COMPLETED'}).expect(400);
  for(const status of ['CONFIRMED','PREPARING','READY','DELIVERING','COMPLETED']) {
    const updated=(await api.patch(`/api/admin/food/orders/${order.id}/status`).set(headers(admin)).send({status}).expect(200)).body;
    assert.equal(updated.status,status);
    if(status==='PREPARING')await api.post(`/api/food/orders/${order.id}/cancel`).set(headers(client)).expect(400);
  }
  const complete=await api.patch(`/api/admin/food/orders/${order.id}/status`).set(headers(admin)).send({status:'COMPLETED'}).expect(200);
  assert.ok(complete.body.completedAt);
  assert.equal(await db.foodStatusHistory.count({where:{orderId:order.id,status:'COMPLETED'}}),1);
  assert.equal((await api.get('/api/food/orders/active').set(headers(client)).expect(200)).body,null);
  assert.equal((await api.get('/api/food/orders/history').set(headers(client)).expect(200)).body[0].id,order.id);
  assert.equal((await api.post('/api/food/orders').set(headers(client)).send(data).expect(201)).body.id,order.id);
});

test('food pickup has no delivery charge or courier stage; early cancellation frees the active order',async()=>{
  const data={...foodBody(),restaurantId:'kfc',items:[{dishId:'chicken-burger',quantity:1,optionIds:[]}],fulfillment:'PICKUP',address:''};
  const order=(await api.post('/api/food/orders').set(headers(client)).send(data).expect(201)).body;
  assert.equal(order.subtotal,290);assert.equal(order.deliveryFee,0);assert.equal(order.total,290);assert.equal(order.address,'');
  for(const status of ['CONFIRMED','PREPARING','READY'])await api.patch(`/api/admin/food/orders/${order.id}/status`).set(headers(admin)).send({status}).expect(200);
  await api.patch(`/api/admin/food/orders/${order.id}/status`).set(headers(admin)).send({status:'DELIVERING'}).expect(400);
  await api.patch(`/api/admin/food/orders/${order.id}/status`).set(headers(admin)).send({status:'COMPLETED'}).expect(200);
  const second=(await api.post('/api/food/orders').set(headers(client)).send({...data,requestId:randomUUID(),fulfillment:'DELIVERY',address:'ул. Киевская, 123'}).expect(201)).body;
  assert.equal(second.total,390);assert.equal(second.deliveryFee,100);
  await api.post(`/api/food/orders/${second.id}/cancel`).set(headers(client2)).expect(403);
  for(let attempt=0;attempt<2;attempt++)assert.equal((await api.post(`/api/food/orders/${second.id}/cancel`).set(headers(client)).expect(201)).body.status,'CANCELLED');
  assert.equal((await api.get('/api/food/orders/active').set(headers(client)).expect(200)).body,null);
});

test('admin reads and mutations reject clients/drivers; SMS cannot authenticate any ADMIN account',async()=>{
  for(const path of ['/api/admin/me','/api/admin/dashboard','/api/admin/orders','/api/admin/tariffs','/api/admin/drivers','/api/admin/audit','/api/admin/restaurants','/api/admin/banners']) {
    await api.get(path).expect(401);
    for(const session of [client,driver1])await api.get(path).set(headers(session)).expect(403);
    await api.get(path).set(headers(admin)).expect(200);
  }
  await api.post('/api/admin/auth/login').send({username:'integration-owner',password:'wrong-password'}).expect(401);
  await api.post('/api/admin/auth/login').send({username:'unknown-owner',password:'wrong-password'}).expect(401);
  const phone='+996700999999',code=process.env.DEV_OTP_CODE??'123456';
  await api.post('/api/auth/request-code').send({phone}).expect(401);
  await db.smsChallenge.upsert({where:{phone},create:{phone,codeHash:createHmac('sha256',process.env.OTP_SECRET!).update(`${phone}:${code}`).digest('hex'),expiresAt:new Date(Date.now()+60000)},update:{}});
  await api.post('/api/auth/verify-code').send({phone,code}).expect(401);
  assert.equal(await db.refreshSession.count({where:{userId:admin.user.id,adminAuthenticated:false}}),0);
});

test('in-flight taxi and food requests recheck client role after acquiring the user lock',async()=>{
  const quote=await quoted(client);
  const staleActor={id:client.user.id,role:'CLIENT',sessionId:'stale-request',familyId:'stale-request',expiresAt:9999999999};
  await db.user.update({where:{id:client.user.id},data:{role:'DRIVER'}});
  try {
    await assert.rejects(()=>app.get(OrdersService).create(staleActor,{quoteId:quote.id,idempotencyKey:randomUUID()}),{status:403});
    await assert.rejects(()=>app.get(FoodService).create(staleActor,foodBody()),{status:403});
  } finally {await db.user.update({where:{id:client.user.id},data:{role:'CLIENT'}});}
});

test('admin tariff changes alter new quotes, retain prior fare and broadcast to authorized sockets',async()=>{
  const before=await quoted(client),stored=await db.tariff.findUniqueOrThrow({where:{id:'economy'}});
  const adminSocket=await socket(admin),riderSocket=await socket(client);
  let leaked=0;riderSocket.on('admin:changed',()=>{leaked++;});
  const adminUpdate=once(adminSocket,'admin:changed'),contentUpdate=once(riderSocket,'content:changed');
  const response=await api.patch('/api/admin/tariffs/economy').set(headers(admin)).send({basePrice:stored.basePrice+100,pricePerKm:stored.pricePerKm+10}).expect(200);
  assert.equal(response.body.basePrice,stored.basePrice+100);
  assert.equal((await adminUpdate).resource,'tariffs');assert.equal((await contentUpdate).resource,'tariffs');
  const after=await quoted(client);assert.ok(after.price>before.price);
  assert.equal((await db.quote.findUniqueOrThrow({where:{id:before.id}})).price,before.price);
  await api.patch('/api/admin/tariffs/economy').set(headers(client)).send({pricePerKm:0}).expect(403);
  await api.patch('/api/admin/tariffs/economy').set(headers(admin)).send({pricePerKm:-1}).expect(400);
  await api.patch('/api/admin/tariffs/economy').set(headers(admin)).send({commissionBps:10001}).expect(400);
  await api.patch('/api/admin/tariffs/economy').set(headers(admin)).send({basePrice:stored.basePrice,pricePerKm:stored.pricePerKm}).expect(200);
  assert.equal(leaked,0);
  assert.ok(await db.adminAudit.findFirst({where:{actorId:admin.user.id,action:'tariff.update',entityId:'economy'}}));
  adminSocket.disconnect();riderSocket.disconnect();
});

test('admin registers and edits drivers while protecting active trips and immutable deposit ledger',async()=>{
  const data={phone:'+996700333333',name:'Новый водитель',carMake:'Toyota Prius',carColor:'Серый',carPlate:'01 KG 123 ABC',verified:true};
  const added=(await api.post('/api/admin/drivers').set(headers(admin)).send(data).expect(201)).body;
  assert.equal(added.phone,data.phone);assert.equal(added.verified,true);assert.equal(added.deposit,0);
  await api.post('/api/admin/drivers').set(headers(admin)).send(data).expect(409);
  await api.patch(`/api/admin/drivers/${added.id}`).set(headers(admin)).send({deposit:100000}).expect(400);
  const edited=(await api.patch(`/api/admin/drivers/${added.id}`).set(headers(admin)).send({name:'Имя обновлено',carColor:'Белый'}).expect(200)).body;
  assert.equal(edited.name,'Имя обновлено');assert.equal(edited.carColor,'Белый');
  const found=(await api.get('/api/admin/drivers?search=333333&pageSize=1').set(headers(admin)).expect(200)).body;
  assert.equal(found.total,1);assert.equal(found.items[0].id,added.id);
  await setOnline(driver1);const order=await create();
  await api.post(`/api/orders/${order.id}/accept`).set(headers(driver1)).expect(201);
  await api.patch(`/api/admin/drivers/${driver1.user.id}`).set(headers(admin)).send({verified:false}).expect(409);
  const detail=(await api.get(`/api/admin/orders/taxi/${order.id}`).set(headers(admin)).expect(200)).body;
  assert.equal(detail.client.id,client.user.id);assert.equal(detail.driver.id,driver1.user.id);assert.ok(detail.history.length>=2);
  await api.post(`/api/admin/orders/taxi/${order.id}/cancel`).set(headers(admin)).send({reason:'Отмена по обращению клиента'}).expect(201);
  assert.equal((await db.order.findUniqueOrThrow({where:{id:order.id}})).status,'CANCELLED');
  assert.ok(await db.adminAudit.findFirst({where:{action:'taxi.cancel',entityId:order.id}}));
});

test('admin dashboard and paginated lists include taxi and food records without credentials',async()=>{
  const dashboard=(await api.get('/api/admin/dashboard').set(headers(admin)).expect(200)).body;
  assert.ok(dashboard.metrics.totalDrivers>=3);assert.ok(dashboard.metrics.todayTaxiOrders>0);assert.ok(dashboard.metrics.todayFoodOrders>0);
  assert.ok(dashboard.recentOrders.taxi.length);assert.ok(dashboard.recentOrders.food.length);
  for(const kind of ['taxi','food']) {
    const result=(await api.get(`/api/admin/orders?kind=${kind}&page=1&pageSize=2`).set(headers(admin)).expect(200)).body;
    assert.equal(result.items.length,2);assert.ok(result.total>=2);assert.equal(result.pageSize,2);
    assert.ok(result.items.every((row:any)=>row.kind===kind));
    assert.ok(!JSON.stringify(result).includes('passwordHash'));assert.ok(!JSON.stringify(result).includes('avatarData'));
  }
  await api.get('/api/admin/orders?kind=taxi&pageSize=9999').set(headers(admin)).expect(400);
  await api.get('/api/admin/orders?kind=taxi&status=INVALID').set(headers(admin)).expect(400);
});

test('admin refresh retains password assurance and disabled administrator sessions are rejected',async()=>{
  const refreshed=(await api.post('/api/auth/refresh').send({refreshToken:admin.refreshToken}).expect(201)).body;
  await api.get('/api/admin/me').set(headers(admin)).expect(401);admin=refreshed;
  await api.get('/api/admin/me').set(headers(admin)).expect(200);
  await db.adminCredential.update({where:{userId:admin.user.id},data:{disabled:true}});
  await api.get('/api/admin/dashboard').set(headers(admin)).expect(401);
  await api.post('/api/auth/refresh').send({refreshToken:admin.refreshToken}).expect(401);
  await db.adminCredential.update({where:{userId:admin.user.id},data:{disabled:false}});
});

test('OTP guesses persist, role comes from database, refresh rotates and logout revokes session',async()=>{
  const phone='+996700555555';await api.post('/api/auth/request-code').send({phone}).expect(201);
  for(let i=0;i<5;i++)await api.post('/api/auth/verify-code').send({phone,code:'999999'}).expect(401);
  assert.equal((await db.smsChallenge.findUniqueOrThrow({where:{phone}})).attempts,5);
  await api.post('/api/auth/verify-code').send({phone,code:process.env.DEV_OTP_CODE??'123456'}).expect(401);
  await api.post('/api/auth/request-code').send({phone}).expect(429);
  const refreshed=(await api.post('/api/auth/refresh').send({refreshToken:client2.refreshToken}).expect(201)).body;
  assert.notEqual(refreshed.refreshToken,client2.refreshToken);
  await api.get('/api/users/me').set(headers(client2)).expect(401);
  await api.get('/api/users/me').set(headers(refreshed)).expect(200);
  await api.post('/api/auth/refresh').send({refreshToken:client2.refreshToken}).expect(401);
  await api.get('/api/users/me').set(headers(refreshed)).expect(401);
  await api.post('/api/auth/logout').set(headers(admin)).send({refreshToken:admin.refreshToken}).expect(201);
  await api.get('/api/users/me').set(headers(admin)).expect(401);
});
