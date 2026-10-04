import type { Language, Order } from './types';

export type DriverHistoryPeriod = 'today' | 'week' | 'month';
export type HistoryRange = { from: string; to: string };
export type HistoryBucket = HistoryRange & { key: string; lastDay: string; amount: number };
const DAY = 86_400_000;
const BISHKEK_OFFSET = 6 * 3_600_000;

// The API groups history by creation date in Bishkek, regardless of device timezone.
export function historyDay(value: Date | string = new Date()): string {
  return new Date(new Date(value).getTime() + BISHKEK_OFFSET).toISOString().slice(0, 10);
}
export function shiftHistoryDay(day: string, count: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}
export function historyBoundary(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - BISHKEK_OFFSET).toISOString();
}
export function historyRange(period: DriverHistoryPeriod, day: string): HistoryRange {
  const first = period === 'today' ? day : period === 'week' ? shiftHistoryDay(day, -6) : `${day.slice(0, 7)}-01`;
  const end = period !== 'month' ? shiftHistoryDay(day, 1) : new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1, 12)).toISOString().slice(0, 10);
  return { from: historyBoundary(first), to: historyBoundary(end) };
}
export function historyChartRange(period: DriverHistoryPeriod, day: string): HistoryRange {
  return period === 'today'
    ? { from: historyBoundary(shiftHistoryDay(day, -6)), to: historyBoundary(shiftHistoryDay(day, 2)) }
    : historyRange(period, day);
}
export function ordersInHistoryRange(orders: Order[], range: HistoryRange): Order[] {
  const start = Date.parse(range.from), end = Date.parse(range.to);
  return orders.filter(order => { const at = Date.parse(order.createdAt); return at >= start && at < end; });
}
export function historyTotals(orders: Order[]) {
  const completed = orders.filter(order => order.status === 'COMPLETED');
  return completed.reduce((total, order) => {
    const price = Number(order.price);
    total.income += price;
    total[order.paymentMethod === 'CARD' ? 'card' : 'cash'] += price;
    total.commission += Number(order.commissionAmount ?? 0);
    return total;
  }, { income: 0, card: 0, cash: 0, bonus: 0, commission: 0, count: completed.length });
}
export function historyBuckets(orders: Order[], period: DriverHistoryPeriod, day: string): HistoryBucket[] {
  const range = historyChartRange(period, day);
  const first = historyDay(range.from), end = historyDay(range.to);
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / DAY);
  const count = period === 'month' ? 8 : days;
  return Array.from({ length: count }, (_, index) => {
    const key = shiftHistoryDay(first, Math.floor(index * days / count));
    const next = shiftHistoryDay(first, Math.floor((index + 1) * days / count));
    const bucket = { from: historyBoundary(key), to: historyBoundary(next) };
    return { ...bucket, key, lastDay: shiftHistoryDay(next, -1), amount: historyTotals(ordersInHistoryRange(orders, bucket)).income };
  });
}
export function historyLocale(language: Language): string {
  return language === 'en' ? 'en-US' : language === 'ky' ? 'ky-KG' : 'ru-RU';
}
export function historyDateLabel(day: string, language: Language, short = false): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(historyLocale(language), { timeZone: 'UTC', day: 'numeric', month: short ? 'short' : 'long' });
}
export function historyPeriodLabel(period: DriverHistoryPeriod, day: string, language: Language): string {
  if (period === 'today') return historyDateLabel(day, language);
  if (period === 'month') return new Date(`${day}T12:00:00Z`).toLocaleDateString(historyLocale(language), { timeZone: 'UTC', month: 'long', year: 'numeric' });
  return `${historyDateLabel(shiftHistoryDay(day, -6), language)} – ${historyDateLabel(day, language)}`;
}
export function historyOrderCount(count: number, language: Language): string {
  if (language === 'en') return `${count} ${count === 1 ? 'order' : 'orders'}`;
  if (language === 'ky') return `${count} буюртма`;
  const last = count % 10, lastTwo = count % 100;
  return `${count} ${lastTwo >= 11 && lastTwo <= 14 ? 'заказов' : last === 1 ? 'заказ' : last >= 2 && last <= 4 ? 'заказа' : 'заказов'}`;
}
