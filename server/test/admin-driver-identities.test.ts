import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminService } from '../src/admin';
import { DriverService } from '../src/driver';
import type { Actor } from '../src/auth';

const administrator:Actor={id:randomUUID(),role:'ADMIN',sessionId:'admin-session',familyId:'admin-family',expiresAt:9999999999};
const details={phone:'+996700123456',name:'Новый водитель',carMake:'Toyota Prius',carColor:'Белый',carPlate:'01 KG 123 ABC',verified:true,transportClass:'ECONOMY' as const};
type Person={id:string;phone:string;name:string;role:Actor['role'];driverProfile:any};
function fixture() {
  const users:Person[]=[],sessions:{userId:string;revokedAt:Date|null}[]=[],challenges:{phone:string;role:Actor['role']}[]=[],trips:any[]=[];
  const person=(role:Actor['role'],phone=details.phone,name=role):Person=>{const user={id:randomUUID(),phone,name,role,driverProfile:null};users.push(user);sessions.push({userId:user.id,revokedAt:null});return user;};
  const find=(where:any)=>users.find(user=>where.id?user.id===where.id:user.phone===where.phone_role.phone&&user.role===where.phone_role.role)??null;
  const tx:any={
    $queryRaw:async()=>[],
    user:{
      findUnique:async({where}:any)=>structuredClone(find(where)),
      findUniqueOrThrow:async({where}:any)=>{const user=find(where);if(!user)throw new Error('Missing fixture user');return structuredClone(user);},
      findFirst:async({where}:any)=>structuredClone(users.find(user=>user.id===where.id&&user.role===where.role)??null),
      create:async({data}:any)=>person(data.role,data.phone,data.name),
      update:async({where,data}:any)=>{const user=find(where)!;Object.assign(user,data);return user;},
    },
    driverProfile:{
      create:async({data}:any)=>{const user=find({id:data.userId})!;assert.equal(user.driverProfile,null);user.driverProfile={deposit:0,...data,vehicle:data.vehicle?.create??null};return user.driverProfile;},
      findUnique:async({where}:any)=>find({id:where.userId})?.driverProfile??null,
      update:async({where,data}:any)=>Object.assign(find({id:where.userId})!.driverProfile,data),
      upsert:async({where,create,update}:any)=>{const user=find({id:where.userId})!;if(user.driverProfile)Object.assign(user.driverProfile,update);else user.driverProfile={deposit:0,...create};return user.driverProfile;},
    },
    vehicle:{upsert:async({where,create,update}:any)=>{const profile=find({id:where.driverId})!.driverProfile;profile.vehicle=profile.vehicle?{...profile.vehicle,...update}:create;return profile.vehicle;}},
    refreshSession:{updateMany:async({where,data}:any)=>{for(const session of sessions)if(session.userId===where.userId)Object.assign(session,data);}},
    smsChallenge:{deleteMany:async({where}:any)=>{for(let index=challenges.length-1;index>=0;index--)if(where.phone.in.includes(challenges[index].phone)&&(!where.role||where.role===challenges[index].role))challenges.splice(index,1);}},
    order:{findFirst:async({where}:any)=>trips.find(trip=>where.OR?where.OR.some((clause:any)=>clause.clientId===trip.clientId||clause.driverId===trip.driverId):where.clientId===trip.clientId)??null},
  };
  const db:any={$transaction:async(callback:any)=>callback(tx)},audit:any={record:async()=>{}},events:any={adminChanged:()=>{}};
  const service=new AdminService(db,audit,events,{} as any,{} as any);
  service.driver=async(_actor,id)=>({...find({id})!}) as any;
  const driver=new DriverService(db,{} as any,{user:async(id:string)=>({...find({id})!})} as any,audit,events);
  return {users,sessions,challenges,trips,person,service,driver};
}

test('admin creates an independent driver while same-phone client has a trip and valid session',async()=>{
  const h=fixture(),client=h.person('CLIENT');
  h.trips.push({id:'active-client-trip',clientId:client.id,status:'SEARCHING'});
  const before=structuredClone({client,sessions:h.sessions,trips:h.trips});
  const added=await h.service.createDriver(administrator,details);
  assert.notEqual(added.id,client.id);assert.equal(added.role,'DRIVER');assert.equal(added.phone,client.phone);
  assert.deepEqual(client,before.client);assert.deepEqual(h.trips,before.trips);
  assert.deepEqual(h.sessions.find(session=>session.userId===client.id),before.sessions[0]);
  assert.equal(added.driverProfile.verified,true);assert.equal(added.driverProfile.vehicle.make,details.carMake);
});

test('admin initializes a driver OTP identity once without changing either account ID',async()=>{
  const h=fixture(),client=h.person('CLIENT'),driver=h.person('DRIVER');
  const added=await h.service.createDriver(administrator,details);
  assert.equal(added.id,driver.id);assert.equal(h.users.length,2);assert.equal(client.role,'CLIENT');
  assert.equal(h.sessions.find(session=>session.userId===driver.id)?.revokedAt,null);
  await assert.rejects(()=>h.service.createDriver(administrator,details),ConflictException);
  assert.equal(h.users.length,2);assert.equal(client.id,h.users[0].id);
});

test('admin-reserved phone cannot create or receive a driver identity',async()=>{
  const h=fixture();h.person('ADMIN');
  await assert.rejects(()=>h.service.createDriver(administrator,details),ConflictException);
  const other=await h.service.createDriver(administrator,{...details,phone:'+996700999111'});
  await assert.rejects(()=>h.service.updateDriver(administrator,other.id,{phone:details.phone}),ConflictException);
  assert.equal(other.phone,'+996700999111');
});

test('changing driver phone leaves same-phone client and its pending OTP and session intact',async()=>{
  const h=fixture(),client=h.person('CLIENT','+996700999111'),driver=await h.service.createDriver(administrator,details);
  h.challenges.push({phone:details.phone,role:'DRIVER'},{phone:client.phone,role:'CLIENT'});
  const before=structuredClone(client);
  const changed=await h.service.updateDriver(administrator,driver.id,{phone:client.phone});
  assert.equal(changed.id,driver.id);assert.equal(changed.phone,client.phone);assert.deepEqual(client,before);
  assert.equal(h.sessions.find(session=>session.userId===client.id)?.revokedAt,null);
  assert.ok(h.sessions.find(session=>session.userId===driver.id)?.revokedAt);
  assert.deepEqual(h.challenges,[{phone:client.phone,role:'CLIENT'}]);
});

test('driver phone collision is rejected before changing either existing driver',async()=>{
  const h=fixture(),first=await h.service.createDriver(administrator,details),second=await h.service.createDriver(administrator,{...details,phone:'+996700999111'});
  const before=structuredClone(h.users);
  await assert.rejects(()=>h.service.updateDriver(administrator,second.id,{phone:first.phone}),ConflictException);
  assert.deepEqual(h.users,before);assert.ok(h.sessions.every(session=>session.revokedAt===null));
});

test('driver verification rejects a client ID instead of converting the account',async()=>{
  const h=fixture(),client=h.person('CLIENT');
  await assert.rejects(()=>h.driver.verify(administrator,client.id,details),BadRequestException);
  assert.equal(client.role,'CLIENT');assert.equal(client.driverProfile,null);
  assert.equal(h.sessions[0].revokedAt,null);
});

test('driver verification preserves both same-phone account IDs and client data',async()=>{
  const h=fixture(),client=h.person('CLIENT'),driver=h.person('DRIVER'),before=structuredClone(client);
  const verified=await h.driver.verify(administrator,driver.id,details);
  assert.equal(verified.id,driver.id);assert.equal(verified.role,'DRIVER');assert.equal(verified.driverProfile.verified,true);
  assert.deepEqual(client,before);assert.equal(h.users.length,2);
});
