export const PERFORMER_ROLES = ['TAXI_DRIVER','CARGO_DRIVER','COURIER'] as const;
export type PerformerRoleValue = typeof PERFORMER_ROLES[number];

export const REGISTRATION_UPLOAD_KINDS = ['PROFILE_PHOTO','IDENTITY_DOCUMENT','DRIVER_LICENSE','VEHICLE_DOCUMENT','VEHICLE_PHOTO','ADDITIONAL_DOCUMENT'] as const;
export type RegistrationUploadKindValue = typeof REGISTRATION_UPLOAD_KINDS[number];

export type RegistrationData = Record<string,unknown>;
export type RegistrationUploadForValidation = {slotKey:string;status:string;kind?:string;role?:string|null;expiresAt?:Date|string|null};
export type RegistrationValidationError = {field:string;code:string;message:string};
export type RegistrationApplicationStatusValue = 'NOT_STARTED'|'DRAFT'|'SUBMITTED'|'UNDER_REVIEW'|'CORRECTION_REQUIRED'|'APPROVED'|'REJECTED'|'BLOCKED';

export function registrationProjectionIssueText(code:string|null|undefined) {
  if(code==='DEPENDENCY_NOT_APPROVED')return 'Сначала должен быть одобрен транспорт, выбранный для этого направления';
  if(code==='MISSING_VEHICLE_DATA')return 'Не удалось подготовить транспорт для рабочего профиля';
  if(code==='LEGACY_PROFILE_CONFLICT')return 'Одобренный транспорт отличается от уже активного основного транспорта';
  if(code==='LEGACY_PROFILE_CAPABILITY_CONFLICT')return 'Текущий рабочий профиль не поддерживает этот вид заказов';
  if(code==='LEGACY_SINGLE_VEHICLE_LIMIT')return 'Для работы доступен другой основной транспорт; переключение нескольких автомобилей пока не поддерживается';
  if(code==='ACTIVE_WORK_DEFERRED')return 'Обновление рабочего профиля завершится после активного заказа';
  return null;
}

const DRIVER_LICENSE_UPLOADS = ['license_front','license_back'] as const;
const TAXI_PHOTOS = ['taxi_photo_front'];
const CARGO_PHOTOS = ['cargo_photo_front'];
const ADDITIONAL_VEHICLE_PHOTOS={TAXI:['front'],CARGO:['front'],COURIER:['front']} as const;
export const DOCUMENTED_COURIER_METHODS = new Set(['MOPED','MOTORCYCLE','CAR','TRUCK','CARGO_CAR']);
export const LIGHT_COURIER_METHODS = new Set(['FOOT','BICYCLE','E_BICYCLE','SCOOTER']);
const ACCEPTABLE_UPLOAD_STATUSES = new Set(['UPLOADED','UNDER_REVIEW','APPROVED','ACTIVE','EXPIRING']);
const REQUIRED_EXPIRY_UPLOAD_SLOTS = new Set(['identity_front','identity_back','license_front','license_back','taxi_insurance','cargo_insurance','courier_insurance']);
export const MAX_ADDITIONAL_VEHICLES=5;
export const ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN=/^v-[a-z0-9]+$/;
export const REGISTRATION_EXPIRY_WARNING_DAYS=30;

export function aggregateRegistrationStatus(statuses:readonly RegistrationApplicationStatusValue[]):RegistrationApplicationStatusValue {
  if(!statuses.length)return 'NOT_STARTED';
  if(statuses.includes('CORRECTION_REQUIRED'))return 'CORRECTION_REQUIRED';
  if(statuses.includes('UNDER_REVIEW'))return 'UNDER_REVIEW';
  if(statuses.includes('SUBMITTED'))return 'SUBMITTED';
  if(statuses.some(status=>status==='DRAFT'||status==='NOT_STARTED'))return 'DRAFT';
  if(statuses.every(status=>status==='APPROVED'))return 'APPROVED';
  if(statuses.includes('BLOCKED'))return 'BLOCKED';
  return 'REJECTED';
}

export function aggregateRegistrationRoleStates(roles:readonly {status:RegistrationApplicationStatusValue;canResubmit?:boolean}[]):RegistrationApplicationStatusValue {
  return aggregateRegistrationStatus(roles.map(role=>role.status==='REJECTED'&&role.canResubmit?'CORRECTION_REQUIRED':role.status));
}

export function correctableRegistrationRoles(roles:readonly {role:PerformerRoleValue;selected:boolean;status:RegistrationApplicationStatusValue;canResubmit?:boolean}[]) {
  return roles.filter(item=>item.selected&&(item.status==='DRAFT'||item.status==='CORRECTION_REQUIRED'||item.status==='REJECTED'&&item.canResubmit)).map(item=>item.role);
}

export function registrationCapabilityCeiling(roles:readonly PerformerRoleValue[],modes:readonly string[],transportClass:'ECONOMY'|'COMFORT'|'TRUCK') {
  const selected=new Set(roles),motorCourier=modes.some(mode=>DOCUMENTED_COURIER_METHODS.has(mode));
  return {
    acceptsEconomy:selected.has('TAXI_DRIVER')&&transportClass!=='TRUCK',
    acceptsComfort:selected.has('TAXI_DRIVER')&&transportClass==='COMFORT',
    acceptsDeliveryCar:selected.has('COURIER')&&motorCourier&&transportClass!=='TRUCK',
    acceptsDeliveryTruck:transportClass==='TRUCK'&&(selected.has('CARGO_DRIVER')||selected.has('COURIER')&&motorCourier),
  };
}

export function registrationRoleStatusAfterUploadDecision(
  current:{status:RegistrationApplicationStatusValue;canResubmit?:boolean},
  decision:'CORRECTION_REQUIRED'|'REJECTED'|'BLOCKED',
  canReupload:boolean,
):RegistrationApplicationStatusValue|null {
  // Upload review may tighten an open role, but terminal role decisions are only
  // reversible through the explicit role-review endpoint.
  if(current.status==='BLOCKED'||current.status==='REJECTED'&&!current.canResubmit)return null;
  if(decision==='BLOCKED')return 'BLOCKED';
  if(decision==='REJECTED'&&!canReupload)return 'REJECTED';
  return 'CORRECTION_REQUIRED';
}

export function registrationUploadRequiresExpiry(slotKey:string) {
  return REQUIRED_EXPIRY_UPLOAD_SLOTS.has(slotKey)||/^vehicle_v-[a-z0-9]+_insurance$/.test(slotKey);
}

export function registrationExpiryCorrectionFields(slotKey:string) {
  if(slotKey.startsWith('identity_'))return ['identity.expiresAt'];
  if(slotKey.startsWith('license_'))return ['driverLicense.expiresAt'];
  if(registrationUploadRequiresExpiry(slotKey))return [`documentExpiries.${slotKey}`];
  return [];
}

export function registrationUploadCanExpire(kind:RegistrationUploadKindValue) {
  return ['IDENTITY_DOCUMENT','DRIVER_LICENSE','VEHICLE_DOCUMENT','ADDITIONAL_DOCUMENT'].includes(kind);
}

export function registrationDocumentLifecycleStatus(expiresAt:Date|null|undefined,now:Date,warningDays=REGISTRATION_EXPIRY_WARNING_DAYS):'ACTIVE'|'EXPIRING'|'EXPIRED'|null {
  if(!expiresAt)return null;
  if(expiresAt.getTime()<=now.getTime())return 'EXPIRED';
  return expiresAt.getTime()<=now.getTime()+warningDays*86400000?'EXPIRING':'ACTIVE';
}

export function parseRegistrationExpiryDate(value:string):Date|null {
  const raw=value.trim(),display=raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/),dateOnly=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(display||dateOnly) {
    const year=Number(display?.[3]??dateOnly?.[1]),month=Number(display?.[2]??dateOnly?.[2]),day=Number(display?.[1]??dateOnly?.[3]);
    const parsed=new Date(Date.UTC(year,month-1,day,23,59,59,999));
    return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day?parsed:null;
  }
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))return null;
  const parsed=new Date(raw);
  return Number.isFinite(parsed.getTime())?parsed:null;
}

export function registrationUploadExpiryOverrides(data:RegistrationData) {
  const result:Record<string,Date>={};
  const identity=record(data.identity),license=record(data.driverLicense),documentExpiries=record(data.documentExpiries);
  if(documentExpiries)for(const [slotKey,value] of Object.entries(documentExpiries)) {
    const expiry=typeof value==='string'?parseRegistrationExpiryDate(value):null;
    if(expiry)result[slotKey]=expiry;
  }
  const identityExpiry=typeof identity?.expiresAt==='string'?parseRegistrationExpiryDate(identity.expiresAt):null;
  const licenseExpiry=typeof license?.expiresAt==='string'?parseRegistrationExpiryDate(license.expiresAt):null;
  // Structured identity/licence fields are authoritative even when defensive
  // handling encounters old client data with a conflicting per-slot value.
  if(identityExpiry)for(const slotKey of ['identity_front','identity_back'])result[slotKey]=identityExpiry;
  if(licenseExpiry)for(const slotKey of ['license_front','license_back'])result[slotKey]=licenseExpiry;
  return result;
}

export function registrationUploadsWithEffectiveExpiry<T extends {slotKey:string;status?:string;expiresAt?:Date|string|null}>(data:RegistrationData,uploads:readonly T[]):T[] {
  const overrides=registrationUploadExpiryOverrides(data);
  return uploads.map(upload=>upload.status==='UPLOADED'&&overrides[upload.slotKey]?{...upload,expiresAt:overrides[upload.slotKey]}:upload);
}

export const REGISTRATION_CONFIG = {
  version:'kg-2026-09-24',
  country:'KG',
  minimumAge:18,
  minimumAgeByRole:{TAXI_DRIVER:18,CARGO_DRIVER:18,COURIER:18},
  estimatedReviewTimeText:'Срок проверки появится после принятия анкеты оператором',
  reviewEta:null,
  legalTermsVersion:'performer-terms-2026-09-22',
  documentExpiry:{warningDays:REGISTRATION_EXPIRY_WARNING_DAYS,requiredSlots:[...REQUIRED_EXPIRY_UPLOAD_SLOTS]},
  supportPhone:'+996700000000',
  roles:[
    {id:'TAXI_DRIVER',title:'Водитель такси',description:'Перевозите пассажиров на легковом автомобиле'},
    {id:'CARGO_DRIVER',title:'Водитель грузового транспорта',description:'Выполняйте грузовые перевозки на собственном или арендованном транспорте'},
    {id:'COURIER',title:'Курьер',description:'Доставляйте посылки, документы, продукты и другие заказы'},
  ],
  countries:['Кыргызстан','Казахстан','Узбекистан','Таджикистан','Россия','Другое'],
  cities:['Бишкек','Ош','Джалал-Абад','Каракол','Токмок','Нарын','Талас','Баткен'],
  districts:{
    'Бишкек':['Ленинский','Октябрьский','Первомайский','Свердловский'],
    'Ош':['Ак-Буура','Анар','Керме-Тоо','Курманжан-Датка','Манас-Ата','Сулайман-Тоо'],
  },
  citizenships:[{id:'KG',name:'Кыргызстан'},{id:'KZ',name:'Казахстан'},{id:'UZ',name:'Узбекистан'},{id:'TJ',name:'Таджикистан'},{id:'RU',name:'Россия'},{id:'OTHER',name:'Другое'}],
  languages:[{id:'ru',name:'Русский'},{id:'ky',name:'Кыргызча'}],
  driverLicenseCategories:['A','A1','B','B1','BE','C','C1','CE','D','D1','DE','Tm','Tb'],
  cargoVehicleTypes:['Пикап','Минивэн','Каблук','Фургон','Бортовой','Тентованный','Рефрижератор','Эвакуатор','Самосвал','Тягач','Другое'],
  taxiBodyTypes:['Седан','Хэтчбек','Универсал','Кроссовер','Минивэн','Другое'],
  tariffs:[{id:'ECONOMY',title:'Эконом'},{id:'COMFORT',title:'Комфорт'},{id:'BUSINESS',title:'Бизнес'}],
  courierTransportModes:['FOOT','BICYCLE','E_BICYCLE','MOPED','SCOOTER','MOTORCYCLE','CAR','TRUCK'],
  courierOrderTypes:['DOCUMENTS','PARCELS','GROCERIES','MEALS','MEDICINE','LARGE'],
  loadingTypes:['REAR','SIDE','TOP'],
  payoutMethods:['CARD','BANK_ACCOUNT','WALLET'],
  documents:[
    {id:'medical-certificate',title:'Медицинская справка',description:'Дополнительный документ при запросе проверки',required:false,sides:1,role:'TAXI_DRIVER'},
    {id:'cargo-permit',title:'Разрешение на грузовые перевозки',description:'Для отдельных типов перевозок',required:false,sides:1,role:'CARGO_DRIVER'},
  ],
  legalConsents:[
    {id:'truth-confirmation',required:true,title:'Подтверждаю достоверность указанных данных'},
    {id:'performer-terms',required:true,title:'Принимаю условия работы исполнителя'},
  ],
  documentRequirements:[
    {id:'profile-photo',title:'Фотография профиля',kind:'PROFILE_PHOTO',slots:['profile_photo'],requiredFor:[...PERFORMER_ROLES]},
    {id:'identity',title:'Удостоверение личности',kind:'IDENTITY_DOCUMENT',slots:['identity_front','identity_back'],requiredFor:[...PERFORMER_ROLES]},
    {id:'driver-license',title:'Водительское удостоверение',kind:'DRIVER_LICENSE',slots:[...DRIVER_LICENSE_UPLOADS],requiredFor:['TAXI_DRIVER','CARGO_DRIVER'],condition:'Также требуется для моторизованной доставки'},
    {id:'taxi-registration',title:'Документы автомобиля',kind:'VEHICLE_DOCUMENT',slots:['taxi_registration','taxi_insurance'],expirySlots:['taxi_insurance'],requiredFor:['TAXI_DRIVER']},
    {id:'taxi-photos',title:'Фотографии автомобиля такси',kind:'VEHICLE_PHOTO',slots:TAXI_PHOTOS,requiredFor:['TAXI_DRIVER']},
    {id:'cargo-registration',title:'Документы грузового автомобиля',kind:'VEHICLE_DOCUMENT',slots:['cargo_registration','cargo_insurance'],expirySlots:['cargo_insurance'],requiredFor:['CARGO_DRIVER']},
    {id:'cargo-photos',title:'Фотографии грузового автомобиля',kind:'VEHICLE_PHOTO',slots:CARGO_PHOTOS,requiredFor:['CARGO_DRIVER']},
    {id:'courier-vehicle',title:'Документы транспорта курьера',kind:'VEHICLE_DOCUMENT',slots:['courier_registration','courier_insurance'],expirySlots:['courier_insurance'],requiredFor:['COURIER'],condition:'Только для моторизованной доставки с отдельным транспортом'},
    {id:'courier-vehicle-photo',title:'Фотография транспорта курьера',kind:'VEHICLE_PHOTO',slots:['courier_photo'],requiredFor:['COURIER'],condition:'Только для моторизованной доставки с отдельным транспортом'},
    {id:'rental-proof',title:'Договор аренды или доверенность',kind:'VEHICLE_DOCUMENT',slots:[],requiredFor:['TAXI_DRIVER','CARGO_DRIVER'],condition:'Только для арендованного транспорта'},
  ],
  upload:{maxBytes:12*1024*1024,maxTotalBytes:256*1024*1024,maxFiles:128,allowedMimeTypes:['image/jpeg','image/png','image/webp','application/pdf']},
} as const;

export function validateRegistrationConsents(input:{truthConfirmed:boolean;termsAccepted:boolean;acceptedConsentIds:readonly string[]}) {
  const allowed=new Set(REGISTRATION_CONFIG.legalConsents.map(consent=>consent.id));
  const accepted=new Set(input.acceptedConsentIds);
  const errors:RegistrationValidationError[]=[];
  for(const id of accepted)if(!allowed.has(id as typeof REGISTRATION_CONFIG.legalConsents[number]['id']))errors.push({field:'acceptedConsentIds',code:'UNKNOWN_CONSENT',message:`Неизвестное согласие: ${id}`});
  for(const consent of REGISTRATION_CONFIG.legalConsents)if(consent.required&&!accepted.has(consent.id))errors.push({field:`acceptedConsentIds.${consent.id}`,code:'REQUIRED',message:`Необходимо принять условие «${consent.title}»`});
  if(!input.truthConfirmed)errors.push({field:'truthConfirmed',code:'REQUIRED',message:'Подтвердите достоверность данных'});
  if(!input.termsAccepted)errors.push({field:'termsAccepted',code:'REQUIRED',message:'Примите условия работы исполнителя'});
  return errors;
}

function record(value:unknown):Record<string,unknown>|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return value as Record<string,unknown>;
}
function text(value:unknown) {return typeof value==='string'?value.trim():'';}
function stringArray(value:unknown) {return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}
function valueAt(source:RegistrationData,...path:string[]) {
  let value:unknown=source;
  for(const part of path) {const item=record(value);if(!item)return undefined;value=item[part];}
  return value;
}
function firstValue(source:RegistrationData,paths:string[][]) {
  for(const path of paths) {const value=valueAt(source,...path);if(value!==undefined&&value!==null&&value!=='')return value;}
  return undefined;
}

export function courierTransportModes(data:RegistrationData) {
  return stringArray(firstValue(data,[['courier','transportModes'],['courierSettings','transportModes'],['courierSettings','deliveryMethods']]));
}

type VehicleUsage='TAXI'|'CARGO'|'COURIER';
export function performerRoleForVehicleUsage(usage:string):PerformerRoleValue|null {
  return usage==='TAXI'?'TAXI_DRIVER':usage==='CARGO'?'CARGO_DRIVER':usage==='COURIER'?'COURIER':null;
}
export function registrationAdditionalVehicles(data:RegistrationData) {
  return Array.isArray(data.vehicles)?data.vehicles.map((value,index)=>({index,vehicle:record(value)})):[];
}

export function requiresDriverLicense(roles:readonly PerformerRoleValue[],data:RegistrationData) {
  if(roles.includes('TAXI_DRIVER')||roles.includes('CARGO_DRIVER'))return true;
  return roles.includes('COURIER')&&courierTransportModes(data).some(mode=>DOCUMENTED_COURIER_METHODS.has(mode));
}

export function registrationSteps(roles:readonly PerformerRoleValue[],data:RegistrationData) {
  const steps=['ROLES'];
  if(roles.includes('COURIER'))steps.push('COURIER_TRANSPORT');
  steps.push('PERSONAL_DATA');
  if(requiresDriverLicense(roles,data))steps.push('PROFILE_PHOTO');
  steps.push('IDENTITY_DOCUMENT');
  if(requiresDriverLicense(roles,data))steps.push('DRIVER_LICENSE');
  if(roles.includes('TAXI_DRIVER'))steps.push('TAXI_VEHICLE','TAXI_DOCUMENTS','TAXI_PHOTOS');
  if(roles.includes('CARGO_DRIVER'))steps.push('CARGO_VEHICLE','CARGO_DOCUMENTS','CARGO_PHOTOS');
  if(roles.includes('COURIER')) {
    if(courierTransportModes(data).some(mode=>DOCUMENTED_COURIER_METHODS.has(mode))&&!usesExistingVehicle(data))steps.push('COURIER_VEHICLE');
  }
  steps.push('REVIEW');
  return steps;
}

export function requiredUploadSlots(roles:readonly PerformerRoleValue[],data:RegistrationData) {
  return registrationUploadSlotSpecs(roles,data).filter(spec=>spec.required).map(spec=>spec.slotKey);
}

export function requiredUploadSlotsForRole(role:PerformerRoleValue,data:RegistrationData) {
  return requiredUploadSlots([role],data);
}

export type RegistrationUploadSlotSpec={slotKey:string;kind:RegistrationUploadKindValue;role:PerformerRoleValue|null;required:boolean};
export function registrationAdditionalDocumentSlotKeys(role:PerformerRoleValue,id:string,sides:number) {
  const prefix=role==='TAXI_DRIVER'?'taxi':role==='CARGO_DRIVER'?'cargo':'courier',base=`${prefix}_additional_${id}`;
  if(sides<=1)return [base];
  return Array.from({length:sides},(_,index)=>`${base}_${index===0?'front':index===1?'back':`side_${index+1}`}`);
}
export function registrationUploadSlotSpecs(roles:readonly PerformerRoleValue[],data:RegistrationData):RegistrationUploadSlotSpec[] {
  const specs:RegistrationUploadSlotSpec[]=[];
  const add=(slotKey:string,kind:RegistrationUploadKindValue,role:PerformerRoleValue|null,required=true)=>{if(!specs.some(item=>item.slotKey===slotKey))specs.push({slotKey,kind,role,required});};
  if(roles.length) {
    add('profile_photo','PROFILE_PHOTO',null,requiresDriverLicense(roles,data));
    add('identity_front','IDENTITY_DOCUMENT',null);add('identity_back','IDENTITY_DOCUMENT',null);
  }
  if(requiresDriverLicense(roles,data)) {add('license_front','DRIVER_LICENSE',null);add('license_back','DRIVER_LICENSE',null);}
  if(roles.includes('TAXI_DRIVER')) {
    add('taxi_registration','VEHICLE_DOCUMENT','TAXI_DRIVER');add('taxi_insurance','VEHICLE_DOCUMENT','TAXI_DRIVER');
    add('taxi_inspection','VEHICLE_DOCUMENT','TAXI_DRIVER',false);
    for(const slotKey of TAXI_PHOTOS)add(slotKey,'VEHICLE_PHOTO','TAXI_DRIVER');
    if(vehicleOwnership(data,'TAXI')==='RENT')add('taxi_rental','VEHICLE_DOCUMENT','TAXI_DRIVER');
  }
  if(roles.includes('CARGO_DRIVER')) {
    add('cargo_registration','VEHICLE_DOCUMENT','CARGO_DRIVER');add('cargo_insurance','VEHICLE_DOCUMENT','CARGO_DRIVER');
    add('cargo_inspection','VEHICLE_DOCUMENT','CARGO_DRIVER',false);
    for(const slotKey of CARGO_PHOTOS)add(slotKey,'VEHICLE_PHOTO','CARGO_DRIVER');
    if(vehicleOwnership(data,'CARGO')==='RENT')add('cargo_rental','VEHICLE_DOCUMENT','CARGO_DRIVER');
  }
  if(roles.includes('COURIER')) {
    if(courierTransportModes(data).some(mode=>DOCUMENTED_COURIER_METHODS.has(mode))&&!usesExistingVehicle(data)) {
      add('courier_registration','VEHICLE_DOCUMENT','COURIER');add('courier_insurance','VEHICLE_DOCUMENT','COURIER');add('courier_photo','VEHICLE_PHOTO','COURIER');
    }
    const orderTypes=stringArray(firstValue(data,[['courier','orderTypes'],['courierSettings','orderTypes']]));
    if(orderTypes.some(type=>type==='GROCERIES'||type==='MEALS'))add('courier_health_book','ADDITIONAL_DOCUMENT','COURIER',false);
  }
  for(const {vehicle} of registrationAdditionalVehicles(data)) {
    if(!vehicle)continue;
    const clientId=text(vehicle.clientId),usage=text(vehicle.usage).toUpperCase() as VehicleUsage,role=performerRoleForVehicleUsage(usage);
    if(clientId.length>64||!ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(clientId)||!role||!roles.includes(role))continue;
    const prefix=`vehicle_${clientId}`;
    add(`${prefix}_registration`,'VEHICLE_DOCUMENT',role);
    add(`${prefix}_insurance`,'VEHICLE_DOCUMENT',role);
    if(text(vehicle.ownership).toUpperCase()==='RENT')add(`${prefix}_rental`,'VEHICLE_DOCUMENT',role);
    for(const suffix of ADDITIONAL_VEHICLE_PHOTOS[usage])add(`${prefix}_photo_${suffix}`,'VEHICLE_PHOTO',role);
  }
  for(const requirement of REGISTRATION_CONFIG.documents) {
    const role=requirement.role as PerformerRoleValue;
    if(!roles.includes(role))continue;
    const ownership='ownership' in requirement?String(requirement.ownership):'';
    if(ownership&&role!=='COURIER'&&vehicleOwnership(data,role==='TAXI_DRIVER'?'TAXI':'CARGO')!==ownership)continue;
    for(const slotKey of registrationAdditionalDocumentSlotKeys(role,requirement.id,requirement.sides))add(slotKey,'ADDITIONAL_DOCUMENT',role,requirement.required);
  }
  return specs;
}

export function registrationUploadSlotSpec(slotKey:string,roles:readonly PerformerRoleValue[],data:RegistrationData) {
  return registrationUploadSlotSpecs(roles,data).find(item=>item.slotKey===slotKey)??null;
}

function vehicleFor(data:RegistrationData,usage:'TAXI'|'CARGO') {
  return record(data[usage==='TAXI'?'taxiVehicle':'cargoVehicle']);
}
function vehicleOwnership(data:RegistrationData,usage:'TAXI'|'CARGO') {return text(vehicleFor(data,usage)?.ownership).toUpperCase();}
function usesExistingVehicle(data:RegistrationData) {
  return Boolean(firstValue(data,[['courier','useExistingVehicle'],['courierSettings','existingVehicleId'],['courierSettings','reuseVehicleId'],['courier','existingVehicleId']]));
}

function required(errors:RegistrationValidationError[],data:RegistrationData,field:string,paths:string[][],message:string) {
  if(!text(firstValue(data,paths)))errors.push({field,code:'REQUIRED',message});
}
function validateVehicleRecord(errors:RegistrationValidationError[],vehicle:Record<string,unknown>|null,prefix:string,usage:VehicleUsage) {
  if(!vehicle) {errors.push({field:prefix,code:'REQUIRED',message:'Заполните данные транспорта'});return;}
  for(const [key,message] of [['ownership','Укажите, собственный транспорт или арендованный'],['brand','Укажите марку транспорта'],['model','Укажите модель транспорта'],['plateNumber','Введите государственный номер']] as const) {
    const aliases=key==='brand'?['brand','make']:key==='plateNumber'?['plateNumber','plate']:[key];
    if(!aliases.some(alias=>text(vehicle[alias])))errors.push({field:`${prefix}.${key}`,code:'REQUIRED',message});
  }
  const year=Number(vehicle.year);
  if(!Number.isInteger(year)||year<1950||year>new Date().getUTCFullYear()+1)errors.push({field:`${prefix}.year`,code:'INVALID',message:'Укажите корректный год выпуска'});
  if(usage==='CARGO') {
    if(!text(vehicle.type))errors.push({field:`${prefix}.type`,code:'REQUIRED',message:'Выберите тип грузового транспорта'});
    if(!text(vehicle.capacityKg))errors.push({field:`${prefix}.capacityKg`,code:'REQUIRED',message:'Укажите грузоподъёмность'});
  }
}
function validateVehicle(errors:RegistrationValidationError[],data:RegistrationData,usage:'TAXI'|'CARGO') {
  const prefix=usage==='TAXI'?'taxiVehicle':'cargoVehicle';
  validateVehicleRecord(errors,vehicleFor(data,usage),prefix,usage);
}

function parsedBirthDate(value:string):Date|null {
  let year:number,month:number,day:number;
  const display=value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/),iso=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(display) [,day,month,year]=display.map(Number);
  else if(iso) [,year,month,day]=iso.map(Number);
  else return null;
  const date=new Date(Date.UTC(year!,month!-1,day!));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month!-1&&date.getUTCDate()===day?date:null;
}

export function validateRegistrationDataValues(data:RegistrationData,roles:readonly PerformerRoleValue[],today=new Date(),_allowedRoles:readonly PerformerRoleValue[]=roles) {
  const errors:RegistrationValidationError[]=[];
  const invalid=(field:string,message:string,code='INVALID')=>{if(!errors.some(item=>item.field===field&&item.code===code))errors.push({field,code,message});};
  const checkText=(field:string,value:unknown,max:number)=>{if(value!==undefined&&value!==null&&typeof value!=='string')invalid(field,'Значение должно быть строкой');else if(typeof value==='string'&&value.length>max)invalid(field,`Максимальная длина — ${max} символов`,'TOO_LONG');};
  const checkEnum=(field:string,value:unknown,allowed:readonly string[])=>{if(value!==undefined&&value!==null&&value!==''&&(typeof value!=='string'||!allowed.includes(value)))invalid(field,'Выбрано недопустимое значение');};
  const checkArray=(field:string,value:unknown,allowed:readonly string[],max=32)=>{
    if(value===undefined||value===null)return;
    if(!Array.isArray(value)||value.some(item=>typeof item!=='string')||value.length>max||new Set(value).size!==value.length) {invalid(field,'Список содержит недопустимые или повторяющиеся значения');return;}
    if(value.some(item=>!allowed.includes(item)))invalid(field,'Список содержит недопустимое значение');
  };
  const checkBoolean=(field:string,value:unknown)=>{if(value!==undefined&&typeof value!=='boolean')invalid(field,'Значение должно быть логическим');};
  const checkNumber=(field:string,value:unknown,min:number,max:number,integer=false)=>{
    if(value===undefined||value===null||value==='')return;
    if(typeof value!=='string'&&typeof value!=='number') {invalid(field,'Укажите число');return;}
    const raw=String(value).trim();
    if(!/^-?\d+(?:[.,]\d+)?$/.test(raw)) {invalid(field,'Укажите корректное число');return;}
    const number=Number(raw.replace(',','.'));
    if(!Number.isFinite(number)||number<min||number>max||integer&&!Number.isInteger(number))invalid(field,`Допустимое значение: ${min}–${max}`);
  };
  const checkDate=(field:string,value:unknown,options:{past?:boolean;future?:boolean}={})=>{
    if(value===undefined||value===null||value==='')return null;
    if(typeof value!=='string') {invalid(field,'Укажите дату в формате ДД.ММ.ГГГГ');return null;}
    const date=parsedBirthDate(value.trim());
    if(!date) {invalid(field,'Укажите дату в формате ДД.ММ.ГГГГ');return null;}
    const day=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()));
    if(options.past&&date>day)invalid(field,'Дата не может быть в будущем');
    if(options.future&&date<day)invalid(field,'Срок действия уже истёк','EXPIRED');
    return date;
  };

  const topLevelAllowed=new Set(['personal','identity','driverLicense','courier','taxiVehicle','cargoVehicle','courierVehicle','cargoEquipment','work','location','payment','agreements','documentExpiries','uploads','skippedSteps','completedSteps','cameraIntroSeen','vehicles']);
  for(const key of Object.keys(data))if(!topLevelAllowed.has(key))invalid(key,'Неизвестный раздел анкеты','UNKNOWN_FIELD');
  const personal=record(data.personal);
  if(data.personal!==undefined&&!personal)invalid('personal','Некорректный раздел личных данных');
  if(personal) {
    checkText('personal.firstName',personal.firstName,80);checkText('personal.lastName',personal.lastName,80);checkText('personal.middleName',personal.middleName,80);
    checkDate('personal.birthDate',personal.birthDate,{past:true});checkEnum('personal.city',personal.city,REGISTRATION_CONFIG.cities);
    checkEnum('personal.citizenship',personal.citizenship,[...REGISTRATION_CONFIG.countries,...REGISTRATION_CONFIG.citizenships.map(item=>item.id)]);checkEnum('personal.language',personal.language,['ru','ky']);
  }
  const identity=record(data.identity);
  if(data.identity!==undefined&&!identity)invalid('identity','Некорректный раздел удостоверения личности');
  if(identity) {
    checkText('identity.number',identity.number,64);checkText('identity.issuedBy',identity.issuedBy,160);
    const issued=checkDate('identity.issuedAt',identity.issuedAt,{past:true}),expires=checkDate('identity.expiresAt',identity.expiresAt,{future:true});
    if(issued&&expires&&issued>=expires)invalid('identity.expiresAt','Срок действия должен быть позже даты выдачи');
  }
  const license=record(data.driverLicense);
  const licenseRequired=requiresDriverLicense(roles,data);
  if(licenseRequired&&data.driverLicense!==undefined&&!license)invalid('driverLicense','Некорректный раздел водительского удостоверения');
  if(license&&licenseRequired) {
    checkText('driverLicense.number',license.number,64);checkArray('driverLicense.categories',license.categories,REGISTRATION_CONFIG.driverLicenseCategories,16);
    const issued=checkDate('driverLicense.issuedAt',license.issuedAt,{past:true}),expires=checkDate('driverLicense.expiresAt',license.expiresAt,{future:true});
    if(issued&&expires&&issued>=expires)invalid('driverLicense.expiresAt','Срок действия должен быть позже даты выдачи');
    checkNumber('driverLicense.experienceYears',license.experienceYears,0,80,true);
  }

  const validateVehicleValues=(key:string,vehicle:Record<string,unknown>|null,usage:VehicleUsage,active:boolean)=>{
    if(!active)return;
    if(!vehicle) {invalid(key,'Некорректные данные транспорта');return;}
    checkEnum(`${key}.ownership`,vehicle.ownership,['OWN','RENT']);checkText(`${key}.brand`,vehicle.brand,80);checkText(`${key}.model`,vehicle.model,80);checkText(`${key}.color`,vehicle.color,50);
    checkNumber(`${key}.year`,vehicle.year,1950,today.getUTCFullYear()+1,true);checkText(`${key}.plateNumber`,vehicle.plateNumber,20);checkText(`${key}.vin`,vehicle.vin,32);
    if(text(vehicle.plateNumber)&&!/^[\p{L}\p{N} -]{3,20}$/u.test(text(vehicle.plateNumber)))invalid(`${key}.plateNumber`,'Некорректный государственный номер');
    if(text(vehicle.vin)&&!/^[A-HJ-NPR-Z0-9]{17}$/i.test(text(vehicle.vin)))invalid(`${key}.vin`,'VIN должен содержать 17 допустимых символов');
    checkBoolean(`${key}.hasAirConditioning`,vehicle.hasAirConditioning);
    if(usage==='TAXI') {checkNumber(`${key}.passengerSeats`,vehicle.passengerSeats,1,20,true);checkEnum(`${key}.bodyType`,vehicle.bodyType,REGISTRATION_CONFIG.taxiBodyTypes);checkArray(`${key}.tariffs`,vehicle.tariffs,REGISTRATION_CONFIG.tariffs.map(item=>item.id),8);}
    if(usage==='CARGO') {checkEnum(`${key}.type`,vehicle.type,REGISTRATION_CONFIG.cargoVehicleTypes);checkNumber(`${key}.capacityKg`,vehicle.capacityKg,1,100000);for(const field of ['volumeM3','lengthM','widthM','heightM'])checkNumber(`${key}.${field}`,vehicle[field],0.01,1000);}
  };
  const validateCargoEquipmentValues=(key:string,equipment:Record<string,unknown>|null,active:boolean)=>{
    if(!active)return;
    if(!equipment) {invalid(key,'Некорректные параметры грузового транспорта');return;}
    checkArray(`${key}.loadingTypes`,equipment.loadingTypes,REGISTRATION_CONFIG.loadingTypes,3);checkNumber(`${key}.palletCount`,equipment.palletCount,0,100,true);
    checkBoolean(`${key}.refrigerator`,equipment.refrigerator);checkBoolean(`${key}.tailLift`,equipment.tailLift);checkBoolean(`${key}.manipulator`,equipment.manipulator);checkBoolean(`${key}.worksWithLoaders`,equipment.worksWithLoaders);
    checkNumber(`${key}.minTemperature`,equipment.minTemperature,-80,80);checkNumber(`${key}.maxTemperature`,equipment.maxTemperature,-80,80);checkNumber(`${key}.loaderCount`,equipment.loaderCount,1,20,true);
    if(text(equipment.minTemperature)&&text(equipment.maxTemperature)&&Number(text(equipment.minTemperature).replace(',','.'))>Number(text(equipment.maxTemperature).replace(',','.')))invalid(`${key}.maxTemperature`,'Максимальная температура должна быть не ниже минимальной');
  };
  validateVehicleValues('taxiVehicle',record(data.taxiVehicle),'TAXI',roles.includes('TAXI_DRIVER')&&data.taxiVehicle!==undefined);
  validateVehicleValues('cargoVehicle',record(data.cargoVehicle),'CARGO',roles.includes('CARGO_DRIVER')&&data.cargoVehicle!==undefined);
  validateVehicleValues('courierVehicle',record(data.courierVehicle),'COURIER',roles.includes('COURIER')&&data.courierVehicle!==undefined&&courierTransportModes(data).some(mode=>DOCUMENTED_COURIER_METHODS.has(mode))&&!usesExistingVehicle(data));

  const extraVehicles=registrationAdditionalVehicles(data),seenVehicleIds=new Set<string>();
  if(data.vehicles!==undefined&&!Array.isArray(data.vehicles))invalid('vehicles','Дополнительный транспорт должен быть списком');
  if(extraVehicles.length>MAX_ADDITIONAL_VEHICLES)invalid('vehicles',`Можно добавить не больше ${MAX_ADDITIONAL_VEHICLES} транспортных средств`,'TOO_MANY');
  for(const {index,vehicle} of extraVehicles) {
    const indexPrefix=`vehicles.${index}`;
    if(!vehicle) {invalid(indexPrefix,'Некорректные данные транспорта');continue;}
    const clientId=text(vehicle.clientId),prefix=ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(clientId)?`vehicles.${clientId}`:indexPrefix,usage=text(vehicle.usage).toUpperCase(),role=performerRoleForVehicleUsage(usage);
    checkText(`${prefix}.clientId`,vehicle.clientId,64);
    if(!ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(clientId)||clientId.length>64)invalid(`${prefix}.clientId`,'Некорректный идентификатор транспорта');
    else if(seenVehicleIds.has(clientId))invalid(`${prefix}.clientId`,'Идентификатор транспорта должен быть уникальным','DUPLICATE');
    else seenVehicleIds.add(clientId);
    checkEnum(`${prefix}.usage`,vehicle.usage,['TAXI','CARGO','COURIER']);
    const active=Boolean(role&&roles.includes(role));
    validateVehicleValues(prefix,vehicle,(role?usage:'COURIER') as VehicleUsage,active);
    if(usage==='CARGO')validateCargoEquipmentValues(`${prefix}.equipment`,record(vehicle.equipment),active);
  }

  const courier=record(data.courier);
  if(roles.includes('COURIER')&&data.courier!==undefined&&!courier)invalid('courier','Некорректные параметры курьера');
  if(courier&&roles.includes('COURIER')) {
    checkArray('courier.transportModes',courier.transportModes,REGISTRATION_CONFIG.courierTransportModes,12);checkArray('courier.orderTypes',courier.orderTypes,REGISTRATION_CONFIG.courierOrderTypes,12);
    checkNumber('courier.maxWeightKg',courier.maxWeightKg,0.1,1000);checkBoolean('courier.hasThermalBag',courier.hasThermalBag);checkBoolean('courier.acceptsCash',courier.acceptsCash);checkBoolean('courier.useExistingVehicle',courier.useExistingVehicle);
    checkEnum('courier.city',courier.city,REGISTRATION_CONFIG.cities);checkEnum('courier.existingVehicleUsage',courier.existingVehicleUsage,['TAXI','CARGO']);checkText('courier.existingVehicleClientId',courier.existingVehicleClientId,64);
    const existingVehicleClientId=text(courier.existingVehicleClientId);
    if(existingVehicleClientId&&!ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(existingVehicleClientId))invalid('courier.existingVehicleClientId','Некорректный идентификатор выбранного транспорта');
    if(courier.useExistingVehicle!==true&&existingVehicleClientId)invalid('courier.existingVehicleClientId','Выбранный транспорт допустим только при повторном использовании');
    const city=text(courier.city)||text(personal?.city),districts=REGISTRATION_CONFIG.districts[city as keyof typeof REGISTRATION_CONFIG.districts]??[];checkArray('courier.districts',courier.districts,districts,32);
  }
  const cargo=record(data.cargoEquipment);
  if(roles.includes('CARGO_DRIVER')&&data.cargoEquipment!==undefined)validateCargoEquipmentValues('cargoEquipment',cargo,true);
  const work=record(data.work);
  if(work) {checkEnum('work.city',work.city,REGISTRATION_CONFIG.cities);const city=text(work.city)||text(personal?.city),districts=REGISTRATION_CONFIG.districts[city as keyof typeof REGISTRATION_CONFIG.districts]??[];checkArray('work.districts',work.districts,districts,32);checkBoolean('work.intercity',work.intercity);checkBoolean('work.night',work.night);checkBoolean('work.notifications',work.notifications);checkEnum('work.schedule',work.schedule,['FULL','FLEXIBLE']);checkText('work.preferredTime',work.preferredTime,80);checkNumber('work.maxPickupDistanceKm',work.maxPickupDistanceKm,0.1,1000);}
  const location=record(data.location);if(location) {checkEnum('location.choice',location.choice,['PRECISE','MANUAL']);checkEnum('location.city',location.city,REGISTRATION_CONFIG.cities);}
  const payment=record(data.payment);
  if(payment) {
    const allowed=new Set(['type','last4','taxIdLast4']);for(const key of Object.keys(payment))if(!allowed.has(key))invalid(`payment.${key}`,'Платёжное поле не поддерживается','UNKNOWN_FIELD');
    checkEnum('payment.type',payment.type,REGISTRATION_CONFIG.payoutMethods);checkText('payment.last4',payment.last4,4);checkText('payment.taxIdLast4',payment.taxIdLast4,4);
    if(text(payment.last4)&&!/^\d{4}$/.test(text(payment.last4)))invalid('payment.last4','Укажите ровно последние четыре цифры');
    if(text(payment.taxIdLast4)&&!/^\d{4}$/.test(text(payment.taxIdLast4)))invalid('payment.taxIdLast4','Укажите ровно последние четыре цифры');
  }
  const agreements=record(data.agreements);if(agreements) {checkBoolean('agreements.truthConfirmed',agreements.truthConfirmed);checkBoolean('agreements.termsAccepted',agreements.termsAccepted);checkArray('agreements.acceptedIds',agreements.acceptedIds,REGISTRATION_CONFIG.legalConsents.map(item=>item.id),32);}
  const documentExpiries=record(data.documentExpiries);
  if(data.documentExpiries!==undefined&&!documentExpiries)invalid('documentExpiries','Некорректные сроки действия документов');
  if(documentExpiries) {
    const entries=Object.entries(documentExpiries),specs=new Map(registrationUploadSlotSpecs(PERFORMER_ROLES,data).map(spec=>[spec.slotKey,spec])),validatedSpecs=new Set(registrationUploadSlotSpecs(roles,data).map(spec=>spec.slotKey));
    if(entries.length>REGISTRATION_CONFIG.upload.maxFiles)invalid('documentExpiries','Слишком много сроков действия','TOO_MANY');
    for(const [slotKey,value] of entries) {
      const spec=specs.get(slotKey);
      if(slotKey.startsWith('identity_')||slotKey.startsWith('license_')) {invalid(`documentExpiries.${slotKey}`,'Используйте срок действия в данных удостоверения','DUPLICATE_EXPIRY_SOURCE');continue;}
      if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(slotKey)||!spec||!registrationUploadCanExpire(spec.kind)) {invalid(`documentExpiries.${slotKey}`,'Срок указан для недопустимого слота','UNKNOWN_FIELD');continue;}
      if(validatedSpecs.has(slotKey))checkDate(`documentExpiries.${slotKey}`,value,{future:true});
    }
  }
  checkBoolean('cameraIntroSeen',data.cameraIntroSeen);
  for(const [key,value] of Object.entries(data))if(typeof value==='string'&&value.length>500)invalid(key,'Значение слишком длинное','TOO_LONG');
  return errors;
}

export function validateRegistrationSubmission(input:{roles:readonly PerformerRoleValue[];selectedRoles?:readonly PerformerRoleValue[];data:RegistrationData;uploads:readonly RegistrationUploadForValidation[];today?:Date}) {
  const {roles,data,uploads}=input,errors:RegistrationValidationError[]=[...validateRegistrationDataValues(data,roles,input.today,input.selectedRoles??roles)];
  if(!roles.length)errors.push({field:'roles',code:'REQUIRED',message:'Выберите хотя бы одно направление работы'});
  required(errors,data,'personal.firstName',[['personal','firstName'],['personalData','firstName'],['firstName']],'Введите имя');
  required(errors,data,'personal.lastName',[['personal','lastName'],['personalData','lastName'],['lastName']],'Введите фамилию');
  required(errors,data,'personal.birthDate',[['personal','birthDate'],['personalData','birthDate'],['birthDate']],'Укажите дату рождения');
  required(errors,data,'personal.city',[['personal','city'],['personalData','city'],['personalData','cityId'],['city'],['cityId']],'Выберите город работы');
  const birthText=text(firstValue(data,[['personal','birthDate'],['personalData','birthDate'],['birthDate']]));
  if(birthText) {
    const birth=parsedBirthDate(birthText),today=input.today??new Date();
    if(!birth||birth>today)errors.push({field:'personal.birthDate',code:'INVALID',message:'Укажите корректную дату рождения'});
    else {
      let age=today.getUTCFullYear()-birth.getUTCFullYear();
      if(today.getUTCMonth()<birth.getUTCMonth()||(today.getUTCMonth()===birth.getUTCMonth()&&today.getUTCDate()<birth.getUTCDate()))age--;
      const minimum=Math.max(...roles.map(role=>REGISTRATION_CONFIG.minimumAgeByRole[role]),REGISTRATION_CONFIG.minimumAge);
      if(age<minimum)errors.push({field:'personal.birthDate',code:'MINIMUM_AGE',message:`Минимальный возраст — ${minimum} лет`});
    }
  }
  required(errors,data,'identity.expiresAt',[['identity','expiresAt'],['identityDocument','expiryDate']],'Укажите срок действия документа');
  if(requiresDriverLicense(roles,data)) {
    if(!stringArray(valueAt(data,'driverLicense','categories')).length)errors.push({field:'driverLicense.categories',code:'REQUIRED',message:'Выберите категорию водительских прав'});
    required(errors,data,'driverLicense.expiresAt',[['driverLicense','expiresAt'],['driverLicense','expiryDate']],'Укажите срок действия водительского удостоверения');
  }
  if(roles.includes('TAXI_DRIVER'))validateVehicle(errors,data,'TAXI');
  if(roles.includes('CARGO_DRIVER'))validateVehicle(errors,data,'CARGO');
  for(const {index,vehicle} of registrationAdditionalVehicles(data)) {
    if(!vehicle)continue;
    const clientId=text(vehicle.clientId),usage=text(vehicle.usage).toUpperCase(),role=performerRoleForVehicleUsage(usage);
    if(!role||!roles.includes(role)||!ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(clientId))continue;
    const prefix=`vehicles.${clientId}`;
    validateVehicleRecord(errors,vehicle,prefix,usage as VehicleUsage);
  }
  if(roles.includes('COURIER')) {
    if(!courierTransportModes(data).length)errors.push({field:'courier.transportModes',code:'REQUIRED',message:'Выберите способ доставки'});
    required(errors,data,'courier.city',[['courier','city'],['personal','city'],['courierSettings','city']],'Выберите город работы курьера');
    if(courierTransportModes(data).some(mode=>DOCUMENTED_COURIER_METHODS.has(mode))&&usesExistingVehicle(data)) {
      const usage=text(valueAt(data,'courier','existingVehicleUsage')).toUpperCase();
      const clientId=text(valueAt(data,'courier','existingVehicleClientId'));
      const selectedRoles=input.selectedRoles??roles;
      if(usage!=='TAXI'&&usage!=='CARGO'||usage==='TAXI'&&!selectedRoles.includes('TAXI_DRIVER')||usage==='CARGO'&&!selectedRoles.includes('CARGO_DRIVER'))errors.push({field:'courier.existingVehicleUsage',code:'INVALID',message:'Выберите транспорт из одного из выбранных направлений'});
      else if(clientId&&!registrationAdditionalVehicles(data).some(item=>item.vehicle&&text(item.vehicle.clientId)===clientId&&text(item.vehicle.usage).toUpperCase()===usage))errors.push({field:'courier.existingVehicleClientId',code:'INVALID',message:'Выбранный дополнительный транспорт не найден или относится к другому направлению'});
    }
    if(courierTransportModes(data).some(mode=>DOCUMENTED_COURIER_METHODS.has(mode))&&!usesExistingVehicle(data)) {
      const vehicle=record(data.courierVehicle);
      if(!vehicle)errors.push({field:'courierVehicle',code:'REQUIRED',message:'Заполните данные транспорта курьера'});
      else for(const [key,message] of [['ownership','Укажите владение транспортом'],['brand','Укажите марку транспорта'],['model','Укажите модель транспорта'],['year','Укажите год выпуска'],['plateNumber','Введите государственный номер']] as const)if(!text(vehicle[key]))errors.push({field:`courierVehicle.${key}`,code:'REQUIRED',message});
    }
  }
  const uploaded=new Map(uploads.map(upload=>[upload.slotKey,upload]));
  const specs=new Map(registrationUploadSlotSpecs(roles,data).map(spec=>[spec.slotKey,spec]));
  for(const slotKey of requiredUploadSlots(roles,data)) {
    const upload=uploaded.get(slotKey),spec=specs.get(slotKey);
    if(!upload||!ACCEPTABLE_UPLOAD_STATUSES.has(upload.status))errors.push({field:`uploads.${slotKey}`,code:'UPLOAD_REQUIRED',message:`Загрузите обязательный файл: ${slotKey}`});
    else if(spec&&(upload.kind!==undefined&&upload.kind!==spec.kind||upload.role!==undefined&&(upload.role??null)!==spec.role))errors.push({field:`uploads.${slotKey}`,code:'UPLOAD_TYPE_MISMATCH',message:`Файл загружен в неверный слот: ${slotKey}`});
    else if(registrationUploadRequiresExpiry(slotKey)) {
      const structured=slotKey.startsWith('identity_')?firstValue(data,[['identity','expiresAt'],['identityDocument','expiryDate']]):slotKey.startsWith('license_')?firstValue(data,[['driverLicense','expiresAt'],['driverLicense','expiryDate']]):null;
      if(!upload.expiresAt&&!text(structured))errors.push({field:`uploads.${slotKey}.expiresAt`,code:'EXPIRY_REQUIRED',message:'Укажите срок действия документа'});
    }
  }
  return errors;
}

export function emptyRegistrationData(language:'ru'|'ky'='ru'):RegistrationData {
  const vehicle=()=>({ownership:'',type:'',brand:'',model:'',year:'',color:'',plateNumber:'',vin:'',passengerSeats:'',bodyType:'',hasAirConditioning:false,tariffs:[],capacityKg:'',volumeM3:'',lengthM:'',widthM:'',heightM:''});
  return {
    personal:{firstName:'',lastName:'',middleName:'',birthDate:'',city:'',citizenship:'',language},
    identity:{number:'',issuedAt:'',expiresAt:'',issuedBy:''},driverLicense:{number:'',categories:[],issuedAt:'',expiresAt:'',experienceYears:''},
    courier:{transportModes:[],hasThermalBag:false,orderTypes:[],maxWeightKg:'',acceptsCash:false,city:'',districts:[],useExistingVehicle:false,existingVehicleUsage:'',existingVehicleClientId:''},
    taxiVehicle:vehicle(),cargoVehicle:vehicle(),courierVehicle:vehicle(),vehicles:[],
    cargoEquipment:{loadingTypes:[],palletCount:'',refrigerator:false,minTemperature:'',maxTemperature:'',tailLift:false,manipulator:false,worksWithLoaders:false,loaderCount:''},
    work:{city:'',districts:[],intercity:false,night:false,schedule:'',preferredTime:'',maxPickupDistanceKm:'',notifications:true},
    location:{choice:'',city:''},payment:{type:'',last4:'',taxIdLast4:''},agreements:{truthConfirmed:false,termsAccepted:false,acceptedIds:[]},
    documentExpiries:{},uploads:{},skippedSteps:[],completedSteps:[],cameraIntroSeen:false,
  };
}

export function stripClientUploadState(data:RegistrationData):RegistrationData {
  const output={...data};delete output.uploads;return output;
}

const forbiddenObjectKeys=new Set(['__proto__','prototype','constructor']);
const sensitivePaymentKeys=new Set(['cardnumber','pan','primaryaccountnumber','accountnumber','bankaccount','iban','cvv','cvc','securitycode','walletnumber','fullnumber']);
const paymentSection=(key:string)=>key.startsWith('payment')||key.startsWith('payout')||key==='bankingdetails';
export function assertSafeRegistrationData(value:unknown) {
  const visit=(item:unknown,path:string[],inPayment:boolean):void=>{
    if(item===null||typeof item==='boolean')return;
    if(typeof item==='number') {if(inPayment&&Math.abs(item)>=100_000_000_000)throw new Error('PAYMENT_SECRET');return;}
    if(typeof item==='string') {
      const tokenPath=path.some(part=>/token/i.test(part));
      if(inPayment&&item.replace(/\D/g,'').length>=12&&(!tokenPath||!/[a-z]/i.test(item)))throw new Error('PAYMENT_SECRET');
      return;
    }
    if(Array.isArray(item)) {for(const child of item)visit(child,path,inPayment);return;}
    const object=record(item);
    if(!object)throw new Error('INVALID_JSON');
    for(const [key,child] of Object.entries(object)) {
      if(forbiddenObjectKeys.has(key))throw new Error('INVALID_JSON');
      const normalized=key.replace(/[^a-z0-9]/gi,'').toLowerCase();
      const payment=inPayment||paymentSection(normalized);
      if((sensitivePaymentKeys.has(normalized)||(payment&&(normalized==='number'||normalized.includes('token'))))&&child!==null&&child!=='')throw new Error('PAYMENT_SECRET');
      if(payment&&normalized==='last4'&&child!==undefined&&child!==null&&!/^\d{0,4}$/.test(String(child)))throw new Error('PAYMENT_LAST4');
      visit(child,[...path,key],payment);
    }
  };
  visit(value,[],false);
}

export function redactRegistrationData(value:unknown):unknown {
  const visit=(item:unknown,inPayment:boolean):unknown=>{
    if(Array.isArray(item))return item.map(child=>visit(child,inPayment));
    const object=record(item);
    if(!object)return item;
    const output:Record<string,unknown>={};
    for(const [key,child] of Object.entries(object)) {
      const normalized=key.replace(/[^a-z0-9]/gi,'').toLowerCase();
      const payment=inPayment||paymentSection(normalized);
      if(sensitivePaymentKeys.has(normalized)||(payment&&(normalized==='number'||normalized.includes('token'))))continue;
      if(payment&&typeof child==='string'&&child.replace(/\D/g,'').length>=12&&(!/token/i.test(key)||!/[a-z]/i.test(child)))continue;
      output[key]=visit(child,payment);
    }
    return output;
  };
  return visit(value,false);
}

export function mergeRegistrationData(base:RegistrationData,patch:RegistrationData):RegistrationData {
  const output:RegistrationData={...base};
  for(const [key,value] of Object.entries(patch)) {
    if(forbiddenObjectKeys.has(key))throw new Error('INVALID_JSON');
    const current=record(output[key]),next=record(value);
    output[key]=current&&next?mergeRegistrationData(current,next):value;
  }
  return output;
}

export function stableJson(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;
  const object=record(value);
  if(object)return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
