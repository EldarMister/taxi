import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { AvatarUploadGate, ChatPhotoUploadGate, MediaUploadSlots, RestaurantMediaUploadGate } from '../src/media-upload-gate';

const id=randomUUID();
const actor={id,role:'DRIVER',sessionId:randomUUID(),familyId:randomUUID(),expiresAt:9999999999};
const req=(overrides:Record<string,any>={})=>({actor,params:{id:randomUUID()},headers:{},socket:{remoteAddress:'127.0.0.1'},...overrides});
const context=(request:any)=>({switchToHttp:()=>({getRequest:()=>request})} as any);
const limits={takeAll:async()=>{}};

test('role/membership and oversized bodies are rejected before buffering, quotas or image decode',async()=>{
  let buffered=0,counters=0;
  const gate=new AvatarUploadGate({takeAll:async()=>{counters++;}} as any);
  const next={handle:()=>{buffered++;return of('done');}};
  await assert.rejects(()=>gate.intercept(context(req({actor:{...actor,role:'CLIENT'}})),next),ForbiddenException);
  await assert.rejects(()=>gate.intercept(context(req({headers:{'content-length':String(6*1024*1024)}})),next),PayloadTooLargeException);
  for(const size of ['1.5','-1','NaN',['123']])await assert.rejects(()=>gate.intercept(context(req({headers:{'content-length':size}})),next),BadRequestException);
  assert.equal(buffered,0);assert.equal(counters,0);
});

test('chat photo admission isolates participants and denies detached restaurant-delivery client',async()=>{
  let order:any={clientId:id,driverId:randomUUID(),status:'ASSIGNED',foodOrderId:null,idempotencyKey:'normal'};
  let buffers=0;
  const gate=new ChatPhotoUploadGate(limits as any,{order:{findUnique:async()=>order}} as any);
  const next={handle:()=>{buffers++;return of('done');}};
  const request=req();
  assert.equal(await firstValueFrom(await gate.intercept(context(request),next)),'done');
  order={...order,foodOrderId:randomUUID()};
  await assert.rejects(()=>gate.intercept(context(request),next),ForbiddenException);
  order={...order,foodOrderId:null,idempotencyKey:'restaurant-food:old-detached'};
  await assert.rejects(()=>gate.intercept(context(request),next),ForbiddenException);
  order={...order,clientId:randomUUID(),driverId:randomUUID()};
  await assert.rejects(()=>gate.intercept(context(request),next),ForbiddenException);
  assert.equal(buffers,1);
});

test('restaurant media rights are checked before quota and multipart admission',async()=>{
  let admission=0;
  const gate=new RestaurantMediaUploadGate({takeAll:async()=>{admission++;}} as any,{mediaAccess:async()=>{throw new ForbiddenException();}} as any);
  await assert.rejects(()=>gate.intercept(context(req({restaurantActor:{id,sessionId:actor.sessionId,sessionVersion:1}})),{handle:()=>{admission++;return of('done');}}),ForbiddenException);
  assert.equal(admission,0);
});

test('failed durable quota releases concurrency slot and never starts buffering',async()=>{
  let fail=true,buffers=0;
  const gate=new AvatarUploadGate({takeAll:async()=>{if(fail)throw new HttpException('quota',429);}} as any);
  const next={handle:()=>{buffers++;return of('done');}},request=req();
  await assert.rejects(()=>gate.intercept(context(request),next),(error:any)=>error.getStatus()===429);
  assert.equal(buffers,0);fail=false;
  assert.equal(await firstValueFrom(await gate.intercept(context(request),next)),'done');
});

test('concurrency gate includes decoding work and releases slot on success and error',async()=>{
  const gate=new AvatarUploadGate(limits as any),request=req(),processing=new Subject<string>();
  const original=await gate.intercept(context(request),{handle:()=>processing});
  const completion=firstValueFrom(original);
  await assert.rejects(()=>gate.intercept(context(request),{handle:()=>of('duplicate')}),(error:any)=>error.getStatus()===429);
  processing.next('done');processing.complete();assert.equal(await completion,'done');
  const failure=await gate.intercept(context(request),{handle:()=>throwError(()=>new Error('decode error'))});
  await assert.rejects(()=>firstValueFrom(failure),/decode error/);
  assert.equal(await firstValueFrom(await gate.intercept(context(request),{handle:()=>of('retry')})),'retry');
});

test('process-wide and per-IP bounds cannot be bypassed by parallel accounts',()=>{
  const slots=new MediaUploadSlots(),releases=[slots.acquire('u1','ip1'),slots.acquire('u2','ip1')];
  assert.throws(()=>slots.acquire('u3','ip1'),(error:any)=>error.getStatus()===429);
  releases.push(slots.acquire('u3','ip2'),slots.acquire('u4','ip3'));
  assert.throws(()=>slots.acquire('u5','ip4'),(error:any)=>error.getStatus()===429);
  for(const release of releases){release();release();}
  const release=slots.acquire('u1','ip1');release();
});
