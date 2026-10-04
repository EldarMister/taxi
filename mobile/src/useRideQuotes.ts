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
  const [pending, setPending] = useState<string[]>([]);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);

  useEffect(() => {
    const id = ++generation.current;
    if (!enabled || !active || !pickup || !dropoff || !tariffs.length) { setPending([]); return; }
    const remaining = new Set(tariffs.map(tariff => tariff.id));
    setPending([...remaining]);
    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const quotes: Record<string, Quote> = {}, expiry: Record<string, number> = {}, errors: Record<string, string> = {};
    const receive = (tariff: string, value: Quote | null, error = '') => {
      if (id !== generation.current || !remaining.delete(tariff)) return;
      const receivedAt = Date.now();
      if (value) { quotes[tariff] = value; expiry[tariff] = localExpiry(value, receivedAt); }
      else errors[tariff] = error;
      if (!remaining.size && watchdog) clearTimeout(watchdog);
      const nextRefresh = Object.values(expiry).length ? Math.min(...Object.values(expiry)) - 30_000 : Infinity;
      const refreshAt = remaining.size ? Infinity : Object.keys(errors).length
        ? receivedAt + 30_000 : Math.max(receivedAt + 30_000, nextRefresh);
      // Publish each response immediately: a slow unselected tariff must not
      // block booking with the selected tariff's fresh server quote.
      setBatch(previous => ({
        requestKey, priceKey,
        displayQuotes: { ...(previous?.priceKey === priceKey ? previous.displayQuotes : {}), ...quotes },
        validQuotes: { ...(previous?.requestKey === requestKey ? previous.validQuotes : {}), ...quotes },
        localExpiry: { ...(previous?.requestKey === requestKey ? previous.localExpiry : {}), ...expiry },
        errors: { ...errors },
        refreshAt,
      }));
      setPending([...remaining]);
      setNow(receivedAt);
    };
    const timer = setTimeout(() => {
      watchdog = setTimeout(() => {
        controller.abort();
        for (const tariff of [...remaining]) receive(tariff, null, 'Сервер долго не отвечает. Повторяем расчёт автоматически.');
      }, 22_000);
      for (const tariff of tariffs) void api.post<Quote>('/orders/quote', {
        pickup: normalizePoint(pickup), dropoff: normalizePoint(dropoff), tariffId: tariff.id,
      }, { signal: controller.signal }).then(value => receive(tariff.id, value), error => receive(tariff.id, null, messageOf(error)));
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
    if (active && matching && !pending.length && now >= matching.refreshAt) setRevision(value => value + 1);
  }, [active, matching, pending, now]);
  const validQuotes = Object.fromEntries(Object.entries(matching?.validQuotes || {})
    .filter(([tariff]) => (matching?.localExpiry[tariff] ?? 0) > now));
  const quote = validQuotes[tariffId] || null;
  const previewQuote = display?.displayQuotes[tariffId] || null;
  const selectedPending = pending.includes(tariffId);
  const error = quote || selectedPending ? '' : matching?.errors[tariffId] || '';
  // A used quote ID cannot book another order. Keep only its display price
  // while a fresh quote is fetched automatically for the same route.
  const clear = () => {
    ++generation.current;
    setBatch(previous => previous ? { ...previous, validQuotes: {}, refreshAt: Date.now() + 30_000 } : null);
    setPending([]);
    // Restart even if React has already resumed booking before invalidation.
    // Otherwise the invalidated request is ignored until the 30-second refresh.
    setRevision(value => value + 1);
  };
  const refresh = clear;
  return { quote, previewQuote, quotes: display?.displayQuotes || {}, calculating: selectedPending && !quote,
    quoteError: error, refresh, clear };
}
