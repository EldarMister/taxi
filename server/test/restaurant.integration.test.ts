import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hashAdminPassword } from '../src/admin.security';
import { DEMO_FOOD_RESTAURANTS } from '../src/food-catalog';
const {AppModule}=require('../dist/src/app.module.js');
const {apiValidation,ApiExceptionFilter}=require('../dist/src/http.js');
const db=new PrismaClient();
const suffix=randomUUID().replace(/\D/g,'').padEnd(9,'0').slice(0,9);
const ids=[`restaurant-access-${randomUUID()}`,`restaurant-access-${randomUUID()}`];
const password=`restaurant-test-${randomUUID()}`;
let app:any,api:ReturnType<typeof request>,adminToken:string,ownerToken:string,ownerRefresh:string,ownerId:string,managerToken:string,managerId:string,adminId:string;
const auth=(token:string)=>({Authorization:`Bearer ${token}`});
before(async()=>{
  const url=new URL(process.env.DATABASE_URL??'http://invalid');
  if(process.env.TEST_DATABASE_RESET!=='true'||url.hostname!=='127.0.0.1'||url.pathname!=='/taxi_test')throw new Error('Requires disposable localhost taxi_test database');
  for(const id of ids){const catalog=structuredClone(DEMO_FOOD_RESTAURANTS[0]);catalog.id=id;await db.foodRestaurant.create({data:{id,catalog:catalog as any,active:true,isDemo:true}});}
  const admin=await db.user.create({data:{phone:`+997${suffix}`,role:'ADMIN',adminCredential:{create:{username:`restaurant-admin-${suffix}`,passwordHash:await hashAdminPassword(password)}}},include:{adminCredential:true}});
  adminId=admin.id;
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalPipes(apiValidation());app.useGlobalFilters(new ApiExceptionFilter());await app.init();api=request(app.getHttpServer());
  adminToken=(await api.post('/api/admin/auth/login').send({username:admin.adminCredential!.username,password}).expect(201)).body.accessToken;
});
after(async()=>{
  await app?.close();
  await db.restaurantAccount.deleteMany({where:{phone:{in:[`+996${suffix}`,`+995${suffix}`]}}});
  await db.foodRestaurant.deleteMany({where:{id:{in:ids}}});
  if(adminId){await db.refreshSession.deleteMany({where:{userId:adminId}});await db.adminCredential.deleteMany({where:{userId:adminId}});await db.user.deleteMany({where:{id:adminId}});}
  await db.$disconnect();
});
test('admin provisions owner; separate token audience and restaurant isolation are enforced',async()=>{
  await api.post('/api/admin/restaurant-accounts').send({phone:`+996${suffix}`,password,restaurantIds:[ids[0]]}).expect(401);
  const created=await api.post('/api/admin/restaurant-accounts').set(auth(adminToken)).send({phone:`+996${suffix}`,password,name:'Owner',restaurantIds:[ids[0]],active:true}).expect(201);
  ownerId=created.body.id;assert.equal(created.body.passwordHash,undefined);
  const login=await api.post('/api/restaurant/auth/login').send({phone:`+996${suffix}`,password}).expect(201);
  ownerToken=login.body.accessToken;ownerRefresh=login.body.refreshToken;
  assert.equal(login.body.memberships[0].role,'OWNER');assert.equal(login.body.memberships[0].permissions.length,8);
  await api.get('/api/restaurant/me').set(auth(adminToken)).expect(401);
  await api.get('/api/admin/restaurant-accounts').set(auth(ownerToken)).expect(401);
  await api.get(`/api/restaurant/${ids[1]}`).set(auth(ownerToken)).expect(403);
  await api.get(`/api/restaurant/${ids[0]}/stats?period=week`).set(auth(ownerToken)).expect(200);
});
test('manager starts with orders only; permissions update immediately and never escape restaurant scope',async()=>{
  await api.post(`/api/restaurant/${ids[0]}/staff`).set(auth(ownerToken)).send({phone:`+995${suffix}`,password,role:'OWNER'}).expect(400);
  const created=await api.post(`/api/restaurant/${ids[0]}/staff`).set(auth(ownerToken)).send({phone:`+995${suffix}`,password,name:'Manager'}).expect(201);
  managerId=created.body.id;assert.deepEqual(created.body.permissions,['orders.read','orders.manage']);
  managerToken=(await api.post('/api/restaurant/auth/login').send({phone:`+995${suffix}`,password}).expect(201)).body.accessToken;
  await api.get(`/api/restaurant/${ids[0]}/orders`).set(auth(managerToken)).expect(200);
  await api.get(`/api/restaurant/${ids[0]}/stats`).set(auth(managerToken)).expect(403);
  await api.get(`/api/restaurant/${ids[0]}/staff`).set(auth(managerToken)).expect(403);
  await api.get(`/api/restaurant/${ids[1]}/orders`).set(auth(managerToken)).expect(403);
  let row=(await api.get(`/api/restaurant/${ids[0]}`).set(auth(managerToken)).expect(200)).body;
  row.catalog.dishes[0].price+=10;
  await api.put(`/api/restaurant/${ids[0]}/catalog`).set(auth(managerToken)).send({catalog:row.catalog,updatedAt:row.updatedAt}).expect(403);
  await api.patch(`/api/restaurant/${ids[0]}/staff/${managerId}`).set(auth(ownerToken)).send({permissions:['orders.read','orders.manage','menu.manage','staff.manage']}).expect(200);
  await api.put(`/api/restaurant/${ids[0]}/catalog`).set(auth(managerToken)).send({catalog:row.catalog,updatedAt:row.updatedAt}).expect(200);
  row=(await api.get(`/api/restaurant/${ids[0]}`).set(auth(managerToken))).body;row.catalog.deliveryFee=999;
  await api.put(`/api/restaurant/${ids[0]}/catalog`).set(auth(managerToken)).send({catalog:row.catalog,updatedAt:row.updatedAt}).expect(403);
  await api.patch(`/api/restaurant/${ids[0]}/staff/${managerId}`).set(auth(managerToken)).send({permissions:['stats.read']}).expect(403);
  await api.post(`/api/restaurant/${ids[0]}/staff`).set(auth(managerToken)).send({phone:`+994${suffix}`,password,permissions:['orders.read','stats.read']}).expect(403);
});
test('promotion validation and optimistic locking protect stored menus',async()=>{
  const current=(await api.get(`/api/admin/restaurants/${ids[0]}/promotions`).set(auth(adminToken)).expect(200)).body;
  const promotion={id:'launch',title:'Opening',type:'PERCENT',value:20,minSubtotal:500,dishIds:[],active:true,startsAt:null,endsAt:null};
  await api.put(`/api/admin/restaurants/${ids[0]}/promotions`).set(auth(adminToken)).send({promotions:[{...promotion,value:120}],updatedAt:current.updatedAt}).expect(400);
  await api.put(`/api/admin/restaurants/${ids[0]}/promotions`).set(auth(adminToken)).send({promotions:[promotion],updatedAt:current.updatedAt}).expect(200);
  await api.put(`/api/admin/restaurants/${ids[0]}/promotions`).set(auth(adminToken)).send({promotions:[],updatedAt:current.updatedAt}).expect(409);
});
test('disabled membership and owner password reset revoke access; refresh reuse revokes the family',async()=>{
  await api.delete(`/api/restaurant/${ids[0]}/staff/${managerId}`).set(auth(ownerToken)).expect(200);
  await api.get(`/api/restaurant/${ids[0]}/orders`).set(auth(managerToken)).expect(403);
  const rotated=(await api.post('/api/restaurant/auth/refresh').send({refreshToken:ownerRefresh}).expect(201)).body;
  await api.post('/api/restaurant/auth/refresh').send({refreshToken:ownerRefresh}).expect(401);
  await api.get('/api/restaurant/me').set(auth(rotated.accessToken)).expect(401);
  const login=(await api.post('/api/restaurant/auth/login').send({phone:`+996${suffix}`,password}).expect(201)).body;
  await api.patch(`/api/admin/restaurant-accounts/${ownerId}`).set(auth(adminToken)).send({password:`new-${password}`}).expect(200);
  await api.get('/api/restaurant/me').set(auth(login.accessToken)).expect(401);
  await api.post('/api/restaurant/auth/refresh').send({refreshToken:login.refreshToken}).expect(401);
});
