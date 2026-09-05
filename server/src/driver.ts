import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Actor, AuthService } from './auth';
import { AppConfig } from './config';
import { ACTIVE_STATUSES } from './domain';
import { TopupDto, VerifyDriverDto } from './dto';
import { PrismaService } from './prisma.service';

@Injectable()
export class DriverService {
  constructor(private readonly db:PrismaService,private readonly config:AppConfig,private readonly auth:AuthService) {}
  private assertDriver(actor:Actor) {if(actor.role!=='DRIVER') throw new ForbiddenException('Действие доступно водителю');}
  async online(actor:Actor,online:boolean) {
    this.assertDriver(actor);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${actor.id}::uuid FOR UPDATE`;
      const profile = await tx.driverProfile.findUnique({where:{userId:actor.id},include:{vehicle:true}});
      if(!profile?.verified||!profile.vehicle) throw new ForbiddenException('Профиль водителя не подтверждён');
      if(online&&profile.deposit<this.config.minimumDeposit) throw new BadRequestException('Пополните депозит у администратора');
      if(!online&&await tx.order.findFirst({where:{driverId:actor.id,status:{in:ACTIVE_STATUSES}}})) throw new ConflictException('Сначала завершите или отмените активный заказ');
      await tx.driverProfile.update({where:{userId:actor.id},data:{online}});
    });
    return this.auth.user(actor.id);
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
    return this.db.$transaction(async tx=>{
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
      return tx.ledgerEntry.create({data:{driverId,kind:'TOPUP',amount:dto.amount,balanceAfter,idempotencyKey:key,actorId:actor.id,note:dto.note}});
    });
  }
  async verify(actor:Actor,userId:string,dto:VerifyDriverDto) {
    if(actor.role!=='ADMIN') throw new ForbiddenException();
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId}::uuid FOR UPDATE`;
      const user=await tx.user.findUnique({where:{id:userId}});
      if(!user||user.role==='ADMIN') throw new BadRequestException('Нельзя изменить этот профиль');
      if(await tx.order.findFirst({where:{OR:[{clientId:userId},{driverId:userId}],status:{in:ACTIVE_STATUSES}}})) throw new ConflictException('У пользователя активный заказ');
      await tx.user.update({where:{id:userId},data:{role:'DRIVER'}});
      await tx.driverProfile.upsert({where:{userId},create:{userId,verified:dto.verified},update:{verified:dto.verified,online:false}});
      await tx.vehicle.upsert({where:{driverId:userId},create:{driverId:userId,make:dto.carMake,color:dto.carColor,plate:dto.carPlate},update:{make:dto.carMake,color:dto.carColor,plate:dto.carPlate}});
    });return this.auth.user(userId);
  }
}
