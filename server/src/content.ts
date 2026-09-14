import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { Actor, AuthGuard, RateLimits } from './auth';
import { AdminAuditService, AdminGuard, assertAdmin } from './admin.security';
import { RealtimeEvents } from './events';
import { PrismaService } from './prisma.service';
import { assertBannerCapacity, contentId, detectMediaMime, MAX_MEDIA_BYTES, normalizeContentImage, validateBanner, validateRestaurantCatalog } from './content-domain';

type AuthedRequest=Request&{actor:Actor};
type MediaFile={buffer:Buffer;mimetype:string;size:number};
export class RestaurantInputDto {
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/) id?:string;
  @IsOptional() @IsObject() catalog?:Record<string,unknown>;
  @IsOptional() @IsBoolean() active?:boolean;
  @IsOptional() @IsBoolean() isDemo?:boolean;
  @IsOptional() @IsInt() @Min(-10_000) @Max(10_000) sortOrder?:number;
}
export class BannerInputDto {
  @IsOptional() @IsString() @MaxLength(120) title?:string;
  @IsOptional() @IsString() @MaxLength(300) subtitle?:string;
  @IsOptional() @IsString() @MaxLength(2000) imageUrl?:string|null;
  @IsOptional() @IsString() @MaxLength(100) imageKey?:string|null;
  @IsOptional() @IsString() @MaxLength(20) actionType?:string;
  @IsOptional() @IsString() @MaxLength(100) restaurantId?:string|null;
  @IsOptional() @IsInt() @Min(-10_000) @Max(10_000) sortOrder?:number;
  @IsOptional() @IsBoolean() active?:boolean;
}

@Injectable()
export class ContentService {
  constructor(private readonly db:PrismaService,private readonly audit:AdminAuditService,private readonly events:RealtimeEvents,private readonly limits:RateLimits) {}

  async restaurants(actor:Actor) {
    assertAdmin(actor);
    const rows=await this.db.foodRestaurant.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}]});
    return {items:rows,total:rows.length};
  }
  async saveRestaurant(actor:Actor,input:RestaurantInputDto,id?:string) {
    assertAdmin(actor);
    const restaurantId=contentId(id??input.id??randomUUID());
    if(id&&input.id!==undefined&&input.id!==id)throw new BadRequestException('Идентификатор ресторана менять нельзя.');
    const result=await this.db.$transaction(async tx=>{
      // Lock also covers first creation and prevents lost partial metadata updates.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restaurant:${restaurantId}`}))`;
      const current=await tx.foodRestaurant.findUnique({where:{id:restaurantId}});
      if(id&&!current)throw new NotFoundException('Ресторан не найден.');
      if(!id&&current)throw new BadRequestException('Ресторан с таким идентификатором уже существует.');
      const active=input.active??current?.active??false,isDemo=input.isDemo??current?.isDemo??false,sortOrder=input.sortOrder??current?.sortOrder??0;
      if(typeof active!=='boolean'||typeof isDemo!=='boolean'||!Number.isInteger(sortOrder)||Math.abs(sortOrder)>10_000)throw new BadRequestException('Некорректные настройки ресторана.');
      const catalog=validateRestaurantCatalog(input.catalog??current?.catalog,restaurantId,isDemo);
      const data={catalog:catalog as unknown as Prisma.InputJsonValue,active,isDemo,sortOrder};
      const row=current?await tx.foodRestaurant.update({where:{id:restaurantId},data}):await tx.foodRestaurant.create({data:{id:restaurantId,...data}});
      await this.audit.record(tx,actor,current?'restaurant.update':'restaurant.create','restaurant',restaurantId,{name:catalog.name,active,isDemo,dishes:catalog.dishes.length});
      return row;
    });
    this.events.adminChanged('restaurants',restaurantId);this.events.contentChanged('restaurants');
    return result;
  }
  async archiveRestaurant(actor:Actor,id:string) {
    assertAdmin(actor);
    const row=await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restaurant:${id}`}))`;
      const current=await tx.foodRestaurant.findUnique({where:{id}});
      if(!current)throw new NotFoundException('Ресторан не найден.');
      const row=await tx.foodRestaurant.update({where:{id},data:{active:false}});
      await this.audit.record(tx,actor,'restaurant.archive','restaurant',id,{name:String((current.catalog as Record<string,unknown>).name??'')});
      return row;
    });
    this.events.adminChanged('restaurants',id);this.events.contentChanged('restaurants');
    return row;
  }
  async banners() {
    const banners=await this.db.banner.findMany({where:{active:true},orderBy:[{sortOrder:'asc'},{id:'asc'}],take:3});
    return {banners};
  }
  async adminBanners(actor:Actor) {
    assertAdmin(actor);
    const items=await this.db.banner.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}]});
    return {items,total:items.length};
  }
  async saveBanner(actor:Actor,input:BannerInputDto,id?:string) {
    assertAdmin(actor);
    const row=await this.db.$transaction(async tx=>{
      // One transaction lock for all banner activation paths, including concurrent creates.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(219861074)`;
      const current=id?await tx.banner.findUnique({where:{id}}):null;
      if(id&&!current)throw new NotFoundException('Баннер не найден.');
      const previous=current?{title:current.title,subtitle:current.subtitle,imageUrl:current.imageUrl,imageKey:current.imageKey,actionType:current.actionType,restaurantId:current.restaurantId,sortOrder:current.sortOrder,active:current.active}:{};
      const data=validateBanner({...previous,...Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined))});
      if(data.restaurantId&&!await tx.foodRestaurant.findUnique({where:{id:data.restaurantId}}))throw new BadRequestException('Ресторан для баннера не найден.');
      assertBannerCapacity(await tx.banner.count({where:{active:true,...(id?{id:{not:id}}:{})}}),data.active);
      const result=id?await tx.banner.update({where:{id},data}):await tx.banner.create({data});
      await this.audit.record(tx,actor,id?'banner.update':'banner.create','banner',result.id,{title:result.title,active:result.active});
      return result;
    });
    this.events.adminChanged('banners',row.id);this.events.contentChanged('banners');
    return row;
  }
  async deleteBanner(actor:Actor,id:string) {
    assertAdmin(actor);
    await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(219861074)`;
      const current=await tx.banner.findUnique({where:{id}});
      if(!current)throw new NotFoundException('Баннер не найден.');
      await tx.banner.delete({where:{id}});
      await this.audit.record(tx,actor,'banner.delete','banner',id,{title:current.title});
    });
    this.events.adminChanged('banners',id);this.events.contentChanged('banners');
    return {deleted:true};
  }
  async upload(actor:Actor,file?:MediaFile) {
    assertAdmin(actor);
    await this.limits.take(`admin:media:${actor.id}`,60,3600);
    if(!file?.buffer)throw new BadRequestException('Выберите изображение.');
    const normalized=await normalizeContentImage(file.buffer,file.mimetype);
    const row=await this.db.$transaction(async tx=>{
      const stored=await tx.mediaAsset.create({data:{...normalized,data:Uint8Array.from(normalized.data)}});
      await this.audit.record(tx,actor,'media.upload','media',stored.id,{width:stored.width,height:stored.height,bytes:normalized.data.length});
      return stored;
    });
    return {url:`/api/content/media/${row.id}`};
  }
  async media(id:string,response:Response) {
    const stored=await this.db.mediaAsset.findUnique({where:{id}});
    if(!stored||stored.mime!=='image/webp'||detectMediaMime(stored.data)!==stored.mime)throw new NotFoundException('Изображение не найдено.');
    const etag=`"media-${id}"`;
    response.setHeader('ETag',etag);
    response.setHeader('Cache-Control','public, max-age=31536000, immutable');
    response.setHeader('Cross-Origin-Resource-Policy','cross-origin');
    response.setHeader('X-Content-Type-Options','nosniff');
    if(response.req.headers['if-none-match']===etag)return response.status(304).end();
    response.setHeader('Content-Type',stored.mime);
    response.setHeader('Content-Length',String(stored.data.length));
    return response.send(Buffer.from(stored.data));
  }
}

@ApiTags('content') @Controller('content')
export class ContentController {
  constructor(private readonly content:ContentService) {}
  @Get('banners') banners() {return this.content.banners();}
  @Get('media/:id') media(@Param('id',ParseUUIDPipe) id:string,@Res() response:Response) {return this.content.media(id,response);}
}

@ApiTags('admin content') @ApiBearerAuth() @UseGuards(AuthGuard,AdminGuard) @Controller('admin')
export class AdminCatalogController {
  constructor(private readonly content:ContentService) {}
  @Get('restaurants') restaurants(@Req() req:AuthedRequest) {return this.content.restaurants(req.actor);}
  @Post('restaurants') createRestaurant(@Req() req:AuthedRequest,@Body() dto:RestaurantInputDto) {return this.content.saveRestaurant(req.actor,dto);}
  @Patch('restaurants/:id') updateRestaurant(@Req() req:AuthedRequest,@Param('id') id:string,@Body() dto:RestaurantInputDto) {return this.content.saveRestaurant(req.actor,dto,id);}
  @Delete('restaurants/:id') archiveRestaurant(@Req() req:AuthedRequest,@Param('id') id:string) {return this.content.archiveRestaurant(req.actor,id);}
  @Get('banners') banners(@Req() req:AuthedRequest) {return this.content.adminBanners(req.actor);}
  @Post('banners') createBanner(@Req() req:AuthedRequest,@Body() dto:BannerInputDto) {return this.content.saveBanner(req.actor,dto);}
  @Patch('banners/:id') updateBanner(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:BannerInputDto) {return this.content.saveBanner(req.actor,dto,id);}
  @Delete('banners/:id') deleteBanner(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {return this.content.deleteBanner(req.actor,id);}
  @Post('media') @ApiConsumes('multipart/form-data')
  @ApiBody({schema:{type:'object',required:['image'],properties:{image:{type:'string',format:'binary'}}}})
  @UseInterceptors(FileInterceptor('image',{limits:{fileSize:MAX_MEDIA_BYTES,files:1,fields:0},fileFilter:(request,file,callback)=>{
    if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype.toLowerCase()))return callback(new BadRequestException('Разрешены только фотографии JPEG, PNG или WEBP.'),false);
    callback(null,true);
  }}))
  upload(@Req() req:AuthedRequest,@UploadedFile() file?:MediaFile) {return this.content.upload(req.actor,file);}
}
