import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrdersService } from '../src/orders';

function fixture({expired=false,reserveAfterLock=false,revokeAfterLock=false}={}) {
  const now=Date.now(),order:any={id:'order',clientId:'client',quoteId:'quote',kind:'RIDE',commission:10,status:'SEARCHING',pickup:{latitude:42.8756,longitude:74.604},dispatchAfter:new Date(now-1000),searchExpiresAt:new Date(now+(expired?-1000:30000)),history:[]};
  const profiles:any[]=[0,1].map(index=>({userId:`driver-${index}`,verified:true,online:true,deposit:1000,transportClass:'ECONOMY',acceptsEconomy:true,locationLatitude:42.8756,locationLongitude:74.604+index*.01,locationMeasuredAt:new Date(now),vehicle:{id:`vehicle-${index}`},user:{role:'DRIVER',deletedAt:null}}));
  const created:any[]=[],sql:string[]=[],held=new Set<string>();let maxHeld=0;
  const tx:any={
    $executeRawUnsafe:async(statement:string)=>{sql.push(statement);if(statement.startsWith('ROLLBACK TO SAVEPOINT'))held.clear();},
    $queryRaw:async(strings:TemplateStringsArray,...values:any[])=>{
      const statement=strings.join('?');sql.push(statement);
      if(statement.includes('FROM "DriverProfile"')){held.add(values[0]);maxHeld=Math.max(maxHeld,held.size);return[{userId:values[0]}];}
      return[];
    },
    driverProfile:{findMany:async()=>profiles,findUnique:async({where}:any)=>{const current=profiles.find(profile=>profile.userId===where.userId);return revokeAfterLock&&where.userId==='driver-0'?{...current,user:{role:'CLIENT',deletedAt:null}}:current;}},
    quote:{findUniqueOrThrow:async()=>({tariff:{requiredClass:'ECONOMY'}})},
    order:{findUnique:async()=>order,findMany:async()=>[],findFirst:async()=>null,update:async({data}:any)=>{if(data.history)order.history.push(data.history.create);Object.assign(order,{...data,history:order.history});return order;}},
    orderOffer:{findMany:async()=>[],findFirst:async()=>reserveAfterLock?{id:'foreign-reservation',expiresAt:new Date(Date.now()+600000)}:null,create:async({data}:any)=>{created.push(data);return data;},updateMany:async()=>({count:0})},
    pushJob:{createMany:async()=>({count:1})},
  };
  const service=new OrdersService({$transaction:async(callback:any)=>callback(tx)} as any,{minimumDeposit:100} as any,{} as any,{} as any,{publish(){}} as any,{} as any);
  service.serialize=async()=>({id:order.id,status:order.status} as any);service.publish=async()=>{};
  return{service,order,created,sql,maxHeld:()=>maxHeld};
}

test('foreign reservations discovered only after locking cannot renew an expired own search deadline',async()=>{
  const h=fixture({expired:true,reserveAfterLock:true}),deadline=h.order.searchExpiresAt.getTime();
  await h.service.dispatchOrder(h.order.id);
  assert.equal(h.order.status,'NO_DRIVER');assert.equal(h.order.searchExpiresAt.getTime(),deadline);assert.equal(h.created.length,0);
  assert.equal(h.maxHeld(),1,'a rejected candidate lock is released before the next attempt');
  assert.equal(h.sql.filter(statement=>statement.startsWith('ROLLBACK TO SAVEPOINT')).length,2);
  await h.service.dispatchOrder(h.order.id);
  assert.equal(h.order.history.filter((item:any)=>item.status==='NO_DRIVER').length,1);
});

test('fresh role revocation under the selected profile lock rejects that candidate and preserves next-driver ranking',async()=>{
  const h=fixture({revokeAfterLock:true});
  await h.service.dispatchOrder(h.order.id);
  assert.equal(h.created.length,1);assert.equal(h.created[0].driverId,'driver-1');assert.equal(h.maxHeld(),1);
  assert.equal(h.sql.filter(statement=>statement.startsWith('ROLLBACK TO SAVEPOINT')).length,1);
});
