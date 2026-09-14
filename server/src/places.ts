import { BadRequestException, Controller, Get, Injectable, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Actor, AuthGuard, RateLimits } from './auth';
import { AppConfig } from './config';
import { PhotonSearch } from './photon';

class SearchDto {
  @ApiProperty() @Transform(({value})=>typeof value === 'string' ? value.trim() : value) @IsString() @MinLength(2) @MaxLength(250) q!: string;
  @ApiPropertyOptional() @ValidateIf(o=>o.latitude!==undefined||o.longitude!==undefined) @Type(()=>Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @ValidateIf(o=>o.latitude!==undefined||o.longitude!==undefined) @Type(()=>Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional({enum:['ru','ky']}) @IsOptional() @IsIn(['ru','ky']) language?: 'ru'|'ky';
}
class ReverseDto {
  @ApiProperty() @Type(()=>Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @Type(()=>Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @ApiPropertyOptional({enum:['ru','ky']}) @IsOptional() @IsIn(['ru','ky']) language?: 'ru'|'ky';
}
export type Place = {id: string; address: string; latitude: number; longitude: number};
type GeocodedPlace = Place & { settlement: boolean };
const publicPlace = ({id,address,latitude,longitude}: Place): Place => ({id,address,latitude,longitude});
const CACHE_LIMIT = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const QUEUE_LIMIT = 16;
const QUEUE_TIMEOUT_MS = 15000;

export function parseNominatimPlace(value: unknown): Place {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid place');
  const place = value as Record<string, unknown>;
  // Empty strings and null must not silently become a valid coordinate of zero.
  if (!['string','number'].includes(typeof place.lat) || !['string','number'].includes(typeof place.lon) || String(place.lat).trim() === '' || String(place.lon).trim() === '') throw new Error('Missing place coordinates');
  const latitude = Number(place.lat), longitude = Number(place.lon);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || typeof place.display_name !== 'string' || place.display_name.trim().length < 2) throw new Error('Invalid place data');
  const id = typeof place.osm_type === 'string' && ['node','way','relation'].includes(place.osm_type) && /^\d+$/.test(String(place.osm_id))
    ? `osm-${place.osm_type}-${place.osm_id}`
    : `osm-point-${latitude}-${longitude}`;
  return {id, address: place.display_name.trim().slice(0, 250), latitude, longitude};
}

@Injectable()
export class PlacesService {
  private readonly cache = new Map<string, {expiresAt: number; places: GeocodedPlace[]}>();
  private readonly pending = new Map<string, Promise<GeocodedPlace[]>>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly photon: PhotonSearch | null;
  constructor(private readonly config: AppConfig) { this.photon=config.photonBaseUrl?new PhotonSearch(config.photonBaseUrl):null; }

  async search(query: string, center?: {latitude:number;longitude:number}, language:'ru'|'ky'='ru'): Promise<Place[]> {
    const q = query.trim();
    if (q.length < 2 || q.length > 250) throw new BadRequestException('Введите адрес от 2 до 250 символов.');
    const focus = center ?? {latitude:42.85,longitude:74.60};
    if (!Number.isFinite(focus.latitude) || Math.abs(focus.latitude)>90 || !Number.isFinite(focus.longitude) || Math.abs(focus.longitude)>180) throw new BadRequestException('Некорректные координаты поиска.');
    if(this.photon)return this.photon.search(q,focus,language);
    const latitude=Math.round(focus.latitude*100)/100, longitude=Math.round(focus.longitude*100)/100;
    const box = (dx:number,dy:number) => [Math.max(-180,longitude-dx),Math.min(90,latitude+dy),Math.min(180,longitude+dx),Math.max(-90,latitude-dy)].map(n=>n.toFixed(2)).join(',');
    const params={q,limit:'8',countrycodes:'kg'};
    const wider = await this.geocode('search', {...params,bounded:'0'},language);
    // A broad viewbox is only a ranking hint. It can omit a nearby street in
    // favour of namesakes in other towns, especially when a house is unmapped.
    // Keep town searches global ("Бишкек" must not become "Бишкек–Ош" nearby).
    if (!center || wider.some(place=>place.settlement)) return wider.map(publicPlace);
    let nearby: GeocodedPlace[];
    try { nearby = await this.geocode('search',{...params,viewbox:box(.08,.08),bounded:'1'},language); }
    catch (error) { if (wider.length) return wider.map(publicPlace); throw error; }
    const unique = new Map<string,Place>();
    for (const place of [...nearby,...wider]) if (!unique.has(place.id)) unique.set(place.id,publicPlace(place));
    return [...unique.values()].slice(0,8);
  }

  async reverse(point: ReverseDto): Promise<Place> {
    if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) throw new BadRequestException('Некорректные координаты.');
    const places = await this.geocode('reverse', {lat:point.latitude.toFixed(5), lon:point.longitude.toFixed(5), zoom:'18'},point.language??'ru');
    if (!places[0]) throw new ServiceUnavailableException('Адрес для этой точки не найден. Выберите точку рядом с дорогой.');
    // A reverse result describes the nearest OSM object; it must not move the user's pin.
    return {...publicPlace(places[0]), latitude:point.latitude, longitude:point.longitude};
  }

  private async geocode(kind: 'search' | 'reverse', params: Record<string, string>, language:'ru'|'ky'): Promise<GeocodedPlace[]> {
    if (!this.config.nominatimBaseUrl) throw new ServiceUnavailableException('Поиск адресов временно недоступен. Выберите точку на карте.');
    const url = new URL(`${this.config.nominatimBaseUrl}/${kind}`);
    url.search = new URLSearchParams({format:'jsonv2', addressdetails:'1', 'accept-language':language==='ky'?'ky,ru,en':'ru,ky,en', ...params}).toString();
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(key); this.cache.set(key, cached);
      return cached.places.map(place=>({...place}));
    }
    if (cached) this.cache.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing.then(places=>places.map(place=>({...place})));
    if (this.pending.size >= QUEUE_LIMIT) throw new ServiceUnavailableException('Поиск адресов занят. Повторите через несколько секунд.');
    const queuedAt = Date.now();
    const request = this.queue.then(async()=>{
      const delay = Math.max(0, this.lastRequestAt + this.config.nominatimIntervalMs - Date.now());
      if (Date.now() + delay - queuedAt > QUEUE_TIMEOUT_MS) throw new ServiceUnavailableException('Поиск адресов занят. Повторите через несколько секунд.');
      if (delay) await new Promise(resolve=>setTimeout(resolve, delay));
      this.lastRequestAt = Date.now();
      try {
        const response = await fetch(url, {signal:AbortSignal.timeout(10000), redirect:'error', headers:{'User-Agent':this.config.nominatimUserAgent, Accept:'application/json'}});
        if (!response.ok) throw new Error('Geocoder unavailable');
        const payload: unknown = await response.json();
        if (kind === 'search' && !Array.isArray(payload)) throw new Error('Invalid search response');
        const places = (kind === 'search' ? (payload as unknown[]).slice(0,8) : [payload]).map(value=>{
          const place=parseNominatimPlace(value);
          const raw=value as Record<string,unknown>;
          const settlement=['city','town','village','hamlet','municipality','borough','suburb','neighbourhood'].includes(String(raw.addresstype??raw.type));
          return {...place,settlement};
        });
        if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, {expiresAt:Date.now() + (places.length ? CACHE_TTL_MS : 5 * 60 * 1000), places});
        return places;
      } catch {
        throw new ServiceUnavailableException('Не удалось найти адрес. Попробуйте снова.');
      }
    });
    this.pending.set(key, request);
    // Search and reverse share one queue. Failed requests do not poison later lookups.
    this.queue = request.then(()=>undefined, ()=>undefined);
    try { return (await request).map(place=>({...place})); }
    finally { this.pending.delete(key); }
  }
}

@ApiTags('places') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService, private readonly limits: RateLimits) {}
  @Get('search') async search(@Query() query: SearchDto, @Req() req: {actor: Actor}) {await this.limits.take(`place-search:${req.actor.id}`,240,60);return this.places.search(query.q,query.latitude===undefined?undefined:{latitude:query.latitude,longitude:query.longitude!},query.language??'ru');}
  @Get('reverse') async reverse(@Query() query: ReverseDto, @Req() req: {actor: Actor}) {await this.limits.take(`places:${req.actor.id}`,60,60);return this.places.reverse(query);}
}
