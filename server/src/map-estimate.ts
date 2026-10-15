import { Body, Controller, ForbiddenException, Injectable, NotFoundException, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Actor, AuthGuard, RateLimits } from './auth';
import { AppConfig } from './config';
import { ACTIVE_STATUSES, calculateFare, haversine, type Point } from './domain';
import { IDLE_POSITION_MAX_AGE_MS, POSITION_MAX_AGE_MS } from './dispatch-ranking';
import { driverCanTake } from './driver-eligibility';
import { PointDto } from './dto';
import { PrismaService } from './prisma.service';
import { RoutingService, type DrivingRoute } from './routing';

export class MapEstimateDto {
  @ApiProperty({type:PointDto}) @IsDefined() @ValidateNested() @Type(()=>PointDto) pickup!:PointDto;
  @ApiPropertyOptional({type:PointDto}) @IsOptional() @ValidateNested() @Type(()=>PointDto) dropoff?:PointDto;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) tariffId!:string;
}

/** Read-only preview: moving a pin must never create or replace a booking quote. */
@Injectable()
export class MapEstimateService {
  private readonly routes = new Map<string, {expires:number; route:DrivingRoute}>();
  private readonly pending = new Map<string, Promise<DrivingRoute>>();
  constructor(private readonly db:PrismaService, private readonly config:AppConfig,
    private readonly routing:RoutingService, private readonly limits:RateLimits) {}

  private async route(from:Point, to:Point):Promise<DrivingRoute> {
    const key = `${from.latitude},${from.longitude}:${to.latitude},${to.longitude}`;
    const cached = this.routes.get(key);
    if (cached && cached.expires > Date.now()) return cached.route;
    this.routes.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 64) throw new ServiceUnavailableException('Расчёт маршрута занят');
    const request = this.routing.route(from, to, 4000, undefined, {fast:true});
    this.pending.set(key, request);
    try {
      const route = await request;
      if (this.routes.size >= 200) this.routes.delete(this.routes.keys().next().value!);
      this.routes.set(key, {expires:Date.now() + 15000, route});
      return route;
    } finally { this.pending.delete(key); }
  }

  async estimate(actor:Actor, dto:MapEstimateDto) {
    if (actor.role !== 'CLIENT') throw new ForbiddenException('Заказ доступен клиенту');
    await this.limits.take(`map-estimate:${actor.id}`,60,60);
    const tariff = await this.db.tariff.findFirst({where:{id:dto.tariffId,active:true}});
    if (!tariff) throw new NotFoundException('Тариф не найден');
    let trip: {durationMinutes:number; durationSeconds:number; distanceMeters:number; price:number; geometry:DrivingRoute['geometry']} | null = null;
    let commission = 0;
    if (dto.dropoff && haversine(dto.pickup,dto.dropoff) >= 30) {
      try {
        const route = await this.route(dto.pickup,dto.dropoff);
        const fare = calculateFare(tariff,route.distanceMeters,route.durationSeconds);
        commission = fare.commission;
        trip = {durationMinutes:Math.max(1,Math.ceil(route.durationSeconds/60)),durationSeconds:route.durationSeconds,
          distanceMeters:route.distanceMeters,price:fare.price,geometry:route.geometry};
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException)) throw error;
      }
    }
    const now = Date.now(), minimumDeposit = Math.max(this.config.minimumDeposit,commission);
    const profiles = await this.db.driverProfile.findMany({where:{verified:true,online:true,deposit:{gte:minimumDeposit},
      vehicle:{isNot:null},locationMeasuredAt:{gte:new Date(now-IDLE_POSITION_MAX_AGE_MS),lte:new Date(now+5000)},
      locationLatitude:{not:null},locationLongitude:{not:null}}});
    // Dispatch can offer an idle driver's last known position for up to 30 minutes.
    // A missing fresh/accurate fix or failed approach route means ETA is unknown,
    // not that a car is unavailable. Recheck availability even when routes are cached.
    const drivers = profiles.filter(driver => driverCanTake(driver,tariff.kind,tariff.requiredClass)
      && driver.verified && driver.online && driver.deposit >= minimumDeposit
      && driver.locationLatitude != null && Number.isFinite(driver.locationLatitude) && Math.abs(driver.locationLatitude) <= 90
      && driver.locationLongitude != null && Number.isFinite(driver.locationLongitude) && Math.abs(driver.locationLongitude) <= 180
      && driver.locationMeasuredAt && driver.locationMeasuredAt.getTime() >= now-IDLE_POSITION_MAX_AGE_MS && driver.locationMeasuredAt.getTime() <= now+5000);
    if (!drivers.length) return {hasAvailableDrivers:false,pickupEtaMinutes:null,trip};
    const ids = drivers.map(driver => driver.userId);
    const [orders,offers] = await Promise.all([
      this.db.order.findMany({where:{driverId:{in:ids},status:{in:ACTIVE_STATUSES}},select:{driverId:true}}),
      this.db.orderOffer.findMany({where:{driverId:{in:ids},skipped:false,expiresAt:{gt:new Date(now)},order:{status:'SEARCHING'}},select:{driverId:true}}),
    ]);
    const busy = new Set([...orders,...offers].map(item => item.driverId));
    const availableDrivers = drivers.filter(driver => !busy.has(driver.userId));
    const candidates = availableDrivers.filter(driver => driver.locationMeasuredAt!.getTime() >= now-POSITION_MAX_AGE_MS
      && driver.locationAccuracyM != null && driver.locationAccuracyM >= 0 && driver.locationAccuracyM <= 100)
      .map(driver => ({latitude:driver.locationLatitude!,longitude:driver.locationLongitude!,address:'Водитель'}))
      .sort((a,b) => haversine(a,dto.pickup)-haversine(b,dto.pickup)).slice(0,3);
    const arrivals = await Promise.all(candidates.map(async from => {
      try {
        const route = await this.route(from,dto.pickup);
        return Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0 ? route.durationSeconds : null;
      } catch { return null; }
    }));
    const durations = arrivals.filter((value):value is number => value !== null);
    return {hasAvailableDrivers:availableDrivers.length > 0,
      pickupEtaMinutes:durations.length ? Math.max(1,Math.ceil(Math.min(...durations)/60)) : null,trip};
  }
}

@ApiTags('orders') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('orders')
export class MapEstimateController {
  constructor(private readonly estimates:MapEstimateService) {}
  @Post('map-estimate') estimate(@Req() req:{actor:Actor}, @Body() dto:MapEstimateDto) { return this.estimates.estimate(req.actor,dto); }
}
