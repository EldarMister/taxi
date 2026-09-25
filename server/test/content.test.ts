import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import sharp from 'sharp';
import { assertBannerCapacity, contentImageUrl, detectMediaMime, MAX_MEDIA_BYTES, normalizeContentImage, validateBanner, validateRestaurantCatalog } from '../src/content-domain';
import { DEMO_FOOD_RESTAURANTS } from '../src/food-catalog';
import { priceFoodOrder } from '../src/food-domain';

const restaurant=()=>structuredClone(DEMO_FOOD_RESTAURANTS[0]);
const media='/api/content/media/346aef41-b109-4a80-a2f1-b8e888173744';

test('catalog validation accepts full menus and reconstructs bounded values with real photos',()=>{
  const source=restaurant();source.imageUrl=media;source.heroImageUrl='https://images.example.org/restaurant.jpg';
  source.dishes[0].imageUrl=media;source.options[0].imageUrl=media;
  const catalog=validateRestaurantCatalog(source,source.id,false);
  assert.equal(catalog.isDemo,false);assert.equal(catalog.imageUrl,media);assert.equal(catalog.dishes[0].imageUrl,media);assert.equal(catalog.options[0].imageUrl,media);
  assert.notEqual(catalog,source);assert.notEqual(catalog.options,source.options);
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
