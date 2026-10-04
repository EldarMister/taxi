import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FoodOption, FoodRestaurant, FOOD_PAYMENT_METHODS } from './food-catalog';
import { CreateFoodOrderBatchDto, CreateFoodOrderDto, FoodFulfillment, FoodStatus } from './food.dto';
import { currentFoodPromotions, promotedDishPrice } from './food-promotions';

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
  const data={restaurantId:dto.restaurantId,items,fulfillment:dto.fulfillment,address,...(dto.deliveryPoint&&dto.fulfillment==='DELIVERY'?{deliveryPoint:{latitude:dto.deliveryPoint.latitude,longitude:dto.deliveryPoint.longitude}}:{}),comment:(dto.comment??'').trim(),paymentMethod:dto.paymentMethod};
  return {...data,requestHash:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}

export function normalizeFoodBatch(dto:CreateFoodOrderBatchDto) {
  if(!dto.orders.length||dto.orders.length>10)throw new BadRequestException('В заказе может быть от 1 до 10 ресторанов');
  if(new Set(dto.orders.map(order=>order.restaurantId)).size!==dto.orders.length)throw new BadRequestException('Объедините блюда одного ресторана в одну корзину');
  if(new Set(dto.orders.map(order=>order.requestId)).size!==dto.orders.length)throw new BadRequestException('Каждой корзине нужен отдельный ключ повтора');
  const normalized=dto.orders.map(order=>({...normalizeFoodRequest(order),requestId:order.requestId}));
  // A key identifies the entire confirmation, so changing/removing another cart cannot produce a partial retry.
  const signature=normalized.map(order=>[order.requestId,order.requestHash]).sort((a,b)=>a[0].localeCompare(b[0]));
  const batchHash=createHash('sha256').update(JSON.stringify(signature)).digest('hex');
  return normalized.map(order=>({...order,requestHash:createHash('sha256').update(`food-batch-v1:${batchHash}:${order.requestHash}`).digest('hex')}));
}

// Every amount comes from the stored catalog. Client totals are never accepted.
export function priceFoodOrder(restaurant:FoodRestaurant,items:CreateFoodOrderDto['items'],fulfillment:FoodFulfillment) {
  if(restaurant.isOpen===false)throw new BadRequestException('Ресторан сейчас закрыт');
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
    for (const group of dish.optionGroups ?? []) {
      const count = group.optionIds.filter(id => item.optionIds.includes(id)).length;
      if (count < (group.minSelected ?? 0) || count > (group.maxSelected ?? group.optionIds.length))
        throw new BadRequestException(`Выберите модификации: ${group.name}`);
    }
    if(!Number.isSafeInteger(dish.price)||dish.price<0)throw new BadRequestException('Цена блюда недоступна');
    const lineTotal=dish.price*item.quantity+options.reduce((sum,value)=>sum+value.price*(value.priceScope==='PER_ITEM'?1:item.quantity),0);
    return {dishId:dish.id,name:dish.name,portion:dish.portion,imageKey:dish.imageKey,...(dish.imageUrl?{imageUrl:dish.imageUrl}:{}),quantity:item.quantity,unitPrice:dish.price,options,lineTotal};
  });
  const beforeDiscount=lines.reduce((sum,line)=>sum+line.lineTotal,0);
  const promotions=currentFoodPromotions(restaurant,beforeDiscount);
  for(const line of lines) {
    const unitPrice=promotedDishPrice(restaurant.dishes.find(dish=>dish.id===line.dishId)!,promotions);
    line.lineTotal-=(line.unitPrice-unitPrice)*line.quantity;
    line.unitPrice=unitPrice;
  }
  const subtotal=lines.reduce((sum,line)=>sum+line.lineTotal,0);
  if(subtotal<restaurant.minimumOrder)throw new BadRequestException(`Минимальный заказ — ${restaurant.minimumOrder} сом`);
  const freeThreshold=restaurant.freeDeliveryThreshold??0;
  const deliveryFee=fulfillment==='PICKUP'||promotions.some(p=>p.type==='FREE_DELIVERY')||(freeThreshold>0&&subtotal>=freeThreshold)?0:restaurant.deliveryFee;
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
