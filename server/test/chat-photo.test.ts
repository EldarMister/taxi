import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import sharp from 'sharp';
import { OrdersService } from '../src/orders';
import type { Actor } from '../src/auth';

const client:Actor={id:'11111111-1111-4111-8111-111111111111',role:'CLIENT',sessionId:'session',familyId:'family',expiresAt:9999999999};
const outsider:Actor={...client,id:'33333333-3333-4333-8333-333333333333'};

test('photo messages are normalized, private, and never include image bytes in chat events',async()=>{
  const order={id:'order',clientId:client.id,driverId:'22222222-2222-4222-8222-222222222222',status:'ASSIGNED'};
  const rows:any[]=[];
  const published:any[]=[];
  const tx={
    message:{
      findUnique:async({where}:any)=>where.id?rows.find(row=>row.id===where.id):rows.find(row=>row.senderId===where.senderId_clientMessageId.senderId&&row.clientMessageId===where.senderId_clientMessageId.clientMessageId),
      create:async({data}:any)=>{const row={id:'photo-id',createdAt:new Date(),...data};rows.push(row);return row;},
      findMany:async()=>rows,
    },
    statusHistory:{findFirst:async()=>({createdAt:new Date(0)})},
  };
  const db={$transaction:async<T>(work:(transaction:typeof tx)=>Promise<T>)=>work(tx),order:{findUniqueOrThrow:async()=>order}};
  const events={publish:(_users:string[],_event:string,payload:unknown)=>published.push(payload)};
  const service=new OrdersService(db as any,{} as any,{} as any,{} as any,events as any,{take:async()=>{}} as any);
  (service as any).lockOrder=async()=>order;
  (service as any).push=async()=>{};
  const image=await sharp({create:{width:24,height:16,channels:3,background:'#2196f3'}}).png().toBuffer();
  const dto={text:'',clientMessageId:'message-id-1234'};
  const sent=await service.sendMessage(client,order.id,dto,{buffer:image,mimetype:'image/png'});
  assert.equal(sent.text,'');
  assert.equal(sent.photoUrl,'/orders/order/messages/photo-id/photo');
  assert.equal('imageData' in sent,false);
  assert.equal('imageData' in published[0],false);
  assert.equal((await sharp(Buffer.from(rows[0].imageData)).metadata()).format,'webp');
  assert.equal((await service.messages(client,order.id))[0].photoUrl,sent.photoUrl);
  assert.equal((await service.sendMessage(client,order.id,dto,{buffer:image,mimetype:'image/png'})).id,sent.id);
  assert.equal(rows.length,1);
  assert.equal((await service.messagePhoto(client,order.id,sent.id)).mime,'image/webp');
  await assert.rejects(()=>service.messagePhoto(outsider,order.id,sent.id),ForbiddenException);
});
