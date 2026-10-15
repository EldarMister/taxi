import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { Order } from './types';

/** Keep offer visibility aligned with the server deadline between global clock ticks. */
export function useDriverOfferExpiry(offer: Pick<Order, 'id' | 'searchExpiresAt'> | undefined, onClock: (now: number) => void) {
  const id = offer?.id;
  const deadline = offer?.searchExpiresAt;

  useEffect(() => {
    if (!id || !deadline) return;
    const expiresAt = Date.parse(deadline);
    if (!Number.isFinite(expiresAt)) return;

    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = (foreground = false) => {
      if (disposed) return;
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
      const now = Date.now();
      if (foreground || now >= expiresAt) onClock(now);
      // Re-read wall time when a suspended or early timer wakes up.
      if (now < expiresAt) timeout = setTimeout(refresh, expiresAt - now);
    };
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh(true);
    });
    refresh();

    return () => {
      disposed = true;
      if (timeout !== undefined) clearTimeout(timeout);
      subscription.remove();
    };
  }, [id, deadline, onClock]);
}
