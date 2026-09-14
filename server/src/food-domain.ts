import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FoodOption, FoodRestaurant, FOOD_PAYMENT_METHODS } from './food-catalog';
import { CreateFoodOrderDto, FoodFulfillment, FoodStatus } from './food.dto';

export const ACTIVE_FOOD_STATUSES:FoodStatus[] = ['PLACED','CONFIRMED','PREPARING','READY','DELIVERING'];
export interface FoodOrderLine {
  dishId:string; name:string; portion:string; imageKey:string; imageUrl?:string; quantity:number; unitPrice:number;
  options:FoodOption[]; lineTotal:number;
}

export function normalizeFoodRequest(dto:CreateFoodOrderDto) {
  const address = dto.fulfillment==='PICKUP'?'':(dto.address??'').trim();
  if(dto.fulfillment==='DELIVERY' && address.length<5)throw new BadRequestException('Укажите полный адрес доставки');
  if(!FOOD_PAYMENT_METHODS.find(method=>method.id===dto.paymentMethod)?.available)throw new BadRequestException('Этот способ оплаты пока недоступен. Выберите наличные.');
  const items=dto.items.map(item=>({dishId:item.dishId,quantity:item.quantity,optionIds:[...item.optionIds].sort()}))
    .sort((a,b)=>JSON.stringify([a.dishId,a.optionIds]).localeCompare(JSON.stringify([b.dishId,b.optionIds])));
  const data={restaurantId:dto.restaurantId,items,fulfillment:dto.fulfillment,address,comment:(dto.comment??'').trim(),paymentMethod:dto.paymentMethod};
  return {...data,requestHash:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}

// Every amount comes from the stored catalog. Client totals are never accepted.
export function priceFoodOrder(restaurant:FoodRestaurant,items:CreateFoodOrderDto['items'],fulfillment:FoodFulfillment) {
  if(!items.length||items.length>50)throw new BadRequestException('Добавьте блюда в корзину');
  if(!['DELIVERY','PICKUP'].includes(fulfillment))throw new BadRequestException('Неизвестный способ получения');
  if(items.reduce((sum,item)=>sum+item.quantity,0)>99)throw new BadRequestException('В одном заказе может быть не больше 99 блюд');
  const lines:FoodOrderLine[]=items.map(item=>{
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99)throw new BadRequestException('Неверное количество блюда');
    const dish=restaurant.dishes.find(value=>value.id===item.dishId);
    if(!dish?.available)throw new BadRequestException('Блюдо больше недоступно. Обновите корзину.');
    if(item.optionIds.length>10||new Set(item.optionIds).size!==item.optionIds.length)throw new BadRequestException('Дополнение выбрано несколько раз');
    const options=item.optionIds.map(id=>{
      const option=restaurant.options.find(value=>value.id===id);
      if(!dish.optionIds.includes(id)||!option)throw new BadRequestException('Это дополнение недоступно для выбранного блюда');
      if(!Number.isSafeInteger(option.price)||option.price<0)throw new BadRequestException('Цена дополнения недоступна');
      return {...option};
    });
    if(!Number.isSafeInteger(dish.price)||dish.price<0)throw new BadRequestException('Цена блюда недоступна');
    return {dishId:dish.id,name:dish.name,portion:dish.portion,imageKey:dish.imageKey,...(dish.imageUrl?{imageUrl:dish.imageUrl}:{}),quantity:item.quantity,unitPrice:dish.price,options,lineTotal:(dish.price+options.reduce((sum,value)=>sum+value.price,0))*item.quantity};
  });
  const subtotal=lines.reduce((sum,line)=>sum+line.lineTotal,0);
  if(subtotal<restaurant.minimumOrder)throw new BadRequestException(`Минимальный заказ — ${restaurant.minimumOrder} сом`);
  const deliveryFee=fulfillment==='PICKUP'?0:restaurant.deliveryFee;
  const total=subtotal+deliveryFee;
  if(!Number.isSafeInteger(total)||total<0||total>1_000_000||!Number.isInteger(deliveryFee)||deliveryFee<0)throw new BadRequestException('Не удалось рассчитать стоимость заказа');
  return {items:lines,subtotal,deliveryFee,total};
}

export function assertFoodTransition(role:string,current:FoodStatus,next:FoodStatus,fulfillment:FoodFulfillment) {
  if(role!=='ADMIN')throw new ForbiddenException('Изменять статус доставки может только администратор');
  if(current===next)return;
  const transitions:Record<FoodStatus,FoodStatus[]>={
    PLACED:['CONFIRMED','CANCELLED'],CONFIRMED:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],
    READY:[fulfillment==='PICKUP'?'COMPLETED':'DELIVERING','CANCELLED'],DELIVERING:['COMPLETED','CANCELLED'],COMPLETED:[],CANCELLED:[],
  };
  if(!transitions[current].includes(next))throw new BadRequestException('Недопустимый переход статуса заказа');
}
