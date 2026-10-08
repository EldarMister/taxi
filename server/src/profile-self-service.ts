import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, Patch, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Prisma, PerformerRole } from '@prisma/client';
import { Request } from 'express';
import { Actor, AuthGuard, AuthService } from './auth';
import { PrismaService } from './prisma.service';
import { CitiesService } from './cities';
import { RealtimeEvents } from './events';
import { ACTIVE_STATUSES } from './domain';
import { ACTIVE_FOOD_STATUSES } from './food-domain';
import { RegistrationData, validateRegistrationDataValues } from './registration-domain';

type Tx = Prisma.TransactionClient;
type Authed = Request & { actor: Actor };
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export class DriverDetailsDto {
  @IsInt() @Min(0) version!: number;
  @IsOptional() @IsObject() personal?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(60) vehicleKey?: string;
  @IsOptional() @IsObject() vehicle?: Record<string, unknown>;
}
const personalFields = ['firstName','lastName','middleName','birthDate','city'];
const vehicleFields = ['ownership','brand','model','year','color','plateNumber','plate','type','capacityKg'];
function permitted(patch: Record<string, unknown>, keys: string[]) {
  if(Object.keys(patch).some(key => !keys.includes(key)))throw new BadRequestException('Недопустимое поле профиля.');
  return Object.fromEntries(Object.entries(patch).map(([key,value]) => [key, typeof value === 'string' ? value.trim() : value]));
}
export function profileVehicles(data: Record<string, any>, roles: string[]) {
  return [
    ...(roles.includes('TAXI_DRIVER') ? [{key:'taxiVehicle',label:'Основной автомобиль',usage:'TAXI',vehicle:object(data.taxiVehicle)}] : []),
    ...(roles.includes('CARGO_DRIVER') ? [{key:'cargoVehicle',label:'Основной грузовой транспорт',usage:'CARGO',vehicle:object(data.cargoVehicle)}] : []),
    ...(Array.isArray(data.vehicles) ? data.vehicles.filter((v:any) => ['TAXI','CARGO'].includes(v.usage)).map((v:any) => ({key:v.clientId,label:'Дополнительный автомобиль',usage:v.usage,vehicle:v})) : []),
  ];
}
@Injectable()
export class ProfileSelfService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly cities: CitiesService, private readonly events: RealtimeEvents) {}
  private driver(actor:Actor) { if(actor.role!=='DRIVER')throw new ForbiddenException('Страница доступна водителю.'); }
  private async source(actor:Actor, tx:PrismaService|Tx=this.db) {
    const user=await tx.user.findUniqueOrThrow({where:{id:actor.id},select:{name:true,deletedAt:true,driverProfile:{select:{transportClass:true,vehicle:{select:{make:true,color:true,plate:true}}}},performerApplication:{include:{roles:true,uploads:{select:{id:true,slotKey:true,kind:true,status:true,mimeType:true,version:true}}}}}});
    if(user.deletedAt)throw new ForbiddenException('Аккаунт удалён.');
    const application=user.performerApplication;
    const selectedRoles=application?.roles.filter(role=>role.selected).map(role=>role.role) ?? [];
    const roles=selectedRoles.length?selectedRoles:[user.driverProfile?.transportClass==='TRUCK'?'CARGO_DRIVER':'TAXI_DRIVER'];
    const name=user.name.trim().split(/\s+/), vehicle=user.driverProfile?.vehicle;
    const data=application ? object(application.data) : {personal:{firstName:name.slice(1).join(' ')||name[0]||'',lastName:name.length>1?name[0]:'',middleName:'',birthDate:'',city:''}, [roles.includes('CARGO_DRIVER')?'cargoVehicle':'taxiVehicle']:{ownership:'OWN',brand:vehicle?.make.split(' ')[0]||'',model:vehicle?.make.split(' ').slice(1).join(' ')||'',color:vehicle?.color||'',plateNumber:vehicle?.plate||'',year:''},vehicles:[]};
    if(!selectedRoles.length&&vehicle) {
      const key=roles.includes('CARGO_DRIVER')?'cargoVehicle':'taxiVehicle',saved=object(data[key]);
      data[key]={...saved,ownership:saved.ownership||'OWN',brand:saved.brand||vehicle.make.split(' ')[0],model:saved.model||vehicle.make.split(' ').slice(1).join(' '),color:saved.color||vehicle.color,plateNumber:saved.plateNumber||vehicle.plate};
    }
    return {user,application,roles,data};
  }
  async details(actor:Actor) {
    this.driver(actor);
    const source=await this.source(actor), config=await this.cities.registrationConfig();
    return {version:source.application?.version??0, personal:source.data.personal, vehicles:profileVehicles(source.data,source.roles),uploads:source.application?.uploads.map(upload=>({...upload,remoteUrl:`/driver/registration/uploads/${encodeURIComponent(upload.slotKey)}?v=${upload.version}`}))??[],config};
  }
  async save(actor:Actor,dto:DriverDetailsDto) {
    this.driver(actor);
    if(!dto.personal&&!dto.vehicle)throw new BadRequestException('Нет изменений.');
    try {
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "userId"=${actor.id}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${actor.id}::uuid FOR UPDATE`;
        const source=await this.source(actor,tx), {data,application,user,roles}=source;
        if((application?.version??0)!==dto.version)throw new ConflictException('Данные изменились. Обновите страницу и повторите сохранение.');
        const config=await this.cities.registrationConfig(tx);
        if(dto.personal) {
          const personal={...object(data.personal),...permitted(dto.personal,personalFields)};
          if(!personal.firstName||!personal.lastName||!personal.birthDate||!personal.city)throw new BadRequestException('Укажите имя, фамилию, дату рождения и город работы.');
          const errors=validateRegistrationDataValues({personal} as RegistrationData,[],new Date(),[],[...config.acceptedCityNames,...(personal.city===object(data.personal).city?[personal.city]:[])]).filter(e=>e.field.startsWith('personal.'));
          if(errors.length)throw new BadRequestException(errors[0].message);
          data.personal=personal;
          await tx.user.update({where:{id:actor.id},data:{name:[personal.lastName,personal.firstName,personal.middleName].filter(Boolean).join(' ')}});
        }
        if(dto.vehicle) {
          if(await tx.order.findFirst({where:{driverId:actor.id,status:{in:ACTIVE_STATUSES}},select:{id:true}}))throw new ConflictException('Сначала завершите текущую поездку.');
          const selected=profileVehicles(data,roles).find(v=>v.key===dto.vehicleKey);
          if(!selected)throw new BadRequestException('Автомобиль не найден в вашем профиле.');
          const vehicle={...selected.vehicle,...permitted(dto.vehicle,vehicleFields)};
          for(const key of ['ownership','brand','model','year','color','plateNumber'])if(!vehicle[key])throw new BadRequestException('Заполните все данные автомобиля.');
          const prefix=selected.usage==='CARGO'?'cargoVehicle':'taxiVehicle';
          const errors=validateRegistrationDataValues({[prefix]:vehicle} as RegistrationData,[selected.usage==='CARGO'?'CARGO_DRIVER':'TAXI_DRIVER']);
          if(errors.length)throw new BadRequestException(errors[0].message);
          vehicle.plateNumber=String(vehicle.plateNumber).toUpperCase();
          if(await tx.vehicle.findFirst({where:{driverId:{not:actor.id},plate:{equals:vehicle.plateNumber,mode:'insensitive'}},select:{id:true}}))throw new ConflictException('Этот номер уже используется другим автомобилем.');
          if(selected.key==='taxiVehicle'||selected.key==='cargoVehicle')data[selected.key]=vehicle;
          else data.vehicles=data.vehicles.map((v:any)=>v.clientId===selected.key?vehicle:v);
          const primaryUsage=user.driverProfile?.transportClass==='TRUCK'?'CARGO':'TAXI';
          if(selected.key===(primaryUsage==='CARGO'?'cargoVehicle':'taxiVehicle')) {
            await tx.vehicle.upsert({where:{driverId:actor.id},create:{driverId:actor.id,make:`${vehicle.brand} ${vehicle.model}`.trim(),color:vehicle.color,plate:vehicle.plateNumber},update:{make:`${vehicle.brand} ${vehicle.model}`.trim(),color:vehicle.color,plate:vehicle.plateNumber}});
          }
        }
        const stored=data as Prisma.InputJsonValue;
        if(application)await tx.performerApplication.update({where:{id:application.id},data:{data:stored,version:{increment:1}}});
        else await tx.performerApplication.create({data:{userId:actor.id,status:'APPROVED',currentStep:'REVIEW',data:stored,version:1,roles:{create:roles.map(role=>({role:role as PerformerRole,status:'APPROVED'}))}}});
      });
    } catch(error) { if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new ConflictException('Этот номер уже используется.');throw error; }
    this.events.adminChanged('drivers',actor.id);
    this.events.publish([actor.id],'profile:updated',await this.auth.user(actor.id));
    return this.details(actor);
  }
  async removeAccount(actor:Actor) {
    if(!['CLIENT','DRIVER'].includes(actor.role))throw new ForbiddenException('Удаление этой учётной записи недоступно.');
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "userId"=${actor.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${actor.id}::uuid FOR UPDATE`;
      if(await tx.order.findFirst({where:{OR:[{clientId:actor.id},{driverId:actor.id}],status:{in:ACTIVE_STATUSES}},select:{id:true}})||await tx.foodOrder.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}},select:{id:true}}))throw new ConflictException('Сначала завершите или отмените активные заказы.');
      await tx.refreshSession.updateMany({where:{userId:actor.id},data:{revokedAt:new Date()}});
      await tx.pushToken.deleteMany({where:{userId:actor.id}});
      await tx.performerApplication.deleteMany({where:{userId:actor.id}});
      await tx.vehicle.updateMany({where:{driverId:actor.id},data:{make:'',color:'',plate:`deleted:${actor.id}`,photoData:null,photoMime:null,photoUpdatedAt:null}});
      await tx.driverProfile.updateMany({where:{userId:actor.id},data:{online:false,verified:false,acceptsEconomy:false,acceptsComfort:false,acceptsDeliveryCar:false,acceptsDeliveryFood:false,acceptsDeliveryTruck:false,courierModes:[],locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}});
      await tx.user.update({where:{id:actor.id},data:{phone:`deleted:${actor.id}`,name:'Удалённый пользователь',avatarData:null,avatarMime:null,avatarUpdatedAt:null,notifications:false,deletedAt:new Date()}});
    });
    this.events.publish([actor.id],'account:deleted',{id:actor.id});
    this.events.adminChanged('drivers',actor.id);
    return {ok:true};
  }
}
@UseGuards(AuthGuard) @Controller('driver/profile-details')
export class DriverDetailsController {
  constructor(private readonly service:ProfileSelfService) {}
  @Get() details(@Req() req:Authed) {return this.service.details(req.actor);}
  @Patch() save(@Req() req:Authed,@Body() dto:DriverDetailsDto) {return this.service.save(req.actor,dto);}
}
@UseGuards(AuthGuard) @Controller('users')
export class AccountDeletionController {
  constructor(private readonly service:ProfileSelfService) {}
  @Delete('me') remove(@Req() req:Authed) {return this.service.removeAccount(req.actor);}
}
