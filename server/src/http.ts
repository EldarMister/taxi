import { ArgumentsHost, BadRequestException, Body, Catch, Controller, Delete, ExceptionFilter, Get, HttpException, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { Actor, AuthGuard, AuthService, RateLimits } from './auth';
import { AppConfig } from './config';
import { DriverService } from './driver';
import { CreateOrderDto, HistoryDto, MessageDto, OnlineDto, PhoneDto, ProfileDto, PushTokenDto, QuoteDto, RatingDto, RefreshDto, RemovePushTokenDto, TopupDto, VerifyDriverDto, VerifyDto } from './dto';
import { OrdersService } from './orders';
import { PrismaService } from './prisma.service';
type AuthedRequest=Request&{actor:Actor};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth:AuthService,private readonly limits:RateLimits) {}
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
    await this.db.user.update({where:{id:req.actor.id},data:{...dto,...(dto.name!==undefined?{name:dto.name.trim()}:{})}});return this.auth.user(req.actor.id);
  }
  @Post('me/push-token') async push(@Req() req:AuthedRequest,@Body() dto:PushTokenDto) {
    await this.limits.take(`push-register:${req.actor.id}`,20,60);
    const count=await this.db.pushToken.count({where:{userId:req.actor.id}});
    if(count>=10 && !await this.db.pushToken.findFirst({where:{userId:req.actor.id,token:dto.token}})) throw new BadRequestException('Превышен лимит устройств');
    await this.db.pushToken.upsert({where:{token:dto.token},create:{userId:req.actor.id,...dto},update:{userId:req.actor.id,platform:dto.platform}});return {ok:true};
  }
  @Delete('me/push-token') async removePush(@Req() req:AuthedRequest,@Body() dto:RemovePushTokenDto) {await this.db.pushToken.deleteMany({where:{userId:req.actor.id,token:dto.token}});return {ok:true};}
}
@ApiTags('orders') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('orders')
export class OrdersController {
  constructor(private readonly orders:OrdersService) {}
  @Post('quote') quote(@Req() req:AuthedRequest,@Body() dto:QuoteDto) {return this.orders.quote(req.actor,dto);}
  @Post() create(@Req() req:AuthedRequest,@Body() dto:CreateOrderDto) {return this.orders.create(req.actor,dto);}
  @Get('active') async active(@Req() req:AuthedRequest,@Res() response:Response) {return response.json(await this.orders.active(req.actor));}
  @Get('history') history(@Req() req:AuthedRequest,@Query() query:HistoryDto) {return this.orders.history(req.actor,query.period);}
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
  @Post(':id/rating') rate(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RatingDto) {return this.orders.rate(req.actor,id,dto.score);}
}
@ApiTags('driver') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('driver')
export class DriverController {
  constructor(private readonly driver:DriverService,private readonly orders:OrdersService) {}
  @Patch('online') online(@Req() req:AuthedRequest,@Body() dto:OnlineDto) {return this.driver.online(req.actor,dto.online);}
  @Get('offers') offers(@Req() req:AuthedRequest) {return this.orders.offers(req.actor);}
  @Get('balance') balance(@Req() req:AuthedRequest) {return this.driver.balance(req.actor);}
}
@ApiTags('admin') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('admin')
export class AdminController {
  constructor(private readonly driver:DriverService) {}
  @Post('drivers/:id/topup') topup(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:TopupDto) {return this.driver.topup(req.actor,id,dto);}
  @Patch('drivers/:id/verify') verify(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:VerifyDriverDto) {return this.driver.verify(req.actor,id,dto);}
}
@ApiTags('configuration') @Controller()
export class PublicController {
  constructor(private readonly db:PrismaService,private readonly config:AppConfig) {}
  @Get('health') async health() {await this.db.$queryRaw`SELECT 1`;return {status:'ok'};}
  @Get('config') configValue() {return {currency:'KGS',development:this.config.development,supportPhone:process.env.SUPPORT_PHONE??'+996700000000'};}
  @Get('tariffs') tariffs() {return this.db.tariff.findMany({where:{active:true},orderBy:{basePrice:'asc'}});}
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
