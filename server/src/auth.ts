import { CanActivate, ExecutionContext, HttpException, Injectable, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AppConfig } from './config';
import { RealtimeEvents } from './events';
import { OtpDelivery } from './otp-delivery';
import { OtpFallback } from './otp-fallback';
import { sealNikitaToken, unsealNikitaToken, nikitaUnavailable } from './nikita-otp';
import { requestClientIp } from './request-client-ip';
import { mapUserProfile, userProfileSelect } from './user-profile';
export interface Actor { id:string; role:Role; sessionId:string; familyId:string; expiresAt:number }
const hash = (value:string) => createHash('sha256').update(value).digest('hex');
export function authRequestIp(request:Pick<Request,'headers'> & {socket?:{remoteAddress?:string}},trustedProxies=process.env.TRUSTED_PROXY_CIDRS??''):string {
  return requestClientIp(request,trustedProxies);
}
@Injectable()
export class RateLimits {
  constructor(private readonly db:PrismaService) {}
  async take(key:string, max:number, seconds:number) {
    await this.consume(this.db,key,max,seconds);
  }
  /** A rejected OTP request must not consume another window's allowance. */
  async takeAll(limits:ReadonlyArray<{key:string;max:number;seconds:number}>) {
    await this.db.$transaction(async tx=>{
      for(const limit of [...limits].sort((a,b)=>a.key.localeCompare(b.key)))
        await this.consume(tx,limit.key,limit.max,limit.seconds);
    });
  }
  private async consume(db:Pick<PrismaService,'$queryRaw'>,key:string,max:number,seconds:number) {
    const rows = await db.$queryRaw<{count:number;retryAfterSeconds:number}[]>`
      INSERT INTO "RateLimit" ("key","count","expiresAt") VALUES (${key},1,(NOW() AT TIME ZONE 'UTC')+${seconds}::int*INTERVAL '1 second')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."expiresAt" <= (NOW() AT TIME ZONE 'UTC') THEN 1 ELSE "RateLimit"."count" + 1 END,
        "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= (NOW() AT TIME ZONE 'UTC') THEN (NOW() AT TIME ZONE 'UTC')+${seconds}::int*INTERVAL '1 second' ELSE "RateLimit"."expiresAt" END
      RETURNING "count",GREATEST(1,CEIL(EXTRACT(EPOCH FROM("expiresAt"-(NOW() AT TIME ZONE 'UTC')))))::int AS "retryAfterSeconds"`;
    if (rows[0].count > max) throw new HttpException({statusCode:429,message:'Слишком много запросов. Попробуйте позже.',retryAfterSeconds:rows[0].retryAfterSeconds},429);
  }
}
@Injectable()
export class AuthService {
  constructor(private readonly db:PrismaService,private readonly jwt:JwtService,private readonly config:AppConfig,private readonly limits:RateLimits,private readonly events:RealtimeEvents,private readonly delivery:OtpDelivery,private readonly fallback:OtpFallback) {}
  private otpHash(phone:string, code:string) {return createHmac('sha256',this.config.otpSecret).update(`${phone}:${code}`).digest('hex');}
  async requestCode(phone:string, ip:string) {
    await this.limits.takeAll([
      {key:`sms:ip:${ip}`,max:20,seconds:3600},
      {key:`sms:phone-hour:${phone}`,max:5,seconds:3600},
      {key:`sms:phone-minute:${phone}`,max:1,seconds:60},
    ]);
    const existingUser=await this.db.user.findUnique({where:{phone},select:{role:true,deletedAt:true}});
    if(existingUser?.role==='ADMIN')throw new UnauthorizedException('Используйте вход в панель управления');
    const testAuth=!existingUser?.deletedAt && !!this.config.testAuthPhones?.includes(phone);
    const code = testAuth ? this.config.testAuthCode : this.config.devAuth ? this.config.devCode : randomInt(100000,1000000).toString();
    if (this.config.smsProvider === 'development' && !this.config.devAuth && !testAuth) throw new ServiceUnavailableException('Отправка кодов входа не настроена.');
    const codeHash = this.otpHash(phone,code);
    // Keep the replacement unusable until the provider accepts the request.
    const pendingAt=new Date();
    const provider=!testAuth && this.config.smsProvider==='nikita'?'nikita':'local';
    await this.db.smsChallenge.upsert({where:{phone},create:{phone,codeHash,provider,providerTokenCiphertext:null,consumedAt:pendingAt,expiresAt:new Date(Date.now()+300000)},update:{codeHash,provider,providerTokenCiphertext:null,attempts:0,consumedAt:pendingAt,requestedAt:pendingAt,expiresAt:new Date(Date.now()+300000)}});
    let providerTokenCiphertext:string|null=null;
    let receipt:{channel:string;deliveryId?:string};
    if(testAuth) receipt={channel:'development'};
    else if(this.config.smsProvider==='nikita') {
      const token=await this.delivery.startNikita(phone);
      providerTokenCiphertext=sealNikitaToken(token,this.config.otpSecret,`${phone}:${codeHash}`);
      receipt={channel:'sms'};
    } else if(this.config.smsProvider==='whatsapp_cloud' || (this.config.smsProvider==='messaggio' && this.config.telegramGatewayToken)) {
      receipt=await this.fallback.start(phone,code,codeHash);
    } else receipt={channel:await this.delivery.send(phone,code)};
    const activated=await this.db.smsChallenge.updateMany({where:{phone,codeHash,consumedAt:pendingAt},data:{consumedAt:null,providerTokenCiphertext}});
    if (!activated.count) throw new ServiceUnavailableException('Запрос кода устарел. Запросите новый код.');
    return {sent:true,...receipt,retryAfterSeconds:60,...(testAuth || this.config.devAuth?{development:true,developmentCode:code}:{}),...(testAuth?{testPhone:phone}:{})};
  }
  async verifyCode(phone:string, code:string, ip:string) {
    await this.limits.take(`verify:ip:${ip}`,40,900);
    await this.limits.take(`verify:phone:${phone}`,10,900);
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "phone" FROM "SmsChallenge" WHERE "phone"=${phone} FOR UPDATE`;
      const challenge = await tx.smsChallenge.findUnique({where:{phone}});
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() < Date.now() || challenge.attempts >= 5) return null;
      // Commit failed attempts: throwing inside this transaction would roll the counter back.
      let valid=false;
      if(challenge.provider==='nikita') {
        if(!challenge.providerTokenCiphertext)return null;
        let token:string;
        try {token=unsealNikitaToken(challenge.providerTokenCiphertext,this.config.otpSecret,`${phone}:${challenge.codeHash}`);} catch {throw nikitaUnavailable();}
        const verified=await this.delivery.verifyNikita(token,code);
        if(verified==='expired') {
          await tx.smsChallenge.update({where:{phone},data:{consumedAt:new Date(),providerTokenCiphertext:null}}); return null;
        }
        valid=verified==='valid';
      } else {
        const actual = Buffer.from(this.otpHash(phone,code),'hex'), expected = Buffer.from(challenge.codeHash,'hex');
        valid=actual.length===expected.length && timingSafeEqual(actual,expected);
      }
      if(!valid) {
        await tx.smsChallenge.update({where:{phone},data:{attempts:{increment:1},...(challenge.attempts>=4?{providerTokenCiphertext:null}:{})}}); return null;
      }
      await tx.smsChallenge.update({where:{phone},data:{consumedAt:new Date(),providerTokenCiphertext:null}});
      if(challenge.expiresAt.getTime()<=Date.now())return null;
      const user = await tx.user.upsert({where:{phone},create:{phone},update:{}});
      // Administrator accounts never use SMS, including development OTP codes.
      if(user.role==='ADMIN')return null;
      const tokens=await this.createSession(tx,user.id,randomUUID());
      return {...tokens,user:await this.user(user.id,tx)};
    },{timeout:12000});
    if (!result) throw new UnauthorizedException('Неверный или просроченный код');
    return result;
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
      // Browser families use an HttpOnly stable cookie. Legacy JS requests may
      // neither rotate that cookie nor revoke its family through token reuse.
      if(session.browserSession)return null;
      if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
        await tx.refreshSession.updateMany({where:{familyId:session.familyId,revokedAt:null},data:{revokedAt:new Date()}}); return null;
      }
      const user=await tx.user.findUniqueOrThrow({where:{id:session.userId},select:{role:true,deletedAt:true,adminCredential:{select:{disabled:true}}}});
      if(user.deletedAt)return null;
      if(user.role==='ADMIN') {
        // Coordinate password resets with token rotation so a reset cannot be bypassed by an in-flight refresh.
        await tx.$queryRaw`SELECT "userId" FROM "AdminCredential" WHERE "userId"=${session.userId}::uuid FOR UPDATE`;
        const currentCredential=await tx.adminCredential.findUnique({where:{userId:session.userId}});
        const currentSession=await tx.refreshSession.findUnique({where:{id:session.id}});
        if(!session.adminAuthenticated||!currentCredential||currentCredential.disabled||!currentSession||currentSession.revokedAt)return null;
      }
      await tx.refreshSession.update({where:{id:session.id},data:{revokedAt:new Date()}});
      const tokens=await this.createSession(tx,session.userId,session.familyId,session.adminAuthenticated);
      // If profile loading fails, rotation rolls back and the old refresh token
      // stays valid. Never commit a token that cannot be returned to the client.
      return {...tokens,user:await this.user(session.userId,tx)};
    });
    if (!result) throw new UnauthorizedException('Сессия истекла. Войдите снова.');
    return result;
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
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(![payload.sub,payload.sid,payload.fid].every(value=>typeof value==='string'&&uuid.test(value))||!Number.isFinite(payload.exp))throw new UnauthorizedException('Сессия истекла. Войдите снова.');
    // A temporary database outage is a server error, not an instruction to erase a valid session.
    const session = await this.db.refreshSession.findUnique({where:{id:payload.sid},select:{id:true,userId:true,familyId:true,revokedAt:true,expiresAt:true,adminAuthenticated:true,user:{select:{role:true,deletedAt:true,adminCredential:{select:{disabled:true}}}}}})
      .catch(()=>{throw new ServiceUnavailableException('Не удалось проверить доступ. Попробуйте позже.');});
    if (!session || session.user.deletedAt || session.userId !== payload.sub || session.familyId !== payload.fid || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Сессия истекла. Войдите снова.');
    if(session.user.role==='ADMIN'&&(!session.adminAuthenticated||!session.user.adminCredential||session.user.adminCredential.disabled))throw new UnauthorizedException('Используйте вход в панель управления');
    return {id:session.userId,role:session.user.role,sessionId:session.id,familyId:session.familyId,expiresAt:payload.exp};
  }
  async user(id:string,db:Prisma.TransactionClient=this.db) {
    // Do not load the avatar bytea on ordinary profile/order reads. The public
    // avatar endpoint streams it only when an image is actually requested.
    const user = await db.user.findUniqueOrThrow({where:{id},select:userProfileSelect});
    const rating = user.role === 'DRIVER' ? await db.rating.aggregate({where:{order:{driverId:id}},_avg:{score:true}}) : null;
    return mapUserProfile(user,rating?._avg.score??null);
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
