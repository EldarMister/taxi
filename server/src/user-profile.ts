import type { Prisma } from '@prisma/client';

// Profile/order reads select metadata only. Avatar bytes belong to the image
// endpoint and must never be pulled into bulk history queries.
export const userProfileSelect={
  id:true,phone:true,name:true,role:true,notifications:true,language:true,avatarMime:true,avatarUpdatedAt:true,
  driverProfile:{select:{verified:true,online:true,transportClass:true,requestedTransportClass:true,acceptsEconomy:true,acceptsComfort:true,acceptsDeliveryCar:true,acceptsDeliveryFood:true,acceptsDeliveryTruck:true,courierModes:true,vehicle:{select:{id:true,make:true,color:true,plate:true,photoUpdatedAt:true}}}},
} as const satisfies Prisma.UserSelect;
export type ProfileUser=Prisma.UserGetPayload<{select:typeof userProfileSelect}>;

/** Identical public fields for single profiles and bulk order serialization. */
export function mapUserProfile(user:ProfileUser,ratingAvg:number|null) {
  const storedAvatar=user.role==='DRIVER'&&user.avatarMime&&user.avatarUpdatedAt
    ?`/avatars/${user.id}?v=${user.avatarUpdatedAt.getTime()}`:null;
  const profile=user.driverProfile;
  return {id:user.id,phone:user.phone,name:user.name,photoUrl:storedAvatar,role:user.role,notifications:user.notifications,language:user.language,
    ...(profile?{driverProfile:{verified:profile.verified,online:profile.online,transportClass:profile.transportClass,requestedTransportClass:profile.requestedTransportClass,acceptsEconomy:profile.acceptsEconomy,acceptsComfort:profile.acceptsComfort,acceptsDeliveryCar:profile.acceptsDeliveryCar,acceptsDeliveryFood:profile.acceptsDeliveryFood,acceptsDeliveryTruck:profile.acceptsDeliveryTruck,courierModes:profile.courierModes,carMake:profile.vehicle?.make??'',carColor:profile.vehicle?.color??'',carPlate:profile.vehicle?.plate??'',carPhotoUrl:profile.vehicle?.photoUpdatedAt?`/vehicles/${profile.vehicle.id}/photo?v=${profile.vehicle.photoUpdatedAt.getTime()}`:null,rating:user.role==='DRIVER'?ratingAvg:null}}:{})};
}
