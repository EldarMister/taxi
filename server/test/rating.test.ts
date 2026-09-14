import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RatingDto } from '../src/dto';
import { OrdersService } from '../src/orders';
import { Actor } from '../src/auth';

const actor:Actor={id:'11111111-1111-4111-8111-111111111111',role:'CLIENT',sessionId:'session',familyId:'family',expiresAt:9999999999};
const driver:Actor={...actor,id:'22222222-2222-4222-8222-222222222222',role:'DRIVER'};

test('rating accepts an optional bounded text comment',async()=>{
  for(const input of [{score:5},{score:5,comment:''},{score:5,comment:'x'.repeat(500)}]) {
    assert.equal((await validate(plainToInstance(RatingDto,input))).length,0);
  }
  for(const input of [{score:5,comment:'x'.repeat(501)},{score:5,comment:123},{score:0,comment:'fine'}]) {
    assert.ok((await validate(plainToInstance(RatingDto,input))).length,JSON.stringify(input));
  }
});

test('rating saves trimmed feedback and changed retries conflict',async()=>{
  let stored:{id:string;orderId:string;score:number;comment:string}|null=null;
  const tx={
    $queryRaw:async()=>[],
    order:{findUnique:async()=>({id:'order',clientId:actor.id,status:'COMPLETED'})},
    rating:{
      findUnique:async()=>stored,
      create:async({data}:{data:{orderId:string;score:number;comment:string}})=>{stored={id:'rating',...data};return stored;},
    },
  };
  const db={$transaction:async<T>(work:(transaction:typeof tx)=>Promise<T>)=>work(tx)};
  const service=new OrdersService(db as any,{} as any,{} as any,{} as any,{} as any,{} as any);
  assert.equal((await service.rate(actor,'order',5,'  Спасибо!  ')).comment,'Спасибо!');
  assert.equal((await service.rate(actor,'order',5,'Спасибо!')).id,'rating');
  await assert.rejects(()=>service.rate(actor,'order',5),ConflictException);
  await assert.rejects(()=>service.rate(actor,'order',4,'Спасибо!'),ConflictException);
  await assert.rejects(()=>service.rate(actor,'order',5,'Другая поездка'),ConflictException);
});

test('rating without a comment preserves the legacy request shape',async()=>{
  let stored:{id:string;orderId:string;score:number;comment:string}|null=null;
  const tx={
    $queryRaw:async()=>[],
    order:{findUnique:async()=>({id:'order',clientId:actor.id,status:'COMPLETED'})},
    rating:{findUnique:async()=>stored,create:async({data}:{data:{orderId:string;score:number;comment:string}})=>{stored={id:'rating',...data};return stored;}},
  };
  const db={$transaction:async<T>(work:(transaction:typeof tx)=>Promise<T>)=>work(tx)};
  const service=new OrdersService(db as any,{} as any,{} as any,{} as any,{} as any,{} as any);
  assert.equal((await service.rate(actor,'order',5)).comment,'');
  assert.equal((await service.rate(actor,'order',5)).id,'rating');
});

test('driver can rate only their passenger after completion, with safe retries',async()=>{
  let status='IN_PROGRESS';
  let stored:{id:string;orderId:string;score:number;comment:string}|null=null;
  const tx={
    $queryRaw:async()=>[],
    order:{findUnique:async()=>({id:'order',clientId:actor.id,driverId:driver.id,status})},
    clientRating:{
      findUnique:async()=>stored,
      create:async({data}:{data:{orderId:string;score:number;comment:string}})=>{stored={id:'client-rating',...data};return stored;},
    },
  };
  const db={$transaction:async<T>(work:(transaction:typeof tx)=>Promise<T>)=>work(tx)};
  const service=new OrdersService(db as any,{} as any,{} as any,{} as any,{} as any,{} as any);
  await assert.rejects(()=>service.rateClient(driver,'order',4),BadRequestException);
  status='COMPLETED';
  await assert.rejects(()=>service.rateClient(actor,'order',4),ForbiddenException);
  await assert.rejects(()=>service.rateClient({...driver,id:'another-driver'},'order',4),ForbiddenException);
  assert.equal((await service.rateClient(driver,'order',4,'  Вежливый пассажир  ')).comment,'Вежливый пассажир');
  assert.equal((await service.rateClient(driver,'order',4,'Вежливый пассажир')).id,'client-rating');
  await assert.rejects(()=>service.rateClient(driver,'order',5,'Вежливый пассажир'),ConflictException);
  await assert.rejects(()=>service.rateClient(driver,'order',4),ConflictException);
});

test('offer snapshot exposes passenger aggregate without passenger identity',async()=>{
  const order={id:'order',clientId:actor.id,driverId:null,status:'SEARCHING',pickup:{},dropoff:{},geometry:[],distanceMeters:1000,durationSeconds:300,price:100,comment:'',createdAt:new Date(),updatedAt:new Date(),searchExpiresAt:new Date(),completedAt:null,rating:null,clientRating:null,quote:{tariff:{id:'economy'},routeProvider:'fixture'}};
  const db={
    order:{findUniqueOrThrow:async()=>order},
    clientRating:{aggregate:async()=>({_avg:{score:4.5}})},
  };
  const service=new OrdersService(db as any,{} as any,{} as any,{user:async()=>{throw new Error('offer must not load a user profile');}} as any,{} as any,{} as any);
  const snapshot=await service.serialize(order.id,true);
  assert.equal(snapshot.clientRating,4.5);
  assert.equal(snapshot.driverRating,null);
  assert.equal(snapshot.client,undefined);
});

test('completed driver snapshot includes their saved passenger score',async()=>{
  const order={id:'order',clientId:actor.id,driverId:driver.id,status:'COMPLETED',pickup:{},dropoff:{},geometry:[],distanceMeters:1000,durationSeconds:300,price:100,comment:'',createdAt:new Date(),updatedAt:new Date(),searchExpiresAt:new Date(),completedAt:new Date(),rating:null,clientRating:{score:5},quote:{tariff:{id:'economy'},routeProvider:'fixture'}};
  const db={order:{findUniqueOrThrow:async()=>order},clientRating:{aggregate:async()=>({_avg:{score:4.25}})}};
  const auth={user:async(id:string)=>({id,name:id===actor.id?'Passenger':'Driver',role:id===actor.id?'CLIENT':'DRIVER'})};
  const service=new OrdersService(db as any,{} as any,{} as any,auth as any,{} as any,{} as any);
  const snapshot=await service.serialize(order.id,false,driver.id);
  assert.equal(snapshot.clientRating,4.25);
  assert.equal(snapshot.driverRating,5);
  assert.equal(snapshot.client?.id,actor.id);
});
