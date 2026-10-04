import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { Actor, RateLimits } from './auth';
import { AdminAuditService, assertAdmin, hashAdminPassword } from './admin.security';
import { RestaurantActor } from './restaurant-auth';
import { assertRestaurantCatalogPermissions, DEFAULT_MANAGER_PERMISSIONS, requireRestaurantPermission, restaurantPermissions, restaurantPhone, RestaurantPermission, RESTAURANT_PERMISSIONS } from './restaurant-domain';
import { RestaurantAccountInputDto, RestaurantCatalogDto, RestaurantOrderActionDto, RestaurantPromotionsDto, RestaurantStaffInputDto } from './restaurant.dto';
import { validateRestaurantCatalog, validateFoodPromotions, normalizeContentImage } from './content-domain';
import { FoodRestaurant } from './food-catalog';
import { assertFoodTransition } from './food-domain';
import { FoodService } from './food';
import { RealtimeEvents } from './events';

const json=(value:unknown)=>value as Prisma.InputJsonValue;
@Injectable()
export class RestaurantService {
  constructor(private readonly db:PrismaService,private readonly audit:AdminAuditService,private readonly events:RealtimeEvents,private readonly food:FoodService,private readonly limits:RateLimits){}
  async access(actor:RestaurantActor,restaurantId:string,permission?:RestaurantPermission,tx:Prisma.TransactionClient=this.db) {
    const member=await tx.restaurantMembership.findUnique({where:{accountId_restaurantId:{accountId:actor.id,restaurantId}},include:{account:true}});
    if(!member?.active||!member.account.active||member.account.sessionVersion!==actor.sessionVersion)throw new ForbiddenException('Нет доступа к этому ресторану');
    if(permission)requireRestaurantPermission(member,permission);
    return member;
  }
  private async lockAccess(tx:Prisma.TransactionClient,actor:RestaurantActor,restaurantId:string,permission?:RestaurantPermission) {
    await tx.$queryRaw`SELECT "id" FROM "RestaurantAccount" WHERE "id"=${actor.id}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "RestaurantMembership" WHERE "accountId"=${actor.id}::uuid AND "restaurantId"=${restaurantId} FOR SHARE`;
    return this.access(actor,restaurantId,permission,tx);
  }
  private async row(tx:Prisma.TransactionClient,id:string) {
    const row=await tx.foodRestaurant.findUnique({where:{id}});
    if(!row)throw new NotFoundException('Ресторан не найден');
    return row;
  }
  private updated(current:Date,expected?:string) {
    if(expected&&current.toISOString()!==expected)throw new ConflictException('Ресторан уже изменён. Обновите данные перед сохранением.');
  }
  async get(actor:RestaurantActor,id:string) {
    await this.access(actor,id);
    const row=await this.row(this.db,id);
    return {catalog:row.catalog,active:row.active,updatedAt:row.updatedAt};
  }
  async saveCatalog(actor:RestaurantActor,id:string,dto:RestaurantCatalogDto) {
    const result=await this.db.$transaction(async tx=>{
      const member=await this.lockAccess(tx,actor,id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restaurant:${id}`}))`;
      const current=await this.row(tx,id);
      this.updated(current.updatedAt,dto.updatedAt);
      const previous=validateRestaurantCatalog(current.catalog,id,current.isDemo);
      const next=validateRestaurantCatalog(dto.catalog,id,current.isDemo);
      assertRestaurantCatalogPermissions(member,previous,next);
      const row=await tx.foodRestaurant.update({where:{id},data:{catalog:json(next)}});
      await tx.adminAudit.create({data:{actorId:actor.id,action:'restaurant-member.catalog',entity:'restaurant',entityId:id,details:{role:member.role}}});
      return {catalog:row.catalog,active:row.active,updatedAt:row.updatedAt};
    });
    this.events.contentChanged('restaurants');this.events.adminChanged('restaurants',id);
    return result;
  }
  async promotions(actor:Actor,id:string) {
    assertAdmin(actor);
    const row=await this.row(this.db,id);
    return {promotions:(row.catalog as unknown as FoodRestaurant).promotions??[],updatedAt:row.updatedAt};
  }
  async savePromotions(actor:Actor,id:string,dto:RestaurantPromotionsDto) {
    assertAdmin(actor);
    const result=await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restaurant:${id}`}))`;
      const row=await this.row(tx,id);
      this.updated(row.updatedAt,dto.updatedAt);
      const catalog=row.catalog as unknown as FoodRestaurant;
      const promotions=validateFoodPromotions(dto.promotions,catalog.dishes.map(d=>d.id));
      const saved=await tx.foodRestaurant.update({where:{id},data:{catalog:json({...catalog,promotions})}});
      await this.audit.record(tx,actor,'restaurant.promotions','restaurant',id,{count:promotions.length});
      return {promotions,updatedAt:saved.updatedAt};
    });
    this.events.contentChanged('restaurants');this.events.adminChanged('restaurants',id);
    return result;
  }
  async listOwners(actor:Actor) {
    assertAdmin(actor);
    const rows=await this.db.restaurantAccount.findMany({where:{memberships:{some:{role:'OWNER'}}},include:{memberships:{where:{role:'OWNER',active:true}}},orderBy:{createdAt:'desc'}});
    return {items:rows.map(row=>({id:row.id,name:row.name,phone:row.phone,active:row.active,role:'OWNER',restaurantIds:row.memberships.map(m=>m.restaurantId),createdAt:row.createdAt,updatedAt:row.updatedAt}))};
  }
  async saveOwner(actor:Actor,dto:RestaurantAccountInputDto,id?:string) {
    assertAdmin(actor);
    if(!id&&(!dto.phone||!dto.password||!dto.restaurantIds?.length))throw new BadRequestException('Укажите телефон, пароль и ресторан');
    const passwordHash=dto.password?await hashAdminPassword(dto.password):undefined;
    const phone=dto.phone?restaurantPhone(dto.phone):undefined;
    try {
      const result=await this.db.$transaction(async tx=>{
        if(id)await tx.$queryRaw`SELECT "id" FROM "RestaurantAccount" WHERE "id"=${id}::uuid FOR UPDATE`;
        const current=id?await tx.restaurantAccount.findUnique({where:{id},include:{memberships:true}}):null;
        if(id&&(!current||!current.memberships.some(m=>m.role==='OWNER')))throw new NotFoundException('Владелец не найден');
        if(dto.restaurantIds&&(await tx.foodRestaurant.count({where:{id:{in:dto.restaurantIds}}}))!==dto.restaurantIds.length)throw new BadRequestException('Один из ресторанов не найден');
        const revoke=!!current&&(!!passwordHash||dto.active!==undefined&&dto.active!==current.active||phone!==undefined&&phone!==current.phone);
        const data={...(dto.name===undefined?{}:{name:dto.name.trim()}),...(phone?{phone}:{}),...(passwordHash?{passwordHash}:{}),...(dto.active===undefined?{}:{active:dto.active}),...(revoke?{sessionVersion:{increment:1}}:{})};
        const account=current?await tx.restaurantAccount.update({where:{id:current.id},data}):await tx.restaurantAccount.create({data:{phone:phone!,passwordHash:passwordHash!,name:dto.name?.trim()??'',active:dto.active??true}});
        if(revoke)await tx.restaurantSession.updateMany({where:{accountId:account.id,revokedAt:null},data:{revokedAt:new Date()}});
        if(dto.restaurantIds) {
          await tx.restaurantMembership.updateMany({where:{accountId:account.id,role:'OWNER',restaurantId:{notIn:dto.restaurantIds}},data:{active:false}});
          for(const restaurantId of dto.restaurantIds)await tx.restaurantMembership.upsert({where:{accountId_restaurantId:{accountId:account.id,restaurantId}},create:{accountId:account.id,restaurantId,role:'OWNER',permissions:[]},update:{role:'OWNER',active:true,permissions:[]}});
        }
        await this.audit.record(tx,actor,current?'restaurant-owner.update':'restaurant-owner.create','restaurant-account',account.id,{restaurantIds:dto.restaurantIds??[],passwordReset:!!passwordHash,active:account.active});
        return {id:account.id,name:account.name,phone:account.phone,active:account.active,role:'OWNER'};
      });
      this.events.adminChanged('restaurant-accounts',result.id);return result;
    }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new ConflictException('Этот телефон уже зарегистрирован в приложении ресторанов');throw error;}
  }
  async staff(actor:RestaurantActor,id:string) {
    await this.access(actor,id,'staff.manage');
    const rows=await this.db.restaurantMembership.findMany({where:{restaurantId:id},include:{account:true},orderBy:{createdAt:'asc'}});
    return {staff:rows.map(row=>({id:row.accountId,name:row.account.name,phone:row.account.phone,role:row.role,permissions:row.role==='OWNER'?[...RESTAURANT_PERMISSIONS]:row.permissions,active:row.active&&row.account.active}))};
  }
  async saveStaff(actor:RestaurantActor,id:string,dto:RestaurantStaffInputDto,accountId?:string) {
    if(!accountId&&(!dto.phone||!dto.password))throw new BadRequestException('Укажите телефон и пароль менеджера');
    if(accountId===actor.id)throw new ForbiddenException('Изменять собственные права нельзя');
    const permissions=dto.permissions===undefined?undefined:restaurantPermissions(dto.permissions);
    const passwordHash=dto.password?await hashAdminPassword(dto.password):undefined;
    const phone=dto.phone?restaurantPhone(dto.phone):undefined;
    try{return await this.db.$transaction(async tx=>{
      const actorMember=await this.lockAccess(tx,actor,id,'staff.manage');
      const granted=permissions??DEFAULT_MANAGER_PERMISSIONS;
      if(actorMember.role!=='OWNER'&&granted.some(permission=>!actorMember.permissions.includes(permission)))throw new ForbiddenException('Нельзя предоставить права, которых у вас нет');
      if(accountId) {
        await tx.$queryRaw`SELECT "id" FROM "RestaurantAccount" WHERE "id"=${accountId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "RestaurantMembership" WHERE "accountId"=${accountId}::uuid AND "restaurantId"=${id} FOR UPDATE`;
      }
      const existing=accountId?await tx.restaurantMembership.findUnique({where:{accountId_restaurantId:{accountId,restaurantId:id}},include:{account:{include:{memberships:true}}}}):null;
      if(accountId&&(!existing||existing.role!=='MANAGER'))throw new NotFoundException('Менеджер не найден');
      if(existing&&(passwordHash||phone||dto.name!==undefined)&&existing.account.memberships.some(m=>m.restaurantId!==id))throw new ForbiddenException('Общие данные этого сотрудника изменяет администратор Atlas');
      if(existing&&actorMember.role!=='OWNER'&&existing.permissions.some(permission=>!actorMember.permissions.includes(permission)))throw new ForbiddenException('Права этого сотрудника изменяет владелец');
      const revoke=!!existing&&(!!passwordHash||phone!==undefined&&phone!==existing.account.phone);
      const account=existing?await tx.restaurantAccount.update({where:{id:existing.accountId},data:{...(dto.name===undefined?{}:{name:dto.name.trim()}),...(phone?{phone}:{}),...(passwordHash?{passwordHash}:{}),...(revoke?{sessionVersion:{increment:1}}:{})}}):await tx.restaurantAccount.create({data:{phone:phone!,passwordHash:passwordHash!,name:dto.name?.trim()??''}});
      const member=existing?await tx.restaurantMembership.update({where:{id:existing.id},data:{...(permissions===undefined?{}:{permissions}),...(dto.active===undefined?{}:{active:dto.active})}}):await tx.restaurantMembership.create({data:{accountId:account.id,restaurantId:id,role:'MANAGER',permissions:granted,active:dto.active??true}});
      if(revoke)await tx.restaurantSession.updateMany({where:{accountId:account.id,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.adminAudit.create({data:{actorId:actor.id,action:existing?'restaurant-member.update':'restaurant-member.create',entity:'restaurant',entityId:id,details:{accountId:account.id,permissions:member.permissions,active:member.active}}});
      return {id:account.id,name:account.name,phone:account.phone,role:member.role,permissions:member.permissions,active:member.active&&account.active};
    });}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new ConflictException('Этот телефон уже зарегистрирован');throw error;}
  }
  async orders(actor:RestaurantActor,id:string) {
    await this.access(actor,id,'orders.read');
    const orders=await this.db.foodOrder.findMany({where:{restaurantId:id},include:{client:{select:{name:true,phone:true}},atlasDelivery:{select:{id:true,status:true,price:true}}},orderBy:{createdAt:'desc'},take:200});
    return {orders:orders.map(order=>({...order,deliveryLat:(order.deliveryPoint as {latitude?:number}|null)?.latitude??null,deliveryLng:(order.deliveryPoint as {longitude?:number}|null)?.longitude??null,atlasOrderId:order.atlasDelivery?.id??null,atlasStatus:order.atlasDelivery?.status??null,deliveryPrice:order.atlasDelivery?.price??null}))};
  }
  async changeOrder(actor:RestaurantActor,id:string,orderId:string,dto:RestaurantOrderActionDto) {
    const next=({ACCEPT:'CONFIRMED',PREPARING:'PREPARING',READY:'READY',COMPLETE:'COMPLETED',CANCEL:'CANCELLED'} as const)[dto.action];
    const row=await this.db.$transaction(async tx=>{
      await this.lockAccess(tx,actor,id,'orders.manage');
      await tx.$queryRaw`SELECT "id" FROM "FoodOrder" WHERE "id"=${orderId}::uuid FOR UPDATE`;
      const order=await tx.foodOrder.findFirst({where:{id:orderId,restaurantId:id},include:{atlasDelivery:true}});
      if(!order)throw new NotFoundException('Заказ не найден');
      if(order.atlasDelivery&&['SEARCHING','ASSIGNED','ARRIVED','IN_PROGRESS'].includes(order.atlasDelivery.status)&&['CANCELLED','COMPLETED'].includes(next))throw new ConflictException('Заказ передан Atlas. Доставку завершает водитель; для отмены обратитесь в поддержку.');
      assertFoodTransition('ADMIN',order.status,next,order.fulfillment);
      if(order.status===next)return order;
      return tx.foodOrder.update({where:{id:orderId},data:{status:next,...(next==='COMPLETED'?{completedAt:new Date()}:{}),history:{create:{status:next,actorId:actor.id,reason:dto.reason?.trim()||null}}}});
    });
    this.food.changed(row);return row;
  }
  async stats(actor:RestaurantActor,id:string,period:string) {
    await this.access(actor,id,'stats.read');
    if(!['day','week','month','all'].includes(period))throw new BadRequestException('Неизвестный период');
    const days=period==='day'?1:period==='week'?7:period==='month'?30:null;
    const since=days?new Date(Math.floor((Date.now()+6*3600000)/86400000)*86400000-6*3600000-(days-1)*86400000):new Date(0);
    const [counts,completed,byDay]=await Promise.all([
      this.db.foodOrder.groupBy({by:['status'],where:{restaurantId:id,createdAt:{gte:since}},_count:{_all:true}}),
      this.db.foodOrder.aggregate({where:{restaurantId:id,status:'COMPLETED',createdAt:{gte:since}},_sum:{total:true},_avg:{total:true},_count:{_all:true}}),
      this.db.$queryRaw<Array<{date:string;orders:number;revenue:number}>>`SELECT to_char("createdAt" + interval '6 hours','YYYY-MM-DD') AS date, COUNT(*)::int AS orders, COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total ELSE 0 END),0)::int AS revenue FROM "FoodOrder" WHERE "restaurantId"=${id} AND "createdAt">=${since} GROUP BY date ORDER BY date`,
    ]);
    return {totalOrders:counts.reduce((sum,row)=>sum+row._count._all,0),revenue:completed._sum.total??0,averageOrder:Math.round(completed._avg.total??0),completedOrders:completed._count._all,cancelledOrders:counts.find(row=>row.status==='CANCELLED')?._count._all??0,byDay};
  }
  async upload(actor:RestaurantActor,id:string,file?:{buffer:Buffer;mimetype:string}) {
    const member=await this.access(actor,id);
    if(member.role!=='OWNER'&&!member.permissions.some(p=>p==='menu.manage'||p==='restaurant.manage'))throw new ForbiddenException('Нет доступа к фотографиям');
    await this.limits.take(`restaurant:media:${actor.id}`,60,3600);
    if(!file?.buffer)throw new BadRequestException('Выберите фотографию');
    const normalized=await normalizeContentImage(file.buffer,file.mimetype);
    const row=await this.db.mediaAsset.create({data:{...normalized,data:Uint8Array.from(normalized.data)}});
    return {url:`/api/content/media/${row.id}`};
  }
}
