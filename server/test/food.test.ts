import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DEMO_FOOD_RESTAURANTS, FOOD_PAYMENT_METHODS } from '../src/food-catalog';
import { assertFoodTransition, normalizeFoodBatch, normalizeFoodRequest, priceFoodOrder } from '../src/food-domain';

const sushi=DEMO_FOOD_RESTAURANTS[0],kfc=DEMO_FOOD_RESTAURANTS[1];
const items=[{dishId:'philadelphia',quantity:2,optionIds:['soy','ginger']}];
const order={requestId:'request-food-0001',restaurantId:sushi.id,items,fulfillment:'DELIVERY' as const,address:'ул. Киевская, 123',comment:' Без звонка ',paymentMethod:'CASH' as const};

test('mandatory variants and one-off add-ons use the same prices as the client', () => {
  const menu = structuredClone(sushi);
  menu.dishes[0].optionGroups = [{ id: 'sauce', name: 'Соус', optionIds: ['soy', 'ginger'], minSelected: 1, maxSelected: 1 }];
  menu.options[0].price = 30;
  menu.options[2].price = 50;
  menu.options[2].priceScope = 'PER_ITEM';
  assert.throws(() => priceFoodOrder(menu, [{ dishId: 'philadelphia', quantity: 2, optionIds: [] }], 'DELIVERY'), BadRequestException);
  assert.throws(() => priceFoodOrder(menu, items, 'DELIVERY'), BadRequestException);
  const priced = priceFoodOrder(menu, [{ dishId: 'philadelphia', quantity: 3, optionIds: ['soy', 'wasabi'] }], 'DELIVERY');
  assert.equal(priced.subtotal, 1700);
  assert.equal(priced.items[0].lineTotal, 1700);
});

test('food totals use catalog prices and charge paid options for every portion',()=>{
  assert.equal(priceFoodOrder(sushi,items,'DELIVERY').total,1040);
  const modified=structuredClone(sushi);modified.options[0].price=30;
  const result=priceFoodOrder(modified,items,'DELIVERY');
  assert.equal(result.subtotal,1100);assert.equal(result.items[0].lineTotal,1100);assert.equal(result.items[0].unitPrice,520);
  const chicken=[{dishId:'chicken-burger',quantity:1,optionIds:[]}];
  assert.equal(priceFoodOrder(kfc,chicken,'DELIVERY').total,390);
  assert.equal(priceFoodOrder(kfc,chicken,'PICKUP').total,290);
});

test('delivery becomes free at the configured order subtotal',()=>{
  const chicken=[{dishId:'chicken-burger',quantity:3,optionIds:[]}];
  const below=priceFoodOrder(kfc,chicken,'DELIVERY');
  assert.equal(below.subtotal,870);assert.equal(below.deliveryFee,100);
  const basket=[{dishId:'chicken-bucket',quantity:2,optionIds:[]}];
  const free=priceFoodOrder(kfc,basket,'DELIVERY');
  assert.equal(free.subtotal,1300);assert.equal(free.deliveryFee,0);assert.equal(free.total,1300);
  const legacy=priceFoodOrder({...kfc,freeDeliveryThreshold:0},basket,'DELIVERY');
  assert.equal(legacy.deliveryFee,100);
});
test('food price validation rejects foreign dishes, duplicate or foreign options, invalid quantity, and minimum basket',()=>{
  assert.throws(()=>priceFoodOrder({...sushi,isOpen:false},items,'DELIVERY'),/Ресторан сейчас закрыт/);
  assert.throws(()=>priceFoodOrder({...sushi,isOpen:false},items,'PICKUP'),/Ресторан сейчас закрыт/);
  assert.equal(priceFoodOrder({...sushi,isOpen:true},items,'DELIVERY').total,1040);
  for(const quantity of [0,-1,1.5,100,NaN])assert.throws(()=>priceFoodOrder(sushi,[{...items[0],quantity}],'DELIVERY'),BadRequestException);
  for(const optionIds of [['missing'],['soy','soy']])assert.throws(()=>priceFoodOrder(sushi,[{...items[0],optionIds}],'DELIVERY'),BadRequestException);
  assert.throws(()=>priceFoodOrder(kfc,items,'DELIVERY'),BadRequestException);
  assert.throws(()=>priceFoodOrder(sushi,[],'DELIVERY'),BadRequestException);
  assert.throws(()=>priceFoodOrder(sushi,[{...items[0],quantity:50},{dishId:'salmon',quantity:50,optionIds:[]}],'DELIVERY'),BadRequestException);
  assert.throws(()=>priceFoodOrder({...sushi,minimumOrder:2000},items,'DELIVERY'),BadRequestException);
  const unavailable=structuredClone(sushi);unavailable.dishes[0].available=false;
  assert.throws(()=>priceFoodOrder(unavailable,items,'DELIVERY'),BadRequestException);
});
test('food request hash is stable for option order and whitespace but binds quantity, fulfillment and address',()=>{
  const normal=normalizeFoodRequest(order);
  assert.equal(normal.requestHash,normalizeFoodRequest({...order,comment:'Без звонка',items:[{...items[0],optionIds:['ginger','soy']}]}).requestHash);
  assert.notEqual(normal.requestHash,normalizeFoodRequest({...order,items:[{...items[0],quantity:1}]}).requestHash);
  assert.notEqual(normal.requestHash,normalizeFoodRequest({...order,address:'ул. Киевская, 125'}).requestHash);
  assert.notEqual(normal.requestHash,normalizeFoodRequest({...order,fulfillment:'PICKUP'}).requestHash);
  assert.equal(normalizeFoodRequest({...order,fulfillment:'PICKUP'}).address,'');
});
test('delivery needs a real entered address and unavailable payment methods cannot be submitted',()=>{
  assert.throws(()=>normalizeFoodRequest({...order,address:'    '}),BadRequestException);
  for(const paymentMethod of ['CARD','ONLINE'] as const)assert.throws(()=>normalizeFoodRequest({...order,paymentMethod}),BadRequestException);
  assert.deepEqual(FOOD_PAYMENT_METHODS.filter(method=>method.available).map(method=>method.id),['CASH']);
});
test('food progress requires administrator actions in order and handles pickup separately',()=>{
  assert.throws(()=>assertFoodTransition('CLIENT','PLACED','CONFIRMED','DELIVERY'),ForbiddenException);
  assert.throws(()=>assertFoodTransition('DRIVER','PREPARING','READY','DELIVERY'),ForbiddenException);
  assert.throws(()=>assertFoodTransition('ADMIN','PLACED','COMPLETED','DELIVERY'),BadRequestException);
  assert.throws(()=>assertFoodTransition('ADMIN','COMPLETED','PREPARING','DELIVERY'),BadRequestException);
  assert.throws(()=>assertFoodTransition('ADMIN','READY','DELIVERING','PICKUP'),BadRequestException);
  assert.doesNotThrow(()=>assertFoodTransition('ADMIN','READY','COMPLETED','PICKUP'));
  assert.doesNotThrow(()=>assertFoodTransition('ADMIN','READY','DELIVERING','DELIVERY'));
  assert.doesNotThrow(()=>assertFoodTransition('ADMIN','CANCELLED','CANCELLED','DELIVERY'));
});

const chickenOrder={...order,requestId:'request-food-0002',restaurantId:kfc.id,items:[{dishId:'chicken-burger',quantity:1,optionIds:[]}]};
const batch=()=>({orders:structuredClone([order,chickenOrder])});

test('batch retries bind every request key to the same full checkout independent of restaurant order',()=>{
  const original=normalizeFoodBatch(batch());
  const reversed=normalizeFoodBatch({orders:batch().orders.reverse()});
  assert.equal(original[0].requestHash,reversed[1].requestHash);
  assert.equal(original[1].requestHash,reversed[0].requestHash);
  const changed=batch();changed.orders[1].items[0].quantity=2;
  assert.notEqual(original[0].requestHash,normalizeFoodBatch(changed)[0].requestHash);
  assert.notEqual(original[0].requestHash,normalizeFoodBatch({orders:[order]})[0].requestHash);
  assert.throws(()=>normalizeFoodBatch({orders:[]}),BadRequestException);
  assert.throws(()=>normalizeFoodBatch({orders:[order,order]}),BadRequestException);
  assert.throws(()=>normalizeFoodBatch({orders:[order,{...chickenOrder,requestId:order.requestId}]}),BadRequestException);
});

// Nest parameter decorators need the emitted server build, as in the other service tests.
const {FoodService}=require('../dist/src/food.js');
const actor={id:'00000000-0000-0000-0000-000000000001',role:'CLIENT'};
function foodServiceFixture() {
  const state={orders:[] as any[],catalog:structuredClone(DEMO_FOOD_RESTAURANTS),role:'CLIENT',writeAttempts:0,failWriteAt:0};
  const published:any[]=[];
  const filter=(rows:any[],where:any)=>rows.filter(row=>(!where.id||row.id===where.id)&&(!where.clientId||row.clientId===where.clientId)&&(!where.requestId||where.requestId.in.includes(row.requestId))&&(!where.status||where.status.in.includes(row.status)));
  const tx={
    $queryRaw:async()=>[],
    user:{findUnique:async()=>({role:state.role})},
    foodRestaurant:{findFirst:async({where}:any)=>{
      const catalog=state.catalog.find(restaurant=>restaurant.id===where.id);
      return catalog&&where.isDemo!==false?{id:catalog.id,catalog,isDemo:true}:null;
    }},
    foodOrder:{
      findUnique:async({where}:any)=>state.orders.find(row=>row.clientId===where.clientId_requestId.clientId&&row.requestId===where.clientId_requestId.requestId)??null,
      findFirst:async({where}:any)=>filter(state.orders,where)[0]??null,
      findMany:async({where}:any)=>filter(state.orders,where),
      create:async({data}:any)=>{
        state.writeAttempts++;
        if(state.writeAttempts===state.failWriteAt)throw new Error('Database write failed');
        const row={...data,id:`order-${state.orders.length+1}`,status:'PLACED',createdAt:new Date(),updatedAt:new Date(),completedAt:null};
        state.orders.push(row);return row;
      },
    },
  };
  const db={...tx,$transaction:async(work:(transaction:any)=>Promise<any>)=>{
    const previous=structuredClone(state.orders);
    try{return await work(tx);}catch(error){state.orders=previous;throw error;}
  }};
  const events={publish:(...args:any[])=>published.push(args),adminChanged:()=>{}};
  const service=new FoodService(db,{development:true},{take:async()=>{}},{},events);
  return {state,published,service};
}

test('batch creates separate restaurant orders with independently calculated fees and an aggregate total',async()=>{
  const {service,state,published}=foodServiceFixture();
  const result=await service.createBatch(actor,batch());
  assert.equal(result.orders.length,2);assert.equal(state.orders.length,2);
  assert.equal(result.orders[0].total,1040);assert.equal(result.orders[1].subtotal,290);
  assert.equal(result.orders[1].deliveryFee,100);assert.equal(result.total,1430);assert.equal(result.currency,'KGS');
  assert.deepEqual(result.orders.map((item:any)=>item.restaurant.id),[sushi.id,kfc.id]);
  assert.equal(published.length,2);assert.equal(state.orders[0].history.create.actorId,actor.id);
});

test('exact batch retries reuse both orders without writes or duplicate events even after completion',async()=>{
  const {service,state,published}=foodServiceFixture();
  const created=await service.createBatch(actor,batch());
  state.orders.forEach(row=>{row.status='COMPLETED';});state.catalog=[];
  const retried=await service.createBatch(actor,{orders:batch().orders.reverse()});
  assert.deepEqual(retried.orders.map((item:any)=>item.id),created.orders.map((item:any)=>item.id).reverse());
  assert.equal(state.writeAttempts,2);assert.equal(published.length,2);
});

test('batch changed data and subset retries cannot create or reuse a partial checkout',async()=>{
  const {service,state}=foodServiceFixture();
  await service.createBatch(actor,batch());
  const changed=batch();changed.orders[1].address='ул. Киевская, 125';
  await assert.rejects(()=>service.createBatch(actor,changed),ConflictException);
  await assert.rejects(()=>service.createBatch(actor,{orders:[order]}),ConflictException);
  await assert.rejects(()=>service.create(actor,order),ConflictException);
  assert.equal(state.orders.length,2);assert.equal(state.writeAttempts,2);
});

test('an unavailable dish in another restaurant prevents all batch writes',async()=>{
  const {service,state,published}=foodServiceFixture();
  const invalid=batch();invalid.orders[0].items[0].dishId='unavailable';
  await assert.rejects(()=>service.createBatch(actor,invalid),BadRequestException);
  assert.equal(state.writeAttempts,0);assert.equal(state.orders.length,0);assert.equal(published.length,0);
});

test('an unavailable restaurant and a disabled payment in another cart reject the whole batch',async()=>{
  const {service,state}=foodServiceFixture();
  state.catalog=state.catalog.filter(restaurant=>restaurant.id!==sushi.id);
  await assert.rejects(()=>service.createBatch(actor,batch()),NotFoundException);
  const disabled={orders:[order,{...chickenOrder,paymentMethod:'CARD'}]};
  await assert.rejects(()=>service.createBatch(actor,disabled),BadRequestException);
  assert.equal(state.orders.length,0);assert.equal(state.writeAttempts,0);
});

test('a failed database write rolls back all restaurant orders and emits no success events',async()=>{
  const {service,state,published}=foodServiceFixture();state.failWriteAt=2;
  await assert.rejects(()=>service.createBatch(actor,batch()),/Database write failed/);
  assert.equal(state.writeAttempts,2);assert.equal(state.orders.length,0);assert.equal(published.length,0);
  state.failWriteAt=0;
  assert.equal((await service.createBatch(actor,batch())).orders.length,2);
});

test('new confirmations remain blocked during an active group and stale client roles are rechecked',async()=>{
  const {service,state}=foodServiceFixture();
  await service.createBatch(actor,batch());
  await assert.rejects(()=>service.createBatch(actor,{orders:batch().orders.map((item,index)=>({...item,requestId:`new-request-${index}`}))}),ConflictException);
  await assert.rejects(()=>service.create(actor,{...order,requestId:'new-request-single'}),ConflictException);
  state.role='DRIVER';
  await assert.rejects(()=>service.createBatch(actor,batch()),ForbiddenException);
  assert.equal(state.orders.length,2);
});

test('active-all restores every active restaurant and keeps other clients and completed orders private',async()=>{
  const {service,state}=foodServiceFixture();
  const created=await service.createBatch(actor,batch());
  assert.deepEqual((await service.activeAll(actor)).map((item:any)=>item.id),created.orders.map((item:any)=>item.id));
  assert.deepEqual(await service.activeAll({...actor,id:'another-client'}),[]);
  state.orders[0].status='COMPLETED';
  assert.deepEqual((await service.activeAll(actor)).map((item:any)=>item.id),[created.orders[1].id]);
});
