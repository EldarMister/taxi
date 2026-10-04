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
  @IsOptional() @IsNumber() @Min(0) @Max(100) accuracy?: number | null;
  @IsOptional() @IsInt() @Min(0) timestamp?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(359.999) heading?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) speed?: number;
  @IsOptional() @IsIn([1]) schemaVersion?: 1;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsUUID() assignmentId?: string;
  @IsOptional() @IsInt() @Min(0) measuredAtMs?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) accuracyM?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) speedMps?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(360) courseDeg?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(180) courseAccuracyDeg?: number | null;
  @IsOptional() @IsIn(['gps', 'displacement']) courseSource?: 'gps' | 'displacement' | null;
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
  courseAccuracyDeg: number | null;
  courseSource: 'gps' | 'displacement' | null;
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
  // Course is clockwise from true north, never the device compass. Old
  // senders cannot provide a quality estimate, so absence stays explicit.
  const courseAccuracyDeg = dto.courseAccuracyDeg ?? null;
  const courseSource = dto.courseSource ?? null;
  const trackingStartedAtMs = v1 ? dto.trackingStartedAtMs : dto.trackingStartedAt;
  if (!Number.isFinite(measuredAtMs) || !Number.isInteger(measuredAtMs)
    || measuredAtMs < 0 || !Number.isFinite(dto.latitude) || Math.abs(dto.latitude) > 90
    || !Number.isFinite(dto.longitude) || Math.abs(dto.longitude) > 180
    || (accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 1000))
    || (speedMps !== null && (!Number.isFinite(speedMps) || speedMps < 0 || speedMps > 100))
    || (courseDeg !== null && (!Number.isFinite(courseDeg) || courseDeg < 0 || courseDeg >= 360))
    || (courseAccuracyDeg !== null && (!Number.isFinite(courseAccuracyDeg) || courseAccuracyDeg < 0 || courseAccuracyDeg > 180))
    || (courseSource !== null && courseSource !== 'gps' && courseSource !== 'displacement'))
    throw new BadRequestException('Некорректные координаты водителя');
  if (courseDeg == null && (courseAccuracyDeg != null || courseSource != null))
    throw new BadRequestException('Для качества направления не указан курс');
  if (now - measuredAtMs > 15000 || measuredAtMs > now + 5000) throw new BadRequestException('Координаты устарели');
  if (trackingStartedAtMs != null && trackingStartedAtMs > measuredAtMs + 5000) throw new BadRequestException('Неверное время сессии координат');
  return {
    ...dto, measuredAtMs, measuredAt: measuredAtMs, timestamp: measuredAtMs,
    accuracyM, accuracy: accuracyM, speedMps, courseDeg, courseAccuracyDeg, courseSource,
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
  // A new process/session can arrive after its first packet was lost. Its
  // start time distinguishes it from late packets of the retired process.
  const startedAt = incoming.trackingStartedAtMs ?? incoming.trackingStartedAt;
  const previousStartedAt = previous.trackingStartedAtMs ?? previous.trackingStartedAt;
  if (incoming.trackingSessionId === previous.trackingSessionId) {
    if (startedAt != null && previousStartedAt != null && startedAt !== previousStartedAt) return false;
    return incoming.sequence > (previous.sequence ?? 0);
  }
  // Once a versioned stream owns an assignment, a delayed sequence=1
  // without a session start must never resurrect a retired process.
  if (previous.schemaVersion === 1) return startedAt != null && startedAt > (previousStartedAt ?? previousMeasuredAt);
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
  // Rejected relocation candidates are short-lived confirmation state, never
  // visible positions. Losing them on restart only requires another good fix.
  private readonly relocationCandidates = new Map<string, { location: DriverFix; baseTimestamp: number; recordedAt: number }>();
  constructor(private readonly db: PrismaService, private readonly events: RealtimeEvents, private readonly limits: RateLimits) {}
  async get(actor: Actor, id: string) {
    const order = await this.db.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.clientId !== actor.id && order.driverId !== actor.id) throw new ForbiddenException('Нет доступа к положению водителя');
    const assignment = order.driverId && ASSIGNED_STATUSES.includes(order.status)
      ? await this.db.statusHistory.findFirst({ where: { orderId: id, status: 'ASSIGNED', actorId: order.driverId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      : null;
    const persisted = order.driverLocation as DriverFix | null;
    const location = visibleDriverLocation({ ...order,
      driverLocation: persisted && (!persisted.assignmentId || persisted.assignmentId === assignment?.id) ? persisted : null });
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
      const persisted = order.driverLocation as DriverFix | null;
      const previous = visibleDriverLocation({ ...order,
        driverLocation: persisted && (!persisted.assignmentId || persisted.assignmentId === assignment.id) ? persisted : null }, now);
      const ordered = isNewDriverFix(previous, incoming, now);
      let plausible = plausibleDriverFix(previous, incoming);
      let pendingRelocation: { location: DriverFix; baseTimestamp: number; recordedAt: number } | undefined;
      const precise = incoming.accuracyM != null && incoming.accuracyM <= 25;
      if (ordered && previous && !plausible && precise) {
        const candidate = this.relocationCandidates.get(id);
        const elapsed = candidate ? incoming.measuredAtMs - candidate.location.timestamp : 0;
        plausible = !!candidate && now - candidate.recordedAt <= 10_000
          && candidate.baseTimestamp === previous.timestamp
          && candidate.location.assignmentId === assignment.id && candidate.location.driverId === actor.id
          && candidate.location.trackingSessionId === incoming.trackingSessionId
          && elapsed >= 800 && elapsed <= 10_000
          && isNewDriverFix(candidate.location, incoming, now)
          && plausibleDriverFix(candidate.location, incoming);
        if (!plausible && (!candidate || incoming.measuredAtMs > candidate.location.timestamp)) {
          pendingRelocation = { location: { ...incoming, orderId: id, assignmentId: assignment.id,
            driverId: actor.id, receivedAt: now }, baseTimestamp: previous.timestamp, recordedAt: now };
        }
      }
      const fresh = ordered && plausible;
      const location: DriverFix = fresh
        ? { ...incoming, orderId: id, assignmentId: assignment.id, driverId: actor.id,
          receivedAt: now, receivedAtMs: now, stateVersion: (previous?.stateVersion ?? 0) + 1 }
        : previous!;
      // Persist the accepted ordering watermark with the fix before publishing.
      // A process restart/reconnect must not roll stateVersion or a session back
      // to a ten-second checkpoint. No in-memory point can survive a rollback.
      if (fresh) {
        await tx.order.update({ where: { id }, data: { driverLocation: { ...location }, updatedAt: order.updatedAt } });
      }
      return { clientId: order.clientId, fresh, pendingRelocation, clearRelocation: fresh || ordered && !precise,
        payload: { orderId: id, assignmentId: assignment.id, driverId: actor.id,
        status: order.status, stateVersion: location.stateVersion ?? 0, location }, pickup: order.pickup, dropoff: order.dropoff };
    });
    if (result.clearRelocation) this.relocationCandidates.delete(id);
    else if (result.pendingRelocation) {
      this.relocationCandidates.set(id, result.pendingRelocation);
      if (this.relocationCandidates.size > 1000) this.relocationCandidates.delete(this.relocationCandidates.keys().next().value!);
    }
    const payload = { ...result.payload, serverTimeMs: Date.now() };
    if (result.fresh) {
      this.events.publish([result.clientId], 'driver:location', payload);
      const fix = result.payload.location;
      this.events.publishOrder(id, 'driver:location:update', { ...payload,
        lat: fix.latitude, lng: fix.longitude, bearing: fix.courseDeg ?? fix.heading ?? null,
        speed: fix.speedMps ?? fix.speed ?? null, accuracy: fix.accuracyM ?? fix.accuracy,
        courseAccuracyDeg: fix.courseAccuracyDeg ?? null, courseSource: fix.courseSource ?? null,
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
