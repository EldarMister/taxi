import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DEMO_FOOD_RESTAURANTS, FOOD_PAYMENT_METHODS } from '../src/food-catalog';
import { assertFoodTransition, normalizeFoodRequest, priceFoodOrder } from '../src/food-domain';

const sushi=DEMO_FOOD_RESTAURANTS[0],kfc=DEMO_FOOD_RESTAURANTS[1];
const items=[{dishId:'philadelphia',quantity:2,optionIds:['soy','ginger']}];
const order={requestId:'request-food-0001',restaurantId:sushi.id,items,fulfillment:'DELIVERY' as const,address:'ул. Киевская, 123',comment:' Без звонка ',paymentMethod:'CASH' as const};

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
