import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { normalizePoint, type Coordinate, type Point } from './types';

export type MapEstimate = {
  hasAvailableDrivers?: boolean;
  pickupEtaMinutes: number | null;
  trip: { durationMinutes: number; price: number; distanceMeters: number; durationSeconds: number; geometry: Coordinate[] } | null;
};

export function usePickupAvailability(estimate: MapEstimate | null, pickup: Point | null, tariffId: string, enabled: boolean, accountId?: string): 'unknown' | 'available' | 'unavailable' {
  const key = JSON.stringify([accountId, tariffId, pickup?.latitude, pickup?.longitude]);
  const [received, setReceived] = useState<{ key: string; available: boolean; at: number } | null>(null);
  useEffect(() => {
    if (enabled && pickup && typeof estimate?.hasAvailableDrivers === 'boolean') {
      setReceived({ key, available: estimate.hasAvailableDrivers, at: Date.now() });
    }
  }, [estimate, key, enabled]);
  if (!enabled || !pickup) return 'unknown';
  const available = typeof estimate?.hasAvailableDrivers === 'boolean' ? estimate.hasAvailableDrivers
    : received?.key === key && Date.now() - received.at < 30_000 ? received.available : undefined;
  return available === undefined ? 'unknown' : available ? 'available' : 'unavailable';
}

/** Destination edits must not erase the still current estimate at the committed pickup. */
export function usePickupEta(estimate: MapEstimate | null, pickup: Point | null, tariffId: string, enabled: boolean, accountId?: string) {
  const key = JSON.stringify([accountId, tariffId, pickup?.latitude, pickup?.longitude]);
  const [received, setReceived] = useState<{ key: string; eta: number | null; at: number } | null>(null);
  useEffect(() => {
    if (enabled && pickup && estimate) setReceived({ key, eta: estimate.pickupEtaMinutes, at: Date.now() });
  }, [estimate, key, enabled]);
  if (!enabled || !pickup) return undefined;
  if (estimate) return estimate.pickupEtaMinutes;
  return received?.key === key && Date.now() - received.at < 30_000 ? received.eta : undefined;
}

/** Map previews never create a bookable quote, and never reuse a different point's estimate. */
export function useMapEstimate(pickup: Point | null, dropoff: Point | null, tariffId: string, enabled: boolean, accountId?: string) {
  const key = JSON.stringify([accountId, tariffId, pickup?.latitude, pickup?.longitude, dropoff?.latitude, dropoff?.longitude]);
  const [result, setResult] = useState<{ key: string; value: MapEstimate } | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    setResult(null);
    if (!enabled || !active || !pickup || !tariffId) return;
    let live = true;
    let controller: AbortController | null = null;
    const request = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void api.post<MapEstimate>('/orders/map-estimate', {
        pickup: normalizePoint(pickup), ...(dropoff ? { dropoff: normalizePoint(dropoff) } : {}), tariffId,
      }, { signal: current.signal }).then(value => {
        if (live && !current.signal.aborted) setResult({ key, value });
      }).catch(() => {
        if (live && !current.signal.aborted) setResult(null);
      });
    };
    const debounce = setTimeout(request, 450);
    const refresh = setInterval(request, 30_000);
    return () => { live = false; clearTimeout(debounce); clearInterval(refresh); controller?.abort(); };
  }, [key, enabled, active]);
  return enabled && active && result?.key === key ? result.value : null;
}
