import { haversine } from './domain';

export const OFFER_SECONDS=30;
export const POSITION_MAX_AGE_MS=30000;
export const NEARBY_TOLERANCE_METERS=250;

export type DriverCandidate={userId:string;locationLatitude:number|null;locationLongitude:number|null;locationMeasuredAt:Date|null};

export function nextDriver(pickup:{latitude:number;longitude:number},drivers:DriverCandidate[],ratings:Map<string,number>,now=Date.now()):string|null {
  const located=drivers.filter(d=>d.locationLatitude!=null&&d.locationLongitude!=null&&d.locationMeasuredAt!=null
    && d.locationMeasuredAt.getTime()<=now+5000&&now-d.locationMeasuredAt.getTime()<=POSITION_MAX_AGE_MS)
    .map(d=>({id:d.userId,distance:haversine(pickup,{latitude:d.locationLatitude!,longitude:d.locationLongitude!})}));
  if(!located.length)return null;
  const nearest=Math.min(...located.map(d=>d.distance));
  const nearby=located.filter(d=>d.distance<=nearest+NEARBY_TOLERANCE_METERS);
  nearby.sort((a,b)=>(ratings.get(b.id)??0)-(ratings.get(a.id)??0)||a.distance-b.distance||a.id.localeCompare(b.id));
  return nearby[0].id;
}
