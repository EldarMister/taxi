import type { DrivingRoute } from './navigation';
import type { Coordinate, Order, Quote } from './types';

type RoadOrder = Pick<Order, 'status' | 'geometry' | 'routeProvider'>;
type RoadQuote = Pick<Quote, 'geometry' | 'routeProvider'>;

function roadGeometry(value?: RoadOrder | RoadQuote | null): Coordinate[] | undefined {
  return value?.routeProvider === 'osrm' && Array.isArray(value.geometry) && value.geometry.length > 1
    ? value.geometry : undefined;
}

// Show only the road the driver is currently following. The fare route becomes
// active after the passenger has boarded and the trip has started.
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
  const ride = driver && headingToPickup ? navigationRoute?.geometry
    : driver && order?.status === 'ARRIVED' ? undefined
    : inProgress && driver ? navigationRoute?.geometry || roadGeometry(order)
    : roadGeometry(displayed) || (!displayed ? roadGeometry(quote) : undefined);
  const approach = !order && driver && offer ? approachRoute?.geometry : undefined;
  return {
    geometry: ride,
    approachGeometry: approach,
    routeOverview: !!order && ['ASSIGNED', 'ARRIVED', 'COMPLETED'].includes(order.status)
      && (!driver || order.status === 'COMPLETED'),
  };
}
