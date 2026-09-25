import type { DrivingRoute } from './navigation';
import type { Coordinate, Order, Quote } from './types';

type RoadOrder = Pick<Order, 'status' | 'geometry' | 'routeProvider'>;
type RoadQuote = Pick<Quote, 'geometry' | 'routeProvider'>;

function roadGeometry(value?: RoadOrder | RoadQuote | null): Coordinate[] | undefined {
  return value?.routeProvider === 'osrm' && Array.isArray(value.geometry) && value.geometry.length > 1
    ? value.geometry : undefined;
}

// The approach is a separate journey to pickup. The accepted fare's geometry
// stays blue even while turn-by-turn navigation is guiding the driver there.
export function tripMapRoutes({ driver, order, offer, quote, navigationRoute, approachRoute }: {
  driver: boolean;
  order: Order | null;
  offer?: Order | null;
  quote?: Quote | null;
  navigationRoute?: DrivingRoute | null;
  approachRoute?: DrivingRoute | null;
}) {
  const displayed = order || offer;
  const headingToPickup = order?.status === 'ASSIGNED';
  const inProgress = order?.status === 'IN_PROGRESS';
  const ride = inProgress && driver ? navigationRoute?.geometry || roadGeometry(order) :
    roadGeometry(displayed) || (!displayed ? roadGeometry(quote) : undefined);
  const approach = headingToPickup && driver ? navigationRoute?.geometry
    : !order && driver && offer ? approachRoute?.geometry : undefined;
  return {
    geometry: ride,
    approachGeometry: approach,
    routeOverview: !!order && ['ASSIGNED', 'ARRIVED', 'COMPLETED'].includes(order.status),
  };
}
