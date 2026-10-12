import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { ForbiddenException, HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard, AuthService, type Actor } from '../src/auth';
import { RestaurantAuthGuard, RestaurantAuthService } from '../src/restaurant-auth';
import { RestaurantService } from '../src/restaurant';
import { TaxiGateway } from '../src/gateway';
import { RealtimeEvents } from '../src/events';

const jwt=new JwtService();
const config={jwtSecret:'disposable-unit-jwt-key-only-000000000000000',otpSecret:'disposable-unit-otp-key-only-111111111111111',accessSeconds:900,refreshDays:30,devAuth:false,testAuthPhones:['+996999000001'],testAuthCode:'654321',smsProvider:'nikita'};
const limits={take:async()=>{},takeAll:async()=>{}};
const actor:Actor={id:randomUUID(),sessionId:randomUUID(),familyId:randomUUID(),role:'CLIENT',expiresAt:9999999999};
const dbDown=async()=>{throw new Error('synthetic database offline');};
const mobileToken=()=>jwt.signAsync({sub:actor.id,sid:actor.sessionId,fid:actor.familyId},{secret:config.jwtSecret,issuer:'taxi-api',audience:'taxi-mobile',expiresIn:900});
const restaurantToken=()=>jwt.signAsync({sub:actor.id,sid:actor.sessionId,ver:1},{secret:config.jwtSecret,issuer:'taxi-api',audience:'atlas-restaurant',expiresIn:900});

test('HTTP mobile and restaurant guards deny protected actions with 503 during DB outage and never revoke tokens',async()=>{
  let writes=0;
  const db={refreshSession:{findUnique:dbDown,updateMany:async()=>writes++},restaurantSession:{findUnique:dbDown,updateMany:async()=>writes++}};
  const mobile=new AuthService(db as any,jwt,config as any,limits as any,{} as any,{} as any,{} as any);
  const restaurant=new RestaurantAuthService(db as any,jwt,config as any,limits as any);
  for(const [guard,token] of [[new AuthGuard(mobile),await mobileToken()],[new RestaurantAuthGuard(restaurant),await restaurantToken()]] as const) {
    const req={headers:{authorization:`Bearer ${token}`}};
    await assert.rejects(()=>guard.canActivate({switchToHttp:()=>({getRequest:()=>req})} as any),ServiceUnavailableException);
    assert.equal('actor' in req,false);assert.equal('restaurantActor' in req,false);
  }
  assert.equal(writes,0);
});

test('invalid signatures/claims are 401 and avoid any DB query',async()=>{
  let queries=0;
  const db={refreshSession:{findUnique:async()=>{queries++;}},restaurantSession:{findUnique:async()=>{queries++;}}};
  const mobile=new AuthService(db as any,jwt,config as any,limits as any,{} as any,{} as any,{} as any);
  const restaurant=new RestaurantAuthService(db as any,jwt,config as any,limits as any);
  await assert.rejects(()=>mobile.authenticate('bad'),UnauthorizedException);
  await assert.rejects(()=>restaurant.authenticate('bad'),UnauthorizedException);
  const malformed=await jwt.signAsync({sub:actor.id},{secret:config.jwtSecret,issuer:'taxi-api',audience:'taxi-mobile'});
  await assert.rejects(()=>mobile.authenticate(malformed),UnauthorizedException);
  assert.equal(queries,0);
});

test('restaurant refresh profile failures roll token rotation back; retry can use original token',async()=>{
  const initial={id:actor.sessionId,accountId:actor.id,familyId:actor.familyId,sessionVersion:1,revokedAt:null as Date|null,expiresAt:new Date(Date.now()+60000)};
  const account={id:actor.id,active:true,sessionVersion:1,name:'Synthetic',phone:config.testAuthPhones[0],memberships:[]};
  let failProfile=true;
  const rows=[initial];
  const tx={$queryRaw:async()=>[],restaurantSession:{
    findUnique:async({where}:any)=>where.id?rows.find(row=>row.id===where.id):rows[0],
    update:async()=>{rows[0].revokedAt=new Date();},
    create:async({data}:any)=>{const row={id:randomUUID(),...data,revokedAt:null};rows.push(row);return row;},
    updateMany:async()=>({count:0}),
  },restaurantAccount:{findUnique:async({include}:any)=>{if(include&&failProfile)throw new Error('profile offline');return account;}}};
  const db={$transaction:async(fn:any)=>{const snapshot=structuredClone(rows);try{return await fn(tx);}catch(error){rows.splice(0,rows.length,...snapshot);throw error;}}};
  const service=new RestaurantAuthService(db as any,jwt,config as any,limits as any);
  await assert.rejects(()=>service.refresh('original-token'),/profile offline/);
  assert.equal(rows[0].revokedAt,null);assert.equal(rows.length,1);
  failProfile=false;assert.ok((await service.refresh('original-token')).accessToken);assert.equal(rows.length,2);
});

test('restaurant logout takes account lock before revoking concurrent refresh successor',async()=>{
  const operations:string[]=[];
  const row={accountId:actor.id,familyId:actor.familyId};
  const tx={restaurantSession:{findUnique:async()=>{operations.push('read');return row;},updateMany:async({where}:any)=>{operations.push('revoke');assert.equal(where.accountId,actor.id);assert.equal(where.familyId,actor.familyId);}},$queryRaw:async()=>{operations.push('lock');}};
  const service=new RestaurantAuthService({$transaction:async(fn:any)=>fn(tx)} as any,jwt,config as any,limits as any);
  assert.deepEqual(await service.logout('token'),{ok:true});assert.deepEqual(operations,['read','lock','revoke']);
});

test('refresh database outage is a server failure, no invalid-session classification or writes',async()=>{
  for(const service of [new AuthService({$transaction:dbDown} as any,jwt,config as any,limits as any,{} as any,{} as any,{} as any),new RestaurantAuthService({$transaction:dbDown} as any,jwt,config as any,limits as any)])
    await assert.rejects(()=>service.refresh('still-valid-token'),error=>!(error instanceof UnauthorizedException)&&String(error).includes('synthetic database offline'));
});

test('store review exception is exact configured phone; ordinary and deleted accounts retain provider flow, admin is denied',async()=>{
  let existing:{role:string;deletedAt:Date|null}|null=null;
  const sent:string[]=[];
  const db={user:{findUnique:async()=>existing},smsChallenge:{upsert:async()=>{},updateMany:async()=>({count:1})}};
  const delivery={startNikita:async(phone:string)=>{sent.push(phone);return 'synthetic-provider-token';}};
  const service=new AuthService(db as any,jwt,config as any,limits as any,{} as any,delivery as any,{} as any);
  const allowed=await service.requestCode(config.testAuthPhones[0],'127.0.0.1');
  assert.equal((allowed as any).developmentCode,config.testAuthCode);assert.equal(sent.length,0);
  const ordinary=await service.requestCode('+996999000002','127.0.0.1');
  assert.equal('developmentCode' in ordinary,false);assert.deepEqual(sent,['+996999000002']);
  existing={role:'CLIENT',deletedAt:new Date()};
  assert.equal('developmentCode' in await service.requestCode(config.testAuthPhones[0],'127.0.0.1'),false);
  existing={role:'ADMIN',deletedAt:null};
  await assert.rejects(()=>service.requestCode(config.testAuthPhones[0],'127.0.0.1'),UnauthorizedException);
  assert.equal(sent.length,2);
});

test('store code alone cannot verify ordinary phone or assign an administrator role',async()=>{
  const challenge={consumedAt:null,expiresAt:new Date(Date.now()+60000),attempts:0,provider:'local',codeHash:createHash('sha256').update('different').digest('hex')};
  let sessionWrites=0;
  const tx={$queryRaw:async()=>[],smsChallenge:{findUnique:async()=>challenge,update:async()=>{}},user:{upsert:async()=>({id:actor.id,role:'ADMIN'})},refreshSession:{create:async()=>{sessionWrites++;}}};
  const service=new AuthService({$transaction:async(fn:any)=>fn(tx)} as any,jwt,config as any,limits as any,{} as any,{} as any,{} as any);
  await assert.rejects(()=>service.verifyCode('+996999000002',config.testAuthCode,'127.0.0.1'),UnauthorizedException);
  assert.equal(sessionWrites,0);
  (service as any).otpHash=()=>challenge.codeHash;
  await assert.rejects(()=>service.verifyCode(config.testAuthPhones[0],config.testAuthCode,'127.0.0.1'),UnauthorizedException);
  assert.equal(sessionWrites,0);
});

test('staff permissions deny access before password hashing or any transaction',async()=>{
  let transactions=0;
  const service=new RestaurantService({restaurantMembership:{findUnique:async()=>null},$transaction:async()=>{transactions++;}} as any,{} as any,{} as any,{} as any,limits as any);
  // hashAdminPassword rejects this password with 400; 403 demonstrates that
  // the actor permission check runs first.
  await assert.rejects(()=>service.saveStaff({id:actor.id,sessionId:actor.sessionId,sessionVersion:1},'foreign',{phone:'+996999000003',password:'short'}),ForbiddenException);
  assert.equal(transactions,0);
});

function socket(id:string,token='token') {
  const emitted:Array<{name:string;payload:any}>=[],rooms=new Set<string>();
  return {id,data:{} as Record<string,any>,handshake:{auth:{token}},emitted,rooms,disconnected:false,emit(name:string,payload:any){emitted.push({name,payload});},disconnect(){this.disconnected=true;},async join(room:string){rooms.add(room);},async leave(room:string){rooms.delete(room);}};
}
test('Socket.IO outage keeps token/transport, denies tracking and delivers no protected event; recovery requires sync',async()=>{
  let unavailable=true;
  const auth={authenticate:async()=>{if(unavailable)throw new ServiceUnavailableException();return actor;}};
  let trackingReads=0;
  const gateway=new TaxiGateway(auth as any,new RealtimeEvents(),{get:async()=>{trackingReads++;return {status:'ASSIGNED'};}} as any,limits as any);
  const client=socket('client');
  await gateway.handleConnection(client as any);
  assert.equal(client.disconnected,false);assert.equal(client.emitted[0].name,'session:unavailable');
  assert.deepEqual(await gateway.subscribeTracking(client as any,{orderId:randomUUID()}),{ok:false,retry:true});assert.equal(trackingReads,0);
  (gateway as any).server={sockets:{sockets:new Map([[client.id,client]]),adapter:{rooms:new Map([['user:'+actor.id,new Set([client.id])]])}}};
  await assert.rejects(()=>(gateway as any).send({userIds:[actor.id],name:'order:updated',payload:{id:'protected'}}),ServiceUnavailableException);
  assert.equal(client.emitted.some(event=>event.name==='order:updated'||event.name==='session:expired'),false);
  unavailable=false;await (gateway as any).audit();
  assert.equal(client.emitted.at(-1)?.name,'session:ready');assert.equal(client.emitted.at(-1)?.payload.resyncRequired,true);
});
test('revoked Socket.IO tokens expire and disconnect rather than receiving protected data',async()=>{
  const gateway=new TaxiGateway({authenticate:async()=>{throw new UnauthorizedException();}} as any,new RealtimeEvents(),{} as any,limits as any);
  const client=socket('revoked');await gateway.handleConnection(client as any);
  assert.equal(client.disconnected,true);assert.equal(client.emitted[0].name,'session:expired');
});
test('Socket.IO connection rate rejection disconnects only this transport and cannot become ready in the audit sweep',async()=>{
  let authenticationChecks=0,limitChecks=0;
  const gateway=new TaxiGateway({authenticate:async()=>{authenticationChecks++;return actor;}} as any,new RealtimeEvents(),{} as any,{take:async(key:string,max:number,seconds:number)=>{
    assert.equal(key,`ws-connect:session:${actor.sessionId}`);assert.equal(max,60);assert.equal(seconds,60);limitChecks++;
    throw new HttpException({statusCode:429,retryAfterSeconds:37,message:'Synthetic rate rejection'},429);
  }} as any);
  const client=socket('rate-rejected','valid-session-token'),connections=new Map([[client.id,client]]);
  client.disconnect=()=>{client.disconnected=true;connections.delete(client.id);};
  (gateway as any).server={sockets:{sockets:connections,adapter:{rooms:new Map()}}};
  await gateway.handleConnection(client as any);
  await (gateway as any).audit();
  assert.equal(client.disconnected,true);assert.equal(connections.size,0);assert.equal(authenticationChecks,1);assert.equal(limitChecks,1);
  assert.equal(client.handshake.auth.token,'valid-session-token');assert.equal(client.rooms.size,0);
  assert.deepEqual(client.emitted.map(event=>event.name),['session:unavailable']);
  assert.equal(client.emitted[0].payload.statusCode,429);assert.equal(client.emitted[0].payload.retryAfterSeconds,37);
});
test('a connection admission DB outage preserves valid transport and token for successful recovery',async()=>{
  let unavailable=true,consumed=0;
  const gateway=new TaxiGateway({authenticate:async()=>actor} as any,new RealtimeEvents(),{} as any,{take:async()=>{consumed++;if(unavailable)throw new ServiceUnavailableException();}} as any);
  const client=socket('admission-outage','valid-session-token');
  (gateway as any).server={sockets:{sockets:new Map([[client.id,client]]),adapter:{rooms:new Map()}}};
  await gateway.handleConnection(client as any);
  assert.equal(client.disconnected,false);assert.equal(client.handshake.auth.token,'valid-session-token');assert.equal(client.rooms.size,0);
  assert.deepEqual(client.emitted.map(event=>event.name),['session:unavailable']);
  unavailable=false;await (gateway as any).audit();
  assert.equal(client.disconnected,false);assert.equal(client.emitted.at(-1)?.name,'session:ready');
  assert.equal(consumed,2);assert.equal(client.emitted.some(event=>event.name==='session:expired'),false);
  await (gateway as any).audit();assert.equal(consumed,2);
});
test('Socket.IO recovery rechecks admission before tracking reads and disconnects a subsequent connection429',async()=>{
  let outage=true,reads=0;
  const gateway=new TaxiGateway({authenticate:async()=>actor} as any,new RealtimeEvents(),{get:async()=>{reads++;return {status:'ASSIGNED'};}} as any,{take:async()=>{
    if(outage)throw new ServiceUnavailableException();
    throw new HttpException({statusCode:429,retryAfterSeconds:25},429);
  }} as any);
  const client=socket('tracking-recovery');await gateway.handleConnection(client as any);assert.equal(client.disconnected,false);
  outage=false;
  assert.deepEqual(await gateway.subscribeTracking(client as any,{orderId:randomUUID()}),{ok:false,statusCode:429});
  assert.equal(reads,0);assert.equal(client.rooms.size,0);assert.equal(client.disconnected,true);
  assert.equal(client.emitted.at(-1)?.payload.retryAfterSeconds,25);assert.equal(client.emitted.some(event=>event.name==='session:ready'||event.name==='session:expired'),false);
});
test('parallel readiness checks share one socket admission but keep fresh authorization checks',async()=>{
  let consumed=0,authChecks=0,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const gateway=new TaxiGateway({authenticate:async()=>{authChecks++;return actor;}} as any,new RealtimeEvents(),{} as any,{take:async()=>{consumed++;await gate;}} as any);
  const client=socket('parallel-ready');
  (gateway as any).server={sockets:{sockets:new Map([[client.id,client]]),adapter:{rooms:new Map()}}};
  const initial=gateway.handleConnection(client as any),audit=(gateway as any).audit();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(consumed,1);assert.equal(authChecks,2);assert.equal(client.rooms.size,0);
  release();await Promise.all([initial,audit]);
  await (gateway as any).audit();assert.equal(consumed,1);assert.equal(authChecks,3);assert.equal(client.disconnected,false);
});
test('tracking operation429 keeps an admitted connection valid and never expires its session',async()=>{
  const gateway=new TaxiGateway({authenticate:async()=>actor} as any,new RealtimeEvents(),{get:async()=>{throw new Error('Rate rejection must precede tracking read');}} as any,{take:async(key:string)=>{
    if(key.startsWith('ws-tracking:'))throw new HttpException({statusCode:429,retryAfterSeconds:10},429);
  }} as any);
  const client=socket('tracking-rate');await gateway.handleConnection(client as any);
  assert.deepEqual(await gateway.subscribeTracking(client as any,{orderId:randomUUID()}),{ok:false,statusCode:429});
  assert.equal(client.disconnected,false);assert.equal(client.emitted.some(event=>event.name==='session:expired'),false);
});
test('targeted events check only recipient sockets and deduplicate identical-token tabs',async()=>{
  let queries=0;
  const gateway=new TaxiGateway({authenticate:async()=>{queries++;return actor;}} as any,new RealtimeEvents(),{} as any,limits as any);
  const clients=[socket('tab1'),socket('tab2'),socket('other','other-token')];
  (gateway as any).server={sockets:{sockets:new Map(clients.map(client=>[client.id,client])),adapter:{rooms:new Map([['user:'+actor.id,new Set(['tab1','tab2'])]])}}};
  await (gateway as any).send({userIds:[actor.id],name:'order:updated',payload:{id:'protected'}});
  assert.equal(queries,1);assert.equal(clients[2].emitted.length,0);
  for(const client of clients.slice(0,2))assert.equal(client.emitted.at(-1)?.name,'order:updated');
});
test('an offer queued for a driver is denied after a fresh role change, even if room data still says DRIVER',async()=>{
  let role:Actor['role']='DRIVER';
  const gateway=new TaxiGateway({authenticate:async()=>({...actor,role})} as any,new RealtimeEvents(),{} as any,limits as any);
  const client=socket('driver');client.data.role='DRIVER';client.data.userId=actor.id;
  (gateway as any).server={sockets:{sockets:new Map([[client.id,client]]),adapter:{rooms:new Map([['user:'+actor.id,new Set([client.id])]])}}};
  await (gateway as any).send({userIds:[actor.id],name:'order:offer',payload:{id:'offer'}});
  assert.equal(client.emitted.filter(event=>event.name==='order:offer').length,1);
  role='CLIENT';
  await (gateway as any).send({userIds:[actor.id],name:'order:offer',payload:{id:'offer'}});
  assert.equal(client.emitted.filter(event=>event.name==='order:offer').length,1);
  assert.equal(client.data.role,'CLIENT');
});
