import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, IsUUID } from 'class-validator';
import { Actor, AuthGuard, RateLimits } from './auth';
import { ASSIGNED_STATUSES } from './domain';
import { PrismaService } from './prisma.service';
import { RealtimeEvents } from './events';

export class DriverLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsNumber() @Min(0) @Max(100) accuracy!: number;
  @IsNumber() @Min(0) timestamp!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(359.999) heading?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) speed?: number;
  // The original fields remain accepted while already installed APKs update.
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsUUID() tripId?: string;
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[a-zA-Z0-9_-]+$/) trackingSessionId?: string;
  @IsOptional() @IsNumber() @Min(0) trackingStartedAt?: number;
  @IsOptional() @IsInt() @Min(1) sequence?: number;
  @IsOptional() @IsNumber() @Min(0) measuredAt?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) accuracyM?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) speedMps?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(359.999) bearingDeg?: number;
}
export type DriverFix = DriverLocationDto & { driverId: string; receivedAt: number };
export function visibleDriverLocation(order: { status: string; driverId: string | null; driverLocation?: unknown }, now = Date.now()): DriverFix | null {
  const fix = order.driverLocation as DriverFix | null;
  if (!ASSIGNED_STATUSES.includes(order.status as any) || !order.driverId || !fix || fix.driverId !== order.driverId
    || !Number.isFinite(fix.timestamp) || fix.timestamp > now + 5000) return null;
  return fix;
}

export function isNewDriverFix(previous: DriverFix | null, incoming: DriverLocationDto, now = Date.now()): boolean {
  if (!previous) return true;
  const measuredAt = incoming.measuredAt ?? incoming.timestamp;
  const previousMeasuredAt = previous.measuredAt ?? previous.timestamp;
  // An older measurement cannot become current just because it was delivered late.
  if (measuredAt <= previousMeasuredAt) return false;
  if (!incoming.trackingSessionId || !incoming.sequence) {
    // Older APKs can resume after a newer stream really stops, but cannot
    // interleave with its live sequence during a rolling client update.
    return !previous.trackingSessionId || now - previous.receivedAt > 15000;
  }
  if (incoming.trackingSessionId === previous.trackingSessionId) return incoming.sequence > (previous.sequence ?? 0);
  // A new process/session can arrive after its first packet was lost. Its
  // start time distinguishes it from late packets of the retired process.
  if (incoming.trackingStartedAt != null && previous.trackingStartedAt != null)
    return incoming.trackingStartedAt > previous.trackingStartedAt;
  if (!previous.trackingSessionId) return true;
  return incoming.sequence === 1 || now - previous.receivedAt > 15000;
}

@Injectable()
export class TrackingService {
  constructor(private readonly db: PrismaService, private readonly events: RealtimeEvents, private readonly limits: RateLimits) {}
  async get(actor: Actor, id: string) {
    const order = await this.db.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.clientId !== actor.id && order.driverId !== actor.id) throw new ForbiddenException('Нет доступа к положению водителя');
    return { orderId: id, driverId: order.driverId, status: order.status, location: visibleDriverLocation(order) };
  }
  async update(actor: Actor, id: string, dto: DriverLocationDto) {
    if (actor.role !== 'DRIVER') throw new ForbiddenException('Только назначенный водитель передаёт положение');
    const now = Date.now();
    if (dto.driverId && dto.driverId !== actor.id) throw new ForbiddenException('Чужое положение водителя');
    if (dto.tripId && dto.tripId !== id) throw new BadRequestException('Неверная поездка для координат');
    if (dto.measuredAt != null && dto.measuredAt !== dto.timestamp) throw new BadRequestException('Время измерения не совпадает');
    if (dto.accuracyM != null && dto.accuracyM !== dto.accuracy) throw new BadRequestException('Точность измерения не совпадает');
    if (dto.speedMps != null && dto.speedMps !== dto.speed) throw new BadRequestException('Скорость измерения не совпадает');
    if (dto.bearingDeg != null && dto.bearingDeg !== dto.heading) throw new BadRequestException('Направление измерения не совпадает');
    if ((dto.trackingSessionId == null) !== (dto.sequence == null)) throw new BadRequestException('Неполная последовательность координат');
    if (dto.trackingStartedAt != null && !dto.trackingSessionId) throw new BadRequestException('Не указана сессия координат');
    if (now - dto.timestamp > 15000 || dto.timestamp > now + 5000) throw new BadRequestException('Координаты устарели');
    await this.limits.take(`driver-location:${actor.id}`, 90, 60);
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id"=${id}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.driverId !== actor.id || !ASSIGNED_STATUSES.includes(order.status)) throw new ForbiddenException('Передача положения для этого заказа завершена');
      const previous = visibleDriverLocation(order, now);
      const fresh = isNewDriverFix(previous, dto, now);
      const location: DriverFix = fresh ? { ...dto, driverId: actor.id, receivedAt: now } : previous!;
      // Keep the order's status version separate from high-frequency GPS updates.
      if (fresh) await tx.order.update({ where: { id }, data: { driverLocation: { ...location }, updatedAt: order.updatedAt } });
      return { clientId: order.clientId, fresh, payload: { orderId: id, driverId: actor.id, status: order.status, location }, pickup: order.pickup, dropoff: order.dropoff };
    });
    if (result.fresh) this.events.publish([result.clientId], 'driver:location', result.payload);
    return { ...result.payload, pickup: result.pickup, dropoff: result.dropoff };
  }
}

@UseGuards(AuthGuard) @Controller('orders')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}
  @Get(':id/driver-location') get(@Req() req: { actor: Actor }, @Param('id', ParseUUIDPipe) id: string) { return this.tracking.get(req.actor, id); }
  @Patch(':id/driver-location') update(@Req() req: { actor: Actor }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DriverLocationDto) { return this.tracking.update(req.actor, id, dto); }
}
