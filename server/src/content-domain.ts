import { BadRequestException, ConflictException } from '@nestjs/common';
import sharp from 'sharp';
import { FoodRestaurant } from './food-catalog';

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

// Reconstruct a bounded, typed catalog rather than persisting arbitrary admin JSON.
export function validateRestaurantCatalog(value:unknown,id:string,isDemo:boolean):FoodRestaurant {
  const r=object(value,'catalog',['id','name','rating','reviewCount','cuisine','categories','etaMin','etaMax','deliveryFee','freeDeliveryThreshold','minimumOrder','address','phone','imageKey','imageUrl','heroImageKey','heroImageUrl','discountPercent','menuCategories','dishes','options','isDemo']);
  if(r.id!==undefined&&r.id!==id)return fail('catalog.id');
  if(r.isDemo!==undefined&&typeof r.isDemo!=='boolean')return fail('catalog.isDemo');
  const menuCategories=strings(r.menuCategories,'menuCategories');
  const options=list(r.options,'options',100).map((value,index)=>{
    const field=`options[${index}]`,o=object(value,field,['id','name','price','imageKey','imageUrl']);
    return {id:contentId(o.id,`${field}.id`),name:string(o.name,`${field}.name`,150,1),price:number(o.price,`${field}.price`),...imageFields(o)};
  });
  unique(options.map(o=>o.id),'options.id');
  const dishes=list(r.dishes,'dishes',500).map((value,index)=>{
    const field=`dishes[${index}]`,d=object(value,field,['id','name','category','description','portion','weightGrams','price','imageKey','imageUrl','heroImageKey','heroImageUrl','available','optionIds']);
    const category=string(d.category,`${field}.category`,100,1),optionIds=strings(d.optionIds,`${field}.optionIds`,10);
    if(!menuCategories.includes(category))return fail(`${field}.category: категория отсутствует в меню`);
    if(optionIds.some(id=>!options.some(o=>o.id===id)))return fail(`${field}.optionIds: дополнение отсутствует`);
    return {id:contentId(d.id,`${field}.id`),name:string(d.name,`${field}.name`,150,1),category,description:string(d.description,`${field}.description`,3000),portion:string(d.portion,`${field}.portion`,100),weightGrams:number(d.weightGrams,`${field}.weightGrams`,100_000),price:number(d.price,`${field}.price`),available:boolean(d.available,`${field}.available`),optionIds,...imageFields(d,true)};
  });
  unique(dishes.map(d=>d.id),'dishes.id');
  const etaMin=number(r.etaMin,'etaMin',1440),etaMax=number(r.etaMax,'etaMax',1440);
  if(etaMax<etaMin)return fail('etaMax: должно быть не меньше etaMin');
  const phone=r.phone==null||r.phone===''?null:string(r.phone,'phone',30,5);
  if(phone&&!/^\+?[\d ()-]{5,30}$/.test(phone))return fail('phone');
  return {id,isDemo,name:string(r.name,'name',150,1),rating:number(r.rating,'rating',5,0,false),reviewCount:number(r.reviewCount,'reviewCount',10_000_000),cuisine:string(r.cuisine,'cuisine',200),categories:strings(r.categories,'categories'),etaMin,etaMax,deliveryFee:number(r.deliveryFee,'deliveryFee'),freeDeliveryThreshold:r.freeDeliveryThreshold===undefined?0:number(r.freeDeliveryThreshold,'freeDeliveryThreshold'),minimumOrder:number(r.minimumOrder,'minimumOrder'),address:string(r.address,'address',500,1),phone,...imageFields(r,true),heroImageKey:r.heroImageKey===undefined?'':string(r.heroImageKey,'heroImageKey',100),...(r.discountPercent===undefined||r.discountPercent===null?{}:{discountPercent:number(r.discountPercent,'discountPercent',100)}),menuCategories,dishes,options};
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
