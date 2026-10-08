import { ArgumentsHost, BadRequestException, Body, Catch, Controller, Delete, ExceptionFilter, ForbiddenException, Get, GoneException, HttpException, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { Actor, AuthGuard, AuthService, RateLimits } from './auth';
import { AppConfig } from './config';
import { OtpFallback } from './otp-fallback';
import { DriverService } from './driver';
import { CreateOrderDto, DriverPositionDto, DriverPreferencesDto, OrdersHistoryDto, MessageDto, PhotoMessageDto, OnlineDto, PhoneDto, ProfileDto, PushTokenDto, QuoteDto, RatingDto, ReadNotificationsDto, RefreshDto, RemovePushTokenDto, TopupDto, VerifyDriverDto, VerifyDto } from './dto';
import { OrdersService } from './orders';
import { PrismaService } from './prisma.service';
import { AdminGuard } from './admin.security';
import { pushNotificationEvents, pushPresentation } from './pushPresentation';
type AuthedRequest=Request&{actor:Actor};
type AvatarFile={buffer:Buffer;mimetype:string;size:number};
export const MAX_AVATAR_BYTES=5*1024*1024;
export const MAX_AVATAR_PIXELS=20_000_000;
export const AVATAR_SIZE=720;
const avatarMimes=new Set(['image/jpeg','image/png','image/webp']);

/** Removes cache keys used only by older mobile builds after a 304 response.
 * All other query keys remain subject to DTO validation. */
export function stripLegacyCacheQuery(url:string):string {
  const separator=url.indexOf('?');
  if(separator<0)return url;
  const pathname=url.slice(0,separator),params=new URLSearchParams(url.slice(separator+1));
  if(!params.has('_')&&!params.has('_fresh'))return url;
  params.delete('_');
  params.delete('_fresh');
  const query=params.toString();
  return query?`${pathname}?${query}`:pathname;
}

export function detectAvatarMime(data:Uint8Array):string|null {
  if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return 'image/jpeg';
  if(data.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>data[index]===value))return 'image/png';
  if(data.length>=12&&data[0]===0x52&&data[1]===0x49&&data[2]===0x46&&data[3]===0x46&&data[8]===0x57&&data[9]===0x45&&data[10]===0x42&&data[11]===0x50)return 'image/webp';
  return null;
}

export async function normalizeAvatar(data:Buffer):Promise<Buffer> {
  try {
    const image=sharp(data,{failOn:'error',limitInputPixels:MAX_AVATAR_PIXELS,sequentialRead:true,animated:false});
    const metadata=await image.metadata();
    if(!metadata.width||!metadata.height||(metadata.pages??1)>1||metadata.width*metadata.height>MAX_AVATAR_PIXELS)throw new Error('invalid-avatar-metadata');
    const normalized=await image.rotate().resize(AVATAR_SIZE,AVATAR_SIZE,{fit:'cover'}).flatten({background:'#ffffff'}).jpeg({quality:80,mozjpeg:true}).toBuffer();
    if(!normalized.length||detectAvatarMime(normalized)!=='image/jpeg')throw new Error('invalid-avatar-output');
    return normalized;
  } catch {
    throw new BadRequestException('Файл повреждён или имеет слишком большое разрешение. Выберите другую фотографию.');
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth:AuthService,private readonly limits:RateLimits,private readonly fallback:OtpFallback) {}
  @Get('code-delivery/:id')
  async deliveryStatus(@Param('id',ParseUUIDPipe) id:string,@Req() req:Request) {await this.limits.take(`otp-status:${req.ip??'unknown'}`,120,60);return this.fallback.status(id);}
  @Post('request-code') @ApiOperation({summary:'Запросить SMS-код; тестовый код доступен только в development'})
  request(@Body() dto:PhoneDto,@Req() req:Request) {return this.auth.requestCode(dto.phone,req.ip??'unknown');}
  @Post('verify-code') verify(@Body() dto:VerifyDto,@Req() req:Request) {return this.auth.verifyCode(dto.phone,dto.code,req.ip??'unknown');}
  @Post('refresh') async refresh(@Body() dto:RefreshDto,@Req() req:Request) {await this.limits.take(`refresh:${req.ip??'unknown'}`,60,60);return this.auth.refresh(dto.refreshToken);}
  @Post('logout') @UseGuards(AuthGuard) @ApiBearerAuth()
  logout(@Body() dto:RefreshDto,@Req() req:AuthedRequest) {return this.auth.logout(dto.refreshToken,req.actor);}
}
@ApiTags('users') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('users')
export class UsersController {
  constructor(private readonly db:PrismaService,private readonly auth:AuthService,private readonly limits:RateLimits) {}
  @Get('me') me(@Req() req:AuthedRequest) {return this.auth.user(req.actor.id);}
  @Patch('me') async update(@Req() req:AuthedRequest,@Body() dto:ProfileDto) {
    const result=await this.db.user.updateMany({where:{id:req.actor.id,deletedAt:null},data:{...dto,...(dto.name!==undefined?{name:dto.name.trim()}:{})}});if(!result.count)throw new ForbiddenException('Аккаунт удалён.');return this.auth.user(req.actor.id);
  }
  @Delete('me/avatar') async removeAvatar(@Req() req:AuthedRequest) {
    if(req.actor.role!=='DRIVER')throw new ForbiddenException('Страница доступна водителю.');
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "userId"=${req.actor.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${req.actor.id}::uuid FOR UPDATE`;
      const result=await tx.user.updateMany({where:{id:req.actor.id,deletedAt:null},data:{avatarData:null,avatarMime:null,avatarUpdatedAt:null}});
      if(!result.count)throw new ForbiddenException('Аккаунт удалён.');
      await tx.performerUpload.deleteMany({where:{application:{userId:req.actor.id},slotKey:'profile_photo'}});
    });
    return this.auth.user(req.actor.id);
  }
  @Get('me/notifications') async notifications(@Req() req:AuthedRequest) {
    const asOf=new Date();
    const since=new Date(asOf.getTime()-30*86400000);
    const where={userId:req.actor.id,createdAt:{gte:since},event:{in:pushNotificationEvents}};
    const [jobs,unread]=await Promise.all([
      this.db.pushJob.findMany({where,orderBy:{createdAt:'desc'},take:50,select:{id:true,event:true,orderId:true,createdAt:true,readAt:true}}),
      this.db.pushJob.count({where:{...where,readAt:null}}),
    ]);
    return {asOf,hasUnread:unread>0,items:jobs.flatMap(job=>{
      const presentation=pushPresentation(job.event,req.actor.role);
      if(!presentation)return [];
      const {title,body}=presentation;
      return [{id:job.id,event:job.event,orderId:job.orderId,createdAt:job.createdAt,readAt:job.readAt,title,body}];
    })};
  }
  @Post('me/notifications/read') async readNotifications(@Req() req:AuthedRequest,@Body() dto:ReadNotificationsDto) {
    const through=new Date(dto.through);
    if(through.getTime()>Date.now()+5000)throw new BadRequestException('Некорректное время просмотра уведомлений.');
    await this.db.pushJob.updateMany({where:{userId:req.actor.id,readAt:null,createdAt:{lte:through}},data:{readAt:new Date()}});
    return {ok:true};
  }
  @Post('me/avatar') @ApiConsumes('multipart/form-data')
  @ApiBody({schema:{type:'object',required:['avatar'],properties:{avatar:{type:'string',format:'binary'}}}})
  @UseInterceptors(FileInterceptor('avatar',{limits:{fileSize:MAX_AVATAR_BYTES,files:1,fields:0},fileFilter:(request,file,callback)=>{
    if((request as AuthedRequest).actor?.role!=='DRIVER')return callback(new ForbiddenException('Только водитель может установить фотографию профиля.'),false);
    if(!avatarMimes.has(file.mimetype.toLowerCase()))return callback(new BadRequestException('Разрешены только фотографии JPEG, PNG или WEBP.'),false);
    callback(null,true);
  }}))
  async avatar(@Req() req:AuthedRequest,@UploadedFile() file?:AvatarFile) {
    if(req.actor.role!=='DRIVER')throw new ForbiddenException('Только водитель может установить фотографию профиля.');
    await this.limits.take(`avatar:${req.actor.id}`,10,3600);
    if(!file?.buffer?.length)throw new BadRequestException('Фотография не выбрана.');
    if(file.buffer.length>MAX_AVATAR_BYTES)throw new HttpException('Файл фотографии должен быть не больше 5 МБ.',HttpStatus.PAYLOAD_TOO_LARGE);
    const detected=detectAvatarMime(file.buffer),declared=file.mimetype.toLowerCase();
    if(!detected)throw new BadRequestException('Файл не является поддерживаемой фотографией.');
    if(detected!==declared)throw new BadRequestException('Тип файла не соответствует содержимому фотографии.');
    const normalized=await normalizeAvatar(file.buffer);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${req.actor.id}::uuid FOR UPDATE`;
      const current=await tx.user.findUniqueOrThrow({where:{id:req.actor.id},select:{avatarUpdatedAt:true,deletedAt:true}});
      if(current.deletedAt)throw new ForbiddenException('Аккаунт удалён.');
      const avatarUpdatedAt=new Date(Math.max(Date.now(),(current.avatarUpdatedAt?.getTime()??0)+1));
      await tx.user.update({where:{id:req.actor.id},data:{avatarData:Uint8Array.from(normalized),avatarMime:'image/jpeg',avatarUpdatedAt}});
    });
    return this.auth.user(req.actor.id);
  }
  @Post('me/push-token') async push(@Req() req:AuthedRequest,@Body() dto:PushTokenDto) {
    await this.limits.take(`push-register:${req.actor.id}`,20,60);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${req.actor.id}::uuid FOR UPDATE`;
      const existing=await tx.pushToken.findUnique({where:{token:dto.token},select:{userId:true}});
      if(existing?.userId!==req.actor.id) {
        const tokens=await tx.pushToken.findMany({where:{userId:req.actor.id},orderBy:{updatedAt:'asc'},select:{id:true}});
        // A token can change after reinstalling the app. Keep active devices
        // registered and make room for the replacement instead of rejecting it.
        if(tokens.length>=10) await tx.pushToken.deleteMany({where:{id:{in:tokens.slice(0,tokens.length-9).map(token=>token.id)}}});
      }
      await tx.pushToken.upsert({where:{token:dto.token},create:{userId:req.actor.id,...dto},update:{userId:req.actor.id,platform:dto.platform}});
    });
    return {ok:true};
  }
  @Delete('me/push-token') async removePush(@Req() req:AuthedRequest,@Body() dto:RemovePushTokenDto) {await this.db.pushToken.deleteMany({where:{userId:req.actor.id,token:dto.token}});return {ok:true};}
}
@ApiTags('orders') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('orders')
export class OrdersController {
  constructor(private readonly orders:OrdersService) {}
  @Post('quote') quote(@Req() req:AuthedRequest,@Body() dto:QuoteDto) {return this.orders.quote(req.actor,dto);}
  @Post() create(@Req() req:AuthedRequest,@Body() dto:CreateOrderDto) {return this.orders.create(req.actor,dto);}
  @Get('active') async active(@Req() req:AuthedRequest,@Res() response:Response) {return response.json(await this.orders.active(req.actor));}
  @Get('history') history(@Req() req:AuthedRequest,@Query() query:OrdersHistoryDto) {return this.orders.history(req.actor,query.period,query.from,query.to);}
  @Get(':id') get(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.get(req.actor,id);}
  @Post(':id/accept') accept(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.accept(req.actor,id);}
  @Post(':id/skip') skip(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.skip(req.actor,id);}
  @Post(':id/arrive') arrive(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.transition(req.actor,id,'ARRIVED');}
  @Post(':id/start') start(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.transition(req.actor,id,'IN_PROGRESS');}
  @Post(':id/complete') complete(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.transition(req.actor,id,'COMPLETED');}
  @Post(':id/cancel') cancel(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.cancel(req.actor,id);}
  @Post(':id/coming') coming(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.coming(req.actor,id);}
  @Get(':id/messages') messages(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.orders.messages(req.actor,id);}
  @Post(':id/messages') message(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:MessageDto) {return this.orders.sendMessage(req.actor,id,dto);}
  @Post(':id/messages/photo') @ApiConsumes('multipart/form-data')
  @ApiBody({schema:{type:'object',required:['image','clientMessageId'],properties:{image:{type:'string',format:'binary'},text:{type:'string'},clientMessageId:{type:'string'}}}})
  @UseInterceptors(FileInterceptor('image',{limits:{fileSize:8*1024*1024,files:1,fields:2},fileFilter:(_request,file,callback)=>{
    if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype.toLowerCase()))return callback(new BadRequestException('Разрешены фотографии JPEG, PNG и WEBP.'),false);
    callback(null,true);
  }}))
  photoMessage(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:PhotoMessageDto,@UploadedFile() file?:AvatarFile) {
    if(!file?.buffer)throw new BadRequestException('Выберите фотографию.');
    return this.orders.sendMessage(req.actor,id,{text:dto.text??'',clientMessageId:dto.clientMessageId},file);
  }
  @Get(':id/messages/:messageId/photo') async messagePhoto(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) messageId:string,@Res() response:Response) {
    const photo=await this.orders.messagePhoto(req.actor,id,messageId);
    response.setHeader('Content-Type',photo.mime);
    response.setHeader('Content-Length',String(photo.data.length));
    response.setHeader('Cache-Control','private, max-age=3600');
    response.setHeader('X-Content-Type-Options','nosniff');
    return response.send(Buffer.from(photo.data));
  }
  @Post(':id/rating') rate(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RatingDto) {return this.orders.rate(req.actor,id,dto.score,dto.comment);}
  @Post(':id/client-rating') rateClient(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RatingDto) {return this.orders.rateClient(req.actor,id,dto.score,dto.comment);}
}
@ApiTags('driver') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('driver')
export class DriverController {
  constructor(private readonly driver:DriverService,private readonly orders:OrdersService) {}
  @Post('register') @ApiOperation({summary:'Устаревший endpoint; используйте /driver/registration',deprecated:true})
  register() {throw new GoneException('Используйте новую пошаговую регистрацию исполнителя: /driver/registration');}
  @Patch('online') online(@Req() req:AuthedRequest,@Body() dto:OnlineDto) {return this.driver.online(req.actor,dto.online);}
  @Patch('preferences') preferences(@Req() req:AuthedRequest,@Body() dto:DriverPreferencesDto) {return this.driver.preferences(req.actor,dto);}
  @Patch('position') position(@Req() req:AuthedRequest,@Body() dto:DriverPositionDto) {return this.driver.position(req.actor,dto);}
  @Get('offers') offers(@Req() req:AuthedRequest) {return this.orders.offers(req.actor);}
  @Get('balance') balance(@Req() req:AuthedRequest) {return this.driver.balance(req.actor);}
}
@ApiTags('admin') @ApiBearerAuth() @UseGuards(AuthGuard,AdminGuard) @Controller('admin')
export class AdminController {
  constructor(private readonly driver:DriverService) {}
  @Post('drivers/:id/topup') topup(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:TopupDto) {return this.driver.topup(req.actor,id,dto);}
  @Patch('drivers/:id/verify') verify(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:VerifyDriverDto) {return this.driver.verify(req.actor,id,dto);}
}
@ApiTags('configuration') @Controller()
export class PublicController {
  constructor(private readonly db:PrismaService,private readonly config:AppConfig) {}
  @Get('health') async health() {await this.db.$queryRaw`SELECT 1`;return {status:'ok'};}
  @Get('config') configValue() {return {currency:'KGS',development:this.config.development,supportPhone:process.env.SUPPORT_PHONE??'+996700000000',balanceTopupTelegramUrl:process.env.BALANCE_TOPUP_TELEGRAM_URL?.trim()||null};}
  @Get('tariffs') tariffs(@Query('kind') kind:string|undefined) {
    const normalized=kind??'RIDE';
    if(!['RIDE','DELIVERY_CAR','DELIVERY_TRUCK'].includes(normalized))throw new BadRequestException('Неизвестный вид тарифа.');
    return this.db.tariff.findMany({where:{active:true,kind:normalized as 'RIDE'|'DELIVERY_CAR'|'DELIVERY_TRUCK'},orderBy:{basePrice:'asc'}});
  }
  @Get('avatars/:id') async avatar(@Param('id',ParseUUIDPipe) id:string,@Query('v') version:string|undefined,@Res() response:Response) {
    const stored=await this.db.user.findUnique({where:{id},select:{avatarData:true,avatarMime:true,avatarUpdatedAt:true}});
    if(!stored?.avatarData||!stored.avatarMime||!stored.avatarUpdatedAt)throw new NotFoundException('Фотография не найдена.');
    const data=Buffer.from(stored.avatarData);
    if(!avatarMimes.has(stored.avatarMime)||detectAvatarMime(data)!==stored.avatarMime)throw new NotFoundException('Фотография не найдена.');
    const currentVersion=String(stored.avatarUpdatedAt.getTime());
    response.setHeader('Content-Type',stored.avatarMime);
    response.setHeader('Content-Length',String(data.length));
    response.setHeader('Cache-Control',version===currentVersion?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
    response.setHeader('ETag',`"avatar-${id}-${currentVersion}"`);
    return response.send(data);
  }
  @Get('vehicles/:id/photo') async vehiclePhoto(@Param('id',ParseUUIDPipe) id:string,@Query('v') version:string|undefined,@Res() response:Response) {
    const stored=await this.db.vehicle.findUnique({where:{id},select:{photoData:true,photoMime:true,photoUpdatedAt:true}});
    if(!stored?.photoData||!stored.photoMime||!stored.photoUpdatedAt)throw new NotFoundException('Фотография не найдена.');
    const data=Buffer.from(stored.photoData);
    if(!avatarMimes.has(stored.photoMime)||detectAvatarMime(data)!==stored.photoMime)throw new NotFoundException('Фотография не найдена.');
    const currentVersion=String(stored.photoUpdatedAt.getTime());
    response.setHeader('Content-Type',stored.photoMime);
    response.setHeader('Content-Length',String(data.length));
    response.setHeader('Cache-Control',version===currentVersion?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
    response.setHeader('ETag',`"vehicle-${id}-${currentVersion}"`);
    return response.send(data);
  }
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost) {
    const response=host.switchToHttp().getResponse<Response>();
    let status=HttpStatus.INTERNAL_SERVER_ERROR, message:unknown='Сервис временно недоступен';
    if(error instanceof HttpException) {status=error.getStatus();message=error.getResponse();}
    else if(error instanceof Prisma.PrismaClientKnownRequestError) {
      if(error.code==='P2002'||error.code==='P2034') {status=409;message='Конфликт: операция уже выполнена или данные изменились';}
      else if(error.code==='P2025') {status=404;message='Запись не найдена';}
    }
    response.status(status).json(typeof message==='object'?message:{statusCode:status,message});
  }
}
export function apiValidation() {return new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true,forbidUnknownValues:true});}
