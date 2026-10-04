import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import sharp from 'sharp';
import { assertBannerCapacity, contentImageUrl, detectMediaMime, MAX_MEDIA_BYTES, normalizeContentImage, validateBanner, validateBannerSelection, validateRestaurantCatalog } from '../src/content-domain';
import { ContentService } from '../src/content';
import { DEMO_FOOD_RESTAURANTS, upgradeLegacyDemoCatalog } from '../src/food-catalog';
import { priceFoodOrder } from '../src/food-domain';

const restaurant=()=>structuredClone(DEMO_FOOD_RESTAURANTS[0]);
const media='/api/content/media/346aef41-b109-4a80-a2f1-b8e888173744';

test('expanded demo menus have twelve orderable dishes and preserve existing identities and prices',()=>{
  const originalPrices:Record<string,number>={philadelphia:520,california:460,tempura:480,salmon:450,'chicken-burger':290,'chicken-bucket':650,plov:380,samsa:180,'ali-cheeseburger':320,'ali-combo':490};
  for(const source of DEMO_FOOD_RESTAURANTS){
    const catalog=validateRestaurantCatalog(source,source.id,true);
    assert.equal(catalog.dishes.length,12);assert.equal(catalog.isDemo,true);
    for(const dish of catalog.dishes){
      if(dish.id in originalPrices)assert.equal(dish.price,originalPrices[dish.id]);
      assert.ok(catalog.menuCategories.includes(dish.category));assert.ok(dish.imageKey);
      assert.equal(dish.imageUrl,undefined,'bundled image keys replace remote demo photographs');
      assert.doesNotThrow(()=>priceFoodOrder(catalog,[{dishId:dish.id,quantity:1,optionIds:[]}],'DELIVERY'));
    }
  }
});
test('demo seed upgrades only unchanged legacy menus and leaves real or customized restaurants intact',()=>{
  const categories=[['Акции','Сеты','Роллы','Суши','Закуски'],['Бургеры','Курица','Закуски'],['Горячее','Выпечка'],['Бургеры','Комбо']];
  for(const [index,source] of DEMO_FOOD_RESTAURANTS.entries()){
    const legacy=structuredClone(source);legacy.dishes=legacy.dishes.slice(0,index===0?4:2);legacy.options=legacy.options.slice(0,index===0?3:0);legacy.menuCategories=categories[index];
    if(index===1)legacy.dishes[0].imageKey='burger';
    if(index===3)legacy.dishes[1].imageKey='burger';
    const stored={id:legacy.id,isDemo:true,catalog:legacy};
    const upgraded=upgradeLegacyDemoCatalog(stored);
    assert.equal(upgraded?.dishes.length,12);assert.notEqual(upgraded,source);assert.equal(legacy.dishes.length,index===0?4:2);
    assert.equal(upgradeLegacyDemoCatalog({...stored,isDemo:false}),null);
    assert.equal(upgradeLegacyDemoCatalog({...stored,catalog:source}),null,'current menus do not need another migration');
    const edited=structuredClone(legacy);edited.dishes[0].price++;
    assert.equal(upgradeLegacyDemoCatalog({...stored,catalog:edited}),null,'merchant price changes are preserved');
    const customPhoto=structuredClone(legacy);customPhoto.imageUrl='https://restaurant.example/owned-photo.jpg';
    assert.equal(upgradeLegacyDemoCatalog({...stored,catalog:customPhoto}),null,'custom imagery is never overwritten');
    const normalized=validateRestaurantCatalog(legacy,legacy.id,true);
    assert.equal(upgradeLegacyDemoCatalog({...stored,catalog:normalized})?.dishes.length,12,'validation-added empty image/default fields are harmless');
  }
});

test('catalog validation accepts full menus and reconstructs bounded values with real photos',()=>{
  const source=restaurant();source.imageUrl=media;source.heroImageUrl='https://images.example.org/restaurant.jpg';
  source.dishes[0].imageUrl=media;source.options[0].imageUrl=media;
  const catalog=validateRestaurantCatalog(source,source.id,false);
  assert.equal(catalog.isDemo,false);assert.equal(catalog.imageUrl,media);assert.equal(catalog.dishes[0].imageUrl,media);assert.equal(catalog.options[0].imageUrl,media);
  assert.notEqual(catalog,source);assert.notEqual(catalog.options,source.options);
  assert.equal(catalog.isOpen,true,'existing published menus remain open by default');
  assert.equal(validateRestaurantCatalog({...source,isOpen:false},source.id,false).isOpen,false,'a closed restaurant keeps its complete published menu');
  assert.throws(()=>validateRestaurantCatalog({...source,isOpen:'false'},source.id,false),BadRequestException);
});
test('catalog edits reject invalid pricing, duplicate identities, orphan categories and foreign options',()=>{
  const changes:((source:ReturnType<typeof restaurant>)=>void)[]=[
    s=>{s.dishes[0].price=-1;},s=>{s.dishes[0].price=0.5;},s=>{s.deliveryFee=Infinity;},s=>{s.freeDeliveryThreshold=-1;},s=>{s.rating=7;},s=>{s.etaMin=100;s.etaMax=10;},
    s=>{s.dishes[1].id=s.dishes[0].id;},s=>{s.options[1].id=s.options[0].id;},s=>{s.dishes[0].category='Нет категории';},s=>{s.options=[];},
    s=>{s.dishes[0].optionIds=['soy','soy'];},s=>{s.menuCategories.push(s.menuCategories[0]);},s=>{s.dishes[0].name='';},
  ];
  for(const change of changes){const source=restaurant();change(source);assert.throws(()=>validateRestaurantCatalog(source,source.id,false),BadRequestException);}
  const source=restaurant();assert.throws(()=>validateRestaurantCatalog({...source,role:'ADMIN'},source.id,false),BadRequestException);
  assert.throws(()=>validateRestaurantCatalog(source,'another-id',false),BadRequestException);
});
test('merchant dish details and variant rules survive validation and enforce scoped option pricing',()=>{
  const source=restaurant(),dish=source.dishes[0];
  Object.assign(dish,{originalPrice:600,ingredients:'  Рис, лосось, сливочный сыр  ',calories:720,badge:'  Запечённое  ',ratingPercent:94,reviewCount:18,
    nutritionPer100g:{calories:218,protein:9.5,fat:11,carbohydrates:22,estimated:false},
    optionGroups:[{id:'sauce',name:'Выберите соус',optionIds:['soy','ginger'],minSelected:1,maxSelected:1}],defaultOptionIds:['soy']});
  Object.assign(source.options[0],{price:5,priceScope:'PER_PORTION'});
  Object.assign(source.options[2],{price:20,priceScope:'PER_ITEM'});
  const catalog=validateRestaurantCatalog(source,source.id,false),validated=catalog.dishes[0];
  assert.equal(validated.ingredients,'Рис, лосось, сливочный сыр');assert.equal(validated.badge,'Запечённое');
  assert.equal(validated.originalPrice,600);assert.equal(validated.calories,720);assert.equal(validated.ratingPercent,94);assert.equal(validated.reviewCount,18);
  assert.deepEqual(validated.nutritionPer100g,dish.nutritionPer100g);assert.notEqual(validated.nutritionPer100g,dish.nutritionPer100g);
  assert.deepEqual(validated.optionGroups,dish.optionGroups);assert.notEqual(validated.optionGroups![0].optionIds,dish.optionGroups![0].optionIds);
  assert.deepEqual(validated.defaultOptionIds,['soy']);assert.equal(catalog.options[2].priceScope,'PER_ITEM');
  assert.throws(()=>priceFoodOrder(catalog,[{dishId:dish.id,quantity:2,optionIds:[]}],'DELIVERY'),BadRequestException);
  assert.throws(()=>priceFoodOrder(catalog,[{dishId:dish.id,quantity:2,optionIds:['soy','ginger']}],'DELIVERY'),BadRequestException);
  assert.equal(priceFoodOrder(catalog,[{dishId:dish.id,quantity:2,optionIds:['soy','wasabi']}],'DELIVERY').total,1070);
  dish.defaultOptionIds=[];
  assert.deepEqual(validateRestaurantCatalog(source,source.id,false).dishes[0].defaultOptionIds,[],'required variants can ask the customer to choose without preselection');
  const plain=validateRestaurantCatalog(restaurant(),source.id,false);
  assert.equal('nutritionPer100g' in plain.dishes[0],false);assert.equal('originalPrice' in plain.dishes[0],false);
  assert.equal('optionGroups' in plain.dishes[0],false);assert.equal('priceScope' in plain.options[0],false);
});
test('merchant variant definitions reject foreign, repeated, contradictory and oversized selections',()=>{
  const group={id:'sauce',name:'Соус',optionIds:['soy','ginger'],minSelected:1,maxSelected:1};
  const invalid:Record<string,unknown>[]=[
    {optionGroups:[{...group,optionIds:['unknown']}]},{optionGroups:[{...group,optionIds:['soy','soy']}]},{optionGroups:[{...group,optionIds:[]}]},
    {optionGroups:[group,group]},{optionGroups:[group,{...group,id:'another'}]},
    {optionGroups:[{...group,minSelected:2,maxSelected:1}]},{optionGroups:[{...group,maxSelected:3}]},{optionGroups:[{...group,minSelected:-1}]},
    {optionGroups:[{...group,maxSelected:.5}]},{optionGroups:[{...group,unexpected:true}]},{optionGroups:Array(11).fill(group)},
    {defaultOptionIds:['unknown']},{defaultOptionIds:['soy','soy']},{optionGroups:[group],defaultOptionIds:['soy','ginger']},
  ];
  for(const fields of invalid){const source=restaurant();Object.assign(source.dishes[0],fields);assert.throws(()=>validateRestaurantCatalog(source,source.id,false),BadRequestException);}
  const source=restaurant();Object.assign(source.options[0],{priceScope:'PER_ORDER'});
  assert.throws(()=>validateRestaurantCatalog(source,source.id,false),BadRequestException);
});
test('merchant dish metadata stays bounded and rejects invalid nutrition or invented nested properties',()=>{
  const nutrition={calories:218,protein:9,fat:11,carbohydrates:22};
  const invalid:Record<string,unknown>[]=[
    {originalPrice:100},{originalPrice:1_000_001},{originalPrice:600.5},{ingredients:'x'.repeat(3001)},{badge:'x'.repeat(61)},
    {calories:-1},{calories:100_001},{ratingPercent:101},{ratingPercent:2.5},{reviewCount:-1},{reviewCount:10_000_001},
    {nutritionPer100g:{...nutrition,calories:Infinity}},{nutritionPer100g:{...nutrition,protein:101}},
    {nutritionPer100g:{...nutrition,fat:-1}},{nutritionPer100g:{...nutrition,carbohydrates:NaN}},
    {nutritionPer100g:{...nutrition,estimated:'yes'}},{nutritionPer100g:{...nutrition,unverified:true}},
    {nutritionPer100g:{calories:218,protein:9,fat:11}},
  ];
  for(const fields of invalid){const source=restaurant();Object.assign(source.dishes[0],fields);assert.throws(()=>validateRestaurantCatalog(source,source.id,false),BadRequestException);}
});
test('existing price and photo snapshots remain intact after later menu revisions',()=>{
  const source=restaurant();source.dishes[0].imageUrl=media;source.options[0].price=10;source.options[0].imageUrl=media;
  const first=priceFoodOrder(validateRestaurantCatalog(source,source.id,false),[{dishId:'philadelphia',quantity:2,optionIds:['soy']}],'DELIVERY');
  source.dishes[0].price=800;source.dishes[0].imageUrl='https://images.example.org/replacement.webp';source.options[0].price=50;source.options[0].imageUrl='https://images.example.org/new-option.webp';
  const second=priceFoodOrder(validateRestaurantCatalog(source,source.id,false),[{dishId:'philadelphia',quantity:2,optionIds:['soy']}],'DELIVERY');
  assert.equal(first.total,1060);assert.equal(second.total,1700);assert.equal(first.items[0].imageUrl,media);assert.equal(first.items[0].options[0].price,10);assert.equal(first.items[0].options[0].imageUrl,media);
  source.dishes[0].available=false;
  assert.throws(()=>priceFoodOrder(validateRestaurantCatalog(source,source.id,false),[{dishId:'philadelphia',quantity:1,optionIds:[]}],'DELIVERY'),BadRequestException);
});
test('only safe image URLs and actions can be persisted for banners',()=>{
  for(const url of ['javascript:alert(1)','data:image/svg+xml;base64,AA','//evil.example/photo.png','http://images.example.org/image.jpg','/api/users/me','https://user:pass@example.org/a'])assert.throws(()=>contentImageUrl(url),BadRequestException);
  assert.equal(contentImageUrl(media),media);assert.equal(contentImageUrl('https://images.example.org/a.webp'),'https://images.example.org/a.webp');
  assert.throws(()=>validateBanner({title:'Ресторан',actionType:'RESTAURANT',active:true}),BadRequestException);
  assert.throws(()=>validateBanner({title:'Баннер',actionType:'LINK',active:true}),BadRequestException);
  assert.throws(()=>validateBanner({title:'Баннер',active:'true'}),BadRequestException);
  assert.equal(validateBanner({title:'Ресторан',actionType:'RESTAURANT',restaurantId:'sushi-roll',active:true}).restaurantId,'sushi-roll');
});
test('banner activation capacity allows edits and drafts while rejecting fourth activation',()=>{
  assert.doesNotThrow(()=>assertBannerCapacity(2,true));
  assert.doesNotThrow(()=>assertBannerCapacity(3,false));
  assert.throws(()=>assertBannerCapacity(3,true),ConflictException);
  assert.throws(()=>assertBannerCapacity(5,true),ConflictException);
});
test('banner display sets allow one wide creative, three square creatives, or hiding all banners',()=>{
  const ids=['ca4c35d5-2ba9-45c5-8ff1-194d3930b24a','22a28d8e-3e4f-41db-aa65-ebd477e96a91','f677ec17-1e1e-43be-ba3a-d465bc0fb985'];
  assert.deepEqual(validateBannerSelection({ids:[]}),[]);
  assert.deepEqual(validateBannerSelection({ids:ids.slice(0,1)}),ids.slice(0,1));
  assert.deepEqual(validateBannerSelection({ids}),ids);
  for(const invalid of [{ids:ids.slice(0,2)},{ids:[...ids,ids[0]]},{ids:[ids[0],ids[0],ids[2]]},{ids:['not-a-uuid']},{ids,extra:true}])assert.throws(()=>validateBannerSelection(invalid),BadRequestException);
});
test('display selection validates all creatives before replacing the set and retains selected order',async()=>{
  const ids=['ca4c35d5-2ba9-45c5-8ff1-194d3930b24a','22a28d8e-3e4f-41db-aa65-ebd477e96a91','f677ec17-1e1e-43be-ba3a-d465bc0fb985'];
  const rows=ids.map((id,sortOrder)=>({id,sortOrder,active:sortOrder===0,imageUrl:'https://images.example.org/banner.webp',imageKey:null}));
  const notices:any[]=[],audits:any[]=[];let locks=0,writes=0;
  const tx={
    $executeRaw:async()=>{locks++;},
    banner:{findMany:async({where}:any)=>where?rows.filter(row=>where.id.in.includes(row.id)):rows,
      updateMany:async()=>{writes++;rows.forEach(row=>{row.active=false;});},
      update:async({where,data}:any)=>{writes++;Object.assign(rows.find(row=>row.id===where.id)!,data);}},
  };
  const service=new ContentService({$transaction:async(fn:any)=>fn(tx)} as any,{record:async(...args:any[])=>audits.push(args)} as any,
    {adminChanged:(...args:any[])=>notices.push(args),contentChanged:(...args:any[])=>notices.push(args)} as any,{} as any);
  const actor={id:'admin',role:'ADMIN'} as any;
  await assert.rejects(()=>service.setBannerDisplay(actor,{ids:ids.slice(0,2)}),BadRequestException);
  assert.equal(writes,0);
  rows[1].imageUrl='';
  await assert.rejects(()=>service.setBannerDisplay(actor,{ids}),BadRequestException);
  assert.equal(writes,0,'a missing uploaded creative keeps the current set intact');
  rows[1].imageUrl='https://images.example.org/second.webp';
  await service.setBannerDisplay(actor,{ids:[ids[2],ids[0],ids[1]]});
  assert.equal(rows.filter(row=>row.active).length,3);
  assert.deepEqual(rows.map(row=>row.sortOrder),[1,2,0]);
  assert.equal(audits.length,1);assert.equal(notices.length,2);assert.equal(locks,2);
  await service.setBannerDisplay(actor,{ids:[ids[1]]});
  assert.deepEqual(rows.filter(row=>row.active).map(row=>row.id),[ids[1]]);
});
test('uploaded photos become bounded metadata-free WebP while SVG, MIME mismatch and corrupt bytes fail',async()=>{
  const original=await sharp({create:{width:2400,height:1200,channels:3,background:'#2e8767'}}).jpeg().withMetadata().toBuffer();
  const photo=await normalizeContentImage(original,'image/jpeg');
  assert.equal(photo.width,2000);assert.equal(photo.height,1000);assert.equal(photo.mime,'image/webp');assert.equal(detectMediaMime(photo.data),'image/webp');
  const metadata=await sharp(photo.data).metadata();assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);
  await assert.rejects(()=>normalizeContentImage(original,'image/png'),BadRequestException);
  await assert.rejects(()=>normalizeContentImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),'image/svg+xml'),BadRequestException);
  await assert.rejects(()=>normalizeContentImage(Buffer.from([0xff,0xd8,0xff]),'image/jpeg'),BadRequestException);
  await assert.rejects(()=>normalizeContentImage(Buffer.alloc(MAX_MEDIA_BYTES+1),'image/jpeg'),BadRequestException);
  const tooBig=await sharp({create:{width:5000,height:5000,channels:3,background:'#fff'}}).png().toBuffer();
  await assert.rejects(()=>normalizeContentImage(tooBig,'image/png'),BadRequestException);
});
