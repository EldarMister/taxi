import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FoodOrder, Prisma } from '@prisma/client';
import { Actor, RateLimits } from './auth';
import { AppConfig } from './config';
import { historySince } from './domain';
import { FoodRestaurant, FOOD_PAYMENT_METHODS } from './food-catalog';
import { ACTIVE_FOOD_STATUSES, assertFoodTransition, normalizeFoodRequest, priceFoodOrder } from './food-domain';
import { CreateFoodOrderDto, FoodStatusDto } from './food.dto';
import { PrismaService } from './prisma.service';
import { AdminAuditService } from './admin.security';
import { RealtimeEvents } from './events';

@Injectable()
export class FoodService {
  constructor(private readonly db:PrismaService,private readonly config:AppConfig,private readonly limits:RateLimits,private readonly audit:AdminAuditService,private readonly events:RealtimeEvents) {}

  async catalog() {
    const rows=await this.db.foodRestaurant.findMany({where:{active:true,...(!this.config.development?{isDemo:false}:{})},orderBy:[{sortOrder:'asc'},{id:'asc'}]});
    const restaurants=rows.map(row=>({...row.catalog as unknown as FoodRestaurant,id:row.id,isDemo:row.isDemo}));
    return {restaurants,paymentMethods:FOOD_PAYMENT_METHODS,isDemo:restaurants.some(restaurant=>restaurant.isDemo)};
  }

  async create(actor:Actor,dto:CreateFoodOrderDto) {
    if(actor.role!=='CLIENT')throw new ForbiddenException('Заказ еды доступен клиенту');
    await this.limits.take(`food:orders:${actor.id}`,20,60);
    const normalized=normalizeFoodRequest(dto);
    const result=await this.db.$transaction(async tx=>{
      // Serializes retries and distinct submissions for this client without blocking other customers.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id}::uuid FOR UPDATE`;
      const user=await tx.user.findUnique({where:{id:actor.id},select:{role:true}});
      if(user?.role!=='CLIENT')throw new ForbiddenException('Заказ еды доступен клиенту');
      const existing=await tx.foodOrder.findUnique({where:{clientId_requestId:{clientId:actor.id,requestId:dto.requestId}}});
      if(existing) {
        if(existing.requestHash!==normalized.requestHash)throw new ConflictException('Ключ повтора уже использован с другим заказом');
        return {order:existing,changed:false};
      }
      if(await tx.foodOrder.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}}}))throw new ConflictException('У вас уже есть активный заказ еды');
      await tx.$queryRaw`SELECT "id" FROM "FoodRestaurant" WHERE "id"=${dto.restaurantId} FOR SHARE`;
      const stored=await tx.foodRestaurant.findFirst({where:{id:dto.restaurantId,active:true,...(!this.config.development?{isDemo:false}:{})}});
      if(!stored)throw new NotFoundException('Ресторан сейчас недоступен');
      const restaurant={...stored.catalog as unknown as FoodRestaurant,id:stored.id,isDemo:stored.isDemo};
      const priced=priceFoodOrder(restaurant,normalized.items,normalized.fulfillment);
      const restaurantSnapshot={id:restaurant.id,name:restaurant.name,rating:restaurant.rating,reviewCount:restaurant.reviewCount,address:restaurant.address,phone:restaurant.phone,imageKey:restaurant.imageKey,...(restaurant.imageUrl?{imageUrl:restaurant.imageUrl}:{}),etaMin:restaurant.etaMin,etaMax:restaurant.etaMax};
      const order=await tx.foodOrder.create({data:{clientId:actor.id,restaurantId:restaurant.id,restaurantSnapshot,requestId:dto.requestId,requestHash:normalized.requestHash,items:priced.items as unknown as Prisma.InputJsonValue,subtotal:priced.subtotal,deliveryFee:priced.deliveryFee,total:priced.total,fulfillment:normalized.fulfillment,address:normalized.address,comment:normalized.comment,paymentMethod:normalized.paymentMethod,isDemo:stored.isDemo,history:{create:{status:'PLACED',actorId:actor.id}}}});
      return {order,changed:true};
    });
    if(result.changed)this.changed(result.order);
    return this.serialize(result.order);
  }

  async active(actor:Actor) {
    const order=await this.db.foodOrder.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}},orderBy:{createdAt:'desc'}});
    return order?this.serialize(order):null;
  }
  async history(actor:Actor,period:string) {
    const orders=await this.db.foodOrder.findMany({where:{clientId:actor.id,createdAt:{gte:historySince(period)}},orderBy:{createdAt:'desc'},take:100});
    return orders.map(order=>this.serialize(order));
  }
  async get(actor:Actor,id:string) {
    const order=await this.db.foodOrder.findFirst({where:{id,clientId:actor.id}});
    if(!order)throw new NotFoundException('Заказ еды не найден');
    return this.serialize(order);
  }

  async cancel(actor:Actor,id:string) {
    const result=await this.db.$transaction(async tx=>{
      const current=await this.lockOrder(tx,id);
      if(current.clientId!==actor.id)throw new ForbiddenException('Нет доступа к заказу');
      if(current.status==='CANCELLED')return {order:current,changed:false};
      if(!['PLACED','CONFIRMED'].includes(current.status))throw new BadRequestException('Ресторан уже готовит заказ. Для отмены обратитесь в поддержку.');
      const order=await tx.foodOrder.update({where:{id},data:{status:'CANCELLED',history:{create:{status:'CANCELLED',actorId:actor.id,reason:'CLIENT_CANCELLED'}}}});
      return {order,changed:true};
    });
    if(result.changed)this.changed(result.order);
    return this.serialize(result.order);
  }

  async changeStatus(actor:Actor,id:string,dto:FoodStatusDto) {
    if(actor.role!=='ADMIN')throw new ForbiddenException('Изменять статус доставки может только администратор');
    const result=await this.db.$transaction(async tx=>{
      const current=await this.lockOrder(tx,id);
      assertFoodTransition(actor.role,current.status,dto.status,current.fulfillment);
      if(current.status===dto.status)return {order:current,changed:false};
      const updated=await tx.foodOrder.update({where:{id},data:{status:dto.status,...(dto.status==='COMPLETED'?{completedAt:new Date()}:{}),history:{create:{status:dto.status,actorId:actor.id,reason:dto.reason?.trim()||null}}}});
      await this.audit.record(tx,actor,'food-order.status','food-order',id,{from:current.status,to:dto.status,reason:dto.reason?.trim()||null});
      return {order:updated,changed:true};
    });
    if(result.changed)this.changed(result.order);
    return this.serialize(result.order);
  }

  private changed(order:FoodOrder) {
    this.events.publish([order.clientId],'food:order:updated',this.serialize(order));
    this.events.adminChanged('food-orders',order.id);
  }

  private async lockOrder(tx:Prisma.TransactionClient,id:string) {
    await tx.$queryRaw`SELECT "id" FROM "FoodOrder" WHERE "id"=${id}::uuid FOR UPDATE`;
    const order=await tx.foodOrder.findUnique({where:{id}});
    if(!order)throw new NotFoundException('Заказ еды не найден');
    return order;
  }
  private serialize(order:FoodOrder) {
    return {id:order.id,status:order.status,createdAt:order.createdAt,updatedAt:order.updatedAt,completedAt:order.completedAt,restaurant:order.restaurantSnapshot,items:order.items,subtotal:order.subtotal,deliveryFee:order.deliveryFee,total:order.total,currency:'KGS',fulfillment:order.fulfillment,address:order.address,comment:order.comment,paymentMethod:order.paymentMethod,isDemo:order.isDemo};
  }
}
