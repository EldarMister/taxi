import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminGuard, assertAdmin, hashAdminPassword, verifyAdminPassword } from '../src/admin.security';
import { AdminTariffDto, AdminTariffPatchDto, AdminOrdersDto, AdminDriverPatchDto } from '../src/admin.dto';
import { AdminService } from '../src/admin';
import { RealtimeEvents } from '../src/events';
import { TaxiGateway } from '../src/gateway';
import { Actor } from '../src/auth';
const actor=(role:Actor['role']):Actor=>({id:'11111111-1111-4111-8111-111111111111',role,sessionId:'session',familyId:'family',expiresAt:9999999999});

test('administrator passwords use randomized scrypt hashes and reject incorrect passwords',async()=>{
  const password='test-only-long-password';
  const first=await hashAdminPassword(password),second=await hashAdminPassword(password);
  assert.notEqual(first,second);assert.ok(!first.includes(password));
  assert.equal(await verifyAdminPassword(password,first),true);
  assert.equal(await verifyAdminPassword('incorrect-password',first),false);
  assert.equal(await verifyAdminPassword(password,'broken'),false);
  await assert.rejects(()=>hashAdminPassword('short'));
});

test('admin guard and service deny customer and driver before any database access',async()=>{
  const db=new Proxy({}, {get(){throw new Error('Database must not be read');}});
  const service=new AdminService(db as any,{} as any,{} as any,{} as any,{} as any);
  for(const role of ['CLIENT','DRIVER'] as const) {
    assert.throws(()=>assertAdmin(actor(role)),ForbiddenException);
    assert.throws(()=>new AdminGuard().canActivate({switchToHttp:()=>({getRequest:()=>({actor:actor(role)})})} as any),ForbiddenException);
    for(const operation of [()=>service.dashboard(actor(role)),()=>service.orders(actor(role),new AdminOrdersDto()),()=>service.order(actor(role),'taxi','id'),()=>service.tariffs(actor(role)),()=>service.driver(actor(role),'id'),()=>service.drivers(actor(role),{} as any),()=>service.auditLog(actor(role),{} as any)])await assert.rejects(operation,ForbiddenException);
  }
});

test('tariff DTO rejects negative, fractional, unbounded and client-controlled fields',async()=>{
  const valid={id:'economy',name:'Эконом',description:'Поездки',basePrice:60,pricePerKm:14,pricePerMinute:2,waitingGraceMinutes:1,freeWaitingMinutes:5,waitingPricePerMinute:2,minimumPrice:100,commissionBps:1000,active:true};
  assert.equal((await validate(plainToInstance(AdminTariffDto,valid))).length,0);
  for(const patch of [{basePrice:-1},{pricePerKm:1.5},{pricePerMinute:1000001},{waitingGraceMinutes:-1},{freeWaitingMinutes:181},{waitingPricePerMinute:1.5},{commissionBps:10001},{active:'true'},{role:'ADMIN'}]) {
    const errors=await validate(plainToInstance(AdminTariffPatchDto,patch),{whitelist:true,forbidNonWhitelisted:true});
    assert.ok(errors.length,JSON.stringify(patch));
  }
  assert.ok((await validate(plainToInstance(AdminDriverPatchDto,{deposit:999999,role:'ADMIN',online:true}),{whitelist:true,forbidNonWhitelisted:true})).length>=3);
});

test('order list bounds prevent invalid pagination and table selection',async()=>{
  for(const input of [{page:0},{pageSize:1000},{kind:'User'},{search:'x'.repeat(101)}])assert.ok((await validate(plainToInstance(AdminOrdersDto,input))).length);
});

test('realtime admin notifications are authenticated at delivery and never sent to customers',async()=>{
  const delivered:{role:string;event:string}[]=[];
  const sockets=new Map();
  for(const role of ['ADMIN','CLIENT','DRIVER'])sockets.set(role,{handshake:{auth:{token:role}},data:{userId:role,role},emit:(event:string)=>delivered.push({role,event}),disconnect:()=>{}});
  const auth={authenticate:async(token:string)=>actor(token as Actor['role'])};
  const gateway=new TaxiGateway(auth as any,new RealtimeEvents());
  gateway.server={sockets:{sockets}} as any;
  await (gateway as any).send({audience:'admin',userIds:[],name:'admin:changed',payload:{resource:'taxi-orders'}});
  assert.deepEqual(delivered,[{role:'ADMIN',event:'admin:changed'}]);
  delivered.length=0;
  auth.authenticate=async()=>actor('CLIENT');
  await (gateway as any).send({audience:'admin',userIds:[],name:'admin:changed',payload:{resource:'taxi-orders'}});
  assert.deepEqual(delivered,[]);
});

test('taxi changes invalidate admin data and tariff changes reach authenticated app sessions',()=>{
  const events=new RealtimeEvents(),sent:any[]=[];events.on('event',event=>sent.push(event));
  events.publish(['client-id'],'order:updated',{id:'order-id'});
  assert.deepEqual(sent.map(event=>event.name),['order:updated','admin:changed']);
  assert.equal(sent[1].audience,'admin');assert.equal(sent[1].payload.resource,'taxi-orders');
  events.contentChanged('tariffs');assert.equal(sent[2].name,'content:changed');assert.equal(sent[2].audience,'authenticated');
});
