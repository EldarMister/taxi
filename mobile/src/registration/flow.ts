import { MAX_ADDITIONAL_VEHICLES, additionalVehicleClientIdPattern, type AdditionalVehicleDraft, type BaseDocumentRequirement, type CargoEquipmentDraft, type CourierTransportMode, type PerformerRole, type RegistrationApplication, type RegistrationConfig, type RegistrationData, type RegistrationStepId, type RegistrationUpload, type VehicleDraft, type VehicleUsage } from './types';

export type RegistrationStep = { id: RegistrationStepId; title: string; optional?: boolean };

export function correctionScopeAllows(scope: readonly string[] | undefined, path: string) {
  if (scope === undefined) return true;
  return scope.some(value => {
    const candidate = value.replace(/^data\./, '').replace(/^uploads\./, '');
    return candidate === path || candidate.startsWith(`${path}.`) || path.startsWith(`${candidate}.`);
  });
}

export function correctionExpiryAllowed(scope: readonly string[] | undefined, slotKey: string) {
  return correctionScopeAllows(scope, `documentExpiries.${slotKey}`);
}

export function correctionVehicleFieldAllowed(scope: readonly string[] | undefined, clientId: string, index: number, path: string) {
  const canonicalRoot = `vehicles.${clientId}`;
  const indexedRoot = `vehicles.${index}`;
  const suffix = path.startsWith(canonicalRoot) ? path.slice(canonicalRoot.length) : path.startsWith(indexedRoot) ? path.slice(indexedRoot.length) : path.startsWith('.') ? path : `.${path}`;
  return correctionScopeAllows(scope, `${canonicalRoot}${suffix}`) || correctionScopeAllows(scope, `${indexedRoot}${suffix}`);
}

export function correctionUploadDeleteAllowed(scope: readonly string[] | undefined) {
  return scope === undefined;
}

const MOTOR_TRANSPORT = new Set<CourierTransportMode>(['MOPED', 'SCOOTER', 'MOTORCYCLE', 'CAR', 'TRUCK']);

export function courierNeedsMotorVehicle(application: Pick<RegistrationApplication, 'data'>) {
  return application.data.courier.transportModes.some(mode => MOTOR_TRANSPORT.has(mode));
}

export function courierNeedsLicense(application: Pick<RegistrationApplication, 'data'>) {
  return application.data.courier.transportModes.some(mode => ['MOPED', 'SCOOTER', 'MOTORCYCLE', 'CAR', 'TRUCK'].includes(mode));
}

const fallbackDocumentRequirements: BaseDocumentRequirement[] = [
  { id: 'profile-photo', title: 'Фотография профиля', kind: 'PROFILE_PHOTO', slots: ['profile_photo'], requiredFor: ['TAXI_DRIVER', 'CARGO_DRIVER', 'COURIER'] },
  { id: 'identity', title: 'Удостоверение личности', kind: 'IDENTITY_DOCUMENT', slots: ['identity_front', 'identity_back'], requiredFor: ['TAXI_DRIVER', 'CARGO_DRIVER', 'COURIER'] },
  { id: 'driver-license', title: 'Водительское удостоверение', kind: 'DRIVER_LICENSE', slots: ['license_front', 'license_back'], requiredFor: ['TAXI_DRIVER', 'CARGO_DRIVER'], condition: 'Также требуется для моторизованной доставки' },
  { id: 'taxi-registration', title: 'Документы автомобиля', kind: 'VEHICLE_DOCUMENT', slots: ['taxi_registration', 'taxi_insurance'], expirySlots: ['taxi_insurance'], requiredFor: ['TAXI_DRIVER'] },
  { id: 'taxi-photos', title: 'Фотографии автомобиля такси', kind: 'VEHICLE_PHOTO', slots: ['taxi_photo_front', 'taxi_photo_back', 'taxi_photo_left', 'taxi_photo_right', 'taxi_photo_interior_front', 'taxi_photo_interior_back', 'taxi_photo_trunk'], requiredFor: ['TAXI_DRIVER'] },
  { id: 'cargo-registration', title: 'Документы грузового автомобиля', kind: 'VEHICLE_DOCUMENT', slots: ['cargo_registration', 'cargo_insurance'], expirySlots: ['cargo_insurance'], requiredFor: ['CARGO_DRIVER'] },
  { id: 'cargo-photos', title: 'Фотографии грузового автомобиля', kind: 'VEHICLE_PHOTO', slots: ['cargo_photo_front', 'cargo_photo_back', 'cargo_photo_left', 'cargo_photo_right', 'cargo_photo_cabin', 'cargo_photo_cargo_bay', 'cargo_photo_plate'], requiredFor: ['CARGO_DRIVER'] },
  { id: 'courier-vehicle', title: 'Документы транспорта курьера', kind: 'VEHICLE_DOCUMENT', slots: ['courier_registration', 'courier_insurance'], expirySlots: ['courier_insurance'], requiredFor: ['COURIER'], condition: 'Только для моторизованной доставки с отдельным транспортом' },
  { id: 'courier-vehicle-photo', title: 'Фотография транспорта курьера', kind: 'VEHICLE_PHOTO', slots: ['courier_photo'], requiredFor: ['COURIER'], condition: 'Только для моторизованной доставки с отдельным транспортом' },
  { id: 'rental-proof', title: 'Договор аренды или доверенность', kind: 'VEHICLE_DOCUMENT', slots: [], requiredFor: ['TAXI_DRIVER', 'CARGO_DRIVER'], condition: 'Только для арендованного транспорта' },
];

const requirements = (config?: Pick<RegistrationConfig, 'documentRequirements'>) => config?.documentRequirements || fallbackDocumentRequirements;
const hasRequirement = (config: Pick<RegistrationConfig, 'documentRequirements'> | undefined, id: string) => requirements(config).some(item => item.id === id);

function requirementApplies(requirement: BaseDocumentRequirement, application: Pick<RegistrationApplication, 'roles' | 'data'>) {
  if (!requirement.requiredFor.some(role => application.roles.includes(role))) return false;
  if (requirement.id === 'driver-license') return application.roles.includes('TAXI_DRIVER') || application.roles.includes('CARGO_DRIVER') || application.roles.includes('COURIER') && courierNeedsLicense(application);
  if (requirement.id === 'rental-proof') return application.roles.includes('TAXI_DRIVER') && application.data.taxiVehicle.ownership === 'RENT' || application.roles.includes('CARGO_DRIVER') && application.data.cargoVehicle.ownership === 'RENT';
  if (requirement.id.startsWith('courier-vehicle')) return application.roles.includes('COURIER') && courierNeedsMotorVehicle(application) && !application.data.courier.useExistingVehicle;
  return true;
}

const knownSlotTitles: Record<string, string> = {
  profile_photo: 'Фотография профиля', identity_front: 'Лицевая сторона', identity_back: 'Обратная сторона', license_front: 'Лицевая сторона', license_back: 'Обратная сторона',
  taxi_registration: 'Свидетельство о регистрации', taxi_insurance: 'Страховой полис', taxi_inspection: 'Технический осмотр', taxi_rental: 'Договор аренды или доверенность',
  cargo_registration: 'Свидетельство о регистрации', cargo_insurance: 'Страховой полис', cargo_inspection: 'Технический осмотр', cargo_rental: 'Договор аренды или доверенность',
  courier_registration: 'Свидетельство о регистрации', courier_insurance: 'Страховой полис', courier_photo: 'Фотография транспорта',
};

export type ConfiguredUploadSlot = { slotKey: string; title: string; description?: string; kind: RegistrationUpload['kind']; required: boolean; requiresExpiry: boolean; exampleImageUrl?: string };

const additionalVehiclePhotoSuffixes: Record<VehicleUsage, readonly string[]> = {
  TAXI: ['front', 'back', 'left', 'right', 'interior_front', 'interior_back', 'trunk'],
  CARGO: ['front', 'back', 'left', 'right', 'cabin', 'cargo_bay', 'plate'],
  COURIER: ['front'],
};

const additionalVehiclePhotoTitles: Record<string, string> = {
  front: 'Спереди', back: 'Сзади', left: 'Левая сторона', right: 'Правая сторона', interior_front: 'Передняя часть салона', interior_back: 'Задний ряд', trunk: 'Багажник', cabin: 'Кабина', cargo_bay: 'Грузовой отсек', plate: 'Государственный номер',
};

export function additionalVehiclesForUsage(data: Pick<RegistrationData, 'vehicles'>, usage: VehicleUsage) {
  return (data.vehicles || []).filter(vehicle => vehicle.usage === usage);
}

export function performerRoleForVehicleUsage(usage: VehicleUsage): PerformerRole {
  return usage === 'TAXI' ? 'TAXI_DRIVER' : usage === 'CARGO' ? 'CARGO_DRIVER' : 'COURIER';
}

export function additionalVehicleForUploadSlot(data: Pick<RegistrationData, 'vehicles'>, slotKey: string) {
  return (data.vehicles || []).find(vehicle => slotKey.startsWith(`vehicle_${vehicle.clientId}_`));
}

export function additionalVehicleUploadSlots(vehicle: AdditionalVehicleDraft): ConfiguredUploadSlot[] {
  const prefix = `vehicle_${vehicle.clientId}`;
  return [
    { slotKey: `${prefix}_registration`, title: 'Свидетельство о регистрации', kind: 'VEHICLE_DOCUMENT', required: true, requiresExpiry: false },
    { slotKey: `${prefix}_insurance`, title: 'Страховой полис', kind: 'VEHICLE_DOCUMENT', required: true, requiresExpiry: true },
    ...(vehicle.ownership === 'RENT' ? [{ slotKey: `${prefix}_rental`, title: 'Договор аренды или доверенность', kind: 'VEHICLE_DOCUMENT' as const, required: true, requiresExpiry: false }] : []),
    ...additionalVehiclePhotoSuffixes[vehicle.usage].map(suffix => ({ slotKey: `${prefix}_photo_${suffix}`, title: additionalVehiclePhotoTitles[suffix] || 'Фотография транспорта', kind: 'VEHICLE_PHOTO' as const, required: true, requiresExpiry: false })),
  ];
}

export function additionalVehicleUploadSlotsForStep(step: RegistrationStepId, application: Pick<RegistrationApplication, 'data'>) {
  const target = step === 'TAXI_DOCUMENTS' || step === 'TAXI_PHOTOS' ? 'TAXI' : step === 'CARGO_DOCUMENTS' || step === 'CARGO_PHOTOS' ? 'CARGO' : step === 'COURIER_VEHICLE' ? 'COURIER' : null;
  if (!target) return [];
  const kind = step === 'TAXI_DOCUMENTS' || step === 'CARGO_DOCUMENTS' ? 'VEHICLE_DOCUMENT' : step === 'TAXI_PHOTOS' || step === 'CARGO_PHOTOS' ? 'VEHICLE_PHOTO' : null;
  return additionalVehiclesForUsage(application.data, target).flatMap(vehicle => additionalVehicleUploadSlots(vehicle).filter(item => !kind || item.kind === kind));
}

export function registrationUploadSlotsForStep(step: RegistrationStepId, application: Pick<RegistrationApplication, 'roles' | 'data'>, config?: Pick<RegistrationConfig, 'documentRequirements'>) {
  return [...configuredUploadSlotsForStep(step, application, config), ...additionalVehicleUploadSlotsForStep(step, application)];
}

export function configuredBaseUploadSlots(application: Pick<RegistrationApplication, 'roles' | 'data'>, config?: Pick<RegistrationConfig, 'documentRequirements'>): ConfiguredUploadSlot[] {
  return requirements(config).filter(item => requirementApplies(item, application)).flatMap(item => {
    let slots = item.slots;
    if (item.id === 'rental-proof') slots = [
      ...(application.roles.includes('TAXI_DRIVER') && application.data.taxiVehicle.ownership === 'RENT' ? ['taxi_rental'] : []),
      ...(application.roles.includes('CARGO_DRIVER') && application.data.cargoVehicle.ownership === 'RENT' ? ['cargo_rental'] : []),
    ];
    return slots.map((slotKey, index) => ({
      slotKey,
      title: item.slotTitles?.[slotKey] || knownSlotTitles[slotKey] || (slots.length > 1 ? `${item.title} · ${index + 1}` : item.title),
      description: item.description,
      kind: item.kind,
      required: item.required !== false,
      requiresExpiry: item.expirySlots?.includes(slotKey) === true,
      exampleImageUrl: item.exampleImageUrl,
    }));
  });
}

export function configuredUploadSlotsForStep(step: RegistrationStepId, application: Pick<RegistrationApplication, 'roles' | 'data'>, config?: Pick<RegistrationConfig, 'documentRequirements'>) {
  const slots = configuredBaseUploadSlots(application, config);
  return slots.filter(item => {
    if (step === 'PROFILE_PHOTO') return item.kind === 'PROFILE_PHOTO';
    if (step === 'IDENTITY_DOCUMENT') return item.kind === 'IDENTITY_DOCUMENT';
    if (step === 'DRIVER_LICENSE') return item.kind === 'DRIVER_LICENSE';
    if (step === 'TAXI_DOCUMENTS') return item.slotKey.startsWith('taxi_') && item.kind === 'VEHICLE_DOCUMENT';
    if (step === 'TAXI_PHOTOS') return item.slotKey.startsWith('taxi_') && item.kind === 'VEHICLE_PHOTO';
    if (step === 'CARGO_DOCUMENTS') return item.slotKey.startsWith('cargo_') && item.kind === 'VEHICLE_DOCUMENT';
    if (step === 'CARGO_PHOTOS') return item.slotKey.startsWith('cargo_') && item.kind === 'VEHICLE_PHOTO';
    if (step === 'COURIER_VEHICLE') return item.slotKey.startsWith('courier_') && (item.kind === 'VEHICLE_DOCUMENT' || item.kind === 'VEHICLE_PHOTO');
    return false;
  });
}

export function buildRegistrationSteps(application: Pick<RegistrationApplication, 'roles' | 'data'>, config?: Pick<RegistrationConfig, 'documentRequirements'>): RegistrationStep[] {
  const roles = new Set<PerformerRole>(application.roles);
  const steps: RegistrationStep[] = [
    { id: 'ROLES', title: 'Направления работы' },
    { id: 'PERSONAL_DATA', title: 'Личные данные' },
  ];
  if (hasRequirement(config, 'profile-photo')) steps.push({ id: 'PROFILE_PHOTO', title: 'Фотография профиля' });
  if (hasRequirement(config, 'identity')) steps.push({ id: 'IDENTITY_DOCUMENT', title: 'Удостоверение личности' });
  if (roles.has('COURIER')) steps.push({ id: 'COURIER_TRANSPORT', title: 'Способ доставки' });
  if (hasRequirement(config, 'driver-license') && (roles.has('TAXI_DRIVER') || roles.has('CARGO_DRIVER') || roles.has('COURIER') && courierNeedsLicense(application))) steps.push({ id: 'DRIVER_LICENSE', title: 'Водительское удостоверение' });
  if (roles.has('TAXI_DRIVER')) {
    steps.push({ id: 'TAXI_VEHICLE', title: 'Легковой автомобиль' });
    if (registrationUploadSlotsForStep('TAXI_DOCUMENTS', application, config).length) steps.push({ id: 'TAXI_DOCUMENTS', title: 'Документы автомобиля' });
    if (registrationUploadSlotsForStep('TAXI_PHOTOS', application, config).length) steps.push({ id: 'TAXI_PHOTOS', title: 'Фотографии автомобиля' });
  }
  if (roles.has('CARGO_DRIVER')) {
    steps.push({ id: 'CARGO_VEHICLE', title: 'Грузовой транспорт' }, { id: 'CARGO_EQUIPMENT', title: 'Оснащение транспорта' });
    if (registrationUploadSlotsForStep('CARGO_DOCUMENTS', application, config).length) steps.push({ id: 'CARGO_DOCUMENTS', title: 'Документы транспорта' });
    if (registrationUploadSlotsForStep('CARGO_PHOTOS', application, config).length) steps.push({ id: 'CARGO_PHOTOS', title: 'Фотографии транспорта' });
  }
  if (roles.has('COURIER')) {
    if (courierNeedsMotorVehicle(application) && !application.data.courier.useExistingVehicle) steps.push({ id: 'COURIER_VEHICLE', title: 'Транспорт курьера' });
    steps.push({ id: 'COURIER_SETTINGS', title: 'Параметры курьера' });
  }
  steps.push(
    { id: 'WORK_PREFERENCES', title: 'График и территория', optional: true },
    { id: 'LOCATION', title: 'Геолокация', optional: true },
    { id: 'PAYMENT', title: 'Платёжные данные', optional: true },
    { id: 'REVIEW', title: 'Проверка анкеты' },
  );
  return steps;
}

const present = (upload?: RegistrationUpload) => !!upload && ['UPLOADED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'EXPIRING'].includes(upload.status);
const filled = (value: string) => value.trim().length > 0;
const positive = (value: string) => Number.isFinite(Number(value.replace(',', '.'))) && Number(value.replace(',', '.')) > 0;
const integerAtLeast = (value: string, minimum: number) => /^\d+$/.test(value) && Number(value) >= minimum;
function displayDate(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/); if (!match) return null;
  const [, day, month, year] = match.map(Number); const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
const vehicleReady = (vehicle: VehicleDraft, cargo = false) => {
  const year = Number(vehicle.year); const validYear = /^\d{4}$/.test(vehicle.year) && year >= 1950 && year <= new Date().getFullYear() + 1;
  return filled(vehicle.ownership) && filled(vehicle.brand) && filled(vehicle.model) && validYear && filled(vehicle.plateNumber) && (!cargo || filled(vehicle.type) && positive(vehicle.capacityKg));
};
function validateCargoEquipment(equipment: CargoEquipmentDraft, errors: Record<string, string>, prefix = '') {
  const key = (name: string) => `${prefix}${name}`;
  if (!equipment.loadingTypes.length) errors[key('loadingTypes')] = 'Выберите тип загрузки';
  if (equipment.palletCount && !integerAtLeast(equipment.palletCount, 0)) errors[key('palletCount')] = 'Укажите количество паллет целым числом';
  if (equipment.refrigerator && (!filled(equipment.minTemperature) || !filled(equipment.maxTemperature) || !Number.isFinite(Number(equipment.minTemperature.replace(',', '.'))) || !Number.isFinite(Number(equipment.maxTemperature.replace(',', '.'))) || Number(equipment.minTemperature.replace(',', '.')) > Number(equipment.maxTemperature.replace(',', '.')))) errors[key('temperature')] = 'Укажите корректный температурный диапазон';
  if (equipment.worksWithLoaders && !integerAtLeast(equipment.loaderCount, 1)) errors[key('loaderCount')] = 'Укажите количество грузчиков';
}
function configuredDocumentSlots(config: RegistrationConfig, role: PerformerRole, prefix: string, ownership?: VehicleDraft['ownership']) {
  return config.documents.filter(item => item.required && item.role === role && (!item.ownership || item.ownership === ownership)).flatMap(item => Array.from({ length: Math.max(1, item.sides || 1) }, (_, index) => ({
    slot: `${prefix}_additional_${item.id}${item.sides > 1 ? index === 0 ? '_front' : index === 1 ? '_back' : `_side_${index + 1}` : ''}`,
    title: item.title,
    requiresExpiry: item.requiresExpiry === true,
  })));
}

export type StepValidation = { valid: boolean; errors: Record<string, string> };

export function validateRegistrationStep(step: RegistrationStepId, application: RegistrationApplication, config: RegistrationConfig): StepValidation {
  const d = application.data;
  const errors: Record<string, string> = {};
  const required = (key: string, value: string, message: string) => { if (!filled(value)) errors[key] = message; };
  const requireUpload = (slot: string, message: string) => { if (!present(d.uploads[slot])) errors[slot] = message; };
  const requireRegistrationUploads = (target: RegistrationStepId) => registrationUploadSlotsForStep(target, application, config).forEach(item => {
    if (item.required) requireUpload(item.slotKey, `Загрузите файл «${item.title}»`);
    if (item.required && item.requiresExpiry) {
      const value = d.documentExpiries[item.slotKey] || '';
      if (!value) errors[`expiry_${item.slotKey}`] = 'Укажите срок действия документа';
      else if (!displayDate(value) || displayDate(value)!.getTime() < Date.now()) errors[`expiry_${item.slotKey}`] = 'Документ должен быть действующим';
    }
  });
  const validateAdditionalVehicles = (usage: VehicleUsage, cargo = false, taxi = false) => {
    const vehicles = d.vehicles || [];
    const clientIds = vehicles.map(vehicle => vehicle.clientId);
    if (vehicles.length > MAX_ADDITIONAL_VEHICLES) errors.vehicles = `Можно добавить не более ${MAX_ADDITIONAL_VEHICLES} дополнительных машин`;
    if (clientIds.some(clientId => !additionalVehicleClientIdPattern.test(clientId)) || new Set(clientIds).size !== clientIds.length) errors.vehicles = 'Не удалось определить одну из дополнительных машин. Удалите её и добавьте заново.';
    additionalVehiclesForUsage(d, usage).forEach(vehicle => {
      if (!vehicleReady(vehicle, cargo)) errors[`vehicle_${vehicle.clientId}`] = 'Заполните обязательные данные транспорта';
      if (taxi && !vehicle.tariffs.length) errors[`vehicle_${vehicle.clientId}_tariffs`] = 'Выберите хотя бы один предпочтительный тариф';
    });
  };
  switch (step) {
    case 'ROLES': if (!application.roles.length) errors.roles = 'Выберите хотя бы одно направление'; break;
    case 'PERSONAL_DATA': {
      required('firstName', d.personal.firstName, 'Введите имя'); required('lastName', d.personal.lastName, 'Введите фамилию'); required('birthDate', d.personal.birthDate, 'Укажите дату рождения'); required('city', d.personal.city, 'Выберите город');
      if (d.personal.birthDate && !/^\d{2}\.\d{2}\.\d{4}$/.test(d.personal.birthDate)) errors.birthDate = 'Используйте формат ДД.ММ.ГГГГ';
      else if (d.personal.birthDate) {
        const [day, month, year] = d.personal.birthDate.split('.').map(Number); const date = new Date(year, month - 1, day); const age = Math.floor((Date.now() - date.getTime()) / 31557600000);
        const minimumAge = Math.max(config.minimumAge, ...application.roles.map(role => config.minimumAgeByRole?.[role] ?? config.minimumAge));
        if (Number.isNaN(date.getTime()) || date.getDate() !== day || age < minimumAge) errors.birthDate = `Минимальный возраст — ${minimumAge} лет`;
      }
      break;
    }
    case 'PROFILE_PHOTO': requireRegistrationUploads(step); break;
    case 'IDENTITY_DOCUMENT':
      requireRegistrationUploads(step); required('identityNumber', d.identity.number, 'Введите номер документа'); required('identityIssuedAt', d.identity.issuedAt, 'Укажите дату выдачи'); required('identityExpiresAt', d.identity.expiresAt, 'Укажите срок действия'); required('identityIssuedBy', d.identity.issuedBy, 'Укажите, кем выдан документ');
      if (d.identity.issuedAt && (!displayDate(d.identity.issuedAt) || displayDate(d.identity.issuedAt)!.getTime() > Date.now())) errors.identityIssuedAt = 'Укажите корректную дату выдачи';
      if (d.identity.expiresAt && (!displayDate(d.identity.expiresAt) || displayDate(d.identity.expiresAt)!.getTime() < Date.now())) errors.identityExpiresAt = 'Документ должен быть действующим';
      break;
    case 'COURIER_TRANSPORT':
      if (!d.courier.transportModes.length) errors.transportModes = 'Выберите хотя бы один способ доставки';
      if (d.courier.useExistingVehicle) {
        if (!d.courier.existingVehicleUsage) errors.existingVehicleUsage = 'Выберите транспорт для доставки';
        else if (!application.roles.includes(d.courier.existingVehicleUsage === 'TAXI' ? 'TAXI_DRIVER' : 'CARGO_DRIVER')) errors.existingVehicleUsage = 'Выбранное направление больше не доступно';
        else if (d.courier.existingVehicleClientId && !d.vehicles.some(vehicle => vehicle.clientId === d.courier.existingVehicleClientId && vehicle.usage === d.courier.existingVehicleUsage)) errors.existingVehicleUsage = 'Выбранная машина больше не доступна';
      }
      break;
    case 'DRIVER_LICENSE':
      requireRegistrationUploads(step); required('licenseNumber', d.driverLicense.number, 'Введите номер удостоверения'); if (!d.driverLicense.categories.length) errors.licenseCategories = 'Выберите категорию прав'; required('licenseExpiresAt', d.driverLicense.expiresAt, 'Укажите срок действия');
      if (d.driverLicense.issuedAt && (!displayDate(d.driverLicense.issuedAt) || displayDate(d.driverLicense.issuedAt)!.getTime() > Date.now())) errors.licenseIssuedAt = 'Укажите корректную дату выдачи';
      if (d.driverLicense.expiresAt && (!displayDate(d.driverLicense.expiresAt) || displayDate(d.driverLicense.expiresAt)!.getTime() < Date.now())) errors.licenseExpiresAt = 'Удостоверение должно быть действующим';
      if (d.driverLicense.experienceYears && !integerAtLeast(d.driverLicense.experienceYears, 0)) errors.experienceYears = 'Укажите стаж целым числом';
      break;
    case 'TAXI_VEHICLE': if (!vehicleReady(d.taxiVehicle)) errors.vehicle = 'Заполните обязательные данные автомобиля'; if (!d.taxiVehicle.tariffs.length) errors.tariffs = 'Выберите хотя бы один предпочтительный тариф'; validateAdditionalVehicles('TAXI', false, true); break;
    case 'CARGO_VEHICLE': if (!vehicleReady(d.cargoVehicle, true)) errors.vehicle = 'Заполните обязательные данные транспорта'; validateAdditionalVehicles('CARGO', true); break;
    case 'COURIER_VEHICLE':
      if (!vehicleReady(d.courierVehicle)) errors.vehicle = 'Заполните данные моторного транспорта';
      validateAdditionalVehicles('COURIER');
      requireRegistrationUploads(step);
      break;
    case 'CARGO_EQUIPMENT':
      validateCargoEquipment(d.cargoEquipment, errors);
      additionalVehiclesForUsage(d, 'CARGO').forEach(vehicle => validateCargoEquipment(vehicle.equipment, errors, `vehicle_${vehicle.clientId}_`));
      break;
    case 'TAXI_DOCUMENTS': case 'CARGO_DOCUMENTS': {
      const prefix = step === 'TAXI_DOCUMENTS' ? 'taxi' : 'cargo'; const vehicle = step === 'TAXI_DOCUMENTS' ? d.taxiVehicle : d.cargoVehicle;
      const role = step === 'TAXI_DOCUMENTS' ? 'TAXI_DRIVER' : 'CARGO_DRIVER';
      requireRegistrationUploads(step);
      configuredDocumentSlots(config, role, prefix, vehicle.ownership).forEach(item => {
        requireUpload(item.slot, `Загрузите документ «${item.title}»`);
        if (item.requiresExpiry) {
          const value = d.documentExpiries[item.slot] || '';
          if (!value) errors[`expiry_${item.slot}`] = 'Укажите срок действия документа';
          else if (!displayDate(value) || displayDate(value)!.getTime() < Date.now()) errors[`expiry_${item.slot}`] = 'Документ должен быть действующим';
        }
      });
      break;
    }
    case 'TAXI_PHOTOS': case 'CARGO_PHOTOS': requireRegistrationUploads(step); break;
    case 'COURIER_SETTINGS':
      if (!d.courier.orderTypes.length) errors.orderTypes = 'Выберите типы заказов'; required('maxWeightKg', d.courier.maxWeightKg, 'Укажите максимальный вес'); if (d.courier.maxWeightKg && !positive(d.courier.maxWeightKg)) errors.maxWeightKg = 'Вес должен быть больше нуля'; required('courierCity', d.courier.city || d.personal.city, 'Выберите город работы');
      configuredDocumentSlots(config, 'COURIER', 'courier').forEach(item => {
        requireUpload(item.slot, `Загрузите документ «${item.title}»`);
        if (item.requiresExpiry && !d.documentExpiries[item.slot]) errors[`expiry_${item.slot}`] = 'Укажите срок действия документа';
      });
      break;
    case 'WORK_PREFERENCES': if (d.work.maxPickupDistanceKm && !positive(d.work.maxPickupDistanceKm)) errors.maxPickupDistanceKm = 'Расстояние должно быть больше нуля'; break;
    case 'PAYMENT': if (d.payment.type && !/^\d{4}$/.test(d.payment.last4)) errors.paymentLast4 = 'Укажите последние четыре цифры'; break;
    case 'REVIEW':
      (config.legalConsents || [{ id: 'truth-confirmation', required: true, title: 'Подтверждение данных' }, { id: 'performer-terms', required: true, title: 'Условия работы' }]).filter(item => item.required).forEach(item => {
        const checked = item.id === 'truth-confirmation' ? d.agreements.truthConfirmed : item.id === 'performer-terms' ? d.agreements.termsAccepted : d.agreements.acceptedIds.includes(item.id);
        if (!checked) errors[item.id === 'truth-confirmation' ? 'truthConfirmed' : item.id === 'performer-terms' ? 'termsAccepted' : `consent_${item.id}`] = `Примите условие «${item.title}»`;
      });
      break;
  }
  return { valid: !Object.keys(errors).length, errors };
}

export function firstIncompleteStep(application: RegistrationApplication, config: RegistrationConfig): RegistrationStepId {
  return buildRegistrationSteps(application, config).find(step => {
    if (step.id === 'REVIEW' || validateRegistrationStep(step.id, application, config).valid) return false;
    if (!step.optional || !application.data.skippedSteps.includes(step.id)) return true;
    return step.id === 'PAYMENT' && !!application.data.payment.type;
  })?.id ?? 'REVIEW';
}

export function normalizeStep(application: RegistrationApplication): RegistrationStepId {
  const steps = buildRegistrationSteps(application); return steps.some(step => step.id === application.currentStep) ? application.currentStep : steps[Math.max(0, steps.length - 1)].id;
}
