import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapUserProfile, type ProfileUser, userProfileSelect } from '../src/user-profile';
const user={id:'synthetic-user',phone:'+996999000000',name:'Synthetic',role:'DRIVER',notifications:true,language:'ru',avatarMime:'image/jpeg',avatarUpdatedAt:new Date(1000),driverProfile:{verified:true,online:false,transportClass:'COMFORT',requestedTransportClass:'ECONOMY',acceptsEconomy:true,acceptsComfort:true,acceptsDeliveryCar:false,acceptsDeliveryFood:true,acceptsDeliveryTruck:false,courierModes:['CAR'],vehicle:{id:'synthetic-car',make:'Synthetic',color:'Synthetic',plate:'Synthetic',photoUpdatedAt:new Date(2000)}}} as ProfileUser;
test('public driver profile keeps all fields and original image paths',()=>{
  assert.deepEqual(mapUserProfile(user,4.75),{id:user.id,phone:user.phone,name:user.name,role:'DRIVER',notifications:true,language:'ru',photoUrl:'/avatars/synthetic-user?v=1000',driverProfile:{verified:true,online:false,transportClass:'COMFORT',requestedTransportClass:'ECONOMY',acceptsEconomy:true,acceptsComfort:true,acceptsDeliveryCar:false,acceptsDeliveryFood:true,acceptsDeliveryTruck:false,courierModes:['CAR'],carMake:'Synthetic',carColor:'Synthetic',carPlate:'Synthetic',carPhotoUrl:'/vehicles/synthetic-car/photo?v=2000',rating:4.75}});
});
test('missing vehicle/avatar/rating keep previous null and empty defaults',()=>{
  const profile=mapUserProfile({...user,avatarUpdatedAt:null,driverProfile:{...user.driverProfile!,vehicle:null}},null);
  assert.equal(profile.photoUrl,null);assert.equal(profile.driverProfile?.carPhotoUrl,null);assert.equal(profile.driverProfile?.rating,null);
  assert.equal(profile.driverProfile?.carMake,'');assert.equal(profile.driverProfile?.carColor,'');assert.equal(profile.driverProfile?.carPlate,'');
});
test('client profile hides driver avatar and driver rating, including legacy retained driverProfile rows',()=>{
  const client=mapUserProfile({...user,role:'CLIENT',driverProfile:null},4.75);
  assert.equal(client.photoUrl,null);assert.equal('driverProfile' in client,false);
  const retained=mapUserProfile({...user,role:'CLIENT'},4.75);
  assert.equal(retained.photoUrl,null);assert.equal(retained.driverProfile?.rating,null);
});
test('bulk profile selection never loads image bytes, password data or token/session relations',()=>{
  assert.equal('avatarData' in userProfileSelect,false);assert.equal('refreshSessions' in userProfileSelect,false);assert.equal('adminCredential' in userProfileSelect,false);
  assert.equal('photoData' in userProfileSelect.driverProfile.select.vehicle.select,false);
});
