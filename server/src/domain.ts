import { OrderStatus, Role } from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
export interface Point { latitude: number; longitude: number; address: string }
export const ACTIVE_STATUSES: OrderStatus[] = ['SEARCHING','ASSIGNED','ARRIVED','IN_PROGRESS'];
export const ASSIGNED_STATUSES: OrderStatus[] = ['ASSIGNED','ARRIVED','IN_PROGRESS'];
export function haversine(a: Pick<Point,'latitude'|'longitude'>, b: Pick<Point,'latitude'|'longitude'>) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude-a.latitude)*rad, dLon = (b.longitude-a.longitude)*rad;
  const h = Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;
  return Math.round(6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h))));
}
export function calculateFare(tariff: {basePrice:number;pricePerKm:number;pricePerMinute:number;minimumPrice:number;commissionBps:number}, distance:number,duration:number) {
  if (!Number.isFinite(distance) || !Number.isFinite(duration) || distance < 1 || duration < 1 || distance > 500000 || duration > 86400) throw new BadRequestException('Маршрут недоступен или слишком длинный');
  const price = Math.max(tariff.minimumPrice,Math.ceil(tariff.basePrice+distance/1000*tariff.pricePerKm+duration/60*tariff.pricePerMinute));
  return {price, commission:Math.ceil(price*tariff.commissionBps/10000)};
}
export function assertDriverTransition(role:Role,from:OrderStatus,to:OrderStatus) {
  if (role !== 'DRIVER') throw new ForbiddenException('Действие доступно водителю');
  const transitions:Partial<Record<OrderStatus,OrderStatus>> = {ASSIGNED:'ARRIVED',ARRIVED:'IN_PROGRESS',IN_PROGRESS:'COMPLETED'};
  if (transitions[from] !== to) throw new BadRequestException('Недопустимый переход статуса поездки');
}
export function historySince(period:string, now = new Date()) {
  if (period === 'all') return undefined;
  // Business timezone is Bishkek (UTC+6), independent of server/container timezone.
  const local = new Date(now.getTime()+6*3600000);
  const midnight = Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-6*3600000;
  return new Date(midnight - (period === 'week' ? 6*86400000 : 0));
}
