import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, messageOf } from './api';
import { normalizePoint, Point, Quote, Tariff } from './types';

// Quotes belong to an exact route and account. Never show an old route's price
// while the next request is pending, even before React runs effect cleanup.
export function useRideQuotes(pickup: Point | null, dropoff: Point | null, tariffs: Tariff[], tariffId: string, enabled: boolean, accountId?: string) {
  const routeKey = JSON.stringify({ pickup, dropoff, tariffs: tariffs.map(item => [item.id, item.basePrice, item.pricePerKm, item.pricePerMinute, item.minimumPrice]), accountId });
  const [revision, setRevision] = useState(0);
  const [batch, setBatch] = useState<{ key: string; quotes: Record<string, Quote>; errors: Record<string, string>; refreshAt: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current;
    if (!enabled || !active || !pickup || !dropoff || !tariffs.length) { setPending(false); return; }
    setPending(true);
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled(tariffs.map(tariff => api.post<Quote>('/orders/quote', {
        pickup: normalizePoint(pickup), dropoff: normalizePoint(dropoff), tariffId: tariff.id,
      })));
      if (id !== generation.current) return;
      const quotes: Record<string, Quote> = {}, errors: Record<string, string> = {};
      results.forEach((result, index) => {
        const tariff = tariffs[index].id;
        if (result.status === 'fulfilled') quotes[tariff] = result.value;
        else errors[tariff] = messageOf(result.reason);
      });
      const receivedAt = Date.now();
      const expirations = Object.values(quotes).map(value => new Date(value.expiresAt).getTime()).filter(Number.isFinite);
      // Refresh 30 seconds before expiry; failures and very short quotes wait at
      // least 30 seconds, so an unavailable server cannot cause a request loop.
      const refreshAt = Object.keys(errors).length || !expirations.length
        ? receivedAt + 30000 : Math.max(receivedAt + 30000, Math.min(...expirations) - 30000);
      setBatch(previous => ({ key: routeKey, quotes: {
        ...(previous?.key === routeKey ? previous.quotes : {}), ...quotes,
      }, errors, refreshAt }));
      setPending(false);
      setNow(Date.now());
    }, 450);
    return () => { clearTimeout(timer); ++generation.current; };
  }, [routeKey, enabled, active, revision]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setNow(Date.now());
      setActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!enabled || !active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled, active]);
  const matching = enabled && batch?.key === routeKey ? batch : null;
  useEffect(() => {
    if (active && matching && !pending && now >= matching.refreshAt) setRevision(value => value + 1);
  }, [active, matching, pending, now]);
  const quotes = Object.fromEntries(Object.entries(matching?.quotes || {}).filter(([, value]) => new Date(value.expiresAt).getTime() > now));
  const quote = quotes[tariffId] || null;
  const error = quote || pending ? '' : matching?.errors[tariffId] || '';
  const clear = () => { ++generation.current; setBatch(null); setPending(false); };
  const refresh = () => { clear(); setRevision(value => value + 1); };
  return { quote, quotes, calculating: pending && !quote, quoteError: error, refresh, clear };
}
