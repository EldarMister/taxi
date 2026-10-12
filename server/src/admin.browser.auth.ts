import {Body,Controller,ForbiddenException,Injectable,Post,Req,Res,UnauthorizedException} from '@nestjs/common';
import {JwtService} from '@nestjs/jwt';
import {IsBoolean,IsOptional,IsString,MaxLength,MinLength} from 'class-validator';
import {createHash,randomBytes} from 'node:crypto';
import {Request,Response} from 'express';
import {Prisma} from '@prisma/client';
import {AdminLoginDto} from './admin.dto';
import {AdminAuthService} from './admin.auth';
import {AuthService,RateLimits} from './auth';
import {requestClientIp} from './request-client-ip';
import {AppConfig} from './config';
import {PrismaService} from './prisma.service';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const COOKIE='atlas.admin';
export class AdminBrowserLoginDto extends AdminLoginDto {@IsOptional() @IsBoolean() remember=true;}
export class AdminBrowserMigrateDto {@IsOptional() @IsBoolean() remember=true; @IsString() @MinLength(32) @MaxLength(256) refreshToken!:string;}
export function browserCookie(request:Pick<Request,'headers'>):string|undefined {
  const value=request.headers.cookie;if(typeof value!=='string'||value.length>8192)return;
  const values=value.split(';').map(part=>part.trim()).filter(part=>part.startsWith(COOKIE+'='));
  if(values.length!==1)return;
  const token=values[0].slice(COOKIE.length+1);return /^[A-Za-z0-9_-]{32,256}$/.test(token)?token:undefined;
}
export function requireBrowserOrigin(request:Pick<Request,'headers'>,config:Pick<AppConfig,'origins'|'development'>) {
  const origin=request.headers.origin;
  if(request.headers['x-atlas-admin']!=='1'||typeof origin!=='string'||!config.origins.includes(origin))throw new ForbiddenException('Недопустимый источник запроса');
  const parsed=new URL(origin);
  if(parsed.origin!==origin||(!config.development&&parsed.protocol!=='https:'))throw new ForbiddenException('Недопустимый источник запроса');
}
@Injectable()
export class AdminBrowserService {
  constructor(private readonly db:PrismaService,private readonly admin:AdminAuthService,private readonly auth:AuthService,private readonly jwt:JwtService,private readonly config:AppConfig,private readonly limits:RateLimits){}
  private cookie(response:Response,token:string,remember:boolean){response.cookie(COOKIE,token,{httpOnly:true,secure:!this.config.development,sameSite:'strict',path:'/api/admin/auth/browser',...(remember?{maxAge:this.config.refreshDays*86400000}:{})});response.setHeader('Cache-Control','no-store');}
  private async validate(tx:Prisma.TransactionClient,token:string,browserOnly=true){
    const initial=await tx.refreshSession.findUnique({where:{tokenHash:digest(token)}});
    if(!initial)throw new UnauthorizedException('Войдите в панель управления');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.familyId}))`;
    await tx.$queryRaw`SELECT "userId" FROM "AdminCredential" WHERE "userId"=${initial.userId}::uuid FOR UPDATE`;
    const session=await tx.refreshSession.findUnique({where:{id:initial.id},include:{user:{include:{adminCredential:true}}}});
    if(!session||session.revokedAt||session.expiresAt.getTime()<=Date.now()||!session.adminAuthenticated||(browserOnly&&!session.browserSession)||session.user.role!=='ADMIN'||session.user.deletedAt||!session.user.adminCredential||session.user.adminCredential.disabled)throw new UnauthorizedException('Войдите в панель управления');
    return session;
  }
  async login(dto:AdminBrowserLoginDto,request:Request,response:Response){
    requireBrowserOrigin(request,this.config);
    const result=await this.admin.login(dto,requestClientIp(request));
    await this.db.refreshSession.update({where:{tokenHash:digest(result.refreshToken)},data:{browserSession:true}});
    this.cookie(response,result.refreshToken,dto.remember);
    const {refreshToken,...safe}=result;return safe;
  }
  async migrate(token:string,remember:boolean,request:Request,response:Response){
    requireBrowserOrigin(request,this.config);
    await this.limits.take(`admin-browser-migrate:${requestClientIp(request)}`,120,60);
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw new UnauthorizedException('Войдите в панель управления');
    const cookieToken=randomBytes(48).toString('base64url');
    const result=await this.db.$transaction(async tx=>{
      const session=await this.validate(tx,token,false);
      await tx.refreshSession.updateMany({where:{familyId:session.familyId,userId:session.userId},data:{browserSession:true,revokedAt:new Date()}});
      const browser=await tx.refreshSession.create({data:{userId:session.userId,familyId:session.familyId,tokenHash:digest(cookieToken),adminAuthenticated:true,browserSession:true,expiresAt:session.expiresAt}});
      return this.access(tx,browser);
    });
    this.cookie(response,cookieToken,remember);return result;
  }
  private async access(tx:Prisma.TransactionClient,session:{id:string;userId:string;familyId:string}){
    const accessToken=await this.jwt.signAsync({sub:session.userId,sid:session.id,fid:session.familyId},{secret:this.config.jwtSecret,expiresIn:this.config.accessSeconds,issuer:'taxi-api',audience:'taxi-mobile',algorithm:'HS256'});
    return {accessToken,expiresIn:this.config.accessSeconds,user:await this.auth.user(session.userId,tx)};
  }
  async refresh(request:Request,response:Response){
    requireBrowserOrigin(request,this.config);
    await this.limits.take(`admin-browser:${requestClientIp(request)}`,120,60);
    const token=browserCookie(request);if(!token)throw new UnauthorizedException('Войдите в панель управления');
    const result=await this.db.$transaction(async tx=>this.access(tx,await this.validate(tx,token)));
    response.setHeader('Cache-Control','no-store');return result;
  }
  async logout(request:Request,response:Response){
    requireBrowserOrigin(request,this.config);
    await this.limits.take(`admin-browser-logout:${requestClientIp(request)}`,120,60);
    const token=browserCookie(request);
    if(token)await this.db.$transaction(async tx=>{
      const initial=await tx.refreshSession.findUnique({where:{tokenHash:digest(token)}});if(!initial)return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.familyId}))`;
      await tx.refreshSession.updateMany({where:{familyId:initial.familyId,userId:initial.userId},data:{revokedAt:new Date()}});
    });
    response.clearCookie(COOKIE,{httpOnly:true,secure:!this.config.development,sameSite:'strict',path:'/api/admin/auth/browser'});response.setHeader('Cache-Control','no-store');return {ok:true};
  }
}
@Controller('admin/auth/browser')
export class AdminBrowserController {
  constructor(private readonly browser:AdminBrowserService){}
  @Post('login') login(@Body() dto:AdminBrowserLoginDto,@Req() request:Request,@Res({passthrough:true}) response:Response){return this.browser.login(dto,request,response);}
  @Post('refresh') refresh(@Req() request:Request,@Res({passthrough:true}) response:Response){return this.browser.refresh(request,response);}
  @Post('migrate') migrate(@Body() dto:AdminBrowserMigrateDto,@Req() request:Request,@Res({passthrough:true}) response:Response){return this.browser.migrate(dto.refreshToken,dto.remember,request,response);}
  @Post('logout') logout(@Req() request:Request,@Res({passthrough:true}) response:Response){return this.browser.logout(request,response);}
}
