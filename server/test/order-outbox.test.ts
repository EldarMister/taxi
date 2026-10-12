import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ServiceUnavailableException} from '@nestjs/common';
import {OrderOutboxWorker} from '../src/order-outbox';
import {RealtimeEvents} from '../src/events';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const nextTurn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function tickHarness(t:any){
  const worker=new OrderOutboxWorker({} as any,{} as any,{} as any,{} as any);
  const limits:number[]=[];
  let work:(limit:number)=>Promise<{claimed:number;delivered:number}>=async()=>({claimed:0,delivered:0});
  t.mock.method(worker,'flush',async(limit:number)=>{limits.push(limit);return work(limit);});
  return {worker,limits,set(workCallback:typeof work){work=workCallback;}};
}

test('empty outbox keeps the existing one-claim idle polling cost',async t=>{
  const h=tickHarness(t);await h.worker.tick();assert.deepEqual(h.limits,[25]);
});
test('a partial last batch finishes without an extra empty claim',async t=>{
  const h=tickHarness(t);let calls=0;
  h.set(async()=>++calls===1?{claimed:25,delivered:25}:{claimed:8,delivered:8});
  await h.worker.tick();assert.deepEqual(h.limits,[25,25]);
});
test('a continuously full queue cannot claim more than 100 rows in one turn',async t=>{
  const h=tickHarness(t);h.set(async limit=>({claimed:limit,delivered:limit}));
  await h.worker.tick();assert.deepEqual(h.limits,[25,25,25,25]);
});
test('one unacknowledged row stops the turn rather than claiming more during an outage',async t=>{
  const h=tickHarness(t);h.set(async()=>({claimed:25,delivered:24}));
  await h.worker.tick();assert.deepEqual(h.limits,[25]);
});
test('a claim exception releases the running guard for a later recovery turn',async t=>{
  const h=tickHarness(t);h.set(async()=>{throw new ServiceUnavailableException();});
  await h.worker.tick();h.set(async()=>({claimed:0,delivered:0}));await h.worker.tick();
  assert.deepEqual(h.limits,[25,25]);
});
test('overlapping scheduled ticks never create a second claim or delivery lane',async t=>{
  const h=tickHarness(t),held=deferred();
  h.set(async()=>{await held.promise;return {claimed:0,delivered:0};});
  const first=h.worker.tick();await h.worker.tick();assert.deepEqual(h.limits,[25]);
  held.resolve();await first;await h.worker.tick();assert.deepEqual(h.limits,[25,25]);
});
test('the 500ms scheduling budget finishes an in-flight batch before stopping',async t=>{
  const h=tickHarness(t),held=deferred();let elapsed=0,calls=0,finished=false;
  t.mock.method(performance,'now',()=>elapsed);
  h.set(async()=>{
    if(++calls===1){elapsed=499;return {claimed:25,delivered:25};}
    await held.promise;return {claimed:25,delivered:25};
  });
  const tick=h.worker.tick().then(()=>{finished=true;});await nextTurn();
  assert.deepEqual(h.limits,[25,25]);elapsed=900;
  await h.worker.tick();assert.equal(finished,false);assert.deepEqual(h.limits,[25,25]);
  held.resolve();await tick;assert.equal(finished,true);assert.deepEqual(h.limits,[25,25]);
});

type Row={id:string;aggregateType:string;aggregateId:string;previousDriverId:string|null;createdAt:Date;availableAt:Date;deliveredAt:Date|null;attempts:number};
function deliveryHarness(count=1){
  const rows:Row[]=Array.from({length:count},(_,index)=>({id:`event-${index}`,aggregateType:'FOOD',aggregateId:'food',previousDriverId:null,createdAt:new Date(index),availableAt:new Date(0),deliveredAt:null,attempts:0}));
  const writes:any[]=[],queries:string[]=[],reads:any[]=[],food={id:'food',clientId:'client',status:'PLACED'};
  const matches=(row:Row,where:any)=>Object.entries(where).every(([key,value])=>{
    if(key==='id'&&typeof value==='object')return (value as any).in.includes(row.id);
    return (row as any)[key]===value;
  });
  const model={
    async updateMany(args:any){
      writes.push(structuredClone(args));let count=0;
      for(const row of rows.filter(row=>matches(row,args.where))){for(const[key,value]of Object.entries(args.data)){
        if(key==='attempts')row.attempts+=(value as {increment:number}).increment;
        else (row as any)[key]=value;
      }count++;}return {count};
    },
    async findMany(args:any){
      reads.push(args);assert.deepEqual(args.orderBy,[{createdAt:'asc'},{id:'asc'}]);
      return structuredClone(rows.filter(row=>args.where.id.in.includes(row.id)).sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()||a.id.localeCompare(b.id)));
    },
  };
  const tx={orderEventOutbox:model,async $queryRaw(strings:TemplateStringsArray,...values:any[]){
    queries.push(strings.join('?'));assert.match(queries.at(-1)!,/ORDER BY "createdAt", "id"/);
    assert.match(queries.at(-1)!,/NOW\(\) AT TIME ZONE 'UTC'/);
    const limit=values[0];return rows.filter(row=>!row.deliveredAt&&row.availableAt.getTime()<=Date.now()).sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()||a.id.localeCompare(b.id)).slice(0,limit).map(row=>({id:row.id}));
  }};
  const db={$transaction:async(callback:any)=>callback(tx),orderEventOutbox:model,foodOrder:{findUnique:async()=>structuredClone(food)},order:{findUnique:async()=>({id:'taxi'})}};
  const events=new RealtimeEvents(),published:any[]=[];
  const orders={publish:async(...args:any[])=>{published.push(args);}};
  const worker=(eventBus=events)=>new OrderOutboxWorker(db as any,orders as any,{serialize:(row:any)=>row} as any,eventBus);
  return {rows,writes,queries,reads,food,events,published,worker};
}

test('every claimed food row rehydrates fresh canonical state and awaits both event deliveries',async()=>{
  const h=deliveryHarness(2),messages:any[]=[];
  h.events.on('event',async event=>{messages.push(event);if(event.name==='food:order:updated')h.food.status='CONFIRMED';});
  assert.deepEqual(await h.worker().flush(25),{claimed:2,delivered:2});
  assert.deepEqual(messages.filter(event=>event.name==='food:order:updated').map(event=>event.payload.status),['PLACED','CONFIRMED']);
  assert.equal(messages.filter(event=>event.name==='admin:changed').length,2);
  assert.equal(h.rows.every(row=>row.attempts===1&&row.deliveredAt!==null),true);
});
test('taxi replay retains previous-driver withdrawals and confirmed delivery rather than repeating business mutations',async()=>{
  const h=deliveryHarness();Object.assign(h.rows[0],{aggregateType:'TAXI',aggregateId:'taxi',previousDriverId:'previous-driver'});
  assert.deepEqual(await h.worker().flush(25),{claimed:1,delivered:1});
  assert.deepEqual(h.published,[['taxi',['previous-driver'],true]]);
  assert.equal(h.writes.every(write=>Object.keys(write.data).every(key=>['attempts','availableAt','deliveredAt'].includes(key))),true);
});
test('an authorization/delivery outage leaves the event undelivered with its existing exponential retry',async()=>{
  const h=deliveryHarness(),before=Date.now();h.events.on('event',async()=>{throw new ServiceUnavailableException();});
  assert.deepEqual(await h.worker().flush(1),{claimed:1,delivered:0});
  assert.equal(h.rows[0].attempts,1);assert.equal(h.rows[0].deliveredAt,null);
  assert.ok(h.rows[0].availableAt.getTime()>=before+2000);
  assert.deepEqual(h.writes[1].where,{id:'event-0',attempts:1,deliveredAt:null});
  assert.deepEqual(await h.worker().flush(1),{claimed:0,delivered:0});
});

for(const outcome of ['acknowledge','retry'] as const)test(`a stale owner cannot ${outcome} a newer worker's reclaimed lease`,async()=>{
  const h=deliveryHarness(),oldEvents=new RealtimeEvents(),newEvents=new RealtimeEvents();
  const oldStarted=deferred(),releaseOld=deferred(),newStarted=deferred(),releaseNew=deferred();
  oldEvents.on('event',async event=>{if(event.name==='food:order:updated'){oldStarted.resolve();await releaseOld.promise;if(outcome==='retry')throw new ServiceUnavailableException();}});
  newEvents.on('event',async event=>{if(event.name==='food:order:updated'){newStarted.resolve();await releaseNew.promise;}});
  const old=h.worker(oldEvents).flush(1);await oldStarted.promise;
  assert.equal(h.rows[0].attempts,1);h.rows[0].availableAt=new Date(0); // Controlled lease expiry; no 30s sleep.
  const current=h.worker(newEvents).flush(1);await newStarted.promise;
  assert.equal(h.rows[0].attempts,2);const newLease=h.rows[0].availableAt.getTime();
  releaseOld.resolve();assert.deepEqual(await old,{claimed:1,delivered:0});
  assert.equal(h.rows[0].attempts,2);assert.equal(h.rows[0].deliveredAt,null);assert.equal(h.rows[0].availableAt.getTime(),newLease);
  releaseNew.resolve();assert.deepEqual(await current,{claimed:1,delivered:1});assert.notEqual(h.rows[0].deliveredAt,null);
});
