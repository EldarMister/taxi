import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { hashAdminPassword } from '../src/admin.security';
import { DEMO_FOOD_RESTAURANTS } from '../src/food-catalog';
const {AppModule}=require('../dist/src/app.module.js');
const {apiValidation,ApiExceptionFilter}=require('../dist/src/http.js');
const db=new PrismaClient();
let app:any,api:ReturnType<typeof request>,baseUrl:string,adminToken:string,clientToken:string,clientId:string,imageUrl:string;
const restaurantId=`catalog-test-${randomUUID()}`;
const restaurant=structuredClone(DEMO_FOOD_RESTAURANTS[0]);restaurant.id=restaurantId;restaurant.isDemo=false;
const sockets:Socket[]=[];
const headers=(token:string)=>({Authorization:`Bearer ${token}`});
async function socket(token:string) {
  const connection=io(baseUrl,{auth:{token},transports:['websocket'],reconnection:false});sockets.push(connection);
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('socket timeout')),5000);connection.once('session:ready',()=>{clearTimeout(timer);resolve();});connection.once('connect_error',error=>{clearTimeout(timer);reject(error);});});
  return connection;
}
function once(connection:Socket,event:string) {
  return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),5000);connection.once(event,value=>{clearTimeout(timer);resolve(value);});});
}
before(async()=>{
  const url=new URL(process.env.DATABASE_URL??'http://invalid');
  if(process.env.TEST_DATABASE_RESET!=='true'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/taxi_test')throw new Error('Use the disposable local taxi_test database and TEST_DATABASE_RESET=true');
  // This file runs serially after the taxi suite against the explicitly disposable local database.
  await db.banner.deleteMany();
  const suffix=randomUUID().replace(/\D/g,'').padEnd(8,'0').slice(0,8),password=`catalog-test-${randomUUID()}`;
  const admin=await db.user.create({data:{phone:`+9969${suffix}`,name:'Catalog integration admin',role:'ADMIN',adminCredential:{create:{username:`catalog-${randomUUID()}`,passwordHash:await hashAdminPassword(password)}}},include:{adminCredential:true}});
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalPipes(apiValidation());app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0,'127.0.0.1');baseUrl=await app.getUrl();api=request(app.getHttpServer());
  adminToken=(await api.post('/api/admin/auth/login').send({username:admin.adminCredential!.username,password}).expect(201)).body.accessToken;
  const phone=`+9968${suffix}`;
  await api.post('/api/auth/request-code').send({phone}).expect(201);
  const client=(await api.post('/api/auth/verify-code').send({phone,code:process.env.DEV_OTP_CODE??'123456'}).expect(201)).body;
  clientToken=client.accessToken;clientId=client.user.id;
});
after(async()=>{for(const connection of sockets)connection.disconnect();await app?.close();await db.$disconnect();});

test('content administration requires ADMIN and rejects unknown/malformed input',async()=>{
  await api.get('/api/admin/restaurants').expect(401);
  await api.get('/api/admin/restaurants').set(headers(clientToken)).expect(403);
  await api.post('/api/admin/banners').set(headers(clientToken)).send({title:'Unauthorized'}).expect(403);
  await api.post('/api/admin/media').set(headers(clientToken)).expect(403);
  await api.post('/api/admin/restaurants').set(headers(adminToken)).send({catalog:restaurant,ownerRole:'ADMIN'}).expect(400);
  await api.post('/api/admin/restaurants').set(headers(adminToken)).send({id:restaurantId,catalog:{...restaurant,dishes:[{...restaurant.dishes[0],price:-1}]}}).expect(400);
});
test('media upload stores normalized bytes durably and serves public cross-origin images',async()=>{
  const bytes=await sharp({create:{width:2200,height:1100,channels:3,background:'#a4d8b4'}}).png().withMetadata().toBuffer();
  await api.post('/api/admin/media').set(headers(adminToken)).attach('image',bytes,{filename:'wrong.jpg',contentType:'image/jpeg'}).expect(400);
  await api.post('/api/admin/media').set(headers(adminToken)).attach('image',Buffer.from('<svg><script>alert(1)</script></svg>'),{filename:'active.svg',contentType:'image/svg+xml'}).expect(400);
  const uploaded=await api.post('/api/admin/media').set(headers(adminToken)).attach('image',bytes,{filename:'restaurant.png',contentType:'image/png'}).expect(201);
  imageUrl=uploaded.body.url;assert.match(imageUrl,/^\/api\/content\/media\/[0-9a-f-]{36}$/);
  const media=await api.get(imageUrl).expect(200).expect('Content-Type',/image\/webp/).expect('Cross-Origin-Resource-Policy','cross-origin');
  const stored=await db.mediaAsset.findUniqueOrThrow({where:{id:imageUrl.split('/').at(-1)}});
  assert.deepEqual(media.body,Buffer.from(stored.data));assert.equal(stored.width,2000);assert.equal(stored.height,1000);
  assert.equal((await sharp(media.body).metadata()).exif,undefined);
  await api.get(imageUrl).set('If-None-Match',media.headers.etag).expect(304);
});
test('restaurant changes persist complete menus, images, references, availability and realtime updates',async()=>{
  const live=await socket(clientToken),event=once(live,'content:changed');
  restaurant.imageUrl=imageUrl;restaurant.dishes[0].imageUrl=imageUrl;restaurant.options[0].imageUrl=imageUrl;
  const created=await api.post('/api/admin/restaurants').set(headers(adminToken)).send({id:restaurantId,catalog:restaurant,active:true,isDemo:false,sortOrder:12}).expect(201);
  assert.equal(created.body.catalog.dishes[0].imageUrl,imageUrl);assert.equal((await event).resource,'restaurants');
  const catalog=(await api.get('/api/food/catalog').expect(200)).body.restaurants.find((r:{id:string})=>r.id===restaurantId);
  assert.equal(catalog.name,restaurant.name);assert.equal(catalog.imageUrl,imageUrl);assert.equal(catalog.isDemo,false);
  const invalid=structuredClone(restaurant);invalid.dishes[0].optionIds=['missing'];
  await api.patch(`/api/admin/restaurants/${restaurantId}`).set(headers(adminToken)).send({catalog:invalid}).expect(400);
  assert.equal((await db.foodRestaurant.findUniqueOrThrow({where:{id:restaurantId}})).active,true);
});
test('concurrent banner activation admits only three, permits partial edits and retains ordering',async()=>{
  const results=await Promise.all(Array.from({length:8},(_,index)=>api.post('/api/admin/banners').set(headers(adminToken)).send({title:`Баннер ${index}`,subtitle:'Тест',imageUrl,actionType:'RESTAURANT',restaurantId,active:true,sortOrder:index})));
  assert.equal(results.filter(r=>r.status===201).length,3,results.map(r=>`${r.status}:${JSON.stringify(r.body)}`).join('\n'));
  assert.equal(results.filter(r=>r.status===409).length,5);
  assert.equal(await db.banner.count({where:{active:true}}),3);
  const first=results.find(r=>r.status===201)!.body;
  const patched=await api.patch(`/api/admin/banners/${first.id}`).set(headers(adminToken)).send({title:'Новое название'}).expect(200);
  assert.equal(patched.body.active,true);assert.equal(patched.body.imageUrl,imageUrl);assert.equal(patched.body.actionType,'RESTAURANT');
  const publicBanners=(await api.get('/api/content/banners').expect(200)).body.banners;
  assert.equal(publicBanners.length,3);assert.deepEqual(publicBanners.map((b:any)=>b.sortOrder),publicBanners.map((b:any)=>b.sortOrder).sort((a:number,b:number)=>a-b));
  const draft=await api.post('/api/admin/banners').set(headers(adminToken)).send({title:'Черновик',active:false}).expect(201);
  await api.patch(`/api/admin/banners/${draft.body.id}`).set(headers(adminToken)).send({active:true}).expect(409);
  await api.delete(`/api/admin/banners/${first.id}`).set(headers(adminToken)).expect(200);
  await api.patch(`/api/admin/banners/${draft.body.id}`).set(headers(adminToken)).send({active:true}).expect(200);
  assert.equal(await db.banner.count({where:{active:true}}),3);
});
test('food orders snapshot menu prices/photos and survive menu replacement and restaurant archive',async()=>{
  const customer=await socket(clientToken),admin=await socket(adminToken),placedEvent=once(customer,'food:order:updated'),adminEvent=once(admin,'admin:changed');
  const body={requestId:randomUUID(),restaurantId,items:[{dishId:'philadelphia',quantity:2,optionIds:['soy']}],fulfillment:'DELIVERY',address:'ул. Тестовая, 15',paymentMethod:'CASH'};
  const placed=(await api.post('/api/food/orders').set(headers(clientToken)).send(body).expect(201)).body;
  assert.equal((await placedEvent).id,placed.id);assert.equal((await adminEvent).resource,'food-orders');
  assert.equal(placed.total,1040);assert.equal(placed.restaurant.imageUrl,imageUrl);assert.equal(placed.items[0].imageUrl,imageUrl);
  const updated=structuredClone(restaurant);updated.name='Обновлённый ресторан';updated.dishes[0].price=900;updated.options[0].price=50;updated.dishes[0].imageUrl='https://images.example.org/new.webp';
  await api.patch(`/api/admin/restaurants/${restaurantId}`).set(headers(adminToken)).send({catalog:updated}).expect(200);
  const current=(await api.get(`/api/food/orders/${placed.id}`).set(headers(clientToken)).expect(200)).body;
  assert.equal(current.total,1040);assert.equal(current.restaurant.name,restaurant.name);assert.equal(current.items[0].unitPrice,520);assert.equal(current.items[0].imageUrl,imageUrl);assert.equal(current.items[0].options[0].price,0);
  const retry=(await api.post('/api/food/orders').set(headers(clientToken)).send(body).expect(201)).body;assert.equal(retry.id,placed.id);assert.equal(retry.total,1040);
  const confirmedEvent=once(customer,'food:order:updated');
  await api.patch(`/api/admin/food/orders/${placed.id}/status`).set(headers(adminToken)).send({status:'CONFIRMED'}).expect(200);assert.equal((await confirmedEvent).status,'CONFIRMED');
  await api.delete(`/api/admin/restaurants/${restaurantId}`).set(headers(adminToken)).expect(200);
  const history=(await api.get('/api/food/orders/history?period=all').set(headers(clientToken)).expect(200)).body;
  assert.ok(history.some((order:any)=>order.id===placed.id));assert.ok(!(await api.get('/api/food/catalog').expect(200)).body.restaurants.some((r:any)=>r.id===restaurantId));
  await api.post(`/api/food/orders/${placed.id}/cancel`).set(headers(clientToken)).expect(201);
  await api.post('/api/food/orders').set(headers(clientToken)).send({...body,requestId:randomUUID()}).expect(404);
  assert.equal(await db.foodOrder.count({where:{clientId}}),1);
  assert.ok(await db.adminAudit.count({where:{entityId:restaurantId}})>=3);
  assert.equal(await db.adminAudit.count({where:{entityId:placed.id,action:'food-order.status'}}),1);
});
