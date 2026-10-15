import type { MapPoint } from './mapkit';

export type RouteFocusTarget = 'pickup' | 'dropoff' | 'route';
export type RouteFocusState = {
  next: RouteFocusTarget;
  callout: Exclude<RouteFocusTarget, 'route'> | null;
};
export type RouteFocusPoints = { pickup?: MapPoint | null; dropoff?: MapPoint | null };
export type RouteFocusAction =
  | { type: 'focus-point'; field: 'pickup' | 'dropoff'; point: MapPoint }
  | { type: 'fit-route' };

const targets: RouteFocusTarget[] = ['pickup', 'dropoff', 'route'];

function validPoint(point: MapPoint | null | undefined): point is MapPoint {
  return !!point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

function targetAvailable(target: RouteFocusTarget, points: RouteFocusPoints) {
  return target === 'route' ? validPoint(points.pickup) && validPoint(points.dropoff) : validPoint(points[target]);
}

function availableTarget(next: RouteFocusTarget, points: RouteFocusPoints): RouteFocusTarget | null {
  const start = targets.indexOf(next);
  for (let offset = 0; offset < targets.length; offset++) {
    const target = targets[(start + offset) % targets.length];
    if (targetAvailable(target, points)) return target;
  }
  return null;
}

export function initialRouteFocus(): RouteFocusState {
  return { next: 'pickup', callout: null };
}

/** A gesture dismisses the callout without changing the next control action. */
export function clearRouteFocusCallout(state: RouteFocusState): RouteFocusState {
  return state.callout === null ? state : { ...state, callout: null };
}

/** Invalid or removed points cannot leave a control targeting an absent marker. */
export function reconcileRouteFocus(state: RouteFocusState, points: RouteFocusPoints): RouteFocusState {
  const next = availableTarget(state.next, points) ?? 'pickup';
  const callout = state.callout && validPoint(points[state.callout]) ? state.callout : null;
  return next === state.next && callout === state.callout ? state : { next, callout };
}

/** Camera actions read the current endpoints; they never edit route coordinates. */
export function stepRouteFocus(state: RouteFocusState, points: RouteFocusPoints): {
  state: RouteFocusState;
  action: RouteFocusAction | null;
} {
  const target = availableTarget(state.next, points);
  if (!target) return { state: initialRouteFocus(), action: null };
  const next = availableTarget(targets[(targets.indexOf(target) + 1) % targets.length], points) ?? 'pickup';
  if (target === 'route') return { state: { next, callout: null }, action: { type: 'fit-route' } };
  const point = points[target];
  // targetAvailable already checked this endpoint, including finite coordinates.
  if (!validPoint(point)) return { state: initialRouteFocus(), action: null };
  return { state: { next, callout: target }, action: { type: 'focus-point', field: target, point } };
}

/** GPS is a pickup-selection action, not a replacement for the booking cycle. */
export function canLocatePickup({ field, dropoff, blocked = false }: {
  field: 'pickup' | 'dropoff' | null;
  dropoff?: MapPoint | null;
  blocked?: boolean;
}): boolean {
  return !blocked && field === 'pickup' && !validPoint(dropoff);
}

// A small dead band avoids alternating marker layouts during a pinch at the edge.
export const PICKUP_COMPACT_ZOOM = 14.5;
export const PICKUP_EXPANDED_ZOOM = 15;

export function compactPickupForZoom(wasCompact: boolean, zoom: number): boolean {
  if (!Number.isFinite(zoom)) return wasCompact;
  return wasCompact ? zoom < PICKUP_EXPANDED_ZOOM : zoom <= PICKUP_COMPACT_ZOOM;
}
