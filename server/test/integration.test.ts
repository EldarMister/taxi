import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
// Load TypeScript-compiled Nest modules: tsx intentionally does not emit decorator metadata.
const {AppModule}=require('../dist/src/app.module.js');
const {apiValidation,ApiExceptionFilter}=require('../dist/src/http.js');
const {OrdersService}=require('../dist/src/orders.js');
const db=new PrismaClient();
let app:any,api:ReturnType<typeof request>,baseUrl:string;
type Session={accessToken:string;refreshToken:string;user:{id:string;role:string}};
let client:Session,client2:Session,driver1:Session,driver2:Session,admin:Session;
const sockets:Socket[]=[];
const headers=(session:Session)=>({Authorization:`Bearer ${session.accessToken}`});
const pickup={latitude:42.8756,longitude:74.6040,address:'Площадь Ала-Тоо'};
const dropoff={latitude:42.8528,longitude:74.5840,address:'Парк Ататюрк'};
async function login(phone:string) {
  await api.post('/api/auth/request-code').send({phone}).expect(201);
  const response=await api.post('/api/auth/verify-code').send({phone,code:process.env.DEV_OTP_CODE??'123456'}).expect(201);
  return response.body as Session;
}
async function quoted(session:Session) {
  return (await api.post('/api/orders/quote').set(headers(session)).send({pickup,dropoff,tariffId:'economy'}).expect(201)).body;
}
async function create(session=client) {
  const quote=await quoted(session);
  return (await api.post('/api/orders').set(headers(session)).send({quoteId:quote.id,idempotencyKey:randomUUID()}).expect(201)).body;
}
async function setOnline(session:Session, online=true) {
  await api.patch('/api/driver/online').set(headers(session)).send({online}).expect(200);
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
  await db.$executeRawUnsafe('TRUNCATE TABLE "PushJob", "PushToken", "RateLimit", "SmsChallenge", "RefreshSession", "Rating", "Message", "StatusHistory", "OrderOffer", "LedgerEntry", "Order", "Quote", "Vehicle", "DriverProfile", "Tariff", "User" CASCADE');
  await db.tariff.create({data:{id:'economy',name:'Эконом',description:'Тестовый тариф',basePrice:60,pricePerKm:14,pricePerMinute:2,minimumPrice:100,commissionBps:1000}});
  for(const [phone,role] of [['+996700123456','CLIENT'],['+996700123457','CLIENT'],['+996700111111','DRIVER'],['+996700222222','DRIVER'],['+996700999999','ADMIN']] as const) {
    const user=await db.user.create({data:{phone,role,name:role}});
    if(role==='DRIVER')await db.driverProfile.create({data:{userId:user.id,verified:true,deposit:1000,vehicle:{create:{make:'Toyota',color:'Белый',plate:phone}}}});
  }
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalPipes(apiValidation());app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0,'127.0.0.1');baseUrl=await app.getUrl();api=request(app.getHttpServer());
  client=await login('+996700123456');client2=await login('+996700123457');driver1=await login('+996700111111');driver2=await login('+996700222222');admin=await login('+996700999999');
  await setOnline(driver1);await setOnline(driver2);
});
after(async()=>{for(const connection of sockets)connection.disconnect();await app?.close();await db.$disconnect();});

test('DTOs reject client price, role escalation and malformed nested route',async()=>{
  await api.patch('/api/users/me').set(headers(client)).send({role:'ADMIN'}).expect(400);
  await api.post('/api/orders/quote').set(headers(client)).send({tariffId:'economy'}).expect(400);
  await api.post('/api/orders/quote').set(headers(client)).send({pickup,dropoff,tariffId:'economy',price:1}).expect(400);
  await api.get('/api/driver/balance').set(headers(client)).expect(403);
  await api.post(`/api/admin/drivers/${driver1.user.id}/topup`).set(headers(client)).send({amount:100,idempotencyKey:randomUUID(),note:'test'}).expect(403);
});
test('concurrent creation and competing acceptances produce one active order and driver',async()=>{
  const quote=await quoted(client);const idempotencyKey=randomUUID();
  const requests=await Promise.all(Array.from({length:5},()=>api.post('/api/orders').set(headers(client)).send({quoteId:quote.id,idempotencyKey})));
  requests.forEach(response=>assert.equal(response.status,201));
  assert.equal(new Set(requests.map(response=>response.body.id)).size,1);
  const order=requests[0].body;
  const secondQuote=await quoted(client);
  await api.post('/api/orders').set(headers(client)).send({quoteId:secondQuote.id,idempotencyKey:randomUUID()}).expect(409);
  const offers=(await api.get('/api/driver/offers').set(headers(driver1)).expect(200)).body;
  assert.equal(offers[0].id,order.id);assert.equal(offers[0].client,undefined);
  const accepted=await Promise.all([driver1,driver2].map(driver=>api.post(`/api/orders/${order.id}/accept`).set(headers(driver))));
  assert.deepEqual(accepted.map(response=>response.status).sort(),[201,409]);
  const acceptedOrder=accepted.find(response=>response.status===201)!.body;
  assert.equal(acceptedOrder.price,quote.price);
  const winner=accepted[0].status===201?driver1:driver2;
  assert.equal((await db.order.findUniqueOrThrow({where:{id:order.id}})).driverId,winner.user.id);
  await api.get(`/api/orders/${order.id}`).set(headers(client2)).expect(403);
  await api.get(`/api/orders/${order.id}/messages`).set(headers(client2)).expect(403);
  await api.post(`/api/orders/${order.id}/cancel`).set(headers(client)).expect(201);
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
  const comingEvent=once(driverSocket,'rider:coming');await api.post(`/api/orders/${order.id}/coming`).set(headers(client)).expect(201);
  assert.equal((await comingEvent).orderId,order.id);
  assert.equal((await api.get('/api/orders/active').set(headers(client))).body.status,'ARRIVED');
  const chatId=randomUUID();const messageEvent=once(driverSocket,'chat:message');
  await api.post(`/api/orders/${order.id}/messages`).set(headers(client)).send({text:'Сейчас выйду',clientMessageId:chatId}).expect(201);
  assert.equal((await messageEvent).text,'Сейчас выйду');
  await api.post(`/api/orders/${order.id}/messages`).set(headers(client)).send({text:'Сейчас выйду',clientMessageId:chatId}).expect(201);
  assert.equal(await db.message.count({where:{orderId:order.id}}),1);
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
  await api.post(`/api/orders/${order.id}/rating`).set(headers(client)).send({score:5}).expect(201);
  await api.post(`/api/orders/${order.id}/rating`).set(headers(client)).send({score:5}).expect(201);
  await api.post(`/api/orders/${order.id}/rating`).set(headers(client)).send({score:6}).expect(400);
  assert.equal(await db.rating.count({where:{orderId:order.id}}),1);
  assert.equal((await api.get('/api/orders/active').set(headers(client))).body,null);
  reconnected.disconnect();driverSocket.disconnect();otherSocket.disconnect();
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
