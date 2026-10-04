import { BadRequestException, ConflictException } from '@nestjs/common';
import sharp from 'sharp';
import { FoodDish, FoodOption, FoodOptionGroup, FoodRestaurant, FoodPromotion } from './food-catalog';

const fail=(field:string):never=>{throw new BadRequestException(`Некорректное поле: ${field}`);};
function object(value:unknown,field:string,keys:string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))return fail(field);
  const result=value as Record<string,unknown>;
  if(Object.keys(result).some(key=>!keys.includes(key)))return fail(`${field}: неизвестное свойство`);
  return result;
}
function string(value:unknown,field:string,max=200,min=0):string {
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))return fail(field);
  return value.trim();
}
function number(value:unknown,field:string,max=1_000_000,min=0,integer=true):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isSafeInteger(value)))return fail(field);
  return value;
}
function boolean(value:unknown,field:string):boolean {if(typeof value!=='boolean')return fail(field);return value;}
export function contentId(value:unknown,field='id'):string {
  const id=string(value,field,100,1);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id))return fail(field);
  return id;
}
function list(value:unknown,field:string,max:number):unknown[] {if(!Array.isArray(value)||value.length>max)return fail(field);return value;}
function unique(values:string[],field:string):string[] {if(new Set(values).size!==values.length)return fail(`${field}: дублирующиеся значения`);return values;}
function strings(value:unknown,field:string,max=40):string[] {return unique(list(value,field,max).map(v=>string(v,field,100,1)),field);}
export function contentImageUrl(value:unknown,field='imageUrl'):string|undefined {
  if(value===undefined||value===null||value==='')return undefined;
  const result=string(value,field,2000,1);
  if(/^\/api\/content\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result))return result;
  try {const url=new URL(result);if(url.protocol==='https:'&&!url.username&&!url.password&&url.hostname)return result;}catch{}
  return fail(`${field}: нужна HTTPS-ссылка или загруженная фотография`);
}
function imageFields(value:Record<string,unknown>,hero=false) {
  const imageKey=value.imageKey===undefined?'':string(value.imageKey,'imageKey',100);
  const imageUrl=contentImageUrl(value.imageUrl);
  const heroImageKey=value.heroImageKey===undefined?'':string(value.heroImageKey,'heroImageKey',100);
  const heroImageUrl=contentImageUrl(value.heroImageUrl,'heroImageUrl');
  return {imageKey,...(imageUrl?{imageUrl}:{}),...(hero?{heroImageKey,...(heroImageUrl?{heroImageUrl}:{})}:{})};
}

function dishDetails(d:Record<string,unknown>,field:string,optionIds:string[],price:number) {
  const details:Pick<FoodDish,'optionGroups'|'defaultOptionIds'|'originalPrice'|'ingredients'|'calories'|'nutritionPer100g'|'badge'|'ratingPercent'|'reviewCount'>={};
  if(d.optionGroups!==undefined) {
    const groups=list(d.optionGroups,`${field}.optionGroups`,10).map((value,index):FoodOptionGroup=>{
      const groupField=`${field}.optionGroups[${index}]`;
      const group=object(value,groupField,['id','name','optionIds','minSelected','maxSelected']);
      const ids=strings(group.optionIds,`${groupField}.optionIds`,10);
      if(!ids.length||ids.some(id=>!optionIds.includes(id)))return fail(`${groupField}.optionIds: дополнение отсутствует у блюда`);
      const min=group.minSelected===undefined?0:number(group.minSelected,`${groupField}.minSelected`,ids.length);
      const max=group.maxSelected===undefined?ids.length:number(group.maxSelected,`${groupField}.maxSelected`,ids.length);
      if(max<min)return fail(`${groupField}.maxSelected: должно быть не меньше minSelected`);
      return {id:contentId(group.id,`${groupField}.id`),name:string(group.name,`${groupField}.name`,150,1),optionIds:ids,
        ...(group.minSelected===undefined?{}:{minSelected:min}),...(group.maxSelected===undefined?{}:{maxSelected:max})};
    });
    unique(groups.map(group=>group.id),`${field}.optionGroups.id`);
    unique(groups.flatMap(group=>group.optionIds),`${field}.optionGroups.optionIds`);
    details.optionGroups=groups;
  }
  if(d.defaultOptionIds!==undefined) {
    const defaults=strings(d.defaultOptionIds,`${field}.defaultOptionIds`,10);
    if(defaults.some(id=>!optionIds.includes(id)))return fail(`${field}.defaultOptionIds: дополнение отсутствует у блюда`);
    if(details.optionGroups?.some(group=>group.optionIds.filter(id=>defaults.includes(id)).length>(group.maxSelected??group.optionIds.length)))return fail(`${field}.defaultOptionIds: превышено количество дополнений в группе`);
    // A required group may intentionally have no default so the customer chooses.
    details.defaultOptionIds=defaults;
  }
  if(d.originalPrice!==undefined)details.originalPrice=number(d.originalPrice,`${field}.originalPrice`,1_000_000,price);
  if(d.ingredients!==undefined)details.ingredients=string(d.ingredients,`${field}.ingredients`,3000);
  if(d.calories!==undefined)details.calories=number(d.calories,`${field}.calories`,100_000);
  if(d.badge!==undefined)details.badge=string(d.badge,`${field}.badge`,60);
  if(d.ratingPercent!==undefined)details.ratingPercent=number(d.ratingPercent,`${field}.ratingPercent`,100);
  if(d.reviewCount!==undefined)details.reviewCount=number(d.reviewCount,`${field}.reviewCount`,10_000_000);
  if(d.nutritionPer100g!==undefined) {
    const fieldName=`${field}.nutritionPer100g`;
    const nutrition=object(d.nutritionPer100g,fieldName,['calories','protein','fat','carbohydrates','estimated']);
    details.nutritionPer100g={calories:number(nutrition.calories,`${fieldName}.calories`,1000,0,false),
      protein:number(nutrition.protein,`${fieldName}.protein`,100,0,false),fat:number(nutrition.fat,`${fieldName}.fat`,100,0,false),
      carbohydrates:number(nutrition.carbohydrates,`${fieldName}.carbohydrates`,100,0,false),
      ...(nutrition.estimated===undefined?{}:{estimated:boolean(nutrition.estimated,`${fieldName}.estimated`)})};
  }
  return details;
}

// Reconstruct a bounded, typed catalog rather than persisting arbitrary admin JSON.
export function validateFoodPromotions(value:unknown,dishIds:string[]):FoodPromotion[] {
  const promotions=list(value,'promotions',30).map((item,index):FoodPromotion=>{
    const field=`promotions[${index}]`,p=object(item,field,['id','title','type','value','minSubtotal','dishIds','active','startsAt','endsAt']);
    if(!['PERCENT','FIXED','FREE_DELIVERY'].includes(String(p.type)))return fail(`${field}.type`);
    const type=p.type as FoodPromotion['type'];
    const ids=strings(p.dishIds??[],`${field}.dishIds`,500);
    if(ids.some(id=>!dishIds.includes(id))||(type==='FREE_DELIVERY'&&ids.length))return fail(`${field}.dishIds`);
    const date=(value:unknown,key:string)=>{
      if(value===undefined||value===null||value==='')return null;
      const text=string(value,key,50,1);
      if(!Number.isFinite(Date.parse(text)))return fail(key);
      return new Date(text).toISOString();
    };
    const startsAt=date(p.startsAt,`${field}.startsAt`),endsAt=date(p.endsAt,`${field}.endsAt`);
    if(startsAt&&endsAt&&startsAt>=endsAt)return fail(`${field}: окончание должно быть позже начала`);
    return {id:contentId(p.id,`${field}.id`),title:string(p.title,`${field}.title`,150,1),type,value:number(p.value??0,`${field}.value`,type==='PERCENT'?100:type==='FREE_DELIVERY'?0:1_000_000),minSubtotal:number(p.minSubtotal??0,`${field}.minSubtotal`),dishIds:ids,active:boolean(p.active,`${field}.active`),startsAt,endsAt};
  });
  unique(promotions.map(p=>p.id),'promotions.id');
  return promotions;
}
export function validateRestaurantCatalog(value:unknown,id:string,isDemo:boolean):FoodRestaurant {
  const r=object(value,'catalog',['id','name','rating','reviewCount','cuisine','categories','etaMin','etaMax','deliveryFee','freeDeliveryThreshold','minimumOrder','address','phone','imageKey','imageUrl','heroImageKey','heroImageUrl','discountPercent','menuCategories','dishes','options','isDemo','isOpen','reviews','ratingCount','latitude','longitude','promotions']);
  if(r.id!==undefined&&r.id!==id)return fail('catalog.id');
  if(r.isDemo!==undefined&&typeof r.isDemo!=='boolean')return fail('catalog.isDemo');
  const isOpen=r.isOpen===undefined?true:boolean(r.isOpen,'catalog.isOpen');
  const reviews=r.reviews===undefined?undefined:list(r.reviews,'reviews',500).map((value,index)=>{
    const field=`reviews[${index}]`,review=object(value,field,['id','authorName','rating','createdAt','text','source']);
    const createdAt=string(review.createdAt,`${field}.createdAt`,50,1);
    if(!Number.isFinite(Date.parse(createdAt)))return fail(`${field}.createdAt`);
    return {id:contentId(review.id,`${field}.id`),authorName:string(review.authorName,`${field}.authorName`,150,1),rating:number(review.rating,`${field}.rating`,5,1,false),createdAt,text:string(review.text,`${field}.text`,3000,1),...(review.source===undefined?{}:{source:string(review.source,`${field}.source`,150)})};
  });
  if(reviews)unique(reviews.map(review=>review.id),'reviews.id');
  const feedback={...(reviews===undefined?{}:{reviews}),...(r.ratingCount===undefined?{}:{ratingCount:number(r.ratingCount,'ratingCount',10_000_000)})};
  const menuCategories=strings(r.menuCategories,'menuCategories');
  const options=list(r.options,'options',100).map((value,index):FoodOption=>{
    const field=`options[${index}]`,o=object(value,field,['id','name','price','imageKey','imageUrl','priceScope']);
    if(o.priceScope!==undefined&&o.priceScope!=='PER_PORTION'&&o.priceScope!=='PER_ITEM')return fail(`${field}.priceScope`);
    return {id:contentId(o.id,`${field}.id`),name:string(o.name,`${field}.name`,150,1),price:number(o.price,`${field}.price`),...imageFields(o),...(o.priceScope===undefined?{}:{priceScope:o.priceScope})};
  });
  unique(options.map(o=>o.id),'options.id');
  const dishes=list(r.dishes,'dishes',500).map((value,index)=>{
    const field=`dishes[${index}]`,d=object(value,field,['id','name','category','description','portion','weightGrams','price','imageKey','imageUrl','heroImageKey','heroImageUrl','available','optionIds','optionGroups','defaultOptionIds','originalPrice','ingredients','calories','nutritionPer100g','badge','ratingPercent','reviewCount']);
    const category=string(d.category,`${field}.category`,100,1),optionIds=strings(d.optionIds,`${field}.optionIds`,10);
    if(!menuCategories.includes(category))return fail(`${field}.category: категория отсутствует в меню`);
    if(optionIds.some(id=>!options.some(o=>o.id===id)))return fail(`${field}.optionIds: дополнение отсутствует`);
    const price=number(d.price,`${field}.price`);
    return {id:contentId(d.id,`${field}.id`),name:string(d.name,`${field}.name`,150,1),category,description:string(d.description,`${field}.description`,3000),portion:string(d.portion,`${field}.portion`,100),weightGrams:number(d.weightGrams,`${field}.weightGrams`,100_000),price,available:boolean(d.available,`${field}.available`),optionIds,...imageFields(d,true),...dishDetails(d,field,optionIds,price)};
  });
  unique(dishes.map(d=>d.id),'dishes.id');
  const location=r.latitude==null&&r.longitude==null?{}:{latitude:number(r.latitude,'latitude',90,-90,false),longitude:number(r.longitude,'longitude',180,-180,false)};
  const promotions=r.promotions===undefined?{}:{promotions:validateFoodPromotions(r.promotions,dishes.map(d=>d.id))};
  const etaMin=number(r.etaMin,'etaMin',1440),etaMax=number(r.etaMax,'etaMax',1440);
  if(etaMax<etaMin)return fail('etaMax: должно быть не меньше etaMin');
  const phone=r.phone==null||r.phone===''?null:string(r.phone,'phone',30,5);
  if(phone&&!/^\+?[\d ()-]{5,30}$/.test(phone))return fail('phone');
  return {id,isDemo,isOpen,...feedback,...location,...promotions,name:string(r.name,'name',150,1),rating:number(r.rating,'rating',5,0,false),reviewCount:number(r.reviewCount,'reviewCount',10_000_000),cuisine:string(r.cuisine,'cuisine',200),categories:strings(r.categories,'categories'),etaMin,etaMax,deliveryFee:number(r.deliveryFee,'deliveryFee'),freeDeliveryThreshold:r.freeDeliveryThreshold===undefined?0:number(r.freeDeliveryThreshold,'freeDeliveryThreshold'),minimumOrder:number(r.minimumOrder,'minimumOrder'),address:string(r.address,'address',500,1),phone,...imageFields(r,true),heroImageKey:r.heroImageKey===undefined?'':string(r.heroImageKey,'heroImageKey',100),...(r.discountPercent===undefined||r.discountPercent===null?{}:{discountPercent:number(r.discountPercent,'discountPercent',100)}),menuCategories,dishes,options};
}

export interface BannerInput {title:string;subtitle:string;imageUrl:string|null;imageKey:string|null;actionType:'NONE'|'RESTAURANT'|'FOOD'|'TAXI';restaurantId:string|null;sortOrder:number;active:boolean}
export function validateBanner(value:unknown):BannerInput {
  const b=object(value,'banner',['title','subtitle','imageUrl','imageKey','actionType','restaurantId','sortOrder','active']);
  const actionType=b.actionType??'NONE';
  if(!['NONE','RESTAURANT','FOOD','TAXI'].includes(String(actionType)))return fail('actionType');
  const restaurantId=actionType==='RESTAURANT'?contentId(b.restaurantId,'restaurantId'):null;
  return {title:string(b.title,'title',120,1),subtitle:string(b.subtitle??'','subtitle',300),imageUrl:contentImageUrl(b.imageUrl)??null,imageKey:b.imageKey==null?null:string(b.imageKey,'imageKey',100),actionType:actionType as BannerInput['actionType'],restaurantId,sortOrder:number(b.sortOrder??0,'sortOrder',10_000,-10_000),active:boolean(b.active??false,'active')};
}
export function assertBannerCapacity(activeOtherCount:number,nextActive:boolean) {if(nextActive&&activeOtherCount>=3)throw new ConflictException('На главном экране может быть не больше трёх активных баннеров. Сначала отключите один из них.');}

/** A display set is changed atomically so two small banners are never published. */
export function validateBannerSelection(value:unknown):string[] {
  const selection=object(value,'banner display',['ids']);
  const ids=list(selection.ids,'ids',3).map(id=>string(id,'ids',36,36));
  if(![0,1,3].includes(ids.length))return fail('ids: выберите один длинный баннер или три квадратных');
  if(ids.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))return fail('ids');
  return unique(ids,'ids');
}

export const MAX_MEDIA_BYTES=8*1024*1024;
export function detectMediaMime(data:Uint8Array):string|null {
  if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return 'image/jpeg';
  if(data.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((v,i)=>data[i]===v))return 'image/png';
  if(data.length>=12&&Buffer.from(data.subarray(0,4)).toString('ascii')==='RIFF'&&Buffer.from(data.subarray(8,12)).toString('ascii')==='WEBP')return 'image/webp';
  return null;
}
export async function normalizeContentImage(data:Buffer,mime:string) {
  if(!data.length||data.length>MAX_MEDIA_BYTES)throw new BadRequestException('Размер фотографии должен быть от 1 байта до 8 МБ.');
  if(!detectMediaMime(data)||detectMediaMime(data)!==mime.toLowerCase())throw new BadRequestException('Поддерживаются фотографии JPEG, PNG и WEBP. Тип файла должен соответствовать содержимому.');
  try {
    const image=sharp(data,{failOn:'error',limitInputPixels:24_000_000,sequentialRead:true,animated:false});
    const metadata=await image.metadata();
    if(!metadata.width||!metadata.height||(metadata.pages??1)>1||metadata.width*metadata.height>24_000_000)throw new Error('invalid-image');
    const {data:normalized,info}=await image.rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});
    if(normalized.length>MAX_MEDIA_BYTES||detectMediaMime(normalized)!=='image/webp')throw new Error('invalid-output');
    return {data:normalized,mime:'image/webp',width:info.width,height:info.height};
  }catch {throw new BadRequestException('Фотография повреждена или слишком велика. Выберите другое изображение.');}
}
