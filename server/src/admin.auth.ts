import { Body, Controller, Injectable, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthService, RateLimits } from './auth';
import { AdminLoginDto } from './admin.dto';
import { verifyAdminPassword } from './admin.security';
import { AppConfig } from './config';
import { PrismaService } from './prisma.service';

@Injectable()
export class AdminAuthService {
  constructor(private readonly db:PrismaService,private readonly jwt:JwtService,private readonly config:AppConfig,private readonly limits:RateLimits,private readonly auth:AuthService) {}
  async login(dto:AdminLoginDto,ip:string) {
    const username=dto.username.trim().toLowerCase();
    await this.limits.take(`admin-login:ip:${ip}`,30,900);
    await this.limits.take(`admin-login:user:${username}`,10,900);
    const credential=await this.db.adminCredential.findUnique({where:{username},include:{user:{select:{role:true}}}});
    // Unknown users still perform the same work; this is a dummy hash, never a credential.
    const dummyHash=`scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`;
    const valid=await verifyAdminPassword(dto.password,credential?.passwordHash??dummyHash);
    if(!valid||!credential||credential.disabled||credential.user.role!=='ADMIN')throw new UnauthorizedException('Неверный логин или пароль');
    const refreshToken=randomBytes(48).toString('base64url'),familyId=randomUUID();
    const session=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "userId" FROM "AdminCredential" WHERE "userId"=${credential.userId}::uuid FOR UPDATE`;
      const current=await tx.adminCredential.findUnique({where:{userId:credential.userId}});
      if(!current||current.disabled||current.passwordHash!==credential.passwordHash)throw new UnauthorizedException('Повторите вход');
      const created=await tx.refreshSession.create({data:{userId:credential.userId,familyId,tokenHash:createHash('sha256').update(refreshToken).digest('hex'),adminAuthenticated:true,expiresAt:new Date(Date.now()+this.config.refreshDays*86400000)}});
      await tx.adminAudit.create({data:{actorId:credential.userId,action:'auth.login',entity:'admin',entityId:credential.userId}});
      return created;
    });
    const accessToken=await this.jwt.signAsync({sub:credential.userId,sid:session.id,fid:familyId},{secret:this.config.jwtSecret,expiresIn:this.config.accessSeconds,issuer:'taxi-api',audience:'taxi-mobile'});
    return {accessToken,refreshToken,expiresIn:this.config.accessSeconds,user:await this.auth.user(credential.userId)};
  }
}
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth:AdminAuthService) {}
  @Post('login') login(@Body() dto:AdminLoginDto,@Req() request:Request) {return this.auth.login(dto,request.ip??'unknown');}
}
