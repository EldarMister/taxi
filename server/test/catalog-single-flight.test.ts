import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import express, { Request, Response } from 'express';
import request from 'supertest';
import type { FoodService } from '../src/food';
import type { FoodCatalogController } from '../src/food.http';
import type { CatalogAudience } from '../src/catalog-capabilities';
import { DEMO_FOOD_RESTAURANTS } from '../src/food-catalog';

const { FoodService: FoodServiceConstructor } = require('../dist/src/food') as { FoodService: new(...args:any[])=>FoodService };
const { FoodCatalogController: CatalogControllerConstructor } = require('../dist/src/food.http') as { FoodCatalogController: new(service:FoodService)=>FoodCatalogController };

function deferred() {
  let release!:()=>void;
  const promise=new Promise<void>(resolve=>{release=resolve;});
  return {promise,release};
}

function fixtures() {
  const catalog=structuredClone(DEMO_FOOD_RESTAURANTS[0]);
  catalog.id='real';catalog.isDemo=false;catalog.name='Ресторан <меню> & JSON';catalog.deliveryFee=100;
  catalog.dishes=[
    {...catalog.dishes[0],id:'legacy',price:100,optionIds:[],optionGroups:undefined,defaultOptionIds:undefined,originalPrice:undefined},
    {...catalog.dishes[0],id:'modern',price:200,optionIds:['choice'],optionGroups:[{id:'required',name:'Вариант',optionIds:['choice'],minSelected:1,maxSelected:1}],defaultOptionIds:['choice'],originalPrice:undefined},
  ];
  catalog.options=[{id:'choice',name:'Соус',price:30,imageKey:'soy',priceScope:'PER_ITEM'}];
  catalog.promotions=[
    {id:'active',title:'Скидка',type:'PERCENT',value:20,minSubtotal:0,dishIds:['legacy'],active:true,startsAt:'2020-01-01',endsAt:'2099-01-01'},
    {id:'expired',title:'Истекла',type:'FIXED',value:99,minSubtotal:0,dishIds:['legacy'],active:true,endsAt:'2020-01-01'},
    {id:'delivery',title:'Доставка',type:'FREE_DELIVERY',value:0,minSubtotal:0,dishIds:[],active:true},
  ];
  return [
    {id:'real',active:true,isDemo:false,sortOrder:0,catalog},
    {id:'demo',active:true,isDemo:true,sortOrder:1,catalog:{...structuredClone(catalog),id:'demo',isDemo:true}},
    {id:'inactive',active:false,isDemo:false,sortOrder:2,catalog:{...structuredClone(catalog),id:'inactive'}},
  ];
}

function harness(development=true) {
  const config={development};
  const state={rows:fixtures(),wait:Promise.resolve(),failure:undefined as Error|undefined};
  const calls:any[]=[];
  const db={foodRestaurant:{findMany:async(args:any)=>{
    calls.push(structuredClone(args));
    const snapshot=structuredClone(state.rows.filter(row=>row.active&&(!('isDemo' in args.where)||row.isDemo===args.where.isDemo)).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)));
    const failure=state.failure;await state.wait;if(failure)throw failure;return snapshot;
  }}};
  const service=new FoodServiceConstructor(db,config,{}, {}, {});
  return {service,config,state,calls};
}

test('100 simultaneous requests for the same public audience perform one catalog query',async()=>{
  const h=harness(),gate=deferred();h.state.wait=gate.promise;
  const pending=Array.from({length:100},()=>h.service.catalogJson('food-modifiers-v2'));
  await Promise.resolve();assert.equal(h.calls.length,1);gate.release();
  const values=await Promise.all(pending);assert.equal(new Set(values).size,1);
  assert.deepEqual(JSON.parse(values[0]).restaurants.map((row:any)=>row.id),['real','demo']);
  assert.equal(h.calls.length,1);
});

test('legacy and modifiers-v2 overlap in separate flights and preserve their projections',async()=>{
  const h=harness(),gate=deferred();h.state.wait=gate.promise;
  const legacy=Array.from({length:50},()=>h.service.catalogJson('legacy'));
  const modern=Array.from({length:50},()=>h.service.catalogJson('food-modifiers-v2'));
  await Promise.resolve();assert.equal(h.calls.length,2);gate.release();
  const [oldValues,newValues]=await Promise.all([Promise.all(legacy),Promise.all(modern)]);
  assert.equal(new Set(oldValues).size,1);assert.equal(new Set(newValues).size,1);
  const oldBody=JSON.parse(oldValues[0]),newBody=JSON.parse(newValues[0]);
  assert.deepEqual(oldBody.restaurants[0].dishes.map((dish:any)=>dish.id),['legacy']);
  assert.deepEqual(newBody.restaurants[0].dishes.map((dish:any)=>dish.id),['legacy','modern']);
  assert.equal(newBody.restaurants[0].options[0].priceScope,'PER_ITEM');
  assert.notEqual(oldValues[0],newValues[0]);
});

test('development and production demo filtering are part of the pending-flight key',async()=>{
  const h=harness(),gate=deferred();h.state.wait=gate.promise;
  const development=h.service.catalogJson('food-modifiers-v2');await Promise.resolve();
  h.config.development=false;
  const production=h.service.catalogJson('food-modifiers-v2');await Promise.resolve();
  assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].where,{active:true});assert.deepEqual(h.calls[1].where,{active:true,isDemo:false});
  gate.release();const [dev,prod]=await Promise.all([development,production]);
  assert.equal(JSON.parse(dev).isDemo,true);assert.equal(JSON.parse(prod).isDemo,false);
  assert.deepEqual(JSON.parse(prod).restaurants.map((row:any)=>row.id),['real']);
});

test('completed waves never cache menus and the next 100 requests see updated database data',async()=>{
  const h=harness();const before=await h.service.catalogJson('food-modifiers-v2');
  h.state.rows[0].catalog.dishes[0].price=500;
  const next=await Promise.all(Array.from({length:100},()=>h.service.catalogJson('food-modifiers-v2')));
  assert.equal(h.calls.length,2);assert.equal(new Set(next).size,1);assert.notEqual(next[0],before);
  assert.equal(JSON.parse(next[0]).restaurants[0].dishes[0].price,400);
  await h.service.catalogJson('food-modifiers-v2');assert.equal(h.calls.length,3);
});

test('shared query rejection does not poison the next wave',async()=>{
  const h=harness(),failure=new Error('Synthetic database unavailable');h.state.failure=failure;
  const failed=await Promise.allSettled(Array.from({length:100},()=>h.service.catalogJson('legacy')));
  assert.equal(h.calls.length,1);assert.ok(failed.every(result=>result.status==='rejected'&&result.reason===failure));
  h.state.failure=undefined;
  const recovered=await Promise.all(Array.from({length:100},()=>h.service.catalogJson('legacy')));
  assert.equal(h.calls.length,2);assert.equal(new Set(recovered).size,1);
});

test('promotions, filtering and decoded JSON equal the unchanged direct catalog semantics',async()=>{
  for(const development of [true,false])for(const audience of ['legacy','food-modifiers-v2'] as CatalogAudience[]) {
    const h=harness(development),direct=await h.service.catalog(audience),json=await h.service.catalogJson(audience);
    assert.equal(json,JSON.stringify(direct));assert.deepEqual(JSON.parse(json),JSON.parse(JSON.stringify(direct)));
    assert.equal(direct.restaurants[0].dishes[0].price,80);assert.equal(direct.restaurants[0].dishes[0].originalPrice,100);assert.equal(direct.restaurants[0].deliveryFee,0);
    assert.equal(direct.restaurants.some(row=>row.id==='inactive'),false);
    h.state.rows[0].catalog.promotions![0].endsAt='2020-01-01';
    const after=JSON.parse(await h.service.catalogJson(audience));assert.equal(after.restaurants[0].dishes[0].price,100);
  }
});

test('HTTP sends the exact previous Express JSON bytes, audience ETag and conditional response',async()=>{
  const h=harness(),controller=new CatalogControllerConstructor(h.service),app=express();
  for(const setting of ['json replacer','json spaces','json escape'])assert.equal(app.get(setting),undefined);
  const baseline=new Map<CatalogAudience,Awaited<ReturnType<FoodService['catalog']>>>();
  for(const audience of ['legacy','food-modifiers-v2'] as CatalogAudience[])baseline.set(audience,await h.service.catalog(audience));
  const etag=(audience:CatalogAudience,json:string)=>`"catalog-${audience}-${createHash('sha256').update(json).digest('hex')}"`;
  app.get('/baseline/:audience',(req,res)=>{
    const audience=req.params.audience as CatalogAudience,body=baseline.get(audience)!;
    res.setHeader('ETag',etag(audience,JSON.stringify(body)));res.json(body);
  });
  app.get('/api/food/catalog',(req:Request,res:Response,next)=>{void controller.catalog(req,res).catch(next);});
  const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  try {
    const tags:string[]=[];
    for(const audience of ['legacy','food-modifiers-v2'] as CatalogAudience[]) {
      const previous=await request(server).get('/baseline/'+audience).expect(200);
      const headers=audience==='legacy'?{}:{'X-Atlas-Capabilities':'food-modifiers-v2'};
      const current=await request(server).get('/api/food/catalog').set(headers).expect(200);
      assert.equal(current.text,previous.text);assert.deepEqual(current.body,previous.body);
      assert.equal(current.headers.etag,previous.headers.etag);assert.equal(current.headers['content-type'],previous.headers['content-type']);
      assert.equal(current.headers.vary,'X-Atlas-Capabilities');assert.equal(current.headers['cache-control'],'public, max-age=0, must-revalidate');
      tags.push(current.headers.etag);
      const conditional=await request(server).get('/api/food/catalog').set({...headers,'If-None-Match':current.headers.etag}).expect(304);
      assert.equal(conditional.text,'');assert.equal(conditional.headers.etag,current.headers.etag);
      h.state.rows[0].catalog.name+=' updated';
      await request(server).get('/api/food/catalog').set({...headers,'If-None-Match':current.headers.etag}).expect(200);
      h.state.rows[0].catalog.name=baseline.get(audience)!.restaurants[0].name;
    }
    assert.notEqual(tags[0],tags[1]);
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
