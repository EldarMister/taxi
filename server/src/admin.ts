import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FoodOrderStatus, OrderStatus, Prisma } from '@prisma/client';
import { Actor, AuthService } from './auth';
import { AdminCancelDto, AdminDriverDto, AdminDriverPatchDto, AdminDriversDto, AdminOrdersDto, AdminPageDto, AdminTariffDto, AdminTariffPatchDto } from './admin.dto';
import { AdminAuditService, assertAdmin } from './admin.security';
import { ACTIVE_STATUSES } from './domain';
import { ACTIVE_FOOD_STATUSES } from './food-domain';
import { RealtimeEvents } from './events';
import { OrdersService } from './orders';
import { PrismaService } from './prisma.service';

const person={id:true,name:true,phone:true} as const;
const taxiInclude={client:{select:person},driver:{select:{...person,driverProfile:{select:{vehicle:true}}}},quote:{select:{tariff:true}}} as const;
const driverSelect={...person,createdAt:true,driverProfile:{include:{vehicle:true}}} as const;
const pageResult=<T>(items:T[],total:number,query:AdminPageDto)=>({items,total,page:query.page,pageSize:query.pageSize});
function validateText(value:string,label:string) {if(!value.trim())throw new BadRequestException(`Заполните поле «${label}»`);return value.trim();}
function driverView(row:{id:string;name:string;phone:string;createdAt:Date;driverProfile:any}) {
  return {...row,verified:row.driverProfile?.verified??false,online:row.driverProfile?.online??false,deposit:row.driverProfile?.deposit??0,carMake:row.driverProfile?.vehicle?.make??'',carColor:row.driverProfile?.vehicle?.color??'',carPlate:row.driverProfile?.vehicle?.plate??''};
}
@Injectable()
export class AdminService {
  constructor(private readonly db:PrismaService,private readonly audit:AdminAuditService,private readonly events:RealtimeEvents,private readonly ordersService:OrdersService,private readonly auth:AuthService) {}
  me(actor:Actor) {assertAdmin(actor);return this.auth.user(actor.id);}
  async dashboard(actor:Actor) {
    assertAdmin(actor);
    const offset=6*3600000,today=new Date(Math.floor((Date.now()+offset)/86400000)*86400000-offset);
    const [taxiActive,foodActive,driversOnline,driversTotal,restaurantsActive,taxiToday,foodToday,taxiRevenue,foodRevenue,unverifiedDrivers,taxiRecent,foodRecent]=await Promise.all([
      this.db.order.count({where:{status:{in:ACTIVE_STATUSES}}}),this.db.foodOrder.count({where:{status:{in:ACTIVE_FOOD_STATUSES}}}),
      this.db.driverProfile.count({where:{online:true}}),this.db.driverProfile.count(),this.db.foodRestaurant.count({where:{active:true}}),
      this.db.order.count({where:{createdAt:{gte:today}}}),this.db.foodOrder.count({where:{createdAt:{gte:today}}}),
      this.db.order.aggregate({where:{status:'COMPLETED',completedAt:{gte:today}},_sum:{price:true,commission:true}}),
      this.db.foodOrder.aggregate({where:{status:'COMPLETED',completedAt:{gte:today}},_sum:{total:true}}),
      this.db.driverProfile.count({where:{verified:false}}),
      this.db.order.findMany({orderBy:{createdAt:'desc'},take:8,include:taxiInclude}),
      this.db.foodOrder.findMany({orderBy:{createdAt:'desc'},take:8,include:{client:{select:person}}}),
    ]);
    return {at:new Date().toISOString(),dayStart:today,currency:'KGS',metrics:{activeTaxiOrders:taxiActive,activeFoodOrders:foodActive,onlineDrivers:driversOnline,totalDrivers:driversTotal,activeRestaurants:restaurantsActive,todayTaxiOrders:taxiToday,todayFoodOrders:foodToday,todayTaxiRevenue:taxiRevenue._sum.price??0,commissionToday:taxiRevenue._sum.commission??0,todayFoodRevenue:foodRevenue._sum.total??0,unverifiedDrivers},recentOrders:{taxi:taxiRecent.map(row=>({...row,kind:'taxi',total:row.price,tariff:row.quote.tariff})),food:foodRecent.map(row=>({...row,kind:'food',restaurant:row.restaurantSnapshot}))}};
  }
  async orders(actor:Actor,query:AdminOrdersDto) {
    assertAdmin(actor);const search=query.search.trim(),skip=(query.page-1)*query.pageSize;
    if(query.kind==='food') {
      if(query.status&&!Object.values(FoodOrderStatus).includes(query.status as FoodOrderStatus))throw new BadRequestException('Неизвестный статус заказа еды');
      const where:Prisma.FoodOrderWhereInput={...(query.status?{status:query.status as FoodOrderStatus}:{}),...(search?{OR:[{client:{phone:{contains:search}}},{client:{name:{contains:search,mode:'insensitive'}}},{restaurantId:{contains:search,mode:'insensitive'}},{restaurantSnapshot:{path:['name'],string_contains:search}},{address:{contains:search,mode:'insensitive'}},...(/^[0-9a-f-]{36}$/i.test(search)?[{id:search}]:[])]}:{})};
      const [rows,total]=await this.db.$transaction([this.db.foodOrder.findMany({where,skip,take:query.pageSize,orderBy:[{createdAt:'desc'},{id:'desc'}],include:{client:{select:person}}}),this.db.foodOrder.count({where})]);
      return pageResult(rows.map(row=>({...row,kind:'food',restaurant:row.restaurantSnapshot})),total,query);
    }
    if(query.status&&!Object.values(OrderStatus).includes(query.status as OrderStatus))throw new BadRequestException('Неизвестный статус поездки');
    const where:Prisma.OrderWhereInput={...(query.status?{status:query.status as OrderStatus}:{}),...(search?{OR:[{client:{phone:{contains:search}}},{client:{name:{contains:search,mode:'insensitive'}}},{driver:{phone:{contains:search}}},{driver:{name:{contains:search,mode:'insensitive'}}},...(/^[0-9a-f-]{36}$/i.test(search)?[{id:search}]:[])]}:{})};
    const [rows,total]=await this.db.$transaction([this.db.order.findMany({where,skip,take:query.pageSize,orderBy:[{createdAt:'desc'},{id:'desc'}],include:taxiInclude}),this.db.order.count({where})]);
    return pageResult(rows.map(row=>({...row,kind:'taxi',total:row.price,tariff:row.quote.tariff})),total,query);
  }
  async order(actor:Actor,kind:string,id:string) {
    assertAdmin(actor);
    if(kind==='food') {
      const row=await this.db.foodOrder.findUnique({where:{id},include:{client:{select:person},history:{orderBy:{createdAt:'asc'}}}});
      if(!row)throw new NotFoundException('Заказ еды не найден');return {...row,kind,restaurant:row.restaurantSnapshot};
    }
    if(kind!=='taxi')throw new BadRequestException('Неизвестный тип заказа');
    const row=await this.db.order.findUnique({where:{id},include:{...taxiInclude,history:{orderBy:{createdAt:'asc'}},rating:true}});
    if(!row)throw new NotFoundException('Поездка не найдена');return {...row,kind,total:row.price,tariff:row.quote.tariff};
  }
  async cancelTaxi(actor:Actor,id:string,dto:AdminCancelDto) {
    assertAdmin(actor);const reason=validateText(dto.reason,'Причина отмены');
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id"=${id}::uuid FOR UPDATE`;
      const current=await tx.order.findUnique({where:{id}});
      if(!current)throw new NotFoundException('Поездка не найдена');
      if(current.status==='CANCELLED')return;
      if(!['SEARCHING','ASSIGNED','ARRIVED'].includes(current.status))throw new ConflictException('Отмена доступна только до начала поездки');
      await tx.order.update({where:{id},data:{status:'CANCELLED',history:{create:{status:'CANCELLED',actorId:actor.id,reason:`ADMIN: ${reason}`}}}});
      await tx.pushJob.createMany({data:[current.clientId,...(current.driverId?[current.driverId]:[])].map(userId=>({userId,event:'order:updated',orderId:id}))});
      await this.audit.record(tx,actor,'taxi.cancel','taxi-orders',id,{previousStatus:current.status,reason});
    });
    await this.ordersService.publish(id);return this.order(actor,'taxi',id);
  }
  async tariffs(actor:Actor) {assertAdmin(actor);const items=await this.db.tariff.findMany({orderBy:[{active:'desc'},{basePrice:'asc'},{id:'asc'}]});return {items,total:items.length,page:1,pageSize:items.length};}
  async createTariff(actor:Actor,dto:AdminTariffDto) {
    assertAdmin(actor);const data={...dto,name:validateText(dto.name,'Название'),description:dto.description.trim()};
    const result=await this.db.$transaction(async tx=>{const row=await tx.tariff.create({data});await this.audit.record(tx,actor,'tariff.create','tariffs',row.id,{after:row});return row;});
    this.events.adminChanged('tariffs',result.id);this.events.contentChanged('tariffs');return result;
  }
  async updateTariff(actor:Actor,id:string,dto:AdminTariffPatchDto) {
    assertAdmin(actor);if(!Object.keys(dto).length)throw new BadRequestException('Нет изменений');
    const data={...dto,...(dto.name!==undefined?{name:validateText(dto.name,'Название')}:{}),...(dto.description!==undefined?{description:dto.description.trim()}:{})};
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "Tariff" WHERE "id"=${id} FOR UPDATE`;
      const before=await tx.tariff.findUnique({where:{id}});if(!before)throw new NotFoundException('Тариф не найден');
      const row=await tx.tariff.update({where:{id},data});await this.audit.record(tx,actor,'tariff.update','tariffs',id,{before,after:row});return row;
    });
    this.events.adminChanged('tariffs',id);this.events.contentChanged('tariffs');return result;
  }
  async drivers(actor:Actor,query:AdminDriversDto) {
    assertAdmin(actor);const search=query.search.trim();
    const where:Prisma.UserWhereInput={role:'DRIVER',...(query.filter==='all'?{}:{driverProfile:{is:query.filter==='unverified'?{verified:false}:{online:query.filter==='online'}}}),...(search?{OR:[{phone:{contains:search}},{name:{contains:search,mode:'insensitive'}},{driverProfile:{is:{vehicle:{is:{plate:{contains:search,mode:'insensitive'}}}}}}]}:{})};
    const [rows,total]=await this.db.$transaction([this.db.user.findMany({where,select:driverSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize}),this.db.user.count({where})]);
    return pageResult(rows.map(driverView),total,query);
  }
  async driver(actor:Actor,id:string) {
    assertAdmin(actor);
    const row=await this.db.user.findFirst({where:{id,role:'DRIVER'},select:driverSelect});if(!row)throw new NotFoundException('Водитель не найден');
    const [operations,recentOrders,stats]=await Promise.all([this.db.ledgerEntry.findMany({where:{driverId:id},orderBy:{createdAt:'desc'},take:50}),this.db.order.findMany({where:{driverId:id},orderBy:{createdAt:'desc'},take:20,include:taxiInclude}),this.db.order.aggregate({where:{driverId:id,status:'COMPLETED'},_sum:{price:true},_count:true})]);
    return {...driverView(row),operations,recentOrders,completedOrders:stats._count,cashIncome:stats._sum.price??0};
  }
  async createDriver(actor:Actor,dto:AdminDriverDto) {
    assertAdmin(actor);const name=validateText(dto.name,'Имя'),vehicle={make:validateText(dto.carMake,'Автомобиль'),color:validateText(dto.carColor,'Цвет'),plate:validateText(dto.carPlate,'Госномер').toUpperCase()};
    const id=await this.db.$transaction(async tx=>{
      let user=await tx.user.findUnique({where:{phone:dto.phone},select:{id:true,role:true}});
      if(user) {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id}::uuid FOR UPDATE`;
        user=await tx.user.findUniqueOrThrow({where:{id:user.id},select:{id:true,role:true}});
        if(user.role!=='CLIENT')throw new ConflictException('Этот номер уже используется водителем или администратором');
        if(await tx.order.findFirst({where:{clientId:user.id,status:{in:ACTIVE_STATUSES}}})||await tx.foodOrder.findFirst({where:{clientId:user.id,status:{in:ACTIVE_FOOD_STATUSES}}}))throw new ConflictException('У пользователя активный заказ');
        await tx.user.update({where:{id:user.id},data:{name,role:'DRIVER'}});
        await tx.refreshSession.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
      } else user=await tx.user.create({data:{phone:dto.phone,name,role:'DRIVER'},select:{id:true,role:true}});
      await tx.driverProfile.create({data:{userId:user.id,verified:dto.verified,vehicle:{create:vehicle}}});
      await this.audit.record(tx,actor,'driver.create','drivers',user.id,{phone:dto.phone,name,vehicle,verified:dto.verified});return user.id;
    });
    this.events.adminChanged('drivers',id);return this.driver(actor,id);
  }
  async updateDriver(actor:Actor,id:string,dto:AdminDriverPatchDto) {
    assertAdmin(actor);if(!Object.keys(dto).length)throw new BadRequestException('Нет изменений');
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${id}::uuid FOR UPDATE`;
      const user=await tx.user.findFirst({where:{id,role:'DRIVER'},select:driverSelect});if(!user?.driverProfile)throw new NotFoundException('Водитель не найден');
      if(await tx.order.findFirst({where:{OR:[{driverId:id},{clientId:id}],status:{in:ACTIVE_STATUSES}}}))throw new ConflictException('Сначала завершите активную поездку водителя');
      const car=user.driverProfile.vehicle;
      const vehicle={make:dto.carMake===undefined?car?.make:validateText(dto.carMake,'Автомобиль'),color:dto.carColor===undefined?car?.color:validateText(dto.carColor,'Цвет'),plate:dto.carPlate===undefined?car?.plate:validateText(dto.carPlate,'Госномер').toUpperCase()};
      if(!vehicle.make||!vehicle.color||!vehicle.plate)throw new BadRequestException('Заполните данные автомобиля');
      await tx.user.update({where:{id},data:{...(dto.phone?{phone:dto.phone}:{}),...(dto.name===undefined?{}:{name:validateText(dto.name,'Имя')})}});
      await tx.driverProfile.update({where:{userId:id},data:{...(dto.verified===undefined?{}:{verified:dto.verified}),online:false,locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}});
      await tx.vehicle.upsert({where:{driverId:id},create:{driverId:id,make:vehicle.make,color:vehicle.color,plate:vehicle.plate},update:{make:vehicle.make,color:vehicle.color,plate:vehicle.plate}});
      if(dto.phone&&dto.phone!==user.phone) {
        await tx.refreshSession.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});
        await tx.smsChallenge.deleteMany({where:{phone:{in:[dto.phone,user.phone]}}});
      }
      await this.audit.record(tx,actor,'driver.update','drivers',id,{changes:JSON.parse(JSON.stringify(dto))});
    });
    this.events.adminChanged('drivers',id);return this.driver(actor,id);
  }
  async auditLog(actor:Actor,query:AdminPageDto) {
    assertAdmin(actor);const where:Prisma.AdminAuditWhereInput=query.search.trim()?{OR:[{action:{contains:query.search,mode:'insensitive'}},{entity:{contains:query.search,mode:'insensitive'}},{entityId:{contains:query.search,mode:'insensitive'}}]}:{};
    const [rows,total]=await this.db.$transaction([this.db.adminAudit.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize}),this.db.adminAudit.count({where})]);
    const actors=await this.db.user.findMany({where:{id:{in:[...new Set(rows.map(row=>row.actorId))]}},select:{id:true,name:true,adminCredential:{select:{username:true}}}});
    return pageResult(rows.map(row=>({...row,actor:actors.find(actor=>actor.id===row.actorId)})),total,query);
  }
}
