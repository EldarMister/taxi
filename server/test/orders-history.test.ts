import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { OrdersService } from '../src/orders';
import type { Actor } from '../src/auth';
import { mapUserProfile } from '../src/user-profile';

// Validation requires the decorator metadata emitted by the server compiler.
const { OrdersHistoryDto, HistoryDto } = require('../dist/src/dto.js');
const driver:Actor = {id:'driver',role:'DRIVER',sessionId:'session',familyId:'family',expiresAt:9999999999};
const client:Actor = {...driver,id:'client',role:'CLIENT'};
const from='2026-10-01T00:00:00+06:00',to='2026-10-02T00:00:00+06:00';

function fixture(changes:Record<string,unknown>={}) {
  return {id:'trip',clientId:client.id,driverId:driver.id,status:'COMPLETED',idempotencyKey:'ordinary-trip',foodOrderId:null,
    createdAt:new Date(from),updatedAt:new Date(from),completedAt:new Date(from),searchExpiresAt:new Date(from),
    pickup:{address:'Начало',latitude:42.87,longitude:74.6},dropoff:{address:'Конец',latitude:42.88,longitude:74.61},
    geometry:[],distanceMeters:1000,durationSeconds:300,price:100,commission:10,comment:'',rating:null,clientRating:null,
    kind:'RIDE',deliveryDetails:null,dispatchAfter:new Date(from),driverLocation:null,arrivedAt:null,waitingCharge:0,waitingBilledMinutes:0,waitingGraceMinutes:1,freeWaitingMinutes:5,waitingPricePerMinute:2,passengerName:null,passengerPhone:null,
    quote:{tariff:{id:'economy'},routeProvider:'fixture'},...changes};
}

function harness(rows:ReturnType<typeof fixture>[],ledger:Array<{driverId:string;orderId:string;kind:string;amount:number}>=[]) {
  const queries:any[]=[],ledgerQueries:any[]=[],roundTrips:string[]=[];
  const users=[...new Set(rows.flatMap(row=>[row.clientId,row.driverId]).filter(Boolean))].map(id=>({id,role:id===driver.id?'DRIVER':'CLIENT',name:id,phone:'+996999000000',notifications:true,language:'ru',avatarMime:null,avatarUpdatedAt:null,driverProfile:null}));
  const db={
    order:{
      findMany:async(query:any)=>{
        roundTrips.push('orders');
        queries.push(query);
        const filtered=rows.filter(order=>(!query.where.driverId||order.driverId===query.where.driverId)
          &&(!query.where.clientId||order.clientId===query.where.clientId)
          &&(query.where.foodOrderId!==null||order.foodOrderId===null)
          &&(!query.where.createdAt.gte||order.createdAt>=query.where.createdAt.gte)
          &&(!query.where.createdAt.lt||order.createdAt<query.where.createdAt.lt))
          .sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime());
        return query.take?filtered.slice(0,query.take):filtered;
      },
      findUniqueOrThrow:async({where}:any)=>{roundTrips.push('one-order');return rows.find(order=>order.id===where.id)!;},
    },
    ledgerEntry:{findMany:async(query:any)=>{
      roundTrips.push('ledger');
      ledgerQueries.push(query);
      return ledger.filter(entry=>entry.driverId===query.where.driverId&&entry.kind===query.where.kind&&query.where.orderId.in.includes(entry.orderId));
    }},
    user:{findMany:async()=>{roundTrips.push('profiles');return users;}},
    $queryRaw:async()=>{roundTrips.push('ratings');return [];},
    statusHistory:{findMany:async()=>{roundTrips.push('history');return [];},findFirst:async()=>{roundTrips.push('one-history');return null;}},clientRating:{aggregate:async()=>{roundTrips.push('one-client-rating');return {_avg:{score:null}};}},
  };
  const auth={user:async(id:string)=>{roundTrips.push('one-profile');return mapUserProfile(users.find(user=>user.id===id)! as any,null);}};
  const service=new OrdersService(db as any,{} as any,{} as any,auth as any,{} as any,{} as any);
  return {service,queries,ledgerQueries,roundTrips};
}

test('order history accepts calendar ranges without changing food history validation',async()=>{
  const pipe=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
  const metadata={type:'query' as const,metatype:OrdersHistoryDto};
  const result=await pipe.transform({period:'month',from,to},metadata);
  assert.equal(result.period,'month');assert.equal(result.from,from);assert.equal(result.to,to);
  await assert.rejects(()=>pipe.transform({period:'month',from:'2026-02-30T00:00:00Z'},metadata));
  await assert.rejects(()=>pipe.transform({period:'month',to:'not-a-date'},metadata));
  await assert.rejects(()=>pipe.transform({period:'month'},{...metadata,metatype:HistoryDto}));
});

test('bounded driver history includes every trip, uses exclusive end and preserves charged fee sign',async()=>{
  const rows=Array.from({length:105},(_,index)=>fixture({id:`trip-${index}`,createdAt:new Date(new Date(from).getTime()+index*60000)}));
  rows.push(fixture({id:'before',createdAt:new Date(new Date(from).getTime()-1)}),fixture({id:'end',createdAt:new Date(to)}),
    fixture({id:'foreign',driverId:'other-driver'}),fixture({id:'cancelled',status:'CANCELLED'}));
  const {service,queries,ledgerQueries}=harness(rows,[
    {driverId:driver.id,orderId:'trip-0',kind:'COMMISSION',amount:-17},
    {driverId:'other-driver',orderId:'trip-1',kind:'COMMISSION',amount:-999},
    {driverId:driver.id,orderId:'cancelled',kind:'COMMISSION',amount:-10},
  ]);
  const result=await service.history(driver,'today',from,to);
  assert.equal(result.length,106);
  assert.equal(queries[0].take,undefined);
  assert.equal(queries[0].where.driverId,driver.id);
  assert.equal(queries[0].where.createdAt.gte.toISOString(),'2026-09-30T18:00:00.000Z');
  assert.equal(queries[0].where.createdAt.lt.toISOString(),'2026-10-01T18:00:00.000Z');
  assert.equal(result.some(order=>['before','end','foreign'].includes(order.id)),false);
  assert.equal(result.find(order=>order.id==='trip-0')?.commissionAmount,-17);
  assert.equal(result.find(order=>order.id==='trip-1')?.commissionAmount,0);
  assert.equal(result.find(order=>order.id==='cancelled')?.commissionAmount,0);
  assert.equal(result.filter(order=>order.status==='COMPLETED').reduce((sum,order)=>sum+order.price,0),10500);
  assert.equal(result[0].currency,'KGS');assert.equal(result[0].paymentMethod,'CASH');
  assert.equal(ledgerQueries[0].where.driverId,driver.id);
  assert.equal(ledgerQueries[0].where.orderId.in.includes('cancelled'),false);
  await assert.rejects(()=>service.serialize('foreign',false,driver.id),{status:403});
});

test('legacy history stays capped and client history never exposes driver financial records',async()=>{
  const rows=Array.from({length:105},(_,index)=>fixture({id:`trip-${index}`}));
  const {service,queries,ledgerQueries}=harness(rows,[{driverId:driver.id,orderId:'trip-0',kind:'COMMISSION',amount:-17}]);
  assert.equal((await service.history(driver,'all')).length,100);
  assert.equal(queries[0].take,100);
  const ledgerRequestCount=ledgerQueries.length;
  const result=await service.history(client,'all');
  assert.equal(result.length,100);assert.equal(queries[1].take,100);
  assert.equal(queries[1].where.clientId,client.id);assert.equal(queries[1].where.foodOrderId,null);
  assert.equal(result.some(order=>'commissionAmount' in order),false);
  assert.equal(ledgerQueries.length,ledgerRequestCount);
});

test('invalid or inverted ranges are rejected before reading orders',async()=>{
  const {service,queries}=harness([]);
  await assert.rejects(()=>service.history(driver,'all',to,from),{status:400});
  await assert.rejects(()=>service.history(driver,'all',from,from),{status:400});
  await assert.rejects(()=>service.history(driver,'all','invalid',to),{status:400});
  assert.equal(queries.length,0);
});

test('bulk history preserves direct snapshots with a constant query budget as repeated actors grow from 1 to 20 trips',async()=>{
  const queryCounts:number[]=[];
  for(const count of [1,20]) {
    const rows=Array.from({length:count},(_,index)=>fixture({id:`trip-${index}`,createdAt:new Date(new Date(from).getTime()+index*60000)}));
    const ledger=rows.map(order=>({driverId:driver.id,orderId:order.id,kind:'COMMISSION',amount:-10}));
    const {service,roundTrips}=harness(rows,ledger);
    const actual=await service.history(driver,'all');queryCounts.push(roundTrips.length);
    assert.ok(roundTrips.length<=6,`Bulk history used ${roundTrips.length} queries`);
    assert.equal(roundTrips.some(query=>query.startsWith('one-')),false,'Bulk history must not fall back to per-row reads');
    const expected=await Promise.all([...rows].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()).map(async order=>({...await service.serialize(order.id,false,driver.id),commissionAmount:-10})));
    assert.deepEqual(actual,expected);
  }
  assert.equal(queryCounts[0],queryCounts[1]);
});
