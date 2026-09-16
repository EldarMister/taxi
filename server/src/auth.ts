import { CanActivate, ExecutionContext, HttpException, Injectable, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AppConfig } from './config';
import { RealtimeEvents } from './events';
export interface Actor { id:string; role:Role; sessionId:string; familyId:string; expiresAt:number }
const hash = (value:string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class RateLimits {
  constructor(private readonly db:PrismaService) {}
  async take(key:string, max:number, seconds:number) {
    const expires = new Date(Date.now()+seconds*1000);
    const rows = await this.db.$queryRaw<{count:number}[]>`
      INSERT INTO "RateLimit" ("key","count","expiresAt") VALUES (${key},1,${expires})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN 1 ELSE "RateLimit"."count" + 1 END,
        "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN ${expires} ELSE "RateLimit"."expiresAt" END
      RETURNING "count"`;
    if (rows[0].count > max) throw new HttpException('Слишком много запросов. Попробуйте позже.',429);
  }
}
@Injectable()
export class AuthService {
  constructor(private readonly db:PrismaService,private readonly jwt:JwtService,private readonly config:AppConfig,private readonly limits:RateLimits,private readonly events:RealtimeEvents) {}
  private otpHash(phone:string, code:string) {return createHmac('sha256',this.config.otpSecret).update(`${phone}:${code}`).digest('hex');}
  async requestCode(phone:string, ip:string) {
    await this.limits.take(`sms:ip:${ip}`,20,3600);
    await this.limits.take(`sms:phone-hour:${phone}`,5,3600);
    await this.limits.take(`sms:phone-minute:${phone}`,1,60);
    if((await this.db.user.findUnique({where:{phone},select:{role:true}}))?.role==='ADMIN')throw new UnauthorizedException('Используйте вход в панель управления');
    const code = this.config.devAuth ? this.config.devCode : randomInt(100000,1000000).toString();
    if (this.config.smsProvider === 'development' && !this.config.devAuth) throw new ServiceUnavailableException('Включите DEV_AUTH_ENABLED в development или настройте SMS');
    const codeHash = this.otpHash(phone,code);
    await this.db.smsChallenge.upsert({where:{phone},create:{phone,codeHash,expiresAt:new Date(Date.now()+300000)},update:{codeHash,attempts:0,consumedAt:null,requestedAt:new Date(),expiresAt:new Date(Date.now()+300000)}});
    if (this.config.smsProvider === 'http') {
      try {
        const response = await fetch(this.config.require('SMS_GATEWAY_URL'),{method:'POST',headers:{Authorization:`Bearer ${this.config.require('SMS_GATEWAY_TOKEN')}`,'Content-Type':'application/json'},body:JSON.stringify({phone,message:`Код для входа в Такси: ${code}. Никому не сообщайте код.`}),signal:AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error('SMS rejected');
      } catch {
        await this.db.smsChallenge.updateMany({where:{phone,codeHash},data:{consumedAt:new Date()}});
        throw new ServiceUnavailableException('Не удалось отправить SMS. Попробуйте позже.');
      }
    }
    return {sent:true,retryAfterSeconds:60,...(this.config.devAuth?{development:true,developmentCode:this.config.devCode}:{})};
  }
  async verifyCode(phone:string, code:string, ip:string) {
    await this.limits.take(`verify:ip:${ip}`,40,900);
    await this.limits.take(`verify:phone:${phone}`,10,900);
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "phone" FROM "SmsChallenge" WHERE "phone"=${phone} FOR UPDATE`;
      const challenge = await tx.smsChallenge.findUnique({where:{phone}});
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() < Date.now() || challenge.attempts >= 5) return null;
      // Commit failed attempts: throwing inside this transaction would roll the counter back.
      const actual = Buffer.from(this.otpHash(phone,code),'hex'), expected = Buffer.from(challenge.codeHash,'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) {
        await tx.smsChallenge.update({where:{phone},data:{attempts:{increment:1}}}); return null;
      }
      await tx.smsChallenge.update({where:{phone},data:{consumedAt:new Date()}});
      const user = await tx.user.upsert({where:{phone},create:{phone},update:{}});
      // Administrator accounts never use SMS, including development OTP codes.
      if(user.role==='ADMIN')return null;
      return this.createSession(tx,user.id,randomUUID());
    });
    if (!result) throw new UnauthorizedException('Неверный или просроченный код');
    return {...result,user:await this.user(result.userId)};
  }
  private async createSession(tx:Prisma.TransactionClient,userId:string,familyId:string,adminAuthenticated=false) {
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await tx.refreshSession.create({data:{userId,familyId,tokenHash:hash(refreshToken),adminAuthenticated,expiresAt:new Date(Date.now()+this.config.refreshDays*86400000)}});
    const accessToken = await this.jwt.signAsync({sub:userId,sid:session.id,fid:familyId},{secret:this.config.jwtSecret,expiresIn:this.config.accessSeconds,issuer:'taxi-api',audience:'taxi-mobile'});
    return {accessToken,refreshToken,userId,expiresIn:this.config.accessSeconds};
  }
  async refresh(refreshToken:string) {
    const tokenHash = hash(refreshToken);
    const result = await this.db.$transaction(async tx => {
      const initial = await tx.refreshSession.findUnique({where:{tokenHash}});
      if (!initial) return null;
      // Serializes all rotations/reuse revocations within one session family.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.familyId}))`;
      const session = await tx.refreshSession.findUnique({where:{tokenHash}});
      if (!session) return null;
      if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
        await tx.refreshSession.updateMany({where:{familyId:session.familyId,revokedAt:null},data:{revokedAt:new Date()}}); return null;
      }
      const user=await tx.user.findUniqueOrThrow({where:{id:session.userId},select:{role:true,adminCredential:{select:{disabled:true}}}});
      if(user.role==='ADMIN') {
        // Coordinate password resets with token rotation so a reset cannot be bypassed by an in-flight refresh.
        await tx.$queryRaw`SELECT "userId" FROM "AdminCredential" WHERE "userId"=${session.userId}::uuid FOR UPDATE`;
        const currentCredential=await tx.adminCredential.findUnique({where:{userId:session.userId}});
        const currentSession=await tx.refreshSession.findUnique({where:{id:session.id}});
        if(!session.adminAuthenticated||!currentCredential||currentCredential.disabled||!currentSession||currentSession.revokedAt)return null;
      }
      await tx.refreshSession.update({where:{id:session.id},data:{revokedAt:new Date()}});
      return this.createSession(tx,session.userId,session.familyId,session.adminAuthenticated);
    });
    if (!result) throw new UnauthorizedException('Сессия истекла. Войдите снова.');
    return {...result,user:await this.user(result.userId)};
  }
  async logout(refreshToken:string, actor:Actor) {
    const session = await this.db.refreshSession.findUnique({where:{tokenHash:hash(refreshToken)}});
    if (session && session.userId !== actor.id) throw new UnauthorizedException();
    await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.familyId}))`;
      await tx.refreshSession.updateMany({where:{userId:actor.id,familyId:actor.familyId},data:{revokedAt:new Date()}});
      await tx.driverProfile.updateMany({where:{userId:actor.id},data:{online:false,locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}});
    });
    if(actor.role==='DRIVER')this.events.adminChanged('drivers',actor.id);
    return {ok:true};
  }
  async authenticate(token:string):Promise<Actor> {
    let payload:{sub:string;sid:string;fid:string;exp:number};
    try {
      payload = await this.jwt.verifyAsync<{sub:string;sid:string;fid:string;exp:number}>(token,{secret:this.config.jwtSecret,issuer:'taxi-api',audience:'taxi-mobile',algorithms:['HS256']});
    } catch {throw new UnauthorizedException('Сессия истекла. Войдите снова.');}
    // A temporary database outage is a server error, not an instruction to erase a valid session.
    const session = await this.db.refreshSession.findUnique({where:{id:payload.sid},select:{id:true,userId:true,familyId:true,revokedAt:true,expiresAt:true,adminAuthenticated:true,user:{select:{role:true,adminCredential:{select:{disabled:true}}}}}});
    if (!session || session.userId !== payload.sub || session.familyId !== payload.fid || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Сессия истекла. Войдите снова.');
    if(session.user.role==='ADMIN'&&(!session.adminAuthenticated||!session.user.adminCredential||session.user.adminCredential.disabled))throw new UnauthorizedException('Используйте вход в панель управления');
    return {id:session.userId,role:session.user.role,sessionId:session.id,familyId:session.familyId,expiresAt:payload.exp};
  }
  async user(id:string) {
    // Do not load the avatar bytea on ordinary profile/order reads. The public
    // avatar endpoint streams it only when an image is actually requested.
    const user = await this.db.user.findUniqueOrThrow({where:{id},select:{
      id:true,phone:true,name:true,role:true,notifications:true,language:true,avatarMime:true,avatarUpdatedAt:true,
      driverProfile:{select:{verified:true,online:true,transportClass:true,requestedTransportClass:true,acceptsEconomy:true,acceptsComfort:true,acceptsDeliveryCar:true,acceptsDeliveryTruck:true,vehicle:{select:{id:true,make:true,color:true,plate:true,photoUpdatedAt:true}}}},
    }});
    const rating = user.role === 'DRIVER' ? await this.db.rating.aggregate({where:{order:{driverId:id}},_avg:{score:true}}) : null;
    const storedAvatar = user.role === 'DRIVER' && user.avatarMime && user.avatarUpdatedAt
      ? `/avatars/${user.id}?v=${user.avatarUpdatedAt.getTime()}`
      : null;
    return {id:user.id,phone:user.phone,name:user.name,photoUrl:storedAvatar,role:user.role,notifications:user.notifications,language:user.language,
      ...(user.driverProfile?{driverProfile:{verified:user.driverProfile.verified,online:user.driverProfile.online,transportClass:user.driverProfile.transportClass,requestedTransportClass:user.driverProfile.requestedTransportClass,acceptsEconomy:user.driverProfile.acceptsEconomy,acceptsComfort:user.driverProfile.acceptsComfort,acceptsDeliveryCar:user.driverProfile.acceptsDeliveryCar,acceptsDeliveryTruck:user.driverProfile.acceptsDeliveryTruck,carMake:user.driverProfile.vehicle?.make??'',carColor:user.driverProfile.vehicle?.color??'',carPlate:user.driverProfile.vehicle?.plate??'',carPhotoUrl:user.driverProfile.vehicle?.photoUpdatedAt?`/vehicles/${user.driverProfile.vehicle.id}/photo?v=${user.driverProfile.vehicle.photoUpdatedAt.getTime()}`:null,rating:rating?._avg.score??null}}:{})};
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth:AuthService) {}
  async canActivate(context:ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string|undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    request.actor = await this.auth.authenticate(header.slice(7)); return true;
  }
}
