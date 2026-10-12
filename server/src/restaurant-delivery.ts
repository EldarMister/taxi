import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { RoutingService } from './providers';
import { OrdersService } from './orders';
import { FoodService } from './food';
import { ACTIVE_STATUSES, calculateFare, haversine, type Point } from './domain';
import { OFFER_SECONDS } from './dispatch-ranking';
import { RESTAURANT_DELIVERY_KEY } from './restaurant-delivery-state';
import type { FoodRestaurant } from './food-catalog';
import { requireRestaurantPermission } from './restaurant-domain';

export type RestaurantDispatchInput = {
  method:'OWN'|'ATLAS_CAR'; deliveryLat?:number; deliveryLng?:number;
  courierName?:string; courierPhone?:string; expectedPrice?:number;
};
type DeliveryActor={id:string;sessionId?:string;sessionVersion?:number};

function coordinates(value:unknown):{latitude:number;longitude:number}|null {
  if(!value||typeof value!=='object')return null;
  const {latitude,longitude}=value as Record<string,unknown>;
  return typeof latitude==='number'&&typeof longitude==='number'&&Number.isFinite(latitude)&&Number.isFinite(longitude)
    &&Math.abs(latitude)<=90&&Math.abs(longitude)<=180?{latitude,longitude}:null;
}

@Injectable()
export class RestaurantDeliveryService {
  constructor(private readonly db:PrismaService,private readonly routing:RoutingService,private readonly orders:OrdersService,private readonly food:FoodService) {}

  async quote(actor:DeliveryActor,restaurantId:string,foodOrderId:string,dto:RestaurantDispatchInput) {
    const member=await this.db.restaurantMembership.findFirst({where:{accountId:actor.id,restaurantId,active:true,account:{active:true,...(actor.sessionVersion===undefined?{}:{sessionVersion:actor.sessionVersion})}}});
    requireRestaurantPermission(member,'orders.manage');
    if(dto.method!=='ATLAS_CAR')throw new BadRequestException('Расчёт доступен для доставки Atlas');
    const order=await this.db.foodOrder.findFirst({where:{id:foodOrderId,restaurantId},include:{restaurant:true,atlasDelivery:true}});
    if(!order)throw new NotFoundException('Заказ ресторана не найден');
    if(order.status!=='READY'||order.fulfillment!=='DELIVERY')throw new BadRequestException('Сначала отметьте заказ готовым');
    if(order.atlasDelivery&&ACTIVE_STATUSES.includes(order.atlasDelivery.status))return {price:order.atlasDelivery.price,currency:'KGS',deliveryPayer:'RESTAURANT'};
    const prepared=await this.prepare(order,dto);
    return {price:prepared.price,currency:'KGS',deliveryPayer:'RESTAURANT'};
  }

  /** Membership and dispatch permission are checked by RestaurantService. */
  async dispatch(actor:DeliveryActor,restaurantId:string,foodOrderId:string,dto:RestaurantDispatchInput) {
    if(!['OWN','ATLAS_CAR'].includes(dto.method))throw new BadRequestException('Выберите способ доставки');
    const preview=await this.db.foodOrder.findFirst({where:{id:foodOrderId,restaurantId},include:{restaurant:true,atlasDelivery:true}});
    if(!preview)throw new NotFoundException('Заказ ресторана не найден');
    if(preview.fulfillment!=='DELIVERY')throw new BadRequestException('Для этого заказа доставка не требуется');
    const activeAtlas=preview.atlasDelivery&&ACTIVE_STATUSES.includes(preview.atlasDelivery.status);
    const existingOwn=preview.deliveryMethod==='OWN'&&['DELIVERING','COMPLETED'].includes(preview.status);
    if(!activeAtlas&&!existingOwn&&preview.status!=='READY')throw new BadRequestException('Сначала отметьте заказ готовым');

    // Route calculation happens before acquiring the order lock. A competing
    // call rechecks the live state under the lock before creating anything.
    const prepared=dto.method==='ATLAS_CAR'&&!activeAtlas&&!existingOwn?await this.prepare(preview,dto):null;
    const result=await this.db.$transaction(async tx=>{
      // Rights can be revoked while routing is in progress. Lock/recheck the
      // account and membership before any dispatch write, using the same lock
      // order as restaurant administration.
      await tx.$queryRaw`SELECT "id" FROM "RestaurantAccount" WHERE "id"=${actor.id}::uuid FOR SHARE`;
      const account=await tx.restaurantAccount.findUnique({where:{id:actor.id}});
      if(!account?.active||(actor.sessionVersion!==undefined&&account.sessionVersion!==actor.sessionVersion))throw new UnauthorizedException('Войдите в приложение ресторана');
      if(actor.sessionId) {
        await tx.$queryRaw`SELECT "id" FROM "RestaurantSession" WHERE "id"=${actor.sessionId}::uuid FOR SHARE`;
        const session=await tx.restaurantSession.findUnique({where:{id:actor.sessionId}});
        if(!session||session.accountId!==actor.id||session.revokedAt||session.expiresAt.getTime()<=Date.now()||session.sessionVersion!==account.sessionVersion)throw new UnauthorizedException('Войдите в приложение ресторана');
      }
      await tx.$queryRaw`SELECT "id" FROM "RestaurantMembership" WHERE "accountId"=${actor.id}::uuid AND "restaurantId"=${restaurantId} FOR SHARE`;
      const member=await tx.restaurantMembership.findFirst({where:{accountId:actor.id,restaurantId,active:true}});
      if(!member)throw new ForbiddenException('Нет доступа к ресторану');
      requireRestaurantPermission(member,'orders.manage');
      await tx.$queryRaw`SELECT "id" FROM "FoodOrder" WHERE "id"=${foodOrderId}::uuid FOR UPDATE`;
      const current=await tx.foodOrder.findFirst({where:{id:foodOrderId,restaurantId},include:{atlasDelivery:true,restaurant:true}});
      if(!current)throw new NotFoundException('Заказ ресторана не найден');
      const existing=current.atlasDelivery;
      if(existing&&ACTIVE_STATUSES.includes(existing.status)) {
        if(dto.method!=='ATLAS_CAR')throw new ConflictException('Доставка Atlas уже назначена. Дождитесь её завершения.');
        return {order:current,delivery:existing,changed:false};
      }
      if(current.deliveryMethod==='OWN'&&['DELIVERING','COMPLETED'].includes(current.status)) {
        if(dto.method!=='OWN')throw new ConflictException('Заказ уже передан вашему курьеру');
        return {order:current,delivery:null,changed:false};
      }
      if(current.status!=='READY'||current.fulfillment!=='DELIVERY')throw new ConflictException('Заказ больше не готов к отправке');
      if(existing&&!['NO_DRIVER','CANCELLED'].includes(existing.status))throw new ConflictException('Для заказа уже есть доставка Atlas');
      if(existing) {
        // Preserve the failed attempt, quote and its immutable food reference
        // in deliveryDetails; only release the unique pointer for a retry.
        await tx.order.update({where:{id:existing.id},data:{foodOrderId:null}});
      }
      if(dto.method==='OWN') {
        const order=await tx.foodOrder.update({where:{id:foodOrderId},data:{status:'DELIVERING',deliveryMethod:'OWN',courierName:dto.courierName?.trim()||null,courierPhone:dto.courierPhone?.trim()||null,
          history:{create:{status:'DELIVERING',actorId:actor.id,reason:existing?`OWN_AFTER_ATLAS:${existing.id}`:'OWN_COURIER'}}}});
        return {order,delivery:null,changed:true};
      }
      if(!prepared)throw new ConflictException('Условия доставки изменились. Повторите отправку.');
      const liveCatalog=current.restaurant.catalog as unknown as FoodRestaurant;
      if(liveCatalog.latitude!==prepared.pickup.latitude||liveCatalog.longitude!==prepared.pickup.longitude)throw new ConflictException('Адрес ресторана изменился. Повторите отправку.');
      const tariff=await tx.tariff.findFirst({where:{id:prepared.tariffId,active:true,kind:'DELIVERY_CAR'}});
      if(!tariff)throw new BadRequestException('Доставка Atlas на машине сейчас недоступна');
      const fare=calculateFare(tariff,prepared.route.distanceMeters,prepared.route.durationSeconds);
      if(fare.price<=0)throw new BadRequestException('Тариф доставки Atlas не настроен');
      if(dto.expectedPrice!==undefined&&dto.expectedPrice!==fare.price)throw new ConflictException('Стоимость изменилась, обновите расчёт');
      const now=new Date();
      const quote=await tx.quote.create({data:{userId:current.clientId,tariffId:tariff.id,kind:'DELIVERY_CAR',pickup:{...prepared.pickup},dropoff:{...prepared.dropoff},geometry:prepared.route.geometry,
        distanceMeters:prepared.route.distanceMeters,durationSeconds:prepared.route.durationSeconds,...fare,routeProvider:prepared.route.provider,expiresAt:new Date(now.getTime()+300000)}});
      const delivery=await tx.order.create({data:{clientId:current.clientId,foodOrderId:current.id,quoteId:quote.id,idempotencyKey:`${RESTAURANT_DELIVERY_KEY}${current.id}:${randomUUID()}`,
        kind:'DELIVERY_CAR',status:'SEARCHING',dispatchAfter:now,pickup:quote.pickup as Prisma.InputJsonValue,dropoff:quote.dropoff as Prisma.InputJsonValue,geometry:quote.geometry as Prisma.InputJsonValue,
        distanceMeters:quote.distanceMeters,durationSeconds:quote.durationSeconds,price:quote.price,commission:quote.commission,
        waitingGraceMinutes:tariff.waitingGraceMinutes,freeWaitingMinutes:tariff.freeWaitingMinutes,waitingPricePerMinute:tariff.waitingPricePerMinute,
        deliveryDetails:{source:'RESTAURANT_FOOD',foodOrderId:current.id,restaurantId,restaurantName:liveCatalog.name,senderPhone:liveCatalog.phone||'',deliveryPayer:'RESTAURANT',doorToDoor:true,cashToCollect:current.paymentMethod==='CASH'?current.total:0,deliveryPrice:fare.price,
          goodsDescription:`Еда из ${liveCatalog.name}. Доставку Atlas оплачивает ресторан.`.slice(0,500)},
        comment:[`Заказ еды ${current.id.slice(0,8)}. С клиента за еду: ${current.paymentMethod==='CASH'?current.total:0} сом. Доставку Atlas (${fare.price} сом) оплачивает ресторан.`,liveCatalog.phone?`Ресторан: ${liveCatalog.phone}.`:'',current.comment].filter(Boolean).join(' ').slice(0,500),
        searchExpiresAt:new Date(now.getTime()+OFFER_SECONDS*1000),history:{create:{status:'SEARCHING',actorId:actor.id,reason:`FOOD_ORDER:${current.id}`}}}});
      const order=await tx.foodOrder.update({where:{id:foodOrderId},data:{deliveryMethod:'ATLAS_CAR',courierName:null,courierPhone:null,deliveryPoint:{latitude:prepared.dropoff.latitude,longitude:prepared.dropoff.longitude},
        history:{create:{status:'READY',actorId:actor.id,reason:`ATLAS_DISPATCH:${delivery.id}${existing?`:RETRY:${existing.id}`:''}`}}}});
      return {order,delivery,changed:true};
    },{timeout:15_000});
    if(result.changed)this.food.changed(result.order);
    if(result.delivery) {
      await this.orders.dispatchOrder(result.delivery.id);
      await this.orders.publish(result.delivery.id);
    }
    const current=await this.db.foodOrder.findFirstOrThrow({where:{id:foodOrderId,restaurantId},include:{atlasDelivery:true}});
    return {...this.food.serialize(current),atlasDelivery:current.atlasDelivery?{id:current.atlasDelivery.id,status:current.atlasDelivery.status,price:current.atlasDelivery.price,driverId:current.atlasDelivery.driverId}:null,
      deliveryPrice:current.atlasDelivery?.price??null,deliveryPayer:current.deliveryMethod==='ATLAS_CAR'?'RESTAURANT':null};
  }

  private async prepare(order:{deliveryPoint:unknown;address:string;restaurant:{catalog:unknown}},dto:RestaurantDispatchInput) {
    const restaurant=order.restaurant.catalog as FoodRestaurant;
    const pickupPoint=coordinates(restaurant);
    if(!pickupPoint)throw new BadRequestException('Укажите точку ресторана на карте в информации о ресторане');
    const fallbackProvided=dto.deliveryLat!==undefined||dto.deliveryLng!==undefined;
    const fallback=fallbackProvided?coordinates({latitude:dto.deliveryLat,longitude:dto.deliveryLng}):null;
    if(fallbackProvided&&!fallback)throw new BadRequestException('Укажите корректные координаты получателя');
    const destination=coordinates(order.deliveryPoint)||fallback;
    if(!destination)throw new BadRequestException('В заказе нет точки доставки. Укажите координаты получателя.');
    const pickup:Point={...pickupPoint,address:restaurant.address};
    const dropoff:Point={...destination,address:order.address};
    if(haversine(pickup,dropoff)<30)throw new BadRequestException('Точки ресторана и получателя должны различаться');
    const tariff=await this.db.tariff.findFirst({where:{kind:'DELIVERY_CAR',active:true},orderBy:{id:'asc'}});
    if(!tariff)throw new BadRequestException('Доставка Atlas на машине сейчас недоступна');
    const route=await this.routing.route(pickup,dropoff);
    const fare=calculateFare(tariff,route.distanceMeters,route.durationSeconds);
    if(fare.price<=0)throw new BadRequestException('Тариф доставки Atlas не настроен');
    return {pickup,dropoff,route,tariffId:tariff.id,price:fare.price};
  }
}
