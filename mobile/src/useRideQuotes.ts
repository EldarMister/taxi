import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, messageOf } from './api';
import { normalizePoint, Point, Quote, Tariff } from './types';

type QuoteBatch = {
  requestKey: string;
  priceKey: string;
  displayQuotes: Record<string, Quote>;
  validQuotes: Record<string, Quote>;
  localExpiry: Record<string, number>;
  errors: Record<string, string>;
  refreshAt: number;
};

// Measure server TTL from the phone's receipt time. Different device clocks
// must not make a newly returned quote look expired.
function localExpiry(quote: Quote, receivedAt: number): number {
  const expires = Date.parse(quote.expiresAt);
  const created = quote.createdAt ? Date.parse(quote.createdAt) : NaN;
  const serverTtl = expires - created;
  const remaining = expires - receivedAt;
  const ttl = Number.isFinite(serverTtl) && serverTtl > 0 && serverTtl <= 600_000
    ? serverTtl : Number.isFinite(remaining) && remaining > 0 && remaining <= 600_000 ? remaining : 240_000;
  return receivedAt + ttl;
}

// Address text is part of the server quote and order, but changing only that
// text must not make an unchanged route price disappear while it refreshes.
export function useRideQuotes(pickup: Point | null, dropoff: Point | null, tariffs: Tariff[], tariffId: string, enabled: boolean, accountId?: string) {
  const priceKey = JSON.stringify({
    pickup: pickup && [pickup.latitude, pickup.longitude],
    dropoff: dropoff && [dropoff.latitude, dropoff.longitude],
    tariffs: tariffs.map(item => [item.id, item.basePrice, item.pricePerKm, item.pricePerMinute, item.minimumPrice]),
    accountId,
  });
  const requestKey = JSON.stringify({ priceKey, pickupAddress: pickup?.address, dropoffAddress: dropoff?.address });
  const [revision, setRevision] = useState(0);
  const [batch, setBatch] = useState<QuoteBatch | null>(null);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);

  useEffect(() => {
    const id = ++generation.current;
    if (!enabled || !active || !pickup || !dropoff || !tariffs.length) { setPending(false); return; }
    setPending(true);
    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    const finish = (quotes: Record<string, Quote>, errors: Record<string, string>) => {
      if (finished || id !== generation.current) return;
      finished = true;
      if (watchdog) clearTimeout(watchdog);
      const receivedAt = Date.now();
      const expiry = Object.fromEntries(Object.entries(quotes).map(([tariff, value]) => [tariff, localExpiry(value, receivedAt)]));
      const nextRefresh = Object.values(expiry).length ? Math.min(...Object.values(expiry)) - 30_000 : Infinity;
      const refreshAt = Object.keys(errors).length
        ? receivedAt + 30_000 : Math.max(receivedAt + 30_000, nextRefresh);
      setBatch(previous => ({
        requestKey, priceKey,
        displayQuotes: { ...(previous?.priceKey === priceKey ? previous.displayQuotes : {}), ...quotes },
        validQuotes: { ...(previous?.requestKey === requestKey ? previous.validQuotes : {}), ...quotes },
        localExpiry: { ...(previous?.requestKey === requestKey ? previous.localExpiry : {}), ...expiry },
        errors,
        refreshAt,
      }));
      setPending(false);
      setNow(receivedAt);
    };
    const timer = setTimeout(() => {
      watchdog = setTimeout(() => {
        controller.abort();
        finish({}, Object.fromEntries(tariffs.map(tariff => [tariff.id, 'Сервер долго не отвечает. Повторяем расчёт автоматически.'])));
      }, 22_000);
      void Promise.allSettled(tariffs.map(tariff => api.post<Quote>('/orders/quote', {
        pickup: normalizePoint(pickup), dropoff: normalizePoint(dropoff), tariffId: tariff.id,
      }, { signal: controller.signal }))).then(results => {
        const quotes: Record<string, Quote> = {}, errors: Record<string, string> = {};
        results.forEach((result, index) => {
          const tariff = tariffs[index].id;
          if (result.status === 'fulfilled') quotes[tariff] = result.value;
          else errors[tariff] = messageOf(result.reason);
        });
        finish(quotes, errors);
      });
    }, 450);
    return () => { clearTimeout(timer); if (watchdog) clearTimeout(watchdog); controller.abort(); ++generation.current; };
  }, [requestKey, enabled, active, revision]);

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

  const matching = enabled && batch?.requestKey === requestKey ? batch : null;
  const display = enabled && batch?.priceKey === priceKey ? batch : null;
  useEffect(() => {
    if (active && matching && !pending && now >= matching.refreshAt) setRevision(value => value + 1);
  }, [active, matching, pending, now]);
  const validQuotes = Object.fromEntries(Object.entries(matching?.validQuotes || {})
    .filter(([tariff]) => (matching?.localExpiry[tariff] ?? 0) > now));
  const quote = validQuotes[tariffId] || null;
  const previewQuote = display?.displayQuotes[tariffId] || null;
  const error = quote || pending ? '' : matching?.errors[tariffId] || '';
  // A used quote ID cannot book another order. Keep only its display price
  // while a fresh quote is fetched automatically for the same route.
  const clear = () => {
    ++generation.current;
    setBatch(previous => previous ? { ...previous, validQuotes: {}, refreshAt: Date.now() + 30_000 } : null);
    setPending(false);
  };
  const refresh = () => { clear(); setRevision(value => value + 1); };
  return { quote, previewQuote, quotes: display?.displayQuotes || {}, calculating: pending && !quote,
    quoteError: error, refresh, clear };
}
