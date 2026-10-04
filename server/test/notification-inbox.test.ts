import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { UsersController } from '../src/http';

test('notification inbox lists only the signed-in user and marks only their viewed events',async()=>{
  const accountId='11111111-1111-4111-8111-111111111111';
  const calls:{list?:any;count?:any;read?:any}={};
  const now=new Date();
  const db={pushJob:{
    findMany:async(args:any)=>{calls.list=args;return [{id:'job',event:'order:assigned',orderId:'order',createdAt:now,readAt:null}];},
    count:async(args:any)=>{calls.count=args;return 1;},
    updateMany:async(args:any)=>{calls.read=args;return {count:1};},
  }};
  const controller=new UsersController(db as any,{} as any,{} as any);
  const request={actor:{id:accountId,role:'CLIENT'}} as any;
  const feed=await controller.notifications(request);
  assert.equal(calls.list.where.userId,accountId);
  assert.equal(calls.count.where.userId,accountId);
  assert.equal(calls.count.where.readAt,null);
  assert.equal(calls.list.where.event.in.includes('order:created'),false);
  assert.equal(calls.list.where.event.in.includes('order:updated'),false);
  assert.deepEqual(calls.count.where.event,calls.list.where.event);
  assert.equal(feed.hasUnread,true);
  assert.equal(feed.items[0].title,'Водитель найден');
  assert.equal('payload' in feed.items[0],false);
  await controller.readNotifications(request,{through:feed.asOf.toISOString()});
  assert.equal(calls.read.where.userId,accountId);
  assert.equal(calls.read.where.readAt,null);
  assert.equal(calls.read.where.createdAt.lte.toISOString(),feed.asOf.toISOString());
  await assert.rejects(()=>controller.readNotifications(request,{through:new Date(Date.now()+60000).toISOString()}),BadRequestException);
});

test('legacy generic and creation events do not occupy inbox rows or create an unread badge',async()=>{
  for(const role of ['CLIENT','DRIVER']) {
    const rows=['order:created','order:updated','trip:started'].map(event=>({event,readAt:null}));
    const matching=(where:any)=>rows.filter(job=>where.event.in.includes(job.event));
    const db={pushJob:{
      findMany:async({where}:any)=>matching(where),
      count:async({where}:any)=>matching(where).length,
    }};
    const controller=new UsersController(db as any,{} as any,{} as any);
    const feed=await controller.notifications({actor:{id:'user',role}} as any);
    assert.deepEqual(feed.items,[]);
    assert.equal(feed.hasUnread,false);
  }
});
