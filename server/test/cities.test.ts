import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CitiesService, cityRegistrationConfig } from '../src/cities';
import { emptyRegistrationData, validateRegistrationDataValues } from '../src/registration-domain';

const admin = { id: 'admin-test', role: 'ADMIN' } as any;
function fixture() {
  const rows: any[] = [{ id: '1', name: 'Шамалды-Сай', aliases: [], status: 'ACTIVE', sortOrder: 0, updatedAt: new Date('2026-10-08T00:00:00Z') }, { id: '2', name: 'Кочкор-Ата', aliases: [], status: 'SOON', sortOrder: 1 }, { id: '3', name: 'Кербен', aliases: [], status: 'SOON', sortOrder: 2 }];
  const audit: any[] = [], events: any[] = [];
  const tx: any = { $queryRaw: async()=>[], serviceCity: { findMany: async()=>rows, findUnique: async({where}: any)=>rows.find(row=>row.id===where.id), create: async({data}: any)=>{ const row={id:'4',...data,updatedAt:new Date()};rows.push(row);return row; }, update: async({where,data}: any)=>{const row=rows.find(row=>row.id===where.id);Object.assign(row,data,{updatedAt:new Date()});return row;} } };
  const db: any = { ...tx, $transaction: async(callback: any)=>callback(tx) };
  const service=new CitiesService(db,{record:async(...args:any[])=>audit.push(args)} as any,{adminChanged:(...args:any[])=>events.push(args),contentChanged:(...args:any[])=>events.push(args)} as any);
  return {service,rows,audit,events};
}
test('active cities can be selected; soon/hidden cities cannot; aliases preserve existing renamed drafts',()=>{
  const config=cityRegistrationConfig([{id:'1',name:'Новый город',aliases:['Прежний город'],status:'ACTIVE',sortOrder:0},{id:'2',name:'Скоро',aliases:[],status:'SOON',sortOrder:1},{id:'3',name:'Скрытый',aliases:[],status:'HIDDEN',sortOrder:2}]);
  assert.deepEqual(config.cities,['Новый город']);assert.deepEqual(config.comingSoonCities,['Скоро']);assert.equal(config.workCities.length,2);
  for(const city of ['Новый город','Прежний город']) assert.equal(validateRegistrationDataValues({personal:{city}},[],undefined,undefined,config.acceptedCityNames).length,0);
  assert.ok(validateRegistrationDataValues({personal:{city:'Скоро'}},[],undefined,undefined,config.acceptedCityNames).some(error=>error.field==='personal.city'));
});
test('city creation and editing persist availability, retain rename aliases, audit and notify clients',async()=>{
  const {service,rows,audit,events}=fixture();
  const created=await service.save(admin,{name:'  Новый  город ',status:'ACTIVE',sortOrder:8});assert.equal(created.name,'Новый город');
  await service.save(admin,{name:'Переименован',status:'ACTIVE',sortOrder:5,updatedAt:created.updatedAt.toISOString()},created.id);
  assert.deepEqual(rows.find(row=>row.id===created.id).aliases,['Новый город']);assert.equal(audit.length,2);assert.equal(events.length,4);
  const config=await service.registrationConfig();assert.ok(config.acceptedCityNames.includes('Новый город'));
  await assert.rejects(service.save(admin,{name:'переименован',status:'SOON'}),/уже существует/);
  await assert.rejects(service.save(admin,{name:'Изменено',status:'SOON',updatedAt:'2000-01-01T00:00:00Z'},created.id),/другим администратором/);
  await assert.rejects(service.save({id:'client',role:'CLIENT'} as any,{name:'Город',status:'ACTIVE'}),/администратору/);
});
