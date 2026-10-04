import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Actor, AuthGuard } from './auth';
import { AdminGuard } from './admin.security';
import { RestaurantActor, RestaurantAuthGuard, RestaurantAuthService } from './restaurant-auth';
import { RestaurantService } from './restaurant';
import { RestaurantDeliveryService } from './restaurant-delivery';
import { RestaurantAccountInputDto, RestaurantCatalogDto, RestaurantDispatchDto, RestaurantLoginDto, RestaurantOrderActionDto, RestaurantPromotionsDto, RestaurantRefreshDto, RestaurantStaffInputDto } from './restaurant.dto';
type RestaurantRequest=Request&{restaurantActor:RestaurantActor};
type AdminRequest=Request&{actor:Actor};
@Controller('restaurant/auth')
export class RestaurantAuthController {
  constructor(private readonly auth:RestaurantAuthService){}
  @Post('login') login(@Body() dto:RestaurantLoginDto,@Req() req:Request){return this.auth.login(dto.phone,dto.password,req.ip??'unknown');}
  @Post('refresh') refresh(@Body() dto:RestaurantRefreshDto){return this.auth.refresh(dto.refreshToken);}
  @Post('logout') logout(@Body() dto:RestaurantRefreshDto){return this.auth.logout(dto.refreshToken);}
}
@UseGuards(RestaurantAuthGuard) @Controller('restaurant')
export class RestaurantController {
  constructor(private readonly auth:RestaurantAuthService,private readonly restaurants:RestaurantService,private readonly delivery:RestaurantDeliveryService){}
  @Get('me') me(@Req() req:RestaurantRequest){return this.auth.profile(req.restaurantActor.id);}
  @Get(':id') get(@Req() req:RestaurantRequest,@Param('id') id:string){return this.restaurants.get(req.restaurantActor,id);}
  @Put(':id/catalog') save(@Req() req:RestaurantRequest,@Param('id') id:string,@Body() dto:RestaurantCatalogDto){return this.restaurants.saveCatalog(req.restaurantActor,id,dto);}
  @Get(':id/orders') orders(@Req() req:RestaurantRequest,@Param('id') id:string){return this.restaurants.orders(req.restaurantActor,id);}
  @Patch(':id/orders/:orderId') status(@Req() req:RestaurantRequest,@Param('id') id:string,@Param('orderId',ParseUUIDPipe) orderId:string,@Body() dto:RestaurantOrderActionDto){return this.restaurants.changeOrder(req.restaurantActor,id,orderId,dto);}
  @Post(':id/orders/:orderId/dispatch') async dispatch(@Req() req:RestaurantRequest,@Param('id') id:string,@Param('orderId',ParseUUIDPipe) orderId:string,@Body() dto:RestaurantDispatchDto){await this.restaurants.access(req.restaurantActor,id,'orders.manage');return this.delivery.dispatch(req.restaurantActor,id,orderId,dto);}
  @Post(':id/orders/:orderId/dispatch-quote') async quote(@Req() req:RestaurantRequest,@Param('id') id:string,@Param('orderId',ParseUUIDPipe) orderId:string,@Body() dto:RestaurantDispatchDto){await this.restaurants.access(req.restaurantActor,id,'orders.manage');return this.delivery.quote(req.restaurantActor,id,orderId,dto);}
  @Get(':id/stats') stats(@Req() req:RestaurantRequest,@Param('id') id:string,@Query('period') period='week'){return this.restaurants.stats(req.restaurantActor,id,period);}
  @Get(':id/staff') staff(@Req() req:RestaurantRequest,@Param('id') id:string){return this.restaurants.staff(req.restaurantActor,id);}
  @Post(':id/staff') createStaff(@Req() req:RestaurantRequest,@Param('id') id:string,@Body() dto:RestaurantStaffInputDto){return this.restaurants.saveStaff(req.restaurantActor,id,dto);}
  @Patch(':id/staff/:accountId') updateStaff(@Req() req:RestaurantRequest,@Param('id') id:string,@Param('accountId',ParseUUIDPipe) accountId:string,@Body() dto:RestaurantStaffInputDto){return this.restaurants.saveStaff(req.restaurantActor,id,dto,accountId);}
  @Delete(':id/staff/:accountId') deleteStaff(@Req() req:RestaurantRequest,@Param('id') id:string,@Param('accountId',ParseUUIDPipe) accountId:string){return this.restaurants.saveStaff(req.restaurantActor,id,{active:false},accountId);}
  @Post(':id/media') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024,files:1}})) upload(@Req() req:RestaurantRequest,@Param('id') id:string,@UploadedFile() file?:{buffer:Buffer;mimetype:string}){return this.restaurants.upload(req.restaurantActor,id,file);}
}
@UseGuards(AuthGuard,AdminGuard) @Controller('admin')
export class AdminRestaurantAccountsController {
  constructor(private readonly restaurants:RestaurantService){}
  @Get('restaurant-accounts') accounts(@Req() req:AdminRequest){return this.restaurants.listOwners(req.actor);}
  @Post('restaurant-accounts') create(@Req() req:AdminRequest,@Body() dto:RestaurantAccountInputDto){return this.restaurants.saveOwner(req.actor,dto);}
  @Patch('restaurant-accounts/:id') update(@Req() req:AdminRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:RestaurantAccountInputDto){return this.restaurants.saveOwner(req.actor,dto,id);}
  @Get('restaurants/:id/promotions') promotions(@Req() req:AdminRequest,@Param('id') id:string){return this.restaurants.promotions(req.actor,id);}
  @Put('restaurants/:id/promotions') savePromotions(@Req() req:AdminRequest,@Param('id') id:string,@Body() dto:RestaurantPromotionsDto){return this.restaurants.savePromotions(req.actor,id,dto);}
}
