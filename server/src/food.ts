import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FoodOrder, Prisma } from '@prisma/client';
import { Actor, RateLimits } from './auth';
import { AppConfig } from './config';
import { historySince } from './domain';
import { FoodRestaurant, FOOD_PAYMENT_METHODS } from './food-catalog';
import { ACTIVE_FOOD_STATUSES, assertFoodTransition, normalizeFoodBatch, normalizeFoodRequest, priceFoodOrder } from './food-domain';
import { CreateFoodOrderBatchDto, CreateFoodOrderDto, FoodStatusDto } from './food.dto';
import { PrismaService } from './prisma.service';
import { AdminAuditService } from './admin.security';
import { RealtimeEvents } from './events';
import { applyFoodPromotionsForDisplay } from './food-promotions';

export function serializeFoodOrder(order:FoodOrder) {
  return {id:order.id,status:order.status,createdAt:order.createdAt,updatedAt:order.updatedAt,completedAt:order.completedAt,restaurant:order.restaurantSnapshot,items:order.items,subtotal:order.subtotal,deliveryFee:order.deliveryFee,total:order.total,currency:'KGS',fulfillment:order.fulfillment,address:order.address,deliveryPoint:order.deliveryPoint,deliveryMethod:order.deliveryMethod,courierName:order.courierName,courierPhone:order.courierPhone,comment:order.comment,paymentMethod:order.paymentMethod,isDemo:order.isDemo};
}

@Injectable()
export class FoodService {
  constructor(private readonly db:PrismaService,private readonly config:AppConfig,private readonly limits:RateLimits,private readonly audit:AdminAuditService,private readonly events:RealtimeEvents) {}

  async catalog() {
    const rows=await this.db.foodRestaurant.findMany({where:{active:true,...(!this.config.development?{isDemo:false}:{})},orderBy:[{sortOrder:'asc'},{id:'asc'}]});
    const restaurants=rows.map(row=>applyFoodPromotionsForDisplay({...row.catalog as unknown as FoodRestaurant,id:row.id,isDemo:row.isDemo}));
    return {restaurants,paymentMethods:FOOD_PAYMENT_METHODS,isDemo:restaurants.some(restaurant=>restaurant.isDemo)};
  }

  async create(actor:Actor,dto:CreateFoodOrderDto) {
    if(actor.role!=='CLIENT')throw new ForbiddenException('Заказ еды доступен клиенту');
    await this.limits.take(`food:orders:${actor.id}`,20,60);
    const normalized=normalizeFoodRequest(dto);
    const result=await this.db.$transaction(async tx=>{
      // Serializes retries and distinct submissions for this client without blocking other customers.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id}::uuid FOR UPDATE`;
      const user=await tx.user.findUnique({where:{id:actor.id},select:{role:true,deletedAt:true}});
      if(user?.role!=='CLIENT'||user.deletedAt)throw new ForbiddenException('Заказ еды доступен клиенту');
      const existing=await tx.foodOrder.findUnique({where:{clientId_requestId:{clientId:actor.id,requestId:dto.requestId}}});
      if(existing) {
        if(existing.requestHash!==normalized.requestHash)throw new ConflictException('Ключ повтора уже использован с другим заказом');
        return {order:existing,changed:false};
      }
      if(await tx.foodOrder.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}}}))throw new ConflictException('У вас уже есть активный заказ еды');
      const data=await this.prepareOrder(tx,actor,dto.requestId,normalized);
      const order=await tx.foodOrder.create({data});
      return {order,changed:true};
    });
    if(result.changed)this.changed(result.order);
    return this.serialize(result.order);
  }

  async createBatch(actor:Actor,dto:CreateFoodOrderBatchDto) {
    if(actor.role!=='CLIENT')throw new ForbiddenException('Заказ еды доступен клиенту');
    await this.limits.take(`food:orders:${actor.id}`,20,60);
    const normalized=normalizeFoodBatch(dto);
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id}::uuid FOR UPDATE`;
      const user=await tx.user.findUnique({where:{id:actor.id},select:{role:true,deletedAt:true}});
      if(user?.role!=='CLIENT'||user.deletedAt)throw new ForbiddenException('Заказ еды доступен клиенту');
      const existing=await tx.foodOrder.findMany({where:{clientId:actor.id,requestId:{in:normalized.map(order=>order.requestId)}}});
      if(existing.length) {
        const byKey=new Map(existing.map(order=>[order.requestId,order]));
        if(existing.length!==normalized.length||normalized.some(order=>byKey.get(order.requestId)?.requestHash!==order.requestHash))throw new ConflictException('Ключ повтора уже использован с другим заказом');
        return {orders:normalized.map(order=>byKey.get(order.requestId)!),changed:false};
      }
      if(await tx.foodOrder.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}}}))throw new ConflictException('У вас уже есть активный заказ еды');
      // Lock and validate every restaurant before the first write; one unavailable cart rejects the entire confirmation.
      const prepared=new Map<string,Awaited<ReturnType<FoodService['prepareOrder']>>>();
      for(const order of [...normalized].sort((a,b)=>a.restaurantId.localeCompare(b.restaurantId)))prepared.set(order.requestId,await this.prepareOrder(tx,actor,order.requestId,order));
      const orders:FoodOrder[]=[];
      for(const order of normalized)orders.push(await tx.foodOrder.create({data:prepared.get(order.requestId)!}));
      return {orders,changed:true};
    },{timeout:15_000});
    if(result.changed)for(const order of result.orders)this.changed(order);
    return {orders:result.orders.map(order=>this.serialize(order)),total:result.orders.reduce((sum,order)=>sum+order.total,0),currency:'KGS' as const};
  }

  async active(actor:Actor) {
    const order=await this.db.foodOrder.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}},orderBy:{createdAt:'desc'}});
    return order?this.serialize(order):null;
  }
  async activeAll(actor:Actor) {
    const orders=await this.db.foodOrder.findMany({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
    return orders.map(order=>this.serialize(order));
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
      if(current.status!=='PLACED')throw new BadRequestException('Ресторан уже подтвердил заказ. Для отмены обратитесь в поддержку.');
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
      if(current.deliveryMethod==='ATLAS_CAR') {
        const delivery=await tx.order.findUnique({where:{foodOrderId:id},select:{status:true}});
        if(delivery&&['SEARCHING','ASSIGNED','ARRIVED','IN_PROGRESS'].includes(delivery.status))throw new ConflictException('Статус еды обновится вместе с доставкой Atlas. Сначала завершите или отмените доставку.');
      }
      const updated=await tx.foodOrder.update({where:{id},data:{status:dto.status,...(dto.status==='COMPLETED'?{completedAt:new Date()}:{}),history:{create:{status:dto.status,actorId:actor.id,reason:dto.reason?.trim()||null}}}});
      await this.audit.record(tx,actor,'food-order.status','food-order',id,{from:current.status,to:dto.status,reason:dto.reason?.trim()||null});
      return {order:updated,changed:true};
    });
    if(result.changed)this.changed(result.order);
    return this.serialize(result.order);
  }

  changed(order:FoodOrder) {
    this.events.publish([order.clientId],'food:order:updated',this.serialize(order));
    this.events.adminChanged('food-orders',order.id);
  }

  private async prepareOrder(tx:Prisma.TransactionClient,actor:Actor,requestId:string,normalized:ReturnType<typeof normalizeFoodRequest>) {
    await tx.$queryRaw`SELECT "id" FROM "FoodRestaurant" WHERE "id"=${normalized.restaurantId} FOR SHARE`;
    const stored=await tx.foodRestaurant.findFirst({where:{id:normalized.restaurantId,active:true,...(!this.config.development?{isDemo:false}:{})}});
    if(!stored)throw new NotFoundException('Ресторан сейчас недоступен');
    const restaurant={...stored.catalog as unknown as FoodRestaurant,id:stored.id,isDemo:stored.isDemo};
    const priced=priceFoodOrder(restaurant,normalized.items,normalized.fulfillment);
    const restaurantSnapshot={id:restaurant.id,name:restaurant.name,rating:restaurant.rating,reviewCount:restaurant.reviewCount,address:restaurant.address,phone:restaurant.phone,imageKey:restaurant.imageKey,...(restaurant.imageUrl?{imageUrl:restaurant.imageUrl}:{}),etaMin:restaurant.etaMin,etaMax:restaurant.etaMax};
    return {clientId:actor.id,restaurantId:restaurant.id,restaurantSnapshot,requestId,requestHash:normalized.requestHash,items:priced.items as unknown as Prisma.InputJsonValue,subtotal:priced.subtotal,deliveryFee:priced.deliveryFee,total:priced.total,fulfillment:normalized.fulfillment,address:normalized.address,...(normalized.deliveryPoint?{deliveryPoint:normalized.deliveryPoint}:{}),comment:normalized.comment,paymentMethod:normalized.paymentMethod,isDemo:stored.isDemo,history:{create:{status:'PLACED' as const,actorId:actor.id}}};
  }

  private async lockOrder(tx:Prisma.TransactionClient,id:string) {
    await tx.$queryRaw`SELECT "id" FROM "FoodOrder" WHERE "id"=${id}::uuid FOR UPDATE`;
    const order=await tx.foodOrder.findUnique({where:{id}});
    if(!order)throw new NotFoundException('Заказ еды не найден');
    return order;
  }
  serialize(order:FoodOrder) { return serializeFoodOrder(order); }
}
