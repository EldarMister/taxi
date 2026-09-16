import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Actor, AuthService } from './auth';
import { AppConfig } from './config';
import { ACTIVE_STATUSES } from './domain';
import { DriverPositionDto, DriverPreferencesDto, DriverRegisterDto, TopupDto, VerifyDriverDto } from './dto';
import { PrismaService } from './prisma.service';
import { AdminAuditService } from './admin.security';
import { RealtimeEvents } from './events';
import { ACTIVE_FOOD_STATUSES } from './food-domain';

@Injectable()
export class DriverService {
  constructor(private readonly db:PrismaService,private readonly config:AppConfig,private readonly auth:AuthService,private readonly audit:AdminAuditService,private readonly events:RealtimeEvents) {}
  private assertDriver(actor:Actor) {if(actor.role!=='DRIVER') throw new ForbiddenException('Действие доступно водителю');}
  async online(actor:Actor,online:boolean) {
    this.assertDriver(actor);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${actor.id}::uuid FOR UPDATE`;
      const profile = await tx.driverProfile.findUnique({where:{userId:actor.id},include:{vehicle:true}});
      if(!profile?.verified||!profile.vehicle) throw new ForbiddenException('Профиль водителя не подтверждён');
      if(online&&profile.deposit<this.config.minimumDeposit) throw new BadRequestException('Пополните депозит у администратора');
      if(online&&!([profile.acceptsEconomy,profile.acceptsComfort,profile.acceptsDeliveryCar,profile.acceptsDeliveryTruck].some(Boolean)))throw new BadRequestException('Включите хотя бы один вид заказов в настройках');
      if(!online&&await tx.order.findFirst({where:{driverId:actor.id,status:{in:ACTIVE_STATUSES}}})) throw new ConflictException('Сначала завершите или отмените активный заказ');
      await tx.driverProfile.update({where:{userId:actor.id},data:{online,...(!online?{locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}:{})}});
    });
    this.events.adminChanged('drivers',actor.id);return this.auth.user(actor.id);
  }
  async preferences(actor:Actor,dto:DriverPreferencesDto) {
    this.assertDriver(actor);
    const profile=await this.db.driverProfile.findUnique({where:{userId:actor.id}});
    if(!profile)throw new NotFoundException('Профиль водителя не найден');
    const next={acceptsEconomy:dto.acceptsEconomy??profile.acceptsEconomy,acceptsComfort:dto.acceptsComfort??profile.acceptsComfort,acceptsDeliveryCar:dto.acceptsDeliveryCar??profile.acceptsDeliveryCar,acceptsDeliveryTruck:dto.acceptsDeliveryTruck??profile.acceptsDeliveryTruck};
    if(profile.transportClass==='ECONOMY'&&(next.acceptsComfort||next.acceptsDeliveryTruck)
      ||profile.transportClass==='COMFORT'&&next.acceptsDeliveryTruck
      ||profile.transportClass==='TRUCK'&&(next.acceptsEconomy||next.acceptsComfort||next.acceptsDeliveryCar))throw new ForbiddenException('Категория автомобиля не позволяет включить этот вид заказов');
    if(!Object.values(next).some(Boolean))throw new BadRequestException('Оставьте включённым хотя бы один вид заказов');
    await this.db.driverProfile.update({where:{userId:actor.id},data:next});
    this.events.adminChanged('drivers',actor.id);
    return this.auth.user(actor.id);
  }
  async register(actor:Actor,dto:DriverRegisterDto,vehiclePhoto:Buffer,profilePhoto?:Buffer) {
    if(actor.role!=='CLIENT')throw new ForbiddenException('Заявку может подать новый водитель');
    const name=`${dto.firstName.trim()} ${dto.lastName.trim()}`;
    const plate=dto.carPlate.trim().toUpperCase();
    const id=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id}::uuid FOR UPDATE`;
      const user=await tx.user.findUniqueOrThrow({where:{id:actor.id},select:{role:true}});
      if(user.role!=='CLIENT')throw new ConflictException('Заявка уже подана');
      if(await tx.order.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_STATUSES}}})||await tx.foodOrder.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}}}))throw new ConflictException('Сначала завершите активный заказ');
      await tx.user.update({where:{id:actor.id},data:{role:'DRIVER',name,...(profilePhoto?{avatarData:Uint8Array.from(profilePhoto),avatarMime:'image/jpeg',avatarUpdatedAt:new Date()}:{})}});
      await tx.driverProfile.create({data:{userId:actor.id,verified:false,online:false,requestedTransportClass:dto.requestedTransportClass,transportClass:'ECONOMY',acceptsEconomy:dto.requestedTransportClass==='ECONOMY',acceptsDeliveryTruck:false,vehicle:{create:{make:dto.carMake.trim(),color:dto.carColor?.trim()||'Не указан',plate,photoData:Uint8Array.from(vehiclePhoto),photoMime:'image/jpeg',photoUpdatedAt:new Date()}}}});
      return actor.id;
    });
    this.events.adminChanged('drivers',id);
    return this.auth.user(id);
  }
  async position(actor:Actor,dto:DriverPositionDto) {
    this.assertDriver(actor);
    const now=Date.now();
    if(dto.measuredAtMs>now+5000||dto.measuredAtMs<now-30000)throw new BadRequestException('GPS-точка устарела');
    const updated=await this.db.driverProfile.updateMany({where:{userId:actor.id,verified:true,online:true,OR:[{locationMeasuredAt:null},{locationMeasuredAt:{lt:new Date(dto.measuredAtMs)}}]},data:{locationLatitude:dto.latitude,locationLongitude:dto.longitude,locationAccuracyM:dto.accuracyM,locationMeasuredAt:new Date(dto.measuredAtMs)}});
    if(!updated.count)throw new ConflictException('Водитель не на линии или GPS-точка устарела');
    return {ok:true};
  }
  async balance(actor:Actor) {
    this.assertDriver(actor);
    const driver=await this.db.driverProfile.findUniqueOrThrow({where:{userId:actor.id}});
    const [cash,fees,operations]=await Promise.all([
      this.db.order.aggregate({where:{driverId:actor.id,status:'COMPLETED'},_sum:{price:true}}),
      this.db.ledgerEntry.aggregate({where:{driverId:actor.id,kind:'COMMISSION'},_sum:{amount:true}}),
      this.db.ledgerEntry.findMany({where:{driverId:actor.id},orderBy:{createdAt:'desc'},take:100})
    ]);
    return {deposit:driver.deposit,cashIncome:cash._sum.price??0,commissionTotal:Math.abs(fees._sum.amount??0),currency:'KGS',operations};
  }
  async topup(actor:Actor,driverId:string,dto:TopupDto) {
    if(actor.role!=='ADMIN') throw new ForbiddenException('Действие доступно администратору');
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${driverId}::uuid FOR UPDATE`;
      const driver=await tx.driverProfile.findUnique({where:{userId:driverId}});
      if(!driver) throw new NotFoundException('Водитель не найден');
      const key=`topup:${dto.idempotencyKey}`;
      const existing=await tx.ledgerEntry.findUnique({where:{idempotencyKey:key}});
      if(existing) {
        if(existing.driverId!==driverId||existing.amount!==dto.amount||existing.note!==dto.note) throw new ConflictException('Ключ повтора уже использован');return existing;
      }
      const balanceAfter=driver.deposit+dto.amount;
      if(balanceAfter>2000000000) throw new BadRequestException('Превышен лимит депозита');
      await tx.driverProfile.update({where:{userId:driverId},data:{deposit:balanceAfter}});
      const entry=await tx.ledgerEntry.create({data:{driverId,kind:'TOPUP',amount:dto.amount,balanceAfter,idempotencyKey:key,actorId:actor.id,note:dto.note}});
      await this.audit.record(tx,actor,'driver.topup','drivers',driverId,{amount:dto.amount,balanceAfter,note:dto.note,ledgerId:entry.id});return entry;
    });
    this.events.adminChanged('drivers',driverId);return result;
  }
  async verify(actor:Actor,userId:string,dto:VerifyDriverDto) {
    if(actor.role!=='ADMIN') throw new ForbiddenException();
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${userId}::uuid FOR UPDATE`;
      const user=await tx.user.findUnique({where:{id:userId},select:{role:true}});
      if(!user||user.role==='ADMIN') throw new BadRequestException('Нельзя изменить этот профиль');
      if(await tx.order.findFirst({where:{OR:[{clientId:userId},{driverId:userId}],status:{in:ACTIVE_STATUSES}}})) throw new ConflictException('У пользователя активный заказ');
      if(user.role==='CLIENT'&&await tx.foodOrder.findFirst({where:{clientId:userId,status:{in:ACTIVE_FOOD_STATUSES}}}))throw new ConflictException('У пользователя активный заказ еды');
      await tx.user.update({where:{id:userId},data:{role:'DRIVER'}});
      await tx.driverProfile.upsert({where:{userId},create:{userId,verified:dto.verified},update:{verified:dto.verified,online:false,locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}});
      await tx.vehicle.upsert({where:{driverId:userId},create:{driverId:userId,make:dto.carMake,color:dto.carColor,plate:dto.carPlate},update:{make:dto.carMake,color:dto.carColor,plate:dto.carPlate}});
      await this.audit.record(tx,actor,'driver.verify','drivers',userId,{verified:dto.verified,carMake:dto.carMake,carColor:dto.carColor,carPlate:dto.carPlate});
    });this.events.adminChanged('drivers',userId);return this.auth.user(userId);
  }
}
