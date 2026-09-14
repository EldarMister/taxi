import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Actor, AuthGuard } from './auth';
import { HistoryDto } from './dto';
import { CreateFoodOrderDto, FoodStatusDto } from './food.dto';
import { FoodService } from './food';
import { AdminGuard } from './admin.security';

type AuthedRequest=Request&{actor:Actor};

@ApiTags('food') @Controller('food')
export class FoodCatalogController {
  constructor(private readonly food:FoodService) {}
  @Get('catalog') catalog() {return this.food.catalog();}
}

@ApiTags('food orders') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('food/orders')
export class FoodOrdersController {
  constructor(private readonly food:FoodService) {}
  @Post() create(@Req() req:AuthedRequest,@Body() dto:CreateFoodOrderDto) {return this.food.create(req.actor,dto);}
  @Get('active') async active(@Req() req:AuthedRequest,@Res() response:Response) {return response.json(await this.food.active(req.actor));}
  @Get('history') history(@Req() req:AuthedRequest,@Query() query:HistoryDto) {return this.food.history(req.actor,query.period);}
  @Get(':id') get(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.food.get(req.actor,id);}
  @Post(':id/cancel') cancel(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.food.cancel(req.actor,id);}
}

@ApiTags('admin food') @ApiBearerAuth() @UseGuards(AuthGuard,AdminGuard) @Controller('admin/food/orders')
export class AdminFoodController {
  constructor(private readonly food:FoodService) {}
  @Patch(':id/status') status(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:FoodStatusDto) {return this.food.changeStatus(req.actor,id,dto);}
}
