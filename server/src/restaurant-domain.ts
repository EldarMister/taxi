import { BadRequestException, ForbiddenException } from '@nestjs/common';
export const RESTAURANT_PERMISSIONS=['orders.read','orders.manage','menu.manage','restaurant.manage','delivery.manage','promotions.manage','stats.read','staff.manage'] as const;
export type RestaurantPermission=typeof RESTAURANT_PERMISSIONS[number];
export const DEFAULT_MANAGER_PERMISSIONS:RestaurantPermission[]=['orders.read','orders.manage'];
export function restaurantPhone(value:string) {
  const phone=value.trim().replace(/[\s()-]/g,'');
  if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new BadRequestException('Введите телефон с кодом страны, например +996…');
  return phone;
}
export function restaurantPermissions(value:unknown):RestaurantPermission[] {
  if(!Array.isArray(value)||value.length>RESTAURANT_PERMISSIONS.length||value.some(item=>!RESTAURANT_PERMISSIONS.includes(item))||new Set(value).size!==value.length)throw new BadRequestException('Неизвестные права сотрудника');
  const permissions=value as RestaurantPermission[];
  if(permissions.includes('orders.manage')&&!permissions.includes('orders.read'))throw new BadRequestException('Для управления заказами нужен просмотр заказов');
  return permissions;
}
export function requireRestaurantPermission(member:{role:string;permissions:string[]}|null,permission:RestaurantPermission) {
  if(!member||!(member.role==='OWNER'||member.permissions.includes(permission)))throw new ForbiddenException('Владелец не предоставил доступ к этому действию');
}
export const CATALOG_PERMISSIONS:Partial<Record<string,RestaurantPermission>>={
  dishes:'menu.manage',options:'menu.manage',menuCategories:'menu.manage',
  name:'restaurant.manage',cuisine:'restaurant.manage',categories:'restaurant.manage',address:'restaurant.manage',phone:'restaurant.manage',
  imageKey:'restaurant.manage',imageUrl:'restaurant.manage',heroImageKey:'restaurant.manage',heroImageUrl:'restaurant.manage',latitude:'restaurant.manage',longitude:'restaurant.manage',isOpen:'restaurant.manage',
  etaMin:'delivery.manage',etaMax:'delivery.manage',deliveryFee:'delivery.manage',freeDeliveryThreshold:'delivery.manage',minimumOrder:'delivery.manage',
  promotions:'promotions.manage',discountPercent:'promotions.manage',
};
function stable(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function assertRestaurantCatalogPermissions(member:{role:string;permissions:string[]},current:object,next:object) {
  const before=current as Record<string,unknown>,after=next as Record<string,unknown>;
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
    if(stable(before[key])===stable(after[key]))continue;
    const permission=CATALOG_PERMISSIONS[key];
    if(!permission)throw new ForbiddenException(`Поле ${key} изменяется только администратором Atlas`);
    requireRestaurantPermission(member,permission);
  }
}
