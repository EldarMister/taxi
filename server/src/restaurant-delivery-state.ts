import type { FoodOrderStatus, Order, OrderStatus, Prisma } from '@prisma/client';

export const RESTAURANT_DELIVERY_KEY = 'restaurant-food:';
export const ordinaryClientOrders = {foodOrderId:null,NOT:{idempotencyKey:{startsWith:RESTAURANT_DELIVERY_KEY}}} satisfies Prisma.OrderWhereInput;

// The immutable key also identifies detached, failed delivery attempts.
export function isRestaurantDelivery(order:Pick<Order,'foodOrderId'|'idempotencyKey'>) {
  return !!order.foodOrderId || order.idempotencyKey?.startsWith(RESTAURANT_DELIVERY_KEY)===true;
}

/** Run inside the same transaction as the driver's order state change. */
export async function syncRestaurantFoodStatus(tx:Prisma.TransactionClient,order:Pick<Order,'id'|'foodOrderId'>,status:OrderStatus,actorId?:string) {
  if(!order.foodOrderId)return null;
  const next:FoodOrderStatus|undefined=status==='IN_PROGRESS'?'DELIVERING':status==='COMPLETED'?'COMPLETED':status==='NO_DRIVER'||status==='CANCELLED'?'READY':undefined;
  if(!next)return null;
  await tx.$queryRaw`SELECT "id" FROM "FoodOrder" WHERE "id"=${order.foodOrderId}::uuid FOR UPDATE`;
  const current=await tx.foodOrder.findUnique({where:{id:order.foodOrderId}});
  if(!current||current.deliveryMethod!=='ATLAS_CAR'||!['READY','DELIVERING'].includes(current.status))return null;
  if(current.status===next&&next!=='READY')return null;
  // Food history requires an actor. Automated search expiry is attributed to
  // the restaurant account that requested the courier, with an explicit reason.
  const initiator=actorId??(await tx.statusHistory.findFirst({where:{orderId:order.id,status:'SEARCHING'},orderBy:{createdAt:'asc'},select:{actorId:true}}))?.actorId??current.clientId;
  return tx.foodOrder.update({where:{id:current.id},data:{status:next,...(next==='COMPLETED'?{completedAt:new Date()}:{}),history:{create:{status:next,actorId:initiator,reason:`ATLAS_${status}:${order.id}`}}}});
}
