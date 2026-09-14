import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Actor, AuthGuard } from './auth';
import { AdminService } from './admin';
import { AdminCancelDto, AdminDriverDto, AdminDriverPatchDto, AdminDriversDto, AdminOrdersDto, AdminPageDto, AdminTariffDto, AdminTariffPatchDto } from './admin.dto';
import { AdminGuard } from './admin.security';
type AdminRequest=Request&{actor:Actor};
@Controller('admin') @UseGuards(AuthGuard,AdminGuard)
export class AdminOperationsController {
  constructor(private readonly admin:AdminService) {}
  @Get('me') me(@Req() request:AdminRequest) {return this.admin.me(request.actor);}
  @Get('dashboard') dashboard(@Req() request:AdminRequest) {return this.admin.dashboard(request.actor);}
  @Get('orders') orders(@Req() request:AdminRequest,@Query() query:AdminOrdersDto) {return this.admin.orders(request.actor,query);}
  @Get('orders/:kind/:id') order(@Req() request:AdminRequest,@Param('kind') kind:string,@Param('id',ParseUUIDPipe) id:string) {return this.admin.order(request.actor,kind,id);}
  @Post('orders/taxi/:id/cancel') cancel(@Req() request:AdminRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AdminCancelDto) {return this.admin.cancelTaxi(request.actor,id,dto);}
  @Get('tariffs') tariffs(@Req() request:AdminRequest) {return this.admin.tariffs(request.actor);}
  @Post('tariffs') createTariff(@Req() request:AdminRequest,@Body() dto:AdminTariffDto) {return this.admin.createTariff(request.actor,dto);}
  @Patch('tariffs/:id') updateTariff(@Req() request:AdminRequest,@Param('id') id:string,@Body() dto:AdminTariffPatchDto) {return this.admin.updateTariff(request.actor,id,dto);}
  @Get('drivers') drivers(@Req() request:AdminRequest,@Query() query:AdminDriversDto) {return this.admin.drivers(request.actor,query);}
  @Post('drivers') createDriver(@Req() request:AdminRequest,@Body() dto:AdminDriverDto) {return this.admin.createDriver(request.actor,dto);}
  @Get('drivers/:id') driver(@Req() request:AdminRequest,@Param('id',ParseUUIDPipe) id:string) {return this.admin.driver(request.actor,id);}
  @Patch('drivers/:id') updateDriver(@Req() request:AdminRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AdminDriverPatchDto) {return this.admin.updateDriver(request.actor,id,dto);}
  @Get('audit') audit(@Req() request:AdminRequest,@Query() query:AdminPageDto) {return this.admin.auditLog(request.actor,query);}
}
