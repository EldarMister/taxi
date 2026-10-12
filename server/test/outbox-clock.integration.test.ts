import 'reflect-metadata';
import {requireTestDatabase} from './test-database';
requireTestDatabase();
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {OrderOutboxWorker} from '../src/order-outbox';
import {RealtimeEvents} from '../src/events';
import {serializeFoodOrder} from '../src/food';

const db=new PrismaClient();
after(()=>db.$disconnect());

test('non-UTC transaction defaults stay UTC and a second outbox worker cannot claim the active UTC lease',async()=>{
  const rollback=new Error('Rollback synthetic timezone fixture');
  await assert.rejects(()=>db.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Almaty'");
    const clock=await tx.$queryRaw<Array<{timezone:string;offsetSeconds:number}>>`SELECT current_setting('TimeZone') AS timezone, EXTRACT(TIMEZONE FROM CURRENT_TIMESTAMP)::int AS "offsetSeconds"`;
    assert.equal(clock[0].timezone,'Asia/Almaty');assert.notEqual(clock[0].offsetSeconds,0);
    // Unrelated queue rows are hidden only inside this always-rolled-back
    // transaction. Other suites and the synthetic load namespace are retained.
    await tx.orderEventOutbox.updateMany({where:{deliveredAt:null},data:{availableAt:new Date('2999-01-01T00:00:00Z')}});
    const id=randomUUID(),user=await tx.user.create({data:{phone:'+996'+BigInt('0x'+id.replaceAll('-','').slice(0,11)).toString().padStart(9,'0').slice(-9),name:'Synthetic clock client'}});
    const restaurant=await tx.foodRestaurant.create({data:{id:'clock-'+id,catalog:{id:'clock-'+id,name:'Synthetic clock restaurant'},active:true,isDemo:true}});
    const food=await tx.foodOrder.create({data:{clientId:user.id,restaurantId:restaurant.id,restaurantSnapshot:{id:restaurant.id,name:'Synthetic clock restaurant'},requestId:id,requestHash:id,items:[],subtotal:100,deliveryFee:0,total:100,fulfillment:'PICKUP',address:'',paymentMethod:'CASH',isDemo:true}});
    const pending=await tx.orderEventOutbox.findMany({where:{aggregateId:food.id,deliveredAt:null}});assert.equal(pending.length,1);
    // Defaults come from a DB trigger, not a JS-provided timestamp. NOW is
    // transaction-stable, so this comparison has no timing tolerance.
    const initialClock=await tx.$queryRaw<Array<{createdUtc:boolean;availableUtc:boolean}>>`SELECT "createdAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS "createdUtc", "availableAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS "availableUtc" FROM "OrderEventOutbox" WHERE id=${pending[0].id}::uuid`;
    assert.deepEqual(initialClock[0],{createdUtc:true,availableUtc:true});
    // All worker calls intentionally share this rollback transaction. NOW
    // stays frozen while timestamp(3) can round a default fraction upward;
    // make this event explicitly due before testing a fresh JS-written lease.
    await tx.orderEventOutbox.update({where:{id:pending[0].id},data:{availableAt:new Date(0)}});
    const transactionalDb=new Proxy(tx,{get(target,property){return property==='$transaction'?async(callback:(client:typeof tx)=>unknown)=>callback(target):Reflect.get(target,property);}});
    const events=new RealtimeEvents();let release!:()=>void,arrived!:()=>void,held=false,failure:unknown;
    const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{arrived=resolve;});
    const listener=async(event:any)=>{if(event.name==='food:order:updated'&&event.payload.id===food.id&&!held){held=true;arrived();await gate;}};
    events.on('event',listener);
    const worker=()=>new OrderOutboxWorker(transactionalDb as any,{} as any,{serialize:serializeFoodOrder} as any,events);
    const first=worker().flush(1);
    try{
      await Promise.race([started,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('First worker never claimed the fresh UTC event')),3000);timer.unref();})]);
      const lease=await tx.orderEventOutbox.findUniqueOrThrow({where:{id:pending[0].id}});assert.equal(lease.attempts,1);assert.equal(lease.deliveredAt,null);assert.ok(lease.availableAt.getTime()>Date.now()+25000);
      const second=await worker().flush(1);assert.deepEqual(second,{claimed:0,delivered:0});assert.equal((await tx.orderEventOutbox.findUniqueOrThrow({where:{id:lease.id}})).attempts,1);
    }catch(error){failure=error;}finally{release();events.off('event',listener);}
    const completed=await first;if(failure)throw failure;
    assert.deepEqual(completed,{claimed:1,delivered:1});assert.notEqual((await tx.orderEventOutbox.findUniqueOrThrow({where:{id:pending[0].id}})).deliveredAt,null);
    throw rollback;
  },{timeout:15000}),error=>error===rollback);
});
