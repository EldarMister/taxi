import type { Order } from './types';

type Listener = (...args: any[]) => void;
type SocketBoundary = { on(event: string, listener: Listener): unknown; off(event: string, listener: Listener): unknown };
type Callbacks = { onReady(): void; onUnavailable(): void; onDisconnected(): void };

/** Transport connectivity alone never proves that the server checked this session. */
export function bindVerifiedSocket(socket: SocketBoundary, userId: string, callbacks: Callbacks) {
  let verified = false;
  const bindings: Array<[string, Listener]> = [];
  const bind = (event: string, listener: Listener) => { bindings.push([event, listener]); socket.on(event, listener); };
  const disconnected = () => { verified = false; callbacks.onDisconnected(); };
  bind('connect', disconnected);
  bind('disconnect', disconnected);
  bind('connect_error', disconnected);
  bind('session:expired', disconnected);
  bind('session:unavailable', () => { verified = false; callbacks.onUnavailable(); });
  bind('session:ready', (event?: { userId?: string }) => {
    if (event?.userId !== userId) { disconnected(); return; }
    verified = true;
    callbacks.onReady();
  });
  return {
    on(event: string, listener: Listener) { bind(event, (...args) => { if (verified) listener(...args); }); },
    dispose() { verified = false; for (const [event, listener] of bindings) socket.off(event, listener); bindings.length = 0; },
  };
}

/** Assignment-removal notifications must trigger a canonical read, never replace a full order. */
export function completeOrderSnapshot(value: Partial<Order> | null | undefined): value is Order {
  return !!value && typeof value.id === 'string' && !!value.status && !!value.pickup && !!value.dropoff &&
    typeof value.price === 'number' && typeof value.distanceMeters === 'number' && typeof value.durationSeconds === 'number' &&
    Array.isArray(value.geometry) && typeof value.createdAt === 'string';
}
