import { useEffect, useState } from 'react';
import type { Order } from './types';

export function waitingAt(order: Order | null | undefined, now = Date.now()) {
  const policy = order?.waiting;
  if (!order || order.status !== 'ARRIVED' || !policy?.arrivedAt) return null;
  const arrivedAt = Date.parse(policy.arrivedAt);
  if (!Number.isFinite(arrivedAt)) return null;
  const graceEnd = arrivedAt + policy.graceMinutes * 60000;
  const freeEnd = graceEnd + policy.freeMinutes * 60000;
  const phase = now < graceEnd ? 'BEFORE_FREE' : now < freeEnd ? 'FREE' : 'PAID';
  const remainingSeconds = Math.max(0, Math.ceil(((phase === 'BEFORE_FREE' ? graceEnd : freeEnd) - now) / 1000));
  const billedMinutes = Math.max(0, Math.ceil((now - freeEnd) / 60000));
  const charge = billedMinutes * policy.pricePerMinute;
  return { phase, remainingSeconds, billedMinutes, charge, totalPrice: (order.basePrice ?? order.price) + charge };
}

export function waitingClock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function useWaiting(order: Order | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (order?.status !== 'ARRIVED' || !order.waiting?.arrivedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [order?.status, order?.waiting?.arrivedAt]);
  return waitingAt(order, now);
}
