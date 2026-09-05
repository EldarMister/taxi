import { Controller, Get, Injectable, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Actor, AuthGuard, RateLimits } from './auth';
import { AppConfig } from './config';
import { haversine } from './domain';
class SearchDto { @ApiProperty() @IsString() @MinLength(2) @MaxLength(250) q!:string; }
class ReverseDto {
  @ApiProperty() @Type(()=>Number) @IsNumber() @Min(-90) @Max(90) latitude!:number;
  @ApiProperty() @Type(()=>Number) @IsNumber() @Min(-180) @Max(180) longitude!:number;
}
const demoPlaces=[
  {id:'demo-ala-too',address:'Площадь Ала-Тоо, Бишкек',latitude:42.8756,longitude:74.6040},
  {id:'demo-ata-turk',address:'Парк Ататюрк, Бишкек',latitude:42.8380,longitude:74.5949},
  {id:'demo-osh-market',address:'Ошский рынок, Бишкек',latitude:42.8747,longitude:74.5695},
  {id:'demo-asia-mall',address:'Asia Mall, проспект Чингиза Айтматова, Бишкек',latitude:42.8476,longitude:74.5850},
  {id:'demo-tsum',address:'ЦУМ Айчурёк, проспект Чуй, Бишкек',latitude:42.8765,longitude:74.6142},
  {id:'demo-bishkek-park',address:'Bishkek Park, улица Киевская, Бишкек',latitude:42.8741,longitude:74.5900},
  {id:'demo-philharmonic',address:'Филармония, проспект Чуй, Бишкек',latitude:42.8769,longitude:74.5860},
];
@Injectable()
export class PlacesService {
  constructor(private readonly config:AppConfig) {}
  async search(q:string) {
    if(this.config.development&&!process.env.YANDEX_GEOCODER_API_KEY)return demoPlaces.filter(place=>place.address.toLocaleLowerCase('ru').includes(q.toLocaleLowerCase('ru'))).map(place=>({...place,development:true}));
    return this.geocode(q,false);
  }
  async reverse(point:ReverseDto) {
    if(this.config.development&&!process.env.YANDEX_GEOCODER_API_KEY) {
      const nearby=[...demoPlaces].sort((a,b)=>haversine(point,a)-haversine(point,b))[0];
      return {id:`demo-point-${point.latitude}-${point.longitude}`,address:haversine(point,nearby)<150?nearby.address:`Точка на карте (${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)})`,...point,development:true};
    }
    const results=await this.geocode(`${point.longitude},${point.latitude}`,true);
    return results[0]??{id:`point-${point.latitude}-${point.longitude}`,address:`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`,...point};
  }
  private async geocode(query:string,reverse:boolean) {
    if(!process.env.YANDEX_GEOCODER_API_KEY)throw new ServiceUnavailableException('Поиск адресов на сервере не настроен. Используйте карту в приложении.');
    try {
      const url=new URL('https://geocode-maps.yandex.ru/v1/');
      url.searchParams.set('apikey',process.env.YANDEX_GEOCODER_API_KEY);url.searchParams.set('format','json');url.searchParams.set('geocode',query);url.searchParams.set('lang','ru_RU');url.searchParams.set('results',reverse?'1':'8');
      if(!reverse){url.searchParams.set('ll','74.60,42.87');url.searchParams.set('spn','0.7,0.5');}
      const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Geocoder unavailable');
      const payload=await response.json() as {response?:{GeoObjectCollection?:{featureMember?:{GeoObject:{name:string;description:string;Point:{pos:string};metaDataProperty?:{GeocoderMetaData?:{text:string}}}}[]}}};
      const members=payload.response?.GeoObjectCollection?.featureMember;if(!Array.isArray(members))throw new Error('Invalid geocoder data');
      return members.map(({GeoObject:place})=>{const [longitude,latitude]=place.Point.pos.split(' ').map(Number);return {id:`yandex-${longitude}-${latitude}`,address:place.metaDataProperty?.GeocoderMetaData?.text??`${place.name}, ${place.description}`,latitude,longitude};}).filter(p=>Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180);
    }catch{throw new ServiceUnavailableException('Не удалось найти адрес. Попробуйте снова.');}
  }
}
@ApiTags('places') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('places')
export class PlacesController {
  constructor(private readonly places:PlacesService,private readonly limits:RateLimits) {}
  @Get('search') async search(@Query() query:SearchDto,@Req() req:{actor:Actor}) {await this.limits.take(`places:${req.actor.id}`,60,60);return this.places.search(query.q);}
  @Get('reverse') async reverse(@Query() query:ReverseDto,@Req() req:{actor:Actor}) {await this.limits.take(`places:${req.actor.id}`,60,60);return this.places.reverse(query);}
}
