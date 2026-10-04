import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AppConfig } from './config';
import { RateLimits } from './auth';
import { verifyAdminPassword } from './admin.security';
import { restaurantPhone, RESTAURANT_PERMISSIONS } from './restaurant-domain';
export interface RestaurantActor {id:string;sessionId:string;sessionVersion:number}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
@Injectable()
export class RestaurantAuthService {
  constructor(private readonly db:PrismaService,private readonly jwt:JwtService,private readonly config:AppConfig,private readonly limits:RateLimits) {}
  async profile(id:string) {
    const account=await this.db.restaurantAccount.findUnique({where:{id},include:{memberships:{where:{active:true},include:{restaurant:true}}}});
    if(!account?.active)throw new UnauthorizedException('Доступ к ресторану отключён');
    return {user:{id:account.id,name:account.name,phone:account.phone},memberships:account.memberships.map(member=>({restaurantId:member.restaurantId,restaurantName:(member.restaurant.catalog as {name:string}).name,role:member.role,permissions:member.role==='OWNER'?[...RESTAURANT_PERMISSIONS]:member.permissions}))};
  }
  private async session(tx:Prisma.TransactionClient,accountId:string,sessionVersion:number,familyId:string) {
    const refreshToken=randomBytes(48).toString('base64url');
    const row=await tx.restaurantSession.create({data:{accountId,sessionVersion,familyId,tokenHash:hash(refreshToken),expiresAt:new Date(Date.now()+this.config.refreshDays*86400000)}});
    const accessToken=await this.jwt.signAsync({sub:accountId,sid:row.id,ver:sessionVersion},{secret:this.config.jwtSecret,expiresIn:this.config.accessSeconds,issuer:'taxi-api',audience:'atlas-restaurant'});
    return {accessToken,refreshToken,expiresIn:this.config.accessSeconds};
  }
  async login(phoneValue:string,password:string,ip:string) {
    await this.limits.take(`restaurant-login:ip:${ip}`,30,900);
    const phone=restaurantPhone(phoneValue);
    await this.limits.take(`restaurant-login:phone:${phone}`,10,900);
    const account=await this.db.restaurantAccount.findUnique({where:{phone}});
    const valid=await verifyAdminPassword(password,account?.passwordHash??`scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if(!valid||!account?.active)throw new UnauthorizedException('Неверный телефон или пароль');
    const tokens=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "RestaurantAccount" WHERE "id"=${account.id}::uuid FOR UPDATE`;
      const current=await tx.restaurantAccount.findUnique({where:{id:account.id}});
      if(!current?.active||current.passwordHash!==account.passwordHash)throw new UnauthorizedException('Повторите вход');
      return this.session(tx,current.id,current.sessionVersion,randomUUID());
    });
    return {...tokens,...await this.profile(account.id)};
  }
  async refresh(refreshToken:string) {
    const result=await this.db.$transaction(async tx=>{
      const initial=await tx.restaurantSession.findUnique({where:{tokenHash:hash(refreshToken)}});
      if(!initial)return null;
      await tx.$queryRaw`SELECT "id" FROM "RestaurantAccount" WHERE "id"=${initial.accountId}::uuid FOR UPDATE`;
      const session=await tx.restaurantSession.findUnique({where:{id:initial.id}});
      const account=await tx.restaurantAccount.findUnique({where:{id:initial.accountId}});
      if(!session||session.revokedAt||session.expiresAt.getTime()<=Date.now()||!account?.active||account.sessionVersion!==session.sessionVersion) {
        await tx.restaurantSession.updateMany({where:{familyId:initial.familyId,revokedAt:null},data:{revokedAt:new Date()}});
        return null;
      }
      await tx.restaurantSession.update({where:{id:session.id},data:{revokedAt:new Date()}});
      return {accountId:account.id,...await this.session(tx,account.id,account.sessionVersion,session.familyId)};
    });
    if(!result)throw new UnauthorizedException('Войдите снова');
    const {accountId,...tokens}=result;
    return {...tokens,...await this.profile(accountId)};
  }
  async logout(refreshToken:string) {
    const session=await this.db.restaurantSession.findUnique({where:{tokenHash:hash(refreshToken)}});
    if(session)await this.db.restaurantSession.updateMany({where:{familyId:session.familyId,revokedAt:null},data:{revokedAt:new Date()}});
    return {ok:true};
  }
  async authenticate(token:string):Promise<RestaurantActor> {
    try {
      const claims=await this.jwt.verifyAsync<{sub:string;sid:string;ver:number}>(token,{secret:this.config.jwtSecret,issuer:'taxi-api',audience:'atlas-restaurant'});
      if(typeof claims.sub!=='string'||typeof claims.sid!=='string'||!Number.isInteger(claims.ver))throw new Error('claims');
      const session=await this.db.restaurantSession.findUnique({where:{id:claims.sid},include:{account:true}});
      if(!session||session.accountId!==claims.sub||session.revokedAt||session.expiresAt.getTime()<=Date.now()||!session.account.active||session.account.sessionVersion!==claims.ver)throw new Error('session');
      return {id:claims.sub,sessionId:claims.sid,sessionVersion:claims.ver};
    }catch {throw new UnauthorizedException('Войдите в приложение ресторана');}
  }
}
@Injectable()
export class RestaurantAuthGuard implements CanActivate {
  constructor(private readonly auth:RestaurantAuthService){}
  async canActivate(context:ExecutionContext) {
    const request=context.switchToHttp().getRequest();
    const value=request.headers.authorization;
    if(typeof value!=='string'||!value.startsWith('Bearer '))throw new UnauthorizedException('Войдите в приложение ресторана');
    request.restaurantActor=await this.auth.authenticate(value.slice(7));
    return true;
  }
}
