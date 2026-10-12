import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_FOOD_RESTAURANTS, FoodPromotion } from '../src/food-catalog';
import { priceFoodOrder } from '../src/food-domain';
import { applyFoodPromotionsForDisplay } from '../src/food-promotions';
test('best promotion applies to dish prices once, keeps modifier prices and uses pre-discount eligibility',()=>{
  const restaurant=structuredClone(DEMO_FOOD_RESTAURANTS[0]);
  restaurant.minimumOrder=0;restaurant.deliveryFee=100;restaurant.dishes=[{...restaurant.dishes[0],price:200,optionIds:['extra'],optionGroups:[]}];restaurant.options=[{id:'extra',name:'Extra',price:50,imageKey:''}];
  const base={minSubtotal:0,dishIds:[],active:true};
  restaurant.promotions=[{...base,id:'fixed',title:'Fixed',type:'FIXED',value:30},{...base,id:'percent',title:'Percent',type:'PERCENT',value:20,minSubtotal:500},{...base,id:'free',title:'Free',type:'FREE_DELIVERY',value:0,minSubtotal:500}];
  const displayed=applyFoodPromotionsForDisplay(restaurant);
  assert.equal(displayed.dishes[0].price,170);
  const result=priceFoodOrder(restaurant,[{dishId:restaurant.dishes[0].id,quantity:2,optionIds:['extra']}],'DELIVERY');
  assert.equal(result.items[0].unitPrice,160);assert.equal(result.subtotal,420);assert.equal(result.deliveryFee,0);assert.equal(result.total,420);
});
test('expired, future, disabled and nonmatching dish promotions never reduce prices',()=>{
  const restaurant=structuredClone(DEMO_FOOD_RESTAURANTS[0]);
  const base:FoodPromotion={id:'expired',title:'Discount',type:'PERCENT',value:90,minSubtotal:0,dishIds:[],active:true};
  restaurant.promotions=[{...base,endsAt:'2020-01-01T00:00:00Z'},{...base,id:'future',startsAt:'2099-01-01T00:00:00Z'},{...base,id:'disabled',active:false},{...base,id:'other',dishIds:['missing']}];
  assert.equal(applyFoodPromotionsForDisplay(restaurant).dishes[0].price,restaurant.dishes[0].price);
});
