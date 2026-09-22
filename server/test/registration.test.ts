import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateRegistrationRoleStates, aggregateRegistrationStatus, assertSafeRegistrationData, correctableRegistrationRoles, mergeRegistrationData, redactRegistrationData, REGISTRATION_CONFIG,
  parseRegistrationExpiryDate, registrationAdditionalDocumentSlotKeys, registrationCapabilityCeiling, registrationDocumentLifecycleStatus, registrationExpiryCorrectionFields,
  registrationRoleStatusAfterUploadDecision, registrationSteps,
  registrationUploadCanExpire, registrationUploadRequiresExpiry, registrationUploadSlotSpec, registrationUploadsWithEffectiveExpiry, requiredUploadSlots, requiredUploadSlotsForRole,
  validateRegistrationConsents, validateRegistrationDataValues, validateRegistrationSubmission,
} from '../src/registration-domain';
import { RegistrationService } from '../src/registration';
import { RegistrationAdminService } from '../src/registration-admin';
import { REGISTRATION_UPLOADS_PER_USER_HOUR, RegistrationUploadGate } from '../src/registration-upload-gate';
import { Subject, lastValueFrom, of } from 'rxjs';

const today=new Date('2026-09-22T00:00:00.000Z');
const personal={firstName:'Асан',lastName:'Ибраев',birthDate:'10.03.1990',city:'Бишкек'};
const identity={number:'ID-123',issuedAt:'01.01.2020',expiresAt:'01.01.2030',issuedBy:'МКК'};
const uploaded=(slots:string[])=>slots.map(slotKey=>({slotKey,status:'UPLOADED',...(registrationUploadRequiresExpiry(slotKey)?{expiresAt:new Date('2030-01-01T23:59:59.999Z')}: {})}));

test('walking courier flow skips driver and vehicle requirements',()=>{
  const roles=['COURIER'] as const;
  const data={personal,identity,courier:{transportModes:['FOOT'],orderTypes:['DOCUMENTS'],maxWeightKg:'5',city:'Бишкек'}};
  const slots=requiredUploadSlots(roles,data);
  assert.deepEqual(slots,['profile_photo','identity_front','identity_back']);
  assert.ok(!registrationSteps(roles,data).includes('DRIVER_LICENSE'));
  assert.deepEqual(validateRegistrationSubmission({roles,data,uploads:uploaded(slots),today}),[]);
});

test('motorized courier dynamically requires a licence and vehicle documents',()=>{
  const roles=['COURIER'] as const;
  const data={personal,identity,driverLicense:{number:'DL-123',categories:['A'],expiresAt:'01.01.2030'},courier:{transportModes:['MOTORCYCLE'],orderTypes:['PARCELS'],maxWeightKg:'10',city:'Бишкек'},courierVehicle:{ownership:'OWN',brand:'Honda',model:'CB',year:'2022',plateNumber:'01 123 AAA'}};
  const slots=requiredUploadSlots(roles,data);
  assert.ok(slots.includes('license_front'));
  assert.ok(slots.includes('courier_insurance'));
  assert.ok(registrationSteps(roles,data).includes('COURIER_VEHICLE'));
  const errors=validateRegistrationSubmission({roles,data,uploads:uploaded(slots.filter(slot=>slot!=='courier_insurance')),today});
  assert.deepEqual(errors.map(error=>error.field),['uploads.courier_insurance']);
});

test('taxi and courier share common identity and licence uploads',()=>{
  const roles=['TAXI_DRIVER','COURIER'] as const;
  const data={
    personal,identity,
    driverLicense:{number:'DL-123',categories:['B'],expiresAt:'01.01.2030'},
    taxiVehicle:{ownership:'OWN',brand:'Toyota',model:'Camry',year:'2020',plateNumber:'01 777 AAA',tariffs:['ECONOMY']},
    courier:{transportModes:['FOOT'],orderTypes:['DOCUMENTS'],maxWeightKg:'5',city:'Бишкек'},
  };
  const slots=requiredUploadSlots(roles,data);
  assert.equal(slots.filter(slot=>slot==='identity_front').length,1);
  assert.equal(slots.filter(slot=>slot==='license_front').length,1);
  assert.deepEqual(validateRegistrationSubmission({roles,data,uploads:uploaded(slots),today}),[]);
});

test('submission validation returns field-level minimum-age and upload errors',()=>{
  const roles=['COURIER'] as const;
  const data={personal:{...personal,birthDate:'01.01.2012'},identity,courier:{transportModes:['BICYCLE'],orderTypes:['DOCUMENTS'],maxWeightKg:'5',city:'Бишкек'}};
  const errors=validateRegistrationSubmission({roles,data,uploads:[],today});
  assert.ok(errors.some(error=>error.field==='personal.birthDate'&&error.code==='MINIMUM_AGE'));
  assert.ok(errors.some(error=>error.field==='uploads.profile_photo'&&error.code==='UPLOAD_REQUIRED'));
});

test('autosave merges nested sections without losing earlier fields',()=>{
  const merged=mergeRegistrationData({personal:{firstName:'Асан',city:'Ош'},courier:{transportModes:['FOOT']}},{personal:{lastName:'Ибраев'}});
  assert.deepEqual(merged,{personal:{firstName:'Асан',lastName:'Ибраев',city:'Ош'},courier:{transportModes:['FOOT']}});
});

test('raw payment credentials are rejected and defensive responses omit them',()=>{
  assert.throws(()=>assertSafeRegistrationData({paymentMethod:{type:'CARD',cardNumber:'4111 1111 1111 1111',last4:'1111'}}),/PAYMENT_SECRET/);
  assert.throws(()=>assertSafeRegistrationData({paymentMethod:{type:'CARD',number:'4111111111111111'}}),/PAYMENT_SECRET/);
  assert.throws(()=>assertSafeRegistrationData({paymentMethod:{type:'PROVIDER_CARD_TOKEN',providerToken:'tok_live_1234567890123456',last4:'4582'}}),/PAYMENT_SECRET/);
  assert.throws(()=>assertSafeRegistrationData({paymentMethod:{providerToken:'4111111111111111'}}),/PAYMENT_SECRET/);
  assert.doesNotThrow(()=>assertSafeRegistrationData({payment:{type:'CARD',last4:'4'}}));
  assert.throws(()=>assertSafeRegistrationData({payment:{type:'CARD',last4:'45821'}}),/PAYMENT_LAST4/);
  assert.deepEqual(redactRegistrationData({paymentMethod:{providerToken:'tok_safe',cardNumber:'4111111111111111',last4:'1111'}}),{paymentMethod:{last4:'1111'}});
});

test('role status aggregation preserves independent review outcomes',()=>{
  assert.equal(aggregateRegistrationStatus(['APPROVED','CORRECTION_REQUIRED']),'CORRECTION_REQUIRED');
  assert.equal(aggregateRegistrationStatus(['APPROVED','UNDER_REVIEW']),'UNDER_REVIEW');
  assert.equal(aggregateRegistrationStatus(['APPROVED','REJECTED']),'REJECTED');
  assert.equal(aggregateRegistrationStatus(['APPROVED','APPROVED']),'APPROVED');
  assert.equal(aggregateRegistrationStatus(['BLOCKED','REJECTED']),'BLOCKED');
  assert.equal(aggregateRegistrationStatus(['REJECTED','REJECTED']),'REJECTED');
  assert.equal(aggregateRegistrationRoleStates([{status:'APPROVED'},{status:'REJECTED',canResubmit:true}]),'CORRECTION_REQUIRED');
});

test('registration-managed preferences cannot restore a revoked role capability',()=>{
  assert.deepEqual(registrationCapabilityCeiling(['COURIER'],['FOOT'],'ECONOMY'),{acceptsEconomy:false,acceptsComfort:false,acceptsDeliveryCar:false,acceptsDeliveryTruck:false});
  assert.deepEqual(registrationCapabilityCeiling(['TAXI_DRIVER','COURIER'],['CAR'],'COMFORT'),{acceptsEconomy:true,acceptsComfort:true,acceptsDeliveryCar:true,acceptsDeliveryTruck:false});
  assert.deepEqual(registrationCapabilityCeiling(['CARGO_DRIVER'],[],'TRUCK'),{acceptsEconomy:false,acceptsComfort:false,acceptsDeliveryCar:false,acceptsDeliveryTruck:true});
});

test('upload review cannot weaken a terminal role decision',()=>{
  assert.equal(registrationRoleStatusAfterUploadDecision({status:'BLOCKED'},'CORRECTION_REQUIRED',true),null);
  assert.equal(registrationRoleStatusAfterUploadDecision({status:'REJECTED',canResubmit:false},'CORRECTION_REQUIRED',true),null);
  assert.equal(registrationRoleStatusAfterUploadDecision({status:'REJECTED',canResubmit:true},'CORRECTION_REQUIRED',true),'CORRECTION_REQUIRED');
  assert.equal(registrationRoleStatusAfterUploadDecision({status:'APPROVED'},'REJECTED',false),'REJECTED');
  assert.equal(registrationRoleStatusAfterUploadDecision({status:'UNDER_REVIEW'},'BLOCKED',false),'BLOCKED');
});

test('document expiry policy requires dates and has deterministic lifecycle boundaries',()=>{
  assert.equal(registrationUploadRequiresExpiry('taxi_insurance'),true);
  assert.equal(registrationUploadRequiresExpiry('taxi_registration'),false);
  assert.equal(registrationUploadCanExpire('VEHICLE_DOCUMENT'),true);
  assert.equal(registrationUploadCanExpire('VEHICLE_PHOTO'),false);
  assert.equal(registrationDocumentLifecycleStatus(new Date('2026-09-22T00:00:00.000Z'),today),'EXPIRED');
  assert.equal(registrationDocumentLifecycleStatus(new Date('2026-10-01T00:00:00.000Z'),today),'EXPIRING');
  assert.equal(registrationDocumentLifecycleStatus(new Date('2027-01-01T00:00:00.000Z'),today),'ACTIVE');
  assert.equal(registrationDocumentLifecycleStatus(null,today),null);
  assert.equal(parseRegistrationExpiryDate('01.10.2026')?.toISOString(),'2026-10-01T23:59:59.999Z');
  assert.equal(parseRegistrationExpiryDate('2026-10-01')?.toISOString(),'2026-10-01T23:59:59.999Z');
  assert.equal(parseRegistrationExpiryDate('31.02.2026'),null);
  assert.deepEqual(registrationExpiryCorrectionFields('identity_front'),['identity.expiresAt']);
  assert.deepEqual(registrationExpiryCorrectionFields('license_back'),['driverLicense.expiresAt']);
  assert.deepEqual(registrationExpiryCorrectionFields('taxi_insurance'),['documentExpiries.taxi_insurance']);
  const motorData={personal,identity,driverLicense:{number:'DL-123',categories:['A'],expiresAt:'01.01.2030'},courier:{transportModes:['MOTORCYCLE'],orderTypes:['PARCELS'],maxWeightKg:'10',city:'Бишкек'},courierVehicle:{ownership:'OWN',brand:'Honda',model:'CB',year:'2022',plateNumber:'01 123 AAA'}};
  const slots=requiredUploadSlots(['COURIER'],motorData),withoutInsuranceExpiry=uploaded(slots).map(upload=>upload.slotKey==='courier_insurance'?{...upload,expiresAt:null}:upload);
  assert.ok(validateRegistrationSubmission({roles:['COURIER'],data:motorData,uploads:withoutInsuranceExpiry,today}).some(error=>error.field==='uploads.courier_insurance.expiresAt'&&error.code==='EXPIRY_REQUIRED'));
  const datedData={...motorData,documentExpiries:{courier_insurance:'01.10.2030'}},effectiveUploads=registrationUploadsWithEffectiveExpiry(datedData,withoutInsuranceExpiry);
  assert.equal(effectiveUploads.find(upload=>upload.slotKey==='courier_insurance')?.expiresAt?.toISOString(),'2030-10-01T23:59:59.999Z');
  assert.ok(!validateRegistrationSubmission({roles:['COURIER'],data:datedData,uploads:effectiveUploads,today}).some(error=>error.code==='EXPIRY_REQUIRED'));
  const adminExpiry=new Date('2031-01-01T23:59:59.999Z'),reviewed=registrationUploadsWithEffectiveExpiry(datedData,[{slotKey:'courier_insurance',status:'APPROVED',expiresAt:adminExpiry}]);
  assert.equal(reviewed[0].expiresAt,adminExpiry,'stored admin-reviewed expiry remains canonical during another role resubmit');
  const conflicting={...motorData,documentExpiries:{license_front:'01.01.2035'}},conflictingUpload=registrationUploadsWithEffectiveExpiry(conflicting,[{slotKey:'license_front',status:'UPLOADED',expiresAt:null}]);
  assert.equal(conflictingUpload[0].expiresAt?.toISOString(),'2030-01-01T23:59:59.999Z','structured licence expiry has priority');
  assert.ok(validateRegistrationDataValues(conflicting,['COURIER'],today).some(error=>error.field==='documentExpiries.license_front'&&error.code==='DUPLICATE_EXPIRY_SOURCE'));
});

test('config-driven expiry data is allow-listed and editable only for a returned upload',()=>{
  assert.deepEqual(validateRegistrationDataValues({taxiVehicle:{ownership:'OWN'},documentExpiries:{taxi_insurance:'01.10.2026'}},['TAXI_DRIVER'],today),[]);
  assert.ok(validateRegistrationDataValues({taxiVehicle:{ownership:'OWN'},documentExpiries:{arbitrary_slot:'01.10.2026'}},['TAXI_DRIVER'],today).some(error=>error.code==='UNKNOWN_FIELD'));
  const service=new RegistrationService({} as never,{} as never,{} as never);
  const application={status:'CORRECTION_REQUIRED',roles:[{selected:true,status:'CORRECTION_REQUIRED',canResubmit:true,correctionFields:[]}],uploads:[{slotKey:'taxi_insurance',status:'CORRECTION_REQUIRED',canReupload:true}]};
  assert.doesNotThrow(()=>(service as any).assertCorrectionScope(application,{documentExpiries:{taxi_insurance:'01.10.2026'}},{documentExpiries:{taxi_insurance:'01.11.2026'}}));
  assert.throws(()=>(service as any).assertCorrectionScope(application,{documentExpiries:{taxi_insurance:'01.10.2026'}},{documentExpiries:{taxi_insurance:'01.10.2026',taxi_registration:'01.11.2026'}}));
  const identityApplication={...application,roles:[{selected:true,status:'CORRECTION_REQUIRED',canResubmit:true,correctionFields:['identity.expiresAt']}],uploads:[{slotKey:'identity_front',status:'EXPIRED',canReupload:true}]};
  assert.doesNotThrow(()=>(service as any).assertCorrectionScope(identityApplication,{identity:{expiresAt:'01.10.2026'}},{identity:{expiresAt:'01.10.2027'}}));
  const replacedInsurance={...application,roles:[{selected:true,status:'CORRECTION_REQUIRED',canResubmit:true,correctionFields:['documentExpiries.taxi_insurance']}],uploads:[{slotKey:'taxi_insurance',status:'UPLOADED',canReupload:true}]};
  assert.doesNotThrow(()=>(service as any).assertCorrectionScope(replacedInsurance,{documentExpiries:{taxi_insurance:'01.10.2026'}},{documentExpiries:{taxi_insurance:'01.10.2027'}}));
});

test('upload gate rejects oversized, concurrent and excessive heavy work before decoding',async()=>{
  const counts=new Map<string,number>(),limits={take:async(key:string,max:number)=>{const count=(counts.get(key)??0)+1;counts.set(key,count);if(count>max)throw new (await import('@nestjs/common')).HttpException('rate',429);}};
  const gate=new RegistrationUploadGate(limits as never);
  const context=(id:string,contentLength?:number,ip='127.0.0.1')=>({switchToHttp:()=>({getRequest:()=>({actor:{id},ip,headers:contentLength===undefined?{}:{'content-length':String(contentLength)}})})}) as any;
  const pending=new Subject<unknown>(),subscription=(await gate.intercept(context('user-1'),{handle:()=>pending} as any)).subscribe();
  await assert.rejects(()=>gate.intercept(context('user-1'),{handle:()=>of(null)} as any),(error:any)=>error?.getStatus?.()===429);
  await lastValueFrom(await gate.intercept(context('user-2'),{handle:()=>of(null)} as any));
  pending.complete();subscription.unsubscribe();
  await lastValueFrom(await gate.intercept(context('user-1'),{handle:()=>of(null)} as any));
  await assert.rejects(()=>gate.intercept(context('user-3',13*1024*1024),{handle:()=>of(null)} as any),(error:any)=>error?.getStatus?.()===413);

  const limitedCounts=new Map<string,number>(),limitedGate=new RegistrationUploadGate({take:async(key:string,max:number)=>{const count=(limitedCounts.get(key)??0)+1;limitedCounts.set(key,count);if(count>max)throw new (await import('@nestjs/common')).HttpException('rate',429);}} as never);
  assert.ok(REGISTRATION_UPLOADS_PER_USER_HOUR>=REGISTRATION_CONFIG.upload.maxFiles*2,'the first-time form and one full retry fit in the user bucket');
  for(let index=0;index<REGISTRATION_UPLOADS_PER_USER_HOUR;index++)await lastValueFrom(await limitedGate.intercept(context('rate-user'),{handle:()=>of(null)} as any));
  await assert.rejects(()=>limitedGate.intercept(context('rate-user'),{handle:()=>of(null)} as any),(error:any)=>error?.getStatus?.()===429);
});

test('expiry worker keeps due documents independent from deferred retry backlog',async()=>{
  const deferred=Array.from({length:250},(_,index)=>({id:`role-${String(index).padStart(3,'0')}`,applicationId:`application-${index}`})),uploadQueries:any[]=[],roleQueries:any[]=[];
  let transactions=0;
  const db={
    performerUpload:{findMany:async(query:any)=>{uploadQueries.push(query);return query.where.status.in.includes('EXPIRING')?[{id:'newly-due',applicationId:'due-application'}]:[];}},
    performerApplicationRole:{findMany:async(query:any)=>{roleQueries.push(query);const cursor=query.where.id?.gt,index=cursor?deferred.findIndex(row=>row.id===cursor)+1:0;return deferred.slice(index,index+query.take);}},
    $transaction:async()=>{transactions++;return {changed:false,reconcile:false,userId:'user'};},
  };
  const service=new RegistrationAdminService(db as never,{} as never,{} as never);
  await service.processDocumentExpiry(today);
  assert.equal(uploadQueries.length,2);
  assert.deepEqual(uploadQueries[0].where.status.in,['APPROVED','ACTIVE','EXPIRING']);
  assert.deepEqual(uploadQueries[1].where.status.in,['APPROVED','ACTIVE']);
  assert.equal(uploadQueries[0].take,200);
  assert.equal(roleQueries[0].take,200);
  assert.equal(transactions,201,'newly due item and an independent deferred batch are both processed');
  await service.processDocumentExpiry(today);
  assert.equal(roleQueries[1].where.id.gt,'role-199');
  assert.equal(transactions,252,'the cursor advances beyond a permanently deferred first batch');
});

test('review requirements are calculated for one role at a time',()=>{
  const data={courier:{transportModes:['FOOT'],useExistingVehicle:true}};
  assert.deepEqual(requiredUploadSlotsForRole('COURIER',data),['profile_photo','identity_front','identity_back']);
  assert.ok(requiredUploadSlotsForRole('TAXI_DRIVER',data).includes('taxi_registration'));
  assert.ok(!requiredUploadSlotsForRole('TAXI_DRIVER',data).includes('cargo_registration'));
});

test('resubmit validates only correctable roles and ignores a blocked independent role',()=>{
  const states=[
    {role:'TAXI_DRIVER',selected:true,status:'BLOCKED',canResubmit:false},
    {role:'CARGO_DRIVER',selected:true,status:'CORRECTION_REQUIRED',canResubmit:true},
  ] as const;
  const roles=correctableRegistrationRoles(states);
  assert.deepEqual(roles,['CARGO_DRIVER']);
  const data={
    personal,identity,driverLicense:{number:'DL-123',categories:['C'],expiresAt:'01.01.2030'},
    taxiVehicle:{ownership:'',brand:'',model:'',year:'',plateNumber:'',tariffs:[]},
    cargoVehicle:{ownership:'OWN',type:'Фургон',brand:'Mercedes',model:'Sprinter',year:'2022',plateNumber:'01 999 AAA',capacityKg:'2000'},
    cargoEquipment:{loadingTypes:['REAR']},
    documentExpiries:{taxi_insurance:'01.01.2030'},
  };
  const slots=requiredUploadSlots(roles,data);
  const errors=validateRegistrationSubmission({roles,selectedRoles:['TAXI_DRIVER','CARGO_DRIVER'],data,uploads:uploaded(slots),today});
  assert.deepEqual(errors,[],'approved-role expiry metadata must not block another role resubmit');
});

test('server derives the only allowed kind and role for every upload slot',()=>{
  const data={taxiVehicle:{ownership:'OWN'},courier:{transportModes:['FOOT'],orderTypes:['MEALS']}};
  assert.deepEqual(registrationUploadSlotSpec('taxi_registration',['TAXI_DRIVER','COURIER'],data),{slotKey:'taxi_registration',kind:'VEHICLE_DOCUMENT',role:'TAXI_DRIVER',required:true});
  assert.deepEqual(registrationUploadSlotSpec('courier_health_book',['TAXI_DRIVER','COURIER'],data),{slotKey:'courier_health_book',kind:'ADDITIONAL_DOCUMENT',role:'COURIER',required:false});
  assert.deepEqual(registrationUploadSlotSpec('taxi_additional_medical-certificate',['TAXI_DRIVER'],data),{slotKey:'taxi_additional_medical-certificate',kind:'ADDITIONAL_DOCUMENT',role:'TAXI_DRIVER',required:false});
  assert.equal(registrationUploadSlotSpec('arbitrary_slot',['TAXI_DRIVER'],data),null);
  assert.deepEqual(registrationAdditionalDocumentSlotKeys('CARGO_DRIVER','permit',3),['cargo_additional_permit_front','cargo_additional_permit_back','cargo_additional_permit_side_3']);
});

test('additional vehicles have role-scoped dynamic slots, expiry and their own cargo equipment',()=>{
  const roles=['TAXI_DRIVER','CARGO_DRIVER'] as const;
  const vehicle=(overrides:Record<string,unknown>)=>({ownership:'OWN',brand:'Toyota',model:'Hiace',year:'2022',color:'Белый',plateNumber:'01 123 ABC',...overrides});
  const data={
    personal,identity,driverLicense:{number:'DL-123',categories:['B','C'],expiresAt:'01.01.2030'},
    taxiVehicle:vehicle({tariffs:['ECONOMY']}),cargoVehicle:vehicle({type:'Фургон',capacityKg:'2000',plateNumber:'01 124 ABC'}),cargoEquipment:{loadingTypes:['REAR']},
    vehicles:[
      vehicle({clientId:'v-taxi2',usage:'TAXI',ownership:'RENT',plateNumber:'01 125 ABC',tariffs:['ECONOMY'],equipment:{loadingTypes:[]}}),
      vehicle({clientId:'v-cargo2',usage:'CARGO',type:'Фургон',capacityKg:'2500',plateNumber:'01 126 ABC',equipment:{loadingTypes:['SIDE'],refrigerator:true,minTemperature:'-10',maxTemperature:'5'}}),
    ],
  };
  const slots=requiredUploadSlots(roles,data);
  for(const slot of ['vehicle_v-taxi2_registration','vehicle_v-taxi2_insurance','vehicle_v-taxi2_rental','vehicle_v-taxi2_photo_interior_front','vehicle_v-cargo2_registration','vehicle_v-cargo2_insurance','vehicle_v-cargo2_photo_cargo_bay'])assert.ok(slots.includes(slot),slot);
  assert.equal(registrationUploadRequiresExpiry('vehicle_v-cargo2_insurance'),true);
  assert.deepEqual(registrationUploadSlotSpec('vehicle_v-cargo2_photo_front',roles,data),{slotKey:'vehicle_v-cargo2_photo_front',kind:'VEHICLE_PHOTO',role:'CARGO_DRIVER',required:true});
  assert.deepEqual(validateRegistrationSubmission({roles,data,uploads:uploaded(slots),today}),[]);

  const invalidData={...data,vehicles:[...data.vehicles,{...data.vehicles[0],clientId:'v-taxi2'},{...data.vehicles[0],clientId:'bad id'},{...data.vehicles[0],clientId:'v-third'},{...data.vehicles[0],clientId:'v-fourth'}]};
  const invalid=validateRegistrationDataValues(invalidData,roles,today);
  assert.ok(invalid.some(error=>error.field==='vehicles'&&error.code==='TOO_MANY'));
  assert.ok(invalid.some(error=>error.field==='vehicles.v-taxi2.clientId'&&error.code==='DUPLICATE'));
  assert.ok(invalid.some(error=>error.field==='vehicles.3.clientId'));
  const dormant={vehicles:[vehicle({clientId:'v-courier',usage:'COURIER',equipment:{loadingTypes:[]}})],documentExpiries:{'vehicle_v-courier_insurance':'01.01.2030'}};
  assert.deepEqual(validateRegistrationDataValues(dormant,roles,today),[],'data and expiry metadata survive deselecting their role');
});

test('courier extra reuse is exact and legacy candidate uses the selected vehicle',()=>{
  const baseVehicle={ownership:'OWN',brand:'Toyota',model:'Prius',year:'2021',color:'Серый',plateNumber:'01 100 AAA',tariffs:['ECONOMY']};
  const data={
    personal,identity,driverLicense:{number:'DL-123',categories:['B'],expiresAt:'01.01.2030'},taxiVehicle:baseVehicle,
    courier:{transportModes:['CAR'],orderTypes:['PARCELS'],maxWeightKg:'10',city:'Бишкек',useExistingVehicle:true,existingVehicleUsage:'TAXI',existingVehicleClientId:'v-second'},
    vehicles:[{...baseVehicle,clientId:'v-second',usage:'TAXI',plateNumber:'01 200 BBB',equipment:{loadingTypes:[]}}],
  };
  const slots=requiredUploadSlots(['COURIER'],data);
  assert.ok(!slots.some(slot=>slot.startsWith('vehicle_')),'an independent approved taxi role owns the selected extra documents');
  assert.ok(!validateRegistrationSubmission({roles:['COURIER'],selectedRoles:['TAXI_DRIVER','COURIER'],data,uploads:uploaded(slots),today}).some(error=>error.field==='courier.existingVehicleClientId'));
  const missing={...data,courier:{...data.courier,existingVehicleClientId:'v-missing'}};
  assert.ok(validateRegistrationSubmission({roles:['COURIER'],selectedRoles:['TAXI_DRIVER','COURIER'],data:missing,uploads:uploaded(requiredUploadSlots(['COURIER'],missing)),today}).some(error=>error.field==='courier.existingVehicleClientId'));
  const adminService=new RegistrationAdminService({} as never,{} as never,{} as never);
  assert.equal((adminService as any).vehicleCandidate('TAXI_DRIVER',data,[]).plate,'01 100 AAA');
  assert.deepEqual((adminService as any).vehicleCandidate('TAXI_DRIVER',data,[],'v-second'),{make:'Toyota Prius',color:'Серый',plate:'01 200 BBB',transportClass:'ECONOMY',photoSlot:'vehicle_v-second_photo_front'});
});

test('additional-vehicle correction scope is canonical and isolated by clientId and field',()=>{
  const service=new RegistrationService({} as never,{} as never,{} as never),adminService=new RegistrationAdminService({} as never,{} as never,{} as never);
  const before={vehicles:[
    {clientId:'v-one',usage:'TAXI',brand:'Toyota',model:'Prius'},
    {clientId:'v-two',usage:'TAXI',brand:'Honda',model:'Fit'},
  ]};
  const application={status:'CORRECTION_REQUIRED',roles:[{selected:true,status:'CORRECTION_REQUIRED',canResubmit:true,correctionFields:['vehicles.v-one.brand']}],uploads:[]};
  assert.doesNotThrow(()=>(service as any).assertCorrectionScope(application,before,{vehicles:[{...before.vehicles[0],brand:'Lexus'},before.vehicles[1]]}));
  assert.doesNotThrow(()=>(service as any).assertCorrectionScope(application,before,{vehicles:[before.vehicles[1],{...before.vehicles[0],brand:'Lexus'}]}),'array reordering is not a data mutation');
  assert.throws(()=>(service as any).assertCorrectionScope(application,before,{vehicles:[before.vehicles[0],{...before.vehicles[1],brand:'Mazda'}]}));
  assert.throws(()=>(service as any).assertCorrectionScope(application,before,{vehicles:[{...before.vehicles[0],model:'Camry'},before.vehicles[1]]}));
  assert.throws(()=>(service as any).assertCorrectionScope(application,before,{vehicles:[before.vehicles[1]]}));
  assert.deepEqual((adminService as any).normalizeCorrectionFields(['vehicles.0.brand'],before),['vehicles.v-one.brand']);
  assert.doesNotThrow(()=>(adminService as any).assertCorrectionFields('TAXI_DRIVER',['vehicles.v-one.brand'],before));
  assert.throws(()=>(adminService as any).assertCorrectionFields('CARGO_DRIVER',['vehicles.v-one.brand'],before));
});

test('exact upload replay succeeds after correction replacement commit and correction delete is blocked',async()=>{
  const bytes=Buffer.from('%PDF-1.4 exact retry'),checksum=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'),now=new Date();
  const previous={id:'upload-1',slotKey:'identity_front',kind:'IDENTITY_DOCUMENT',role:null,status:'UPLOADED',mimeType:'application/pdf',byteSize:bytes.length,checksum,version:2,expiresAt:null,reasonCode:null,reasonText:null,canReupload:true,createdAt:now,updatedAt:now};
  let mutations=0;
  const tx:any={
    $queryRaw:async()=>[],
    performerApplication:{
      upsert:async()=>({id:'application-1'}),
      findUniqueOrThrow:async()=>({id:'application-1',status:'CORRECTION_REQUIRED',canResubmit:true,data:{},roles:[{selected:true,role:'COURIER'}]}),
      update:async()=>{mutations++;},
    },
    performerUpload:{findUnique:async()=>previous,findUniqueOrThrow:async()=>previous,count:async()=>1,aggregate:async()=>({_sum:{byteSize:bytes.length}}),upsert:async()=>{mutations++;return previous;},delete:async()=>{mutations++;}},
  };
  const db:any={$transaction:async(callback:any)=>callback(tx),performerApplication:{findUnique:async()=>({id:'application-1'})}};
  const service=new RegistrationService(db,{} as never,{} as never),actor={id:'user-1',role:'CLIENT'} as any;
  const result=await service.upload(actor,'identity_front',{kind:'IDENTITY_DOCUMENT'}, {buffer:bytes,mimetype:'application/pdf',size:bytes.length});
  assert.match(result.remoteUrl,/\?v=2$/);assert.equal(mutations,0);
  await assert.rejects(()=>service.removeUpload(actor,'identity_front'),(error:any)=>error?.getStatus?.()===403);
  assert.equal(mutations,0);
});

test('submission accepts only configured consents and requires every mandatory consent',()=>{
  assert.deepEqual(validateRegistrationConsents({truthConfirmed:true,termsAccepted:true,acceptedConsentIds:['truth-confirmation','performer-terms']}),[]);
  const missing=validateRegistrationConsents({truthConfirmed:true,termsAccepted:true,acceptedConsentIds:['truth-confirmation']});
  assert.ok(missing.some(error=>error.field==='acceptedConsentIds.performer-terms'&&error.code==='REQUIRED'));
  assert.ok(validateRegistrationConsents({truthConfirmed:true,termsAccepted:true,acceptedConsentIds:['truth-confirmation','performer-terms','invented-consent']}).some(error=>error.code==='UNKNOWN_CONSENT'));
});

test('server rejects out-of-config enums, dates and numeric ranges',()=>{
  const errors=validateRegistrationDataValues({
    personal:{city:'Atlantis',birthDate:'31.02.2000',language:'xx'},
    driverLicense:{categories:['Z'],experienceYears:'999'},
    taxiVehicle:{ownership:'BORROWED',year:'1800',tariffs:['ULTRA'],plateNumber:'!'},
    payment:{type:'CRYPTO',last4:'12345'},
  },['TAXI_DRIVER'],today);
  const fields=new Set(errors.map(error=>error.field));
  for(const field of ['personal.city','personal.birthDate','personal.language','driverLicense.categories','driverLicense.experienceYears','taxiVehicle.ownership','taxiVehicle.year','taxiVehicle.tariffs','taxiVehicle.plateNumber','payment.type','payment.last4'])assert.ok(fields.has(field),field);
});
