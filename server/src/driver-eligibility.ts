import { OrderKind, TransportClass } from '@prisma/client';

export type DispatchProfile={transportClass:TransportClass;acceptsEconomy:boolean;acceptsComfort:boolean;acceptsDeliveryCar:boolean;acceptsDeliveryFood?:boolean;acceptsDeliveryTruck:boolean};

export function driverCanTake(driver:DispatchProfile,kind:OrderKind,requiredClass:TransportClass,restaurantDelivery=false):boolean {
  if(restaurantDelivery)return kind==='DELIVERY_CAR'&&driver.transportClass!=='TRUCK'&&driver.acceptsDeliveryFood===true;
  if(kind==='DELIVERY_TRUCK')return driver.transportClass==='TRUCK'&&driver.acceptsDeliveryTruck;
  if(kind==='DELIVERY_CAR')return driver.transportClass!=='TRUCK'&&driver.acceptsDeliveryCar;
  if(requiredClass==='COMFORT')return driver.transportClass==='COMFORT'&&driver.acceptsComfort;
  return driver.transportClass!=='TRUCK'&&driver.acceptsEconomy;
}
