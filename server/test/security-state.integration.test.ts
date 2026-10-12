import 'reflect-metadata';
import { requireTestDatabase } from './test-database';
requireTestDatabase();
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient, type OrderStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DEMO_FOOD_RESTAURANTS, type FoodRestaurant } from '../src/food-catalog';

const {AppModule}=require('../dist/src/app.module.js');
const {ApiExceptionFilter,apiValidation}=require('../dist/src/http.js');
const {PrismaService}=require('../dist/src/prisma.service.js');
const {AuthService}=require('../dist/src/auth.js');
const {OrdersService}=require('../dist/src/orders.js');
const {FoodService}=require('../dist/src/food.js');
const {TaxiGateway}=require('../dist/src/gateway.js');
const {RealtimeEvents}=require('../dist/src/events.js');
const {BackgroundJobs}=require('../dist/src/jobs.js');
const {OrderOutboxWorker}=require('../dist/src/order-outbox.js');
const {JwtService}=require('@nestjs/jwt');
const db=new PrismaClient();
const suffix=randomUUID().replace(/\D/g,'').padEnd(9,'0').slice(0,9);
const phones=[`+996${suffix}`,`+995${suffix}`,`+994${suffix}`];
const restaurantId=`state-restaurant-${randomUUID()}`,tariffId=`state-tariff-${randomUUID()}`;
const orderIds:string[]=[],quoteIds:string[]=[],foodIds:string[]=[];
const sockets:Socket[]=[];
let app:any,api:ReturnType<typeof request>,prisma:any,orders:any,food:any,events:any,baseUrl:string;
let client:any,driver:any,nextDriver:any,clientActor:any,driverActor:any,clientToken:string,driverToken:string;
let catalog:FoodRestaurant;
const headers=(token:string)=>({Authorization:`Bearer ${token}`});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const point={latitude:42.87,longitude:74.60,address:'Synthetic address'};
const geometry=[[74.60,42.87],[74.61,42.88]];
function event(socket:Socket,name:string) {
  return new Promise<any>((resolve,reject)=>{const done=(data:any)=>{clearTimeout(timer);resolve(data);};const timer=setTimeout(()=>{socket.off(name,done);reject(new Error(`Timed out waiting for ${name}`));},5000);socket.once(name,done);});
}
async function session(user:any) {
  const familyId=randomUUID(),row=await db.refreshSession.create({data:{userId:user.id,familyId,tokenHash:hash(randomUUID()),expiresAt:new Date(Date.now()+600000)}});
  const actor={id:user.id,role:user.role,sessionId:row.id,familyId,expiresAt:Math.floor(Date.now()/1000)+600};
  const token=await app.get(JwtService).signAsync({sub:user.id,sid:row.id,fid:familyId},{secret:process.env.JWT_SECRET,issuer:'taxi-api',audience:'taxi-mobile',expiresIn:600});
  return {actor,token};
}
async function createOrder(status:OrderStatus,driverId:string|null=driver.id,extra:Record<string,any>={}) {
  const quote=await db.quote.create({data:{userId:client.id,tariffId,pickup:point,dropoff:point,geometry,distanceMeters:1000,durationSeconds:300,price:100,commission:10,routeProvider:'synthetic',expiresAt:new Date(Date.now()+600000)}});quoteIds.push(quote.id);
  const row=await db.order.create({data:{clientId:client.id,driverId,quoteId:quote.id,idempotencyKey:randomUUID(),status,pickup:point,dropoff:point,geometry,distanceMeters:1000,durationSeconds:300,price:100,commission:10,searchExpiresAt:new Date(Date.now()+600000),...extra}});orderIds.push(row.id);return row;
}
const worker=()=>new OrderOutboxWorker(prisma,orders,food,events);
const pending=(id:string)=>db.orderEventOutbox.findMany({where:{aggregateId:id,deliveredAt:null}});
async function flushPending(id:string) {
  await db.orderEventOutbox.updateMany({where:{aggregateId:id,deliveredAt:null},data:{availableAt:new Date(0)}});
  return worker().flush(1000);
}
async function connect(token:string) {
  const socket=io(baseUrl,{auth:{token},autoConnect:false,reconnection:false,transports:['websocket']});sockets.push(socket);
  const ready=event(socket,'session:ready');socket.connect();assert.equal((await ready).resyncRequired,true);return socket;
}
const body=(items:unknown[],changes:Record<string,unknown>={})=>({requestId:randomUUID(),restaurantId,items,fulfillment:'PICKUP',paymentMethod:'CASH',...changes});
const item=(options=['choice-a'])=>({dishId:'v2-dish',quantity:2,optionIds:options});

before(async()=>{
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(BackgroundJobs).useValue({}).overrideProvider(OrderOutboxWorker).useValue({}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalPipes(apiValidation());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
  baseUrl=await app.getUrl();api=request(app.getHttpServer());prisma=app.get(PrismaService);orders=app.get(OrdersService);food=app.get(FoodService);events=app.get(RealtimeEvents);
  client=await db.user.create({data:{phone:phones[0],role:'CLIENT',name:'Synthetic client'}});
  for(const [index,phone] of phones.slice(1).entries()) {
    const row=await db.user.create({data:{phone,role:'DRIVER',name:'Synthetic driver',driverProfile:{create:{verified:true,online:true,deposit:1000,acceptsEconomy:true,vehicle:{create:{make:'Synthetic',color:'Synthetic',plate:`synthetic-${suffix}-${index}`}}}}}});
    if(index===0)driver=row;else nextDriver=row;
  }
  ({actor:clientActor,token:clientToken}=await session(client));({actor:driverActor,token:driverToken}=await session(driver));
  await db.tariff.create({data:{id:tariffId,name:'Synthetic',description:'Synthetic',basePrice:100,pricePerKm:0,pricePerMinute:0,minimumPrice:100,commissionBps:1000}});
  catalog=structuredClone(DEMO_FOOD_RESTAURANTS[0]);catalog.id=restaurantId;catalog.minimumOrder=0;catalog.deliveryFee=40;catalog.discountPercent=0;catalog.promotions=[];catalog.isOpen=true;
  const base=catalog.dishes[0];
  catalog.options=[{id:'choice-a',name:'A',price:30,imageKey:'soy',priceScope:'PER_ITEM'},{id:'choice-b',name:'B',price:50,imageKey:'soy',priceScope:'PER_PORTION'}];
  catalog.dishes=[{...base,id:'v2-dish',price:100,optionIds:['choice-a','choice-b'],optionGroups:[{id:'required',name:'Choice',optionIds:['choice-a','choice-b'],minSelected:1,maxSelected:1}],defaultOptionIds:['choice-a']},{...base,id:'legacy-safe',price:80,optionIds:[]}];
  delete catalog.dishes[1].optionGroups;delete catalog.dishes[1].defaultOptionIds;
  await db.foodRestaurant.create({data:{id:restaurantId,catalog:catalog as any,isDemo:true,active:true}});
});
after(async()=>{
  for(const socket of sockets)socket.disconnect();await app?.close();
  await db.orderEventOutbox.deleteMany({where:{aggregateId:{in:[...orderIds,...foodIds]}}});
  await db.pushJob.deleteMany({where:{orderId:{in:orderIds}}});await db.orderOffer.deleteMany({where:{orderId:{in:orderIds}}});await db.ledgerEntry.deleteMany({where:{orderId:{in:orderIds}}});
  await db.statusHistory.deleteMany({where:{orderId:{in:orderIds}}});await db.rating.deleteMany({where:{orderId:{in:orderIds}}});await db.clientRating.deleteMany({where:{orderId:{in:orderIds}}});await db.order.deleteMany({where:{id:{in:orderIds}}});await db.quote.deleteMany({where:{id:{in:quoteIds}}});
  await db.foodStatusHistory.deleteMany({where:{orderId:{in:foodIds}}});await db.foodOrder.deleteMany({where:{id:{in:foodIds}}});await db.foodRestaurant.deleteMany({where:{id:restaurantId}});await db.tariff.deleteMany({where:{id:tariffId}});
  const users=[client?.id,driver?.id,nextDriver?.id].filter(Boolean);
  await db.refreshSession.deleteMany({where:{userId:{in:users}}});await db.vehicle.deleteMany({where:{driverId:{in:users}}});await db.driverProfile.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
});

test('DB commit survives failed immediate publish; durable retry/new worker sends latest state without applying commission twice',async()=>{
  const row=await createOrder('IN_PROGRESS',driver.id,{history:{create:{status:'IN_PROGRESS',actorId:driver.id,createdAt:new Date(Date.now()-300000)}}});
  await db.orderEventOutbox.updateMany({where:{aggregateId:row.id},data:{deliveredAt:new Date()}});
  const publish=orders.publish;orders.publish=async()=>{throw new ServiceUnavailableException('Synthetic failure after commit');};
  try{await api.post(`/api/orders/${row.id}/complete`).set(headers(driverToken)).send({}).expect(503);}finally{orders.publish=publish;}
  assert.equal((await db.order.findUniqueOrThrow({where:{id:row.id}})).status,'COMPLETED');assert.equal(await db.ledgerEntry.count({where:{orderId:row.id,kind:'COMMISSION'}}),1);
  assert.equal((await db.driverProfile.findUniqueOrThrow({where:{userId:driver.id}})).deposit,990);assert.ok((await pending(row.id)).length>0);
  const received:any[]=[],fail=(message:any)=>{if(message.name==='order:updated'&&message.payload.id===row.id)throw new Error('Synthetic listener unavailable');};events.on('event',fail);
  try{await worker().flush(1000);}finally{events.off('event',fail);}
  const deferred=await pending(row.id);assert.ok(deferred.some(message=>message.attempts===1));
  await db.order.update({where:{id:row.id},data:{price:105}});
  const capture=(message:any)=>{if(message.name==='order:updated'&&message.payload.id===row.id)received.push(message);};events.on('event',capture);
  try{await flushPending(row.id);await flushPending(row.id);}finally{events.off('event',capture);}
  assert.ok(received.length>0);assert.equal(received.every(message=>message.payload.price===105&&message.payload.status==='COMPLETED'),true);assert.equal((await pending(row.id)).length,0);
  await api.post(`/api/orders/${row.id}/complete`).set(headers(driverToken)).send({}).expect(201);
  assert.equal(await db.ledgerEntry.count({where:{orderId:row.id}}),1);assert.equal(await db.statusHistory.count({where:{orderId:row.id,status:'COMPLETED'}}),1);assert.equal((await db.driverProfile.findUniqueOrThrow({where:{userId:driver.id}})).deposit,990);
});

test('reassignment replay sends previous driver only withdrawal, with no current client/order snapshot access',async()=>{
  const row=await createOrder('ASSIGNED');await db.orderEventOutbox.updateMany({where:{aggregateId:row.id},data:{deliveredAt:new Date()}});
  await db.order.update({where:{id:row.id},data:{driverId:nextDriver.id,history:{create:{status:'ASSIGNED',actorId:nextDriver.id}}}});
  const messages:any[]=[],capture=(message:any)=>{if(message.payload?.id===row.id||message.payload?.orderId===row.id)messages.push(message);};events.on('event',capture);
  try{await flushPending(row.id);}finally{events.off('event',capture);}
  const old=messages.filter(message=>message.userIds.includes(driver.id));assert.ok(old.length>0);assert.equal(old.every(message=>message.name==='order:withdrawn'),true);assert.deepEqual(old[0].payload,{orderId:row.id});
  assert.equal(messages.some(message=>message.name==='order:updated'&&message.userIds.includes(nextDriver.id)&&message.userIds.includes(client.id)),true);
  await api.get(`/api/orders/${row.id}`).set(headers(driverToken)).expect(403);
  await db.order.update({where:{id:row.id},data:{status:'CANCELLED'}});await flushPending(row.id);
});

test('offer outbox survives the enqueue/disconnect window; reconnect reads canonical offer and duplicate accept remains one assignment',async()=>{
  const row=await createOrder('SEARCHING',null);await db.orderEventOutbox.updateMany({where:{aggregateId:row.id},data:{deliveredAt:new Date()}});
  const socket=await connect(driverToken),serverSocket=app.get(TaxiGateway).server.sockets.sockets.get(socket.id);assert.ok(serverSocket);
  const disconnected=event(socket,'disconnect'),emit=serverSocket.emit;let enqueued=false;
  serverSocket.emit=function(name:string,...args:unknown[]){const result=emit.call(this,name,...args);if(name==='order:offer'){enqueued=true;this.disconnect(true);}return result;};
  await db.orderOffer.create({data:{orderId:row.id,driverId:driver.id,expiresAt:new Date(Date.now()+600000)}});assert.ok((await pending(row.id)).length>0,'offer insert must create durable wakeup');
  await flushPending(row.id);await disconnected;assert.equal(enqueued,true);assert.equal((await pending(row.id)).length,0);
  const recovered=await connect(driverToken);
  const offers=(await api.get('/api/driver/offers').set(headers(driverToken)).expect(200)).body;const offer=offers.find((value:any)=>value.id===row.id);assert.ok(offer);assert.equal(offer.client,undefined);assert.equal(offer.driverLocation,null);
  await api.post(`/api/orders/${row.id}/accept`).set(headers(driverToken)).send({}).expect(201);await api.post(`/api/orders/${row.id}/accept`).set(headers(driverToken)).send({}).expect(201);
  assert.equal(await db.statusHistory.count({where:{orderId:row.id,status:'ASSIGNED'}}),1);assert.equal((await db.order.findUniqueOrThrow({where:{id:row.id}})).driverId,driver.id);
  await api.post(`/api/orders/${row.id}/cancel`).set(headers(driverToken)).send({}).expect(201);recovered.disconnect();await flushPending(row.id);
});

test('legacy/v2 catalog representations have distinct cache validators and cannot return the other representation as 304',async()=>{
  const legacy=await api.get('/api/food/catalog').expect(200),v2=await api.get('/api/food/catalog').set('X-Atlas-Capabilities','food-modifiers-v2').expect(200);
  assert.match(legacy.headers.vary,/X-Atlas-Capabilities/i);assert.match(v2.headers.vary,/X-Atlas-Capabilities/i);assert.notEqual(legacy.headers.etag,v2.headers.etag);
  assert.deepEqual(legacy.body.restaurants.find((value:any)=>value.id===restaurantId).dishes.map((dish:any)=>dish.id),['legacy-safe']);assert.equal(v2.body.restaurants.find((value:any)=>value.id===restaurantId).dishes.length,2);
  await api.get('/api/food/catalog').set('If-None-Match',legacy.headers.etag).expect(304);await api.get('/api/food/catalog').set('X-Atlas-Capabilities','food-modifiers-v2').set('If-None-Match',legacy.headers.etag).expect(200);
  await api.get('/api/food/catalog').set('If-None-Match',v2.headers.etag).expect(200);await api.get('/api/food/catalog').set('X-Atlas-Capabilities','food-modifiers-v2').set('If-None-Match',v2.headers.etag).expect(304);
});

test('forged capabilities never bypass stored modifier rules, prices or availability; duplicate food request creates one order',async()=>{
  for(const capability of ['food-modifiers-v2','forged-super-admin']) {
    for(const options of [[],['choice-a','choice-b'],['foreign-option']])await api.post('/api/food/orders').set(headers(clientToken)).set('X-Atlas-Capabilities',capability).send(body([item(options)])).expect(400);
  }
  await api.post('/api/food/orders').set(headers(clientToken)).send(body([{dishId:'legacy-safe',quantity:1,optionIds:['choice-a']}])).expect(400);
  await api.post('/api/food/orders').set(headers(clientToken)).send(body([item()],{total:1})).expect(400);await api.post('/api/food/orders').set(headers(clientToken)).send(body([{...item(),unitPrice:1}])).expect(400);
  for(const changed of [{...catalog,minimumOrder:300},{...catalog,isOpen:false},{...catalog,dishes:catalog.dishes.map(dish=>({...dish,available:false}))}]) {
    await db.foodRestaurant.update({where:{id:restaurantId},data:{catalog:changed as any}});await api.post('/api/food/orders').set(headers(clientToken)).set('X-Atlas-Capabilities','food-modifiers-v2').send(body([item()])).expect(400);
  }
  await db.foodRestaurant.update({where:{id:restaurantId},data:{catalog:catalog as any,active:false}});await api.post('/api/food/orders').set(headers(clientToken)).send(body([item()])).expect(404);await db.foodRestaurant.update({where:{id:restaurantId},data:{active:true}});
  const submitted=body([item()]);const first=(await api.post('/api/food/orders').set(headers(clientToken)).set('X-Atlas-Capabilities','forged-super-admin').send(submitted).expect(201)).body;foodIds.push(first.id);
  assert.equal(first.total,230);assert.equal(first.items[0].unitPrice,100);assert.equal(first.items[0].lineTotal,230);
  const second=(await api.post('/api/food/orders').set(headers(clientToken)).set('X-Atlas-Capabilities','food-modifiers-v2').send(submitted).expect(201)).body;assert.equal(second.id,first.id);
  food.changed(await db.foodOrder.findUniqueOrThrow({where:{id:first.id}}));food.changed(await db.foodOrder.findUniqueOrThrow({where:{id:first.id}}));
  assert.equal(await db.foodOrder.count({where:{clientId:client.id,requestId:submitted.requestId}}),1);assert.equal(await db.foodStatusHistory.count({where:{orderId:first.id}}),1);
});

test('real PostgreSQL bulk history equals direct serialization and keeps SQL count constant for 1 versus 20 orders',async()=>{
  const perfDb=new PrismaClient({log:[{level:'query',emit:'event'}]});let queries=0;perfDb.$on('query',()=>{queries++;});
  const perfAuth=new AuthService(perfDb,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any),service=new OrdersService(perfDb,{} as any,{} as any,perfAuth,{} as any,{} as any);
  const from='2026-10-01T00:00:00Z',to='2026-10-02T00:00:00Z';const counts:number[]=[],directCounts:number[]=[],selected:any[]=[];
  try {
    for(let index=0;index<20;index++) {
      const started=new Date(Date.parse(from)+index*60000),completed=new Date(started.getTime()+300000);
      const row=await createOrder('COMPLETED',driver.id,{createdAt:started,completedAt:completed,passengerName:index%5===0?'Synthetic passenger':null,passengerPhone:index%5===0?'+996999000000':null,history:{create:[{status:'ASSIGNED',actorId:driver.id,createdAt:started},{status:'IN_PROGRESS',actorId:driver.id,createdAt:started}]}});selected.push(row);
      await db.ledgerEntry.create({data:{driverId:driver.id,orderId:row.id,kind:'COMMISSION',amount:-10,balanceAfter:990,idempotencyKey:`test-history:${row.id}`,note:'Synthetic history fixture'}});
      if(index===0||index===19) {
        queries=0;const actual=await service.history(driverActor,'all',from,to);counts.push(queries);
        assert.equal(actual.length,index+1);assert.ok(queries<=20,`Bulk history unexpectedly ran ${queries} SQL queries`);
        queries=0;
        const expected=await Promise.all([...selected].reverse().map(async order=>({...await service.serialize(order.id,false,driver.id),commissionAmount:-10})));
        directCounts.push(queries);
        assert.deepEqual(actual,expected);
      }
    }
    assert.equal(counts[0],counts[1],`SQL reads must be independent of repeated order count: ${counts.join(',')}`);
    assert.ok(directCounts[1]>counts[1]);
    console.info(`SQL query evidence: bulk(1,20)=${counts.join(',')}; direct(1,20)=${directCounts.join(',')}`);
  }finally{await perfDb.$disconnect();}
});
