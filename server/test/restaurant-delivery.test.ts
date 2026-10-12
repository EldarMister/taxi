import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RestaurantDeliveryService } from '../src/restaurant-delivery';
import { isRestaurantDelivery, ordinaryClientOrders, syncRestaurantFoodStatus } from '../src/restaurant-delivery-state';
import { OrdersService } from '../src/orders';

const foodId='00000000-0000-4000-8000-000000000001';
const actor={id:'00000000-0000-4000-8000-000000000002'};
const clientId='00000000-0000-4000-8000-000000000003';
const tariff={id:'delivery',kind:'DELIVERY_CAR',active:true,basePrice:100,pricePerKm:20,pricePerMinute:0,minimumPrice:100,commissionBps:1000,waitingGraceMinutes:1,freeWaitingMinutes:5,waitingPricePerMinute:0};

function fixture(overrides:Record<string,unknown>={}) {
  let food:any={id:foodId,clientId,restaurantId:'sushi-roll',fulfillment:'DELIVERY',paymentMethod:'CASH',status:'READY',deliveryFee:0,subtotal:700,total:700,address:'ул. Киевская 77',deliveryPoint:{latitude:42.87,longitude:74.62},deliveryMethod:null,
    courierName:null,courierPhone:null,comment:'Позвоните у ворот',...overrides};
  const restaurant={catalog:{id:'sushi-roll',name:'Sushi Roll',address:'ул. Ленина 12',latitude:42.86,longitude:74.60,phone:'+996700000001'}};
  const member={role:'OWNER',permissions:['orders.read','orders.manage'],active:true};
  const hooks={afterRoute:()=>{}};
  const attempts:any[]=[],quotes:any[]=[],history:any[]=[],dispatches:string[]=[],published:string[]=[],changed:any[]=[];
  const withRelations=()=>({...food,restaurant,atlasDelivery:attempts.find(order=>order.foodOrderId===food.id)||null});
  const matches=(where:any)=>where.id===food.id&&(!where.restaurantId||where.restaurantId===food.restaurantId);
  const db:any={
    $queryRaw:async()=>[{id:food.id}],
    tariff:{findFirst:async()=>tariff},
    statusHistory:{findFirst:async()=>({actorId:actor.id})},
    restaurantAccount:{findUnique:async()=>({id:actor.id,active:true,sessionVersion:0})},
    restaurantMembership:{findFirst:async()=>member.active?member:null},
    foodOrder:{
      findFirst:async({where}:any)=>matches(where)?withRelations():null,
      findFirstOrThrow:async({where}:any)=>{assert.ok(matches(where));return withRelations();},
      findUnique:async()=>({...food}),
      update:async({data}:any)=>{const {history:entry,...fields}=data;food={...food,...fields};if(entry)history.push(entry.create);return {...food};},
    },
    quote:{create:async({data}:any)=>{const quote={id:`quote-${quotes.length}`, ...data};quotes.push(quote);return quote;}},
    order:{
      create:async({data}:any)=>{const order={id:`attempt-${attempts.length}`,driverId:null,...data};attempts.push(order);return {...order};},
      update:async({where,data}:any)=>{const order=attempts.find(order=>order.id===where.id);Object.assign(order,data);return {...order};},
    },
  };
  let queue:Promise<unknown>=Promise.resolve();
  db.$transaction=(work:any)=>{const task=queue.then(()=>work(db));queue=task.catch(()=>{});return task;};
  const routes:any[]=[];
  const routing={route:async(pickup:any,dropoff:any)=>{routes.push({pickup,dropoff});hooks.afterRoute();return {geometry:{type:'LineString',coordinates:[[74.60,42.86],[74.62,42.87]]},distanceMeters:2000,durationSeconds:300,provider:'test'};}};
  const orders={dispatchOrder:async(id:string)=>{dispatches.push(id);},publish:async(id:string)=>{published.push(id);}};
  const service=new RestaurantDeliveryService(db,routing as any,orders as any,{changed:(order:any)=>changed.push(order),serialize:(order:any)=>({...order})} as any);
  return {service,db,routes,attempts,quotes,history,dispatches,published,changed,member,hooks,food:()=>food};
}

test('own courier dispatch is scoped, starts only ready orders and repeated taps do not create history twice',async()=>{
  const h=fixture();
  await assert.rejects(h.service.dispatch(actor,'another-restaurant',foodId,{method:'OWN'}),/не найден/);
  const result=await h.service.dispatch(actor,'sushi-roll',foodId,{method:'OWN',courierName:' Курьер ',courierPhone:'+996700000002'});
  assert.equal(result.status,'DELIVERING');assert.equal(result.courierName,'Курьер');assert.equal(result.deliveryMethod,'OWN');
  await h.service.dispatch(actor,'sushi-roll',foodId,{method:'OWN'});
  assert.equal(h.history.length,1);assert.equal(h.attempts.length,0);assert.equal(h.routes.length,0);
  await assert.rejects(h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR'}),/вашему курьеру/);
  const notReady=fixture({status:'PREPARING'});
  await assert.rejects(notReady.service.dispatch(actor,'sushi-roll',foodId,{method:'OWN'}),/готовым/);
});

test('concurrent Atlas dispatch uses one real delivery order with the current tariff even when customer delivery is free',async()=>{
  const h=fixture();
  const results=await Promise.all(Array.from({length:6},()=>h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR'})));
  assert.equal(h.attempts.length,1);assert.equal(h.quotes.length,1);
  assert.ok(results.every(order=>order.atlasDelivery.id===h.attempts[0].id));
  assert.equal(h.attempts[0].kind,'DELIVERY_CAR');assert.equal(h.attempts[0].price,140);assert.equal(h.attempts[0].commission,14);
  assert.equal(h.attempts[0].foodOrderId,foodId);assert.equal(h.attempts[0].clientId,clientId);
  assert.equal(h.attempts[0].deliveryDetails.deliveryPayer,'RESTAURANT');assert.equal(h.food().deliveryFee,0);assert.equal(h.food().total,700);
  assert.equal(h.attempts[0].deliveryDetails.cashToCollect,700);assert.equal(h.attempts[0].deliveryDetails.deliveryPrice,140);
  assert.match(h.attempts[0].comment,/С клиента за еду: 700 сом/);
  assert.equal(h.food().status,'READY','food is not on the way until the driver actually picks it up');
  assert.ok(h.dispatches.every(id=>id===h.attempts[0].id));
  await assert.rejects(h.service.dispatch(actor,'sushi-roll',foodId,{method:'OWN'}),/уже назначена/);
});

test('quote is read-only and a changed courier price is rejected before dispatch',async()=>{
  const h=fixture();
  const quote=await h.service.quote(actor,'sushi-roll',foodId,{method:'ATLAS_CAR'});
  assert.deepEqual(quote,{price:140,currency:'KGS',deliveryPayer:'RESTAURANT'});
  assert.equal(h.attempts.length,0);assert.equal(h.quotes.length,0);assert.equal(h.history.length,0);
  await assert.rejects(h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR',expectedPrice:100}),/Стоимость изменилась/);
  assert.equal(h.attempts.length,0);assert.equal(h.quotes.length,0);
  await h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR',expectedPrice:140});
  assert.equal(h.attempts.length,1);
});

test('rights revoked during route calculation prevent all dispatch writes',async()=>{
  const h=fixture();h.member.role='MANAGER';
  h.hooks.afterRoute=()=>{h.member.permissions=['orders.read'];};
  await assert.rejects(h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR'}),/не предоставил доступ/);
  assert.equal(h.attempts.length,0);assert.equal(h.quotes.length,0);assert.equal(h.history.length,0);
  const disabled=fixture();disabled.member.active=false;
  await assert.rejects(disabled.service.dispatch(actor,'sushi-roll',foodId,{method:'OWN'}),/Нет доступа/);
});

test('failed Atlas attempts remain auditable and a retry creates exactly one fresh linked trip',async()=>{
  const h=fixture();
  await h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR'});
  const first=h.attempts[0];first.status='NO_DRIVER';
  await syncRestaurantFoodStatus(h.db,first,'NO_DRIVER');
  assert.equal(h.food().status,'READY');
  await h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR'});
  assert.equal(h.attempts.length,2);assert.equal(first.foodOrderId,null);assert.equal(first.deliveryDetails.foodOrderId,foodId);
  assert.equal(isRestaurantDelivery(first),true,'detached attempts remain distinguishable from ordinary client deliveries');
  assert.notEqual(h.attempts[1].idempotencyKey,first.idempotencyKey);
  assert.equal(h.attempts[1].foodOrderId,foodId);
  assert.ok(h.history.some(entry=>entry.reason.includes(`RETRY:${first.id}`)));
});

test('delivery requires validated restaurant/destination coordinates and never invents a destination',async()=>{
  const h=fixture({deliveryPoint:null});
  await assert.rejects(h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR'}),/нет точки/);
  await assert.rejects(h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR',deliveryLat:181,deliveryLng:74}),/корректные координаты/);
  assert.equal(h.attempts.length,0);assert.equal(h.routes.length,0);
  await h.service.dispatch(actor,'sushi-roll',foodId,{method:'ATLAS_CAR',deliveryLat:42.87,deliveryLng:74.62});
  assert.deepEqual(h.food().deliveryPoint,{latitude:42.87,longitude:74.62});
});

test('driver pickup/completion change the food atomically, while delivery failure never cancels the meal',async()=>{
  const h=fixture({deliveryMethod:'ATLAS_CAR'});
  const trip={id:'driver-trip',foodOrderId:foodId};
  assert.equal(await syncRestaurantFoodStatus(h.db,trip,'ASSIGNED'),null);
  assert.equal(h.food().status,'READY');
  await syncRestaurantFoodStatus(h.db,trip,'IN_PROGRESS',actor.id);assert.equal(h.food().status,'DELIVERING');
  await syncRestaurantFoodStatus(h.db,trip,'CANCELLED',actor.id);assert.equal(h.food().status,'READY');
  await syncRestaurantFoodStatus(h.db,trip,'IN_PROGRESS',actor.id);
  await syncRestaurantFoodStatus(h.db,trip,'COMPLETED',actor.id);assert.equal(h.food().status,'COMPLETED');assert.ok(h.food().completedAt);
  assert.equal(await syncRestaurantFoodStatus(h.db,trip,'NO_DRIVER'),null,'a late courier event must not reopen a completed meal');
});

test('restaurant trips are excluded from client taxi lists but stay in driver lists',async()=>{
  const queries:any[]=[];
  const db={order:{findFirst:async(query:any)=>{queries.push(query);return null;},findMany:async(query:any)=>{queries.push(query);return [];}}};
  const service=new OrdersService(db as any,{} as any,{} as any,{} as any,{} as any,{} as any);
  await service.active({id:clientId,role:'CLIENT'} as any);await service.history({id:clientId,role:'CLIENT'} as any,'all');
  for(const query of queries){assert.equal(query.where.foodOrderId,null);assert.deepEqual(query.where.NOT,ordinaryClientOrders.NOT);}
  queries.length=0;await service.active({id:actor.id,role:'DRIVER'} as any);await service.history({id:actor.id,role:'DRIVER'} as any,'all');
  for(const query of queries){assert.equal(query.where.foodOrderId,undefined);assert.equal(query.where.NOT,undefined);assert.equal(query.where.driverId,actor.id);}
});

test('courier state publishes the food event to its client and the taxi event only to the driver',async()=>{
  const delivered:any[]=[];
  const meal={id:foodId,clientId,status:'DELIVERING'};
  const db={foodOrder:{findUnique:async()=>meal},orderOffer:{findMany:async()=>[]}};
  const events={publish:(users:string[],event:string,payload:unknown)=>delivered.push({users,event,payload}),adminChanged:()=>{}};
  const service=new OrdersService(db as any,{} as any,{} as any,{} as any,events as any,{} as any);
  service.serialize=async()=>({id:'trip',foodOrderId:foodId,restaurantDelivery:true,status:'IN_PROGRESS',client:{id:clientId},driver:{id:actor.id}} as any);
  await service.publish('trip');
  assert.deepEqual(delivered.find(event=>event.event==='order:updated').users,[actor.id]);
  assert.deepEqual(delivered.find(event=>event.event==='food:order:updated').users,[clientId]);
  assert.equal(delivered.find(event=>event.event==='food:order:updated').payload.status,'DELIVERING');
});
