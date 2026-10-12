import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SingleFlight} from '../src/single-flight';
import {catalogAudience,projectCatalog,legacyDishCompatible} from '../src/catalog-capabilities';
import {DEMO_FOOD_RESTAURANTS} from '../src/food-catalog';
import {priceFoodOrder} from '../src/food-domain';
test('100 identical concurrent computations perform one upstream call without sharing mutable results',async()=>{
  const flight=new SingleFlight<{geometry:number[]}>();let calls=0;
  const work=async()=>{calls++;await new Promise(done=>setTimeout(done,5));return {geometry:[1,2]};};
  const values=await Promise.all(Array.from({length:100},()=>flight.run('same-exact-route',work)));
  assert.equal(calls,1);values[0].geometry[0]=9;assert.deepEqual(values[1],{geometry:[1,2]});
  await flight.run('same-exact-route',work);assert.equal(calls,2,'no completed-result cache can mask a graph update');
});
test('different coordinates/options and failed computations do not share or poison subsequent results',async()=>{
  const flight=new SingleFlight<number>();let calls=0;
  await Promise.all(['a','b'].map(key=>flight.run(key,async()=>++calls)));assert.equal(calls,2);
  await assert.rejects(flight.run('c',async()=>{throw new Error('synthetic');}));assert.equal(await flight.run('c',async()=>3),3);
});
test('catalog audiences are independent and legacy never sees unsupported modifier prices or constraints',()=>{
  const restaurant=structuredClone(DEMO_FOOD_RESTAURANTS[0]);
  const dish=structuredClone(restaurant.dishes[0]);dish.id='advanced';dish.optionIds=[restaurant.options[0].id];dish.optionGroups=[{id:'required',name:'Required',optionIds:dish.optionIds,minSelected:1,maxSelected:1}];restaurant.dishes.push(dish);
  const legacy=projectCatalog([restaurant],'legacy'),modern=projectCatalog([restaurant],'food-modifiers-v2');
  assert.equal(legacy[0].dishes.some(item=>item.id==='advanced'),false);assert.equal(modern[0].dishes.some(item=>item.id==='advanced'),true);
  legacy[0].name='mutated';assert.notEqual(modern[0].name,'mutated');assert.notEqual(restaurant.name,'mutated');
  assert.equal(catalogAudience(undefined),'legacy');assert.equal(catalogAudience('arbitrary'),'legacy');assert.equal(catalogAudience('food-modifiers-v2'),'food-modifiers-v2');
});
test('server enforces modifiers and canonical PER_ITEM totals independently from presentation capability',()=>{
  const restaurant=structuredClone(DEMO_FOOD_RESTAURANTS[0]);restaurant.promotions=[];restaurant.minimumOrder=0;
  const dish=restaurant.dishes[0];dish.price=100;dish.optionIds=['extra'];dish.optionGroups=[{id:'required',name:'Required',optionIds:['extra'],minSelected:1,maxSelected:1}];
  restaurant.options=[{id:'extra',name:'Extra',price:25,priceScope:'PER_ITEM',imageKey:'soy'}];
  for(const capability of [undefined,'food-modifiers-v2','forged-admin']){
    catalogAudience(capability);
    assert.throws(()=>priceFoodOrder(restaurant,[{dishId:dish.id,quantity:2,optionIds:[]}],'PICKUP'));
    assert.equal(priceFoodOrder(restaurant,[{dishId:dish.id,quantity:2,optionIds:['extra']}],'PICKUP').total,225);
  }
  assert.equal(legacyDishCompatible(dish,restaurant),false);dish.available=false;assert.throws(()=>priceFoodOrder(restaurant,[{dishId:dish.id,quantity:2,optionIds:['extra']}],'PICKUP'));
});
