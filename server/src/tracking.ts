import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Actor, AuthGuard, RateLimits } from './auth';
import { ASSIGNED_STATUSES } from './domain';
import { PrismaService } from './prisma.service';
import { RealtimeEvents } from './events';

export class TrackingRoadPointDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
}
export class DriverLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) accuracy?: number;
  @IsOptional() @IsInt() @Min(0) timestamp?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(359.999) heading?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) speed?: number;
  @IsOptional() @IsIn([1]) schemaVersion?: 1;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsUUID() assignmentId?: string;
  @IsOptional() @IsInt() @Min(0) measuredAtMs?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) accuracyM?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) speedMps?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(359.999) courseDeg?: number | null;
  @IsOptional() @IsInt() @Min(0) trackingStartedAtMs?: number;
  // The original fields remain accepted while already installed APKs update.
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsUUID() tripId?: string;
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[a-zA-Z0-9_-]+$/) trackingSessionId?: string;
  @IsOptional() @IsInt() @Min(0) trackingStartedAt?: number;
  @IsOptional() @IsInt() @Min(1) sequence?: number;
  @IsOptional() @IsInt() @Min(0) measuredAt?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(359.999) bearingDeg?: number;
  @IsOptional() @IsInt() @Min(0) routeIndex?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) routeProgress?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10000) distanceToRoute?: number;
  @IsOptional() @IsIn([true, false]) matched?: boolean;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(128)
  @ValidateNested({ each: true }) @Type(() => TrackingRoadPointDto) matchedPath?: { latitude: number; longitude: number }[];
}
export type DriverFix = DriverLocationDto & {
  driverId: string;
  timestamp: number;
  accuracy: number | null;
  receivedAt: number;
  receivedAtMs?: number;
  stateVersion?: number;
};

type NormalizedDriverLocation = DriverLocationDto & {
  timestamp: number;
  accuracy: number | null;
  measuredAtMs: number;
  accuracyM: number | null;
  speedMps: number | null;
  courseDeg: number | null;
};

export function normalizeDriverLocation(dto: DriverLocationDto, orderId: string, now = Date.now()): NormalizedDriverLocation {
  const v1 = dto.schemaVersion === 1;
  if (v1) {
    if (dto.orderId !== orderId || !dto.assignmentId || !dto.trackingSessionId || dto.sequence == null
      || dto.measuredAtMs == null || !Object.hasOwn(dto, 'accuracyM') || !Object.hasOwn(dto, 'speedMps') || !Object.hasOwn(dto, 'courseDeg'))
      throw new BadRequestException('Неполный пакет координат водителя');
    if (dto.driverId != null || dto.tripId != null || dto.timestamp != null || dto.accuracy != null
      || dto.heading != null || dto.speed != null || dto.measuredAt != null || dto.bearingDeg != null
      || dto.trackingStartedAt != null) throw new BadRequestException('В пакете координат смешаны версии полей');
  } else if (dto.timestamp == null || dto.accuracy == null) {
    throw new BadRequestException('Неполный пакет координат водителя');
  }
  const measuredAtMs = v1 ? dto.measuredAtMs! : dto.measuredAt ?? dto.timestamp!;
  const accuracyM = v1 ? dto.accuracyM! : dto.accuracyM ?? dto.accuracy!;
  const speedMps = v1 ? dto.speedMps! : dto.speedMps ?? dto.speed ?? null;
  const courseDeg = v1 ? dto.courseDeg! : dto.bearingDeg ?? dto.heading ?? null;
  const trackingStartedAtMs = v1 ? dto.trackingStartedAtMs : dto.trackingStartedAt;
  if (!Number.isFinite(measuredAtMs) || !Number.isInteger(measuredAtMs)
    || !Number.isFinite(dto.latitude) || !Number.isFinite(dto.longitude)
    || (accuracyM !== null && !Number.isFinite(accuracyM))
    || (speedMps !== null && !Number.isFinite(speedMps))
    || (courseDeg !== null && !Number.isFinite(courseDeg))) throw new BadRequestException('Некорректные координаты водителя');
  if (now - measuredAtMs > 15000 || measuredAtMs > now + 5000) throw new BadRequestException('Координаты устарели');
  if (trackingStartedAtMs != null && trackingStartedAtMs > measuredAtMs + 5000) throw new BadRequestException('Неверное время сессии координат');
  return {
    ...dto, measuredAtMs, measuredAt: measuredAtMs, timestamp: measuredAtMs,
    accuracyM, accuracy: accuracyM, speedMps, courseDeg,
    ...(speedMps == null ? {} : { speed: speedMps }),
    ...(courseDeg == null ? {} : { heading: courseDeg, bearingDeg: courseDeg }),
    ...(trackingStartedAtMs == null ? {} : { trackingStartedAtMs, trackingStartedAt: trackingStartedAtMs }),
  };
}
export function visibleDriverLocation(order: { status: string; driverId: string | null; driverLocation?: unknown }, now = Date.now()): DriverFix | null {
  const fix = order.driverLocation as DriverFix | null;
  if (!ASSIGNED_STATUSES.includes(order.status as any) || !order.driverId || !fix || fix.driverId !== order.driverId
    || !Number.isFinite(fix.timestamp) || fix.timestamp > now + 5000) return null;
  return fix;
}

export function isNewDriverFix(previous: DriverFix | null, incoming: DriverLocationDto, now = Date.now()): boolean {
  if (!previous) return true;
  const measuredAt = incoming.measuredAtMs ?? incoming.measuredAt ?? incoming.timestamp;
  const previousMeasuredAt = previous.measuredAtMs ?? previous.measuredAt ?? previous.timestamp;
  // An older measurement cannot become current just because it was delivered late.
  if (measuredAt == null || measuredAt <= previousMeasuredAt) return false;
  if (!incoming.trackingSessionId || !incoming.sequence) {
    // Legacy packets may resume a legacy stream after a gap, but can never
    // take ownership back from a versioned stream in the same assignment.
    return previous.schemaVersion !== 1 && (!previous.trackingSessionId || now - previous.receivedAt > 15000);
  }
  if (previous.schemaVersion === 1 && incoming.schemaVersion !== 1) return false;
  if (incoming.trackingSessionId === previous.trackingSessionId) return incoming.sequence > (previous.sequence ?? 0);
  // A new process/session can arrive after its first packet was lost. Its
  // start time distinguishes it from late packets of the retired process.
  const startedAt = incoming.trackingStartedAtMs ?? incoming.trackingStartedAt;
  const previousStartedAt = previous.trackingStartedAtMs ?? previous.trackingStartedAt;
  if (startedAt != null && previousStartedAt != null) return startedAt > previousStartedAt;
  if (!previous.trackingSessionId) return true;
  return incoming.sequence === 1 || now - previous.receivedAt > 15000;
}

export function plausibleDriverFix(previous: DriverFix | null, incoming: DriverLocationDto): boolean {
  if (!previous) return true;
  const at = incoming.measuredAtMs ?? incoming.measuredAt ?? incoming.timestamp ?? 0;
  const elapsed = Math.max(0, (at - previous.timestamp) / 1000);
  if (elapsed > 30) return true;
  const latM = (incoming.latitude - previous.latitude) * 111_195;
  const lonM = (incoming.longitude - previous.longitude) * 111_195 * Math.cos(incoming.latitude * Math.PI / 180);
  const allowance = 35 + elapsed * 55 + Math.min(60, (incoming.accuracyM ?? incoming.accuracy ?? 0) + (previous.accuracyM ?? previous.accuracy ?? 0));
  return Math.hypot(latM, lonM) <= allowance;
}

@Injectable()
export class TrackingService {
  private readonly live = new Map<string, DriverFix>();
  private readonly persistedAt = new Map<string, number>();
  constructor(private readonly db: PrismaService, private readonly events: RealtimeEvents, private readonly limits: RateLimits) {}
  async get(actor: Actor, id: string) {
    const order = await this.db.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.clientId !== actor.id && order.driverId !== actor.id) throw new ForbiddenException('Нет доступа к положению водителя');
    const assignment = order.driverId && ASSIGNED_STATUSES.includes(order.status)
      ? await this.db.statusHistory.findFirst({ where: { orderId: id, status: 'ASSIGNED', actorId: order.driverId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      : null;
    const cached = this.live.get(id);
    const persisted = order.driverLocation as DriverFix | null;
    const location = visibleDriverLocation({ ...order, driverLocation: cached?.driverId === order.driverId && cached.assignmentId === assignment?.id
      ? cached : persisted && (!persisted.assignmentId || persisted.assignmentId === assignment?.id) ? persisted : null });
    return { orderId: id, assignmentId: assignment?.id ?? null, driverId: order.driverId, status: order.status,
      serverTimeMs: Date.now(), stateVersion: location?.stateVersion ?? 0, location };
  }
  async update(actor: Actor, id: string, dto: DriverLocationDto) {
    if (actor.role !== 'DRIVER') throw new ForbiddenException('Только назначенный водитель передаёт положение');
    const now = Date.now();
    if (dto.driverId && dto.driverId !== actor.id) throw new ForbiddenException('Чужое положение водителя');
    if (dto.tripId && dto.tripId !== id) throw new BadRequestException('Неверная поездка для координат');
    if (dto.orderId && dto.orderId !== id) throw new BadRequestException('Неверный заказ для координат');
    if (dto.schemaVersion !== 1) {
      if (dto.measuredAt != null && dto.measuredAt !== dto.timestamp) throw new BadRequestException('Время измерения не совпадает');
      if (dto.accuracyM != null && dto.accuracyM !== dto.accuracy) throw new BadRequestException('Точность измерения не совпадает');
      if (dto.speedMps != null && dto.speedMps !== dto.speed) throw new BadRequestException('Скорость измерения не совпадает');
      if (dto.bearingDeg != null && dto.bearingDeg !== dto.heading) throw new BadRequestException('Направление измерения не совпадает');
    }
    if ((dto.trackingSessionId == null) !== (dto.sequence == null)) throw new BadRequestException('Неполная последовательность координат');
    if (dto.trackingStartedAt != null && !dto.trackingSessionId) throw new BadRequestException('Не указана сессия координат');
    const incoming = normalizeDriverLocation(dto, id, now);
    await this.limits.take(`driver-location:${actor.id}`, 90, 60);
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id"=${id}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.driverId !== actor.id || !ASSIGNED_STATUSES.includes(order.status)) throw new ForbiddenException('Передача положения для этого заказа завершена');
      const assignment = await tx.statusHistory.findFirst({ where: { orderId: id, status: 'ASSIGNED', actorId: actor.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      if (!assignment) throw new ForbiddenException('Назначение водителя не найдено');
      if (dto.schemaVersion === 1 && dto.assignmentId !== assignment.id) throw new ForbiddenException('Назначение водителя изменилось');
      const cached = this.live.get(id);
      const persisted = order.driverLocation as DriverFix | null;
      const previous = visibleDriverLocation({ ...order,
        driverLocation: cached?.driverId === actor.id && cached.assignmentId === assignment.id ? cached
          : persisted && (!persisted.assignmentId || persisted.assignmentId === assignment.id) ? persisted : null }, now);
      const fresh = isNewDriverFix(previous, incoming, now) && plausibleDriverFix(previous, incoming);
      const location: DriverFix = fresh
        ? { ...incoming, orderId: id, assignmentId: assignment.id, driverId: actor.id,
          receivedAt: now, receivedAtMs: now, stateVersion: (previous?.stateVersion ?? 0) + 1 }
        : previous!;
      // A hot trip is held in process memory; SQL is a recovery checkpoint,
      // not a one-write-per-GPS-fix event stream. Assignment/status are still
      // checked in the transaction before each accepted update.
      if (fresh) {
        this.live.set(id, location);
        if (this.live.size > 10000) this.live.delete(this.live.keys().next().value!);
        if (now - (this.persistedAt.get(id) ?? 0) >= 10_000) {
          await tx.order.update({ where: { id }, data: { driverLocation: { ...location }, updatedAt: order.updatedAt } });
          this.persistedAt.set(id, now);
        }
      }
      return { clientId: order.clientId, fresh, payload: { orderId: id, assignmentId: assignment.id, driverId: actor.id,
        status: order.status, stateVersion: location.stateVersion ?? 0, location }, pickup: order.pickup, dropoff: order.dropoff };
    });
    const payload = { ...result.payload, serverTimeMs: Date.now() };
    if (result.fresh) {
      this.events.publish([result.clientId], 'driver:location', payload);
      const fix = result.payload.location;
      this.events.publishOrder(id, 'driver:location:update', { ...payload,
        lat: fix.latitude, lng: fix.longitude, bearing: fix.courseDeg ?? fix.heading ?? null,
        speed: fix.speedMps ?? fix.speed ?? null, accuracy: fix.accuracyM ?? fix.accuracy,
        timestamp: fix.measuredAtMs ?? fix.timestamp, seq: fix.sequence ?? null,
        routeIndex: fix.routeIndex ?? null, routeProgress: fix.routeProgress ?? null,
        distanceToRoute: fix.distanceToRoute ?? null, matched: fix.matched ?? false });
    }
    return { ...payload, pickup: result.pickup, dropoff: result.dropoff };
  }
}

@UseGuards(AuthGuard) @Controller('orders')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}
  @Get(':id/driver-location') @Header('Cache-Control', 'private, no-store')
  get(@Req() req: { actor: Actor }, @Param('id', ParseUUIDPipe) id: string) { return this.tracking.get(req.actor, id); }
  @Patch(':id/driver-location') @Header('Cache-Control', 'private, no-store')
  update(@Req() req: { actor: Actor }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DriverLocationDto) { return this.tracking.update(req.actor, id, dto); }
}
