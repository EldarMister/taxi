import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../design/theme';
import { Icon } from '../ui';
import { additionalVehicleUploadSlotsForStep, additionalVehiclesForUsage, buildRegistrationSteps, configuredUploadSlotsForStep, correctionExpiryAllowed, correctionUploadDeleteAllowed, correctionVehicleFieldAllowed, performerRoleForVehicleUsage, registrationUploadSlotsForStep, validateRegistrationStep, type ConfiguredUploadSlot } from './flow';
import {
  CheckboxRow, ChoiceCard, FormInput, InfoCard, MultiSelect, NativeDateInput, OptionSheet, SectionTitle, SelectInput, StatusBadge, ToggleRow, UploadCard,
} from './components';
import { MAX_ADDITIONAL_VEHICLES, createAdditionalVehicle, type AdditionalVehicleDraft, type CargoEquipmentDraft, type PerformerRole, type RegistrationApplication, type RegistrationConfig, type RegistrationData, type RegistrationStepId, type RegistrationUpload, type VehicleDraft, type VehicleUsage } from './types';

type UploadKind = RegistrationUpload['kind'];
type Props = {
  step: RegistrationStepId;
  application: RegistrationApplication;
  config: RegistrationConfig;
  errors: Record<string, string>;
  onRoles: (roles: PerformerRole[]) => void;
  onData: (updater: (data: RegistrationData) => RegistrationData) => void;
  onUpload: (slotKey: string, kind: UploadKind, title: string, image?: boolean, profile?: boolean, role?: PerformerRole, expiresAt?: string) => void;
  onDeleteUpload: (slotKey: string) => void;
  onRequestLocation: () => void;
  onGoTo: (step: RegistrationStepId) => void;
  correctionFields?: string[];
};

const roleIcons: Record<PerformerRole, React.ComponentProps<typeof Icon>['name']> = { TAXI_DRIVER: 'car-sport-outline', CARGO_DRIVER: 'bus-outline', COURIER: 'bicycle-outline' };
const roleImages: Record<PerformerRole, number> = {
  TAXI_DRIVER: require('../../assets/registration/role-taxi-3d.png'),
  CARGO_DRIVER: require('../../assets/registration/role-cargo-3d.png'),
  COURIER: require('../../assets/registration/role-courier-3d.png'),
};
const courierModeLabels: Record<string, string> = { FOOT: 'Пешком', BICYCLE: 'Велосипед', E_BICYCLE: 'Электровелосипед', MOPED: 'Мопед', SCOOTER: 'Скутер', MOTORCYCLE: 'Мотоцикл', CAR: 'Легковой автомобиль', TRUCK: 'Грузовой автомобиль' };
const orderTypeLabels: Record<string, string> = { DOCUMENTS: 'Документы', PARCELS: 'Посылки', GROCERIES: 'Продукты', MEALS: 'Готовая еда', MEDICINE: 'Лекарства', LARGE: 'Крупные заказы' };
const loadingTypeLabels: Record<string, string> = { REAR: 'Задняя', SIDE: 'Боковая', TOP: 'Верхняя' };
const photoLabels: Record<string, string> = { front: 'Спереди', back: 'Сзади', left: 'Левая сторона', right: 'Правая сторона', interior_front: 'Передняя часть салона', interior_back: 'Задний ряд', trunk: 'Багажник', cabin: 'Кабина', cargo_bay: 'Грузовой отсек', plate: 'Государственный номер' };

function scopeAllows(scope: string[] | undefined, path: string) {
  if (scope === undefined) return true;
  const normalized = path.replace(/^data\./, '').replace(/^uploads\./, '');
  return scope.some(value => {
    const candidate = value.replace(/^data\./, '').replace(/^uploads\./, '');
    return candidate === normalized || candidate.startsWith(`${normalized}.`) || normalized.startsWith(`${candidate}.`);
  });
}

function correctionUploadAllowed(scope: string[] | undefined, slotKey: string, upload?: RegistrationUpload) {
  if (scope === undefined) return true;
  return !!upload && ['CORRECTION_REQUIRED', 'REJECTED', 'EXPIRED'].includes(upload.status) && upload.canReupload !== false && (scope.length === 0 || scopeAllows(scope, `uploads.${slotKey}`) || !scope.some(item => item.startsWith('uploads.')));
}

const stepFieldRoots: Partial<Record<RegistrationStepId, string[]>> = {
  ROLES: ['roles'], PERSONAL_DATA: ['personal'], IDENTITY_DOCUMENT: ['identity'], DRIVER_LICENSE: ['driverLicense'], COURIER_TRANSPORT: ['courier.transportModes', 'courier.useExistingVehicle', 'courier.existingVehicleUsage', 'courier.existingVehicleClientId'],
  TAXI_VEHICLE: ['taxiVehicle'], CARGO_VEHICLE: ['cargoVehicle'], COURIER_VEHICLE: ['courierVehicle'], CARGO_EQUIPMENT: ['cargoEquipment'], COURIER_SETTINGS: ['courier'], WORK_PREFERENCES: ['work'], LOCATION: ['location'], PAYMENT: ['payment'],
};

function normalizedCorrectionField(value: string) {
  return value.replace(/^data\./, '').replace(/^uploads\./, '');
}

function additionalVehicleHasCorrection(step: RegistrationStepId, application: RegistrationApplication, scope: string[]) {
  const usage = step === 'TAXI_VEHICLE' ? 'TAXI' : step === 'CARGO_VEHICLE' || step === 'CARGO_EQUIPMENT' ? 'CARGO' : step === 'COURIER_VEHICLE' ? 'COURIER' : null;
  if (!usage) return false;
  return application.data.vehicles.some((vehicle, index) => {
    if (vehicle.usage !== usage) return false;
    const roots = [`vehicles.${index}`, `vehicles.${vehicle.clientId}`];
    return scope.some(value => {
      const candidate = normalizedCorrectionField(value);
      if (candidate === 'vehicles') return true;
      if (step === 'CARGO_EQUIPMENT') return roots.some(root => candidate === `${root}.equipment` || candidate.startsWith(`${root}.equipment.`));
      return roots.some(root => candidate === root || candidate.startsWith(`${root}.`) && !candidate.startsWith(`${root}.equipment`));
    });
  });
}

function stepHasCorrection(step: RegistrationStepId, application: RegistrationApplication, config: RegistrationConfig, scope: string[]) {
  if ((stepFieldRoots[step] || []).some(path => scopeAllows(scope, path))) return true;
  if (additionalVehicleHasCorrection(step, application, scope)) return true;
  const problemSlots = Object.values(application.data.uploads).filter(upload => ['CORRECTION_REQUIRED', 'REJECTED', 'EXPIRED'].includes(upload.status) && upload.canReupload !== false).map(upload => upload.slotKey);
  if (registrationUploadSlotsForStep(step, application, config).some(item => problemSlots.includes(item.slotKey))) return true;
  if (step === 'COURIER_SETTINGS' && problemSlots.some(slot => slot === 'courier_health_book' || slot.startsWith('courier_additional_'))) return true;
  if (step === 'TAXI_DOCUMENTS' && problemSlots.some(slot => slot.startsWith('taxi_additional_'))) return true;
  if (step === 'CARGO_DOCUMENTS' && problemSlots.some(slot => slot.startsWith('cargo_additional_'))) return true;
  return false;
}

export function RegistrationStepContent(props: Props) {
  const { step, application: a, config, errors, onData, onRoles, onUpload, onDeleteUpload, onRequestLocation, onGoTo, correctionFields } = props; const d = a.data; const { palette } = useTheme();
  const [picker, setPicker] = useState<{ title: string; options: { value: string; label: string }[]; selected?: string; choose: (value: string) => void } | null>(null);
  const roleOptions = config.roles.map(option => ({ role: option.id, title: option.title, description: option.description, icon: roleIcons[option.id], image: roleImages[option.id] }));
  const courierModes = config.courierTransportModes.map(value => ({ value, label: courierModeLabels[value] || value }));
  const orderTypes = config.courierOrderTypes.map(value => ({ value, label: orderTypeLabels[value] || value }));
  const loadingTypes = config.loadingTypes.map(value => ({ value, label: loadingTypeLabels[value] || value }));
  const birthDateMaximum = new Date();
  birthDateMaximum.setHours(12, 0, 0, 0);
  birthDateMaximum.setFullYear(birthDateMaximum.getFullYear() - Math.max(config.minimumAge || 18, ...a.roles.map(role => config.minimumAgeByRole[role] || config.minimumAge || 18)));
  const birthDateMinimum = new Date(birthDateMaximum.getFullYear() - 72, 0, 1, 12);
  const canEdit = (path: string) => scopeAllows(correctionFields, path);
  const patch = <K extends keyof RegistrationData>(key: K, value: Partial<RegistrationData[K]>) => {
    const allowed = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([field]) => key === 'agreements' || canEdit(`${String(key)}.${field}`) || key === 'documentExpiries' && correctionUploadAllowed(correctionFields, field, d.uploads[field]))) as Partial<RegistrationData[K]>;
    if (!Object.keys(allowed as object).length) return;
    onData(data => ({ ...data, [key]: { ...(data[key] as object), ...allowed } }));
  };
  const configuredUploads = (target: RegistrationStepId, profile = false) => configuredUploadSlotsForStep(target, a, config).map(item => <ConfiguredUpload key={item.slotKey} item={item} upload={d.uploads[item.slotKey]} expiry={d.documentExpiries[item.slotKey] || ''} error={errors[item.slotKey]} expiryError={errors[`expiry_${item.slotKey}`]} profile={profile} disabled={!correctionUploadAllowed(correctionFields, item.slotKey, d.uploads[item.slotKey])} expiryDisabled={!correctionExpiryAllowed(correctionFields, item.slotKey)} onExpiry={value => patch('documentExpiries', { [item.slotKey]: value })} onUpload={() => onUpload(item.slotKey, item.kind, item.title, true, profile, undefined, item.requiresExpiry ? d.documentExpiries[item.slotKey] : undefined)} onDelete={correctionUploadDeleteAllowed(correctionFields) ? () => onDeleteUpload(item.slotKey) : undefined}/>);
  const select = (title: string, options: { value: string; label: string }[], selected: string | undefined, choose: (value: string) => void) => setPicker({ title, options, selected, choose });
  const updateAdditionalVehicle = (clientId: string, updater: (vehicle: AdditionalVehicleDraft) => AdditionalVehicleDraft) => onData(data => ({ ...data, vehicles: data.vehicles.map(vehicle => vehicle.clientId === clientId ? updater(vehicle) : vehicle) }));
  const addAdditionalVehicle = (usage: VehicleUsage) => {
    if (correctionFields !== undefined) return;
    onData(data => {
      if (data.vehicles.length >= MAX_ADDITIONAL_VEHICLES) return data;
      let vehicle = createAdditionalVehicle(usage);
      while (data.vehicles.some(item => item.clientId === vehicle.clientId)) vehicle = createAdditionalVehicle(usage);
      return { ...data, vehicles: [...data.vehicles, vehicle] };
    });
  };
  const removeAdditionalVehicle = (vehicle: AdditionalVehicleDraft) => {
    if (correctionFields !== undefined) return;
    const slotPrefix = `vehicle_${vehicle.clientId}_`;
    Object.keys(d.uploads).filter(slotKey => slotKey.startsWith(slotPrefix)).forEach(onDeleteUpload);
    onData(data => {
      const documentExpiries = { ...data.documentExpiries };
      Object.keys(documentExpiries).filter(slotKey => slotKey.startsWith(slotPrefix)).forEach(slotKey => { delete documentExpiries[slotKey]; });
      const selectedForCourier = data.courier.existingVehicleClientId === vehicle.clientId;
      return { ...data, vehicles: data.vehicles.filter(item => item.clientId !== vehicle.clientId), documentExpiries, courier: selectedForCourier ? { ...data.courier, useExistingVehicle: false, existingVehicleUsage: '', existingVehicleClientId: '' } : data.courier };
    });
  };
  const reusableVehicleOptions = [
    ...(a.roles.includes('TAXI_DRIVER') ? [{ value: 'TAXI:primary', label: `${`${d.taxiVehicle.brand} ${d.taxiVehicle.model}`.trim() || 'Основной автомобиль такси'} · ${d.taxiVehicle.plateNumber || 'номер не указан'}` }, ...additionalVehiclesForUsage(d, 'TAXI').map(vehicle => ({ value: `TAXI:${vehicle.clientId}`, label: `${`${vehicle.brand} ${vehicle.model}`.trim() || 'Дополнительный автомобиль такси'} · ${vehicle.plateNumber || 'номер не указан'}` }))] : []),
    ...(a.roles.includes('CARGO_DRIVER') ? [{ value: 'CARGO:primary', label: `${`${d.cargoVehicle.brand} ${d.cargoVehicle.model}`.trim() || 'Основной грузовой транспорт'} · ${d.cargoVehicle.plateNumber || 'номер не указан'}` }, ...additionalVehiclesForUsage(d, 'CARGO').map(vehicle => ({ value: `CARGO:${vehicle.clientId}`, label: `${`${vehicle.brand} ${vehicle.model}`.trim() || 'Дополнительный грузовой транспорт'} · ${vehicle.plateNumber || 'номер не указан'}` }))] : []),
  ];

  let content: React.ReactNode;
  switch (step) {
    case 'ROLES': content = <>
      <View style={s.roleIntro}><View style={s.roleIntroCopy}><SectionTitle title="Как хотите работать?" description="Можно выбрать несколько направлений — общие сведения заполняются только один раз."/></View><Image source={require('../../assets/registration/roles-checklist-3d.png')} resizeMode="contain" style={s.roleHero}/></View>
      <View style={s.stack}>{roleOptions.map(option => <ChoiceCard key={option.role} {...option} selected={a.roles.includes(option.role)} disabled={!canEdit('roles')} onPress={() => onRoles(a.roles.includes(option.role) ? a.roles.filter(role => role !== option.role) : [...a.roles, option.role])}/>)}</View>
      {errors.roles ? <Text style={s.error}>{errors.roles}</Text> : null}
      <InfoCard title="Можно совмещать" text="Выберите одно или несколько направлений. Следующие шаги автоматически подстроятся под ваш выбор."/>
    </>; break;
    case 'PERSONAL_DATA': content = <>
      <SectionTitle title="Личные данные" description="Укажите данные как в удостоверении личности. Они используются для всех направлений."/>
      <View style={s.twoColumns}><View style={s.half}><FormInput label="Имя" value={d.personal.firstName} onChangeText={firstName => patch('personal', { firstName })} error={errors.firstName} disabled={!canEdit('personal.firstName')}/></View><View style={s.half}><FormInput label="Фамилия" value={d.personal.lastName} onChangeText={lastName => patch('personal', { lastName })} error={errors.lastName} disabled={!canEdit('personal.lastName')}/></View></View>
      <FormInput label="Отчество" optional value={d.personal.middleName} onChangeText={middleName => patch('personal', { middleName })} placeholder="При наличии" disabled={!canEdit('personal.middleName')}/>
      <NativeDateInput label="Дата рождения" value={d.personal.birthDate} onChange={birthDate => patch('personal', { birthDate })} minimumDate={birthDateMinimum} maximumDate={birthDateMaximum} error={errors.birthDate} disabled={!canEdit('personal.birthDate')}/>
      <SelectInput label="Город работы" value={d.personal.city} placeholder="Выберите город" error={errors.city} disabled={!canEdit('personal.city')} onPress={() => select('Город работы', config.cities.map(value => ({ value, label: value })), d.personal.city, city => { patch('personal', { city }); if (!d.work.city) patch('work', { city }); if (!d.courier.city) patch('courier', { city }); })}/>
      <SelectInput label="Гражданство" optional value={d.personal.citizenship} placeholder="Выберите страну" disabled={!canEdit('personal.citizenship')} onPress={() => select('Гражданство', config.countries.map(value => ({ value, label: value })), d.personal.citizenship, citizenship => patch('personal', { citizenship }))}/>
      <SelectInput label="Язык интерфейса" value={config.languages.find(item => item.id === d.personal.language)?.name || d.personal.language} placeholder="Выберите язык" disabled={!canEdit('personal.language')} onPress={() => select('Язык интерфейса', config.languages.map(item => ({ value: item.id, label: item.name })), d.personal.language, language => patch('personal', { language: language as 'ru' | 'ky' }))}/>
    </>; break;
    case 'PROFILE_PHOTO': content = <>
      <SectionTitle title="Фотография профиля" description="Фото увидят клиенты после назначения заказа."/>
      {configuredUploads('PROFILE_PHOTO', true)}
      <Requirements items={['Лицо хорошо видно и находится в центре', 'На фото только один человек', 'Хорошее освещение без бликов', 'Без тёмных очков и закрытого лица']}/>
    </>; break;
    case 'IDENTITY_DOCUMENT': content = <>
      <SectionTitle title="Удостоверение личности" description="Все края документа должны быть видны, а текст — легко читаться."/>
      {configuredUploads('IDENTITY_DOCUMENT')}
      <FormInput label="Номер документа" value={d.identity.number} onChangeText={number => patch('identity', { number })} autoCapitalize="characters" error={errors.identityNumber} disabled={!canEdit('identity.number')}/>
      <View style={s.twoColumns}><View style={s.half}><FormInput label="Дата выдачи" value={d.identity.issuedAt} onChangeText={issuedAt => patch('identity', { issuedAt })} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" error={errors.identityIssuedAt} disabled={!canEdit('identity.issuedAt')}/></View><View style={s.half}><FormInput label="Действителен до" value={d.identity.expiresAt} onChangeText={expiresAt => patch('identity', { expiresAt })} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" error={errors.identityExpiresAt} disabled={!canEdit('identity.expiresAt')}/></View></View>
      <FormInput label="Кем выдан" value={d.identity.issuedBy} onChangeText={issuedBy => patch('identity', { issuedBy })} error={errors.identityIssuedBy} disabled={!canEdit('identity.issuedBy')}/>
    </>; break;
    case 'COURIER_TRANSPORT': content = <>
      <SectionTitle title="Как будете доставлять?" description="Можно выбрать несколько способов доставки."/>
      <MultiSelect options={courierModes} values={d.courier.transportModes} onChange={transportModes => patch('courier', { transportModes: transportModes as RegistrationData['courier']['transportModes'] })} error={errors.transportModes} columns={1} disabled={!canEdit('courier.transportModes')}/>
      {d.courier.transportModes.some(mode => ['MOPED', 'SCOOTER', 'MOTORCYCLE', 'CAR', 'TRUCK'].includes(mode)) && reusableVehicleOptions.length ? <><Text style={[s.label, { color: palette.muted }]}>Использовать добавленный транспорт</Text><MultiSelect columns={1} options={reusableVehicleOptions} values={d.courier.existingVehicleUsage ? [`${d.courier.existingVehicleUsage}:${d.courier.existingVehicleClientId || 'primary'}`] : []} onChange={values => { const [usage = '', selected = ''] = (values.at(-1) || '').split(':'); const existingVehicleUsage = usage === 'TAXI' || usage === 'CARGO' ? usage : ''; patch('courier', { existingVehicleUsage, existingVehicleClientId: selected && selected !== 'primary' ? selected : '', useExistingVehicle: !!existingVehicleUsage }); }} error={errors.existingVehicleUsage} disabled={!canEdit('courier.existingVehicleUsage') && !canEdit('courier.existingVehicleClientId') && !canEdit('courier.useExistingVehicle')}/><InfoCard text="Можно выбрать конкретную основную или дополнительную машину. Пустой выбор создаст отдельный транспорт курьера."/></> : null}
      <InfoCard text="Для пеших и велодоставок документы транспорта не нужны. Для моторного транспорта появятся дополнительные шаги."/>
    </>; break;
    case 'DRIVER_LICENSE': content = <>
      <SectionTitle title="Водительское удостоверение" description="Загрузите обе стороны и проверьте распознанные данные."/>
      {configuredUploads('DRIVER_LICENSE')}
      <FormInput label="Номер" value={d.driverLicense.number} onChangeText={number => patch('driverLicense', { number })} autoCapitalize="characters" error={errors.licenseNumber} disabled={!canEdit('driverLicense.number')}/>
      <Text style={[s.label, { color: palette.muted }]}>Категории *</Text><MultiSelect options={config.driverLicenseCategories.map(value => ({ value, label: value }))} values={d.driverLicense.categories} onChange={categories => patch('driverLicense', { categories })} error={errors.licenseCategories} columns={3} disabled={!canEdit('driverLicense.categories')}/>
      <View style={s.twoColumns}><View style={s.half}><FormInput label="Дата выдачи" value={d.driverLicense.issuedAt} onChangeText={issuedAt => patch('driverLicense', { issuedAt })} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" error={errors.licenseIssuedAt} disabled={!canEdit('driverLicense.issuedAt')}/></View><View style={s.half}><FormInput label="Действителен до" value={d.driverLicense.expiresAt} onChangeText={expiresAt => patch('driverLicense', { expiresAt })} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" error={errors.licenseExpiresAt} disabled={!canEdit('driverLicense.expiresAt')}/></View></View>
      <FormInput label="Водительский стаж" value={d.driverLicense.experienceYears} onChangeText={experienceYears => patch('driverLicense', { experienceYears })} placeholder="Полных лет" keyboardType="number-pad" error={errors.experienceYears} disabled={!canEdit('driverLicense.experienceYears')}/>
    </>; break;
    case 'TAXI_VEHICLE': content = <><VehicleForm title="Основной автомобиль" description="Основная карточка сохраняет совместимость с действующим профилем такси." vehicle={d.taxiVehicle} path="taxiVehicle" onChange={value => patch('taxiVehicle', value)} canEdit={canEdit} config={config} errors={errors} taxi select={select}/><AdditionalVehicleForms usage="TAXI" vehicles={d.vehicles} config={config} errors={errors} correctionFields={correctionFields} onAdd={() => addAdditionalVehicle('TAXI')} onRemove={removeAdditionalVehicle} onChange={(vehicle, value) => updateAdditionalVehicle(vehicle.clientId, current => ({ ...current, ...value }))} select={select}/></>; break;
    case 'CARGO_VEHICLE': content = <><VehicleForm title="Основной грузовой транспорт" description="Основная карточка сохраняет совместимость с действующим грузовым профилем." vehicle={d.cargoVehicle} path="cargoVehicle" onChange={value => patch('cargoVehicle', value)} canEdit={canEdit} config={config} errors={errors} cargo select={select}/><AdditionalVehicleForms usage="CARGO" vehicles={d.vehicles} config={config} errors={errors} correctionFields={correctionFields} onAdd={() => addAdditionalVehicle('CARGO')} onRemove={removeAdditionalVehicle} onChange={(vehicle, value) => updateAdditionalVehicle(vehicle.clientId, current => ({ ...current, ...value }))} select={select}/></>; break;
    case 'COURIER_VEHICLE': content = <>
      <VehicleForm title="Основной транспорт курьера" description="Моторный транспорт требует отдельной карточки и документов." vehicle={d.courierVehicle} path="courierVehicle" onChange={value => patch('courierVehicle', value)} canEdit={canEdit} config={config} errors={errors} select={select}/>
      <AdditionalVehicleForms usage="COURIER" vehicles={d.vehicles} config={config} errors={errors} correctionFields={correctionFields} onAdd={() => addAdditionalVehicle('COURIER')} onRemove={removeAdditionalVehicle} onChange={(vehicle, value) => updateAdditionalVehicle(vehicle.clientId, current => ({ ...current, ...value }))} select={select}/>
      {configuredUploads('COURIER_VEHICLE')}
      <AdditionalVehicleUploads step="COURIER_VEHICLE" application={a} data={d} errors={errors} correctionFields={correctionFields} onData={onData} onUpload={onUpload} onDelete={onDeleteUpload}/>
    </>; break;
    case 'TAXI_DOCUMENTS': content = <><DocumentList step="TAXI_DOCUMENTS" application={a} role="TAXI_DRIVER" prefix="taxi" title="Документы основного автомобиля" vehicle={d.taxiVehicle} data={d} config={config} errors={errors} correctionFields={correctionFields} onData={onData} onUpload={onUpload} onDelete={onDeleteUpload}/><AdditionalVehicleUploads step="TAXI_DOCUMENTS" application={a} data={d} errors={errors} correctionFields={correctionFields} onData={onData} onUpload={onUpload} onDelete={onDeleteUpload}/></>; break;
    case 'CARGO_DOCUMENTS': content = <><DocumentList step="CARGO_DOCUMENTS" application={a} role="CARGO_DRIVER" prefix="cargo" title="Документы основного грузового транспорта" vehicle={d.cargoVehicle} data={d} config={config} errors={errors} correctionFields={correctionFields} onData={onData} onUpload={onUpload} onDelete={onDeleteUpload}/><AdditionalVehicleUploads step="CARGO_DOCUMENTS" application={a} data={d} errors={errors} correctionFields={correctionFields} onData={onData} onUpload={onUpload} onDelete={onDeleteUpload}/></>; break;
    case 'TAXI_PHOTOS': content = <><PhotoList title="Фотографии основного автомобиля" role="TAXI_DRIVER" slots={configuredUploadSlotsForStep('TAXI_PHOTOS', a, config)} uploads={d.uploads} errors={errors} correctionFields={correctionFields} onUpload={onUpload} onDelete={onDeleteUpload}/><AdditionalVehicleUploads step="TAXI_PHOTOS" application={a} data={d} errors={errors} correctionFields={correctionFields} onData={onData} onUpload={onUpload} onDelete={onDeleteUpload}/></>; break;
    case 'CARGO_PHOTOS': content = <><PhotoList title="Фотографии основного транспорта" role="CARGO_DRIVER" slots={configuredUploadSlotsForStep('CARGO_PHOTOS', a, config)} uploads={d.uploads} errors={errors} correctionFields={correctionFields} onUpload={onUpload} onDelete={onDeleteUpload}/><AdditionalVehicleUploads step="CARGO_PHOTOS" application={a} data={d} errors={errors} correctionFields={correctionFields} onData={onData} onUpload={onUpload} onDelete={onDeleteUpload}/></>; break;
    case 'CARGO_EQUIPMENT': content = <><CargoEquipmentForm title="Оснащение основного транспорта" description="Укажите возможности основной машины — они влияют на доступные заказы." equipment={d.cargoEquipment} path="cargoEquipment" loadingTypes={loadingTypes} errors={errors} canEdit={canEdit} onChange={value => patch('cargoEquipment', value)}/>{additionalVehiclesForUsage(d, 'CARGO').map(vehicle => { const index = d.vehicles.findIndex(item => item.clientId === vehicle.clientId); const prefix = `vehicle_${vehicle.clientId}_`; return <View key={vehicle.clientId} style={[s.additionalCard, { borderColor: palette.line, backgroundColor: palette.surface }]}><CargoEquipmentForm title={`${vehicle.brand} ${vehicle.model}`.trim() || 'Дополнительный грузовой транспорт'} description={vehicle.plateNumber || `ID: ${vehicle.clientId}`} equipment={vehicle.equipment} path={`vehicles.${vehicle.clientId}.equipment`} loadingTypes={loadingTypes} errors={{ loadingTypes: errors[`${prefix}loadingTypes`], palletCount: errors[`${prefix}palletCount`], temperature: errors[`${prefix}temperature`], loaderCount: errors[`${prefix}loaderCount`] }} canEdit={path => correctionVehicleFieldAllowed(correctionFields, vehicle.clientId, index, path)} onChange={value => updateAdditionalVehicle(vehicle.clientId, current => ({ ...current, equipment: { ...current.equipment, ...value } }))}/></View>; })}</>; break;
    case 'COURIER_SETTINGS': content = <>
      <SectionTitle title="Параметры доставки" description="Расскажите, какие заказы вам подходят."/>
      <ToggleRow title="Есть термосумка" value={d.courier.hasThermalBag} onValueChange={hasThermalBag => patch('courier', { hasThermalBag })} disabled={!canEdit('courier.hasThermalBag')}/>
      <Text style={[s.label, { color: palette.muted }]}>Типы заказов *</Text><MultiSelect options={orderTypes} values={d.courier.orderTypes} onChange={values => patch('courier', { orderTypes: values })} error={errors.orderTypes} disabled={!canEdit('courier.orderTypes')}/>
      <FormInput label="Максимальный вес" value={d.courier.maxWeightKg} onChangeText={maxWeightKg => patch('courier', { maxWeightKg })} placeholder="кг" keyboardType="decimal-pad" error={errors.maxWeightKg} disabled={!canEdit('courier.maxWeightKg')}/>
      <ToggleRow title="Принимать наличные" value={d.courier.acceptsCash} onValueChange={acceptsCash => patch('courier', { acceptsCash })} disabled={!canEdit('courier.acceptsCash')}/>
      <SelectInput label="Город работы" value={d.courier.city || d.personal.city} placeholder="Выберите город" error={errors.courierCity} disabled={!canEdit('courier.city')} onPress={() => select('Город работы', config.cities.map(value => ({ value, label: value })), d.courier.city, city => patch('courier', { city, districts: [] }))}/>
      <Text style={[s.label, { color: palette.muted }]}>Районы · необязательно</Text><MultiSelect options={(config.districts[d.courier.city || d.personal.city] || []).map(value => ({ value, label: value }))} values={d.courier.districts} onChange={districts => patch('courier', { districts })} disabled={!canEdit('courier.districts')}/>
      {d.courier.orderTypes.some(type => ['GROCERIES', 'MEALS'].includes(type)) ? <UploadCard title="Санитарная книжка" upload={d.uploads.courier_health_book} disabled={!correctionUploadAllowed(correctionFields, 'courier_health_book', d.uploads.courier_health_book)} onPress={() => onUpload('courier_health_book', 'ADDITIONAL_DOCUMENT', 'Санитарная книжка', true, false, 'COURIER')} onDelete={d.uploads.courier_health_book && correctionUploadDeleteAllowed(correctionFields) ? () => onDeleteUpload('courier_health_book') : undefined}/> : null}
      {config.documents.filter(item => item.role === 'COURIER').flatMap(item => Array.from({ length: Math.max(1, item.sides || 1) }, (_, index) => ({ item, slot: `courier_additional_${item.id}${item.sides > 1 ? index === 0 ? '_front' : index === 1 ? '_back' : `_side_${index + 1}` : ''}`, side: index }))).map(({ item, slot, side }) => { const disabled = !correctionUploadAllowed(correctionFields, slot, d.uploads[slot]); return <View key={slot} style={s.uploadField}><UploadCard title={item.sides > 1 ? `${item.title} · ${side === 0 ? 'лицевая сторона' : side === 1 ? 'обратная сторона' : `сторона ${side + 1}`}` : item.title} required={item.required} upload={d.uploads[slot]} hint={item.description || (item.required ? 'Обязательный документ' : 'Необязательно')} disabled={disabled} onPress={() => onUpload(slot, 'ADDITIONAL_DOCUMENT', item.title, true, false, 'COURIER', item.requiresExpiry ? d.documentExpiries[slot] : undefined)} onDelete={d.uploads[slot] && correctionUploadDeleteAllowed(correctionFields) ? () => onDeleteUpload(slot) : undefined}/>{errors[slot] ? <Text style={s.error}>{errors[slot]}</Text> : null}{item.requiresExpiry ? <FormInput label="Действителен до" value={d.documentExpiries[slot] || ''} onChangeText={value => patch('documentExpiries', { [slot]: value })} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" error={errors[`expiry_${slot}`]} disabled={!correctionExpiryAllowed(correctionFields, slot)}/> : null}</View>; })}
    </>; break;
    case 'WORK_PREFERENCES': content = <>
      <SectionTitle title="График и территория" description="Необязательный раздел. Настройки можно изменить позже."/>
      <SelectInput label="Город" value={d.work.city || d.personal.city} placeholder="Выберите город" disabled={!canEdit('work.city')} onPress={() => select('Город', config.cities.map(value => ({ value, label: value })), d.work.city, city => patch('work', { city, districts: [] }))}/>
      <Text style={[s.label, { color: palette.muted }]}>Районы</Text><MultiSelect options={(config.districts[d.work.city || d.personal.city] || []).map(value => ({ value, label: value }))} values={d.work.districts} onChange={districts => patch('work', { districts })} disabled={!canEdit('work.districts')}/>
      <Text style={[s.label, { color: palette.muted }]}>График</Text><MultiSelect options={[{ value: 'FULL', label: 'Полный' }, { value: 'FLEXIBLE', label: 'Свободный' }]} values={d.work.schedule ? [d.work.schedule] : []} onChange={values => patch('work', { schedule: (values.at(-1) || '') as RegistrationData['work']['schedule'] })} disabled={!canEdit('work.schedule')}/>
      <FormInput label="Предпочтительное время" optional value={d.work.preferredTime} onChangeText={preferredTime => patch('work', { preferredTime })} placeholder="Например, 09:00–18:00" disabled={!canEdit('work.preferredTime')}/>
      <FormInput label="Расстояние до подачи" optional value={d.work.maxPickupDistanceKm} onChangeText={maxPickupDistanceKm => patch('work', { maxPickupDistanceKm })} placeholder="км" keyboardType="decimal-pad" error={errors.maxPickupDistanceKm} disabled={!canEdit('work.maxPickupDistanceKm')}/>
      <ToggleRow title="Междугородние заказы" value={d.work.intercity} onValueChange={intercity => patch('work', { intercity })} disabled={!canEdit('work.intercity')}/><ToggleRow title="Ночные заказы" value={d.work.night} onValueChange={night => patch('work', { night })} disabled={!canEdit('work.night')}/><ToggleRow title="Уведомления о новых заказах" value={d.work.notifications} onValueChange={notifications => patch('work', { notifications })} disabled={!canEdit('work.notifications')}/>
    </>; break;
    case 'LOCATION': content = <>
      <SectionTitle title="Геолокация" description="Она нужна, чтобы находить заказы рядом. Точное местоположение можно не предоставлять сейчас."/>
      <View style={[s.locationHero, { backgroundColor: palette.elevated }]}><Icon name="location-outline" size={46} color={palette.accent}/><Text style={[s.locationTitle, { color: palette.ink }]}>Заказы рядом с вами</Text><Text style={[s.locationText, { color: palette.muted }]}>Разрешение запрашивается только после вашего действия. Фоновый доступ понадобится отдельно при выходе на линию.</Text></View>
      <Pressable disabled={!canEdit('location.choice')} onPress={() => { patch('location', { choice: 'PRECISE' }); onRequestLocation(); }} style={[s.locationChoice, !canEdit('location.choice') && s.readOnly, { borderColor: d.location.choice === 'PRECISE' ? palette.accent : palette.line }]}><Icon name="navigate-circle-outline" color={palette.accent}/><Text style={[s.locationChoiceText, { color: palette.ink }]}>Разрешить геолокацию</Text>{d.location.choice === 'PRECISE' ? <Icon name="checkmark-circle" color={palette.accent}/> : null}</Pressable>
      <Pressable disabled={!canEdit('location.choice')} onPress={() => patch('location', { choice: 'MANUAL', city: d.personal.city })} style={[s.locationChoice, !canEdit('location.choice') && s.readOnly, { borderColor: d.location.choice === 'MANUAL' ? palette.accent : palette.line }]}><Icon name="map-outline" color={palette.accent}/><Text style={[s.locationChoiceText, { color: palette.ink }]}>Выбрать город вручную</Text>{d.location.choice === 'MANUAL' ? <Icon name="checkmark-circle" color={palette.accent}/> : null}</Pressable>
      {d.location.choice === 'MANUAL' ? <SelectInput label="Город" value={d.location.city || d.personal.city} placeholder="Выберите город" disabled={!canEdit('location.city')} onPress={() => select('Город', config.cities.map(value => ({ value, label: value })), d.location.city, city => patch('location', { city }))}/> : null}
    </>; break;
    case 'PAYMENT': content = <>
      <SectionTitle title="Платёжные данные" description="Можно пропустить и добавить способ выплат позже."/>
      <Text style={[s.label, { color: palette.muted }]}>Способ выплаты</Text><MultiSelect options={config.payoutMethods.map(value => ({ value, label: value === 'CARD' ? 'Банковская карта' : value === 'BANK_ACCOUNT' ? 'Банковский счёт' : 'Электронный кошелёк' }))} values={d.payment.type ? [d.payment.type] : []} onChange={values => patch('payment', { type: (values.at(-1) || '') as RegistrationData['payment']['type'], last4: '' })} columns={1} disabled={!canEdit('payment.type')}/>
      {d.payment.type ? <><FormInput label="Последние 4 цифры" value={d.payment.last4} onChangeText={last4 => patch('payment', { last4: last4.replace(/\D/g, '').slice(0, 4) })} placeholder="4582" keyboardType="number-pad" maxLength={4} error={errors.paymentLast4} disabled={!canEdit('payment.last4')}/>{d.payment.last4.length === 4 ? <InfoCard title="Сохранено безопасно" text={`•••• •••• •••• ${d.payment.last4}. Полные реквизиты приложение не хранит.`} tone="green"/> : <InfoCard text="Введите только последние четыре цифры. Полные реквизиты должны передаваться платёжному провайдеру по защищённому каналу."/>}</> : null}
    </>; break;
    case 'REVIEW': {
      const steps = buildRegistrationSteps(a, config).filter(item => item.id !== 'REVIEW' && (correctionFields === undefined || stepHasCorrection(item.id, a, config, correctionFields)));
      content = <>
        <SectionTitle title={correctionFields === undefined ? 'Проверьте анкету' : 'Проверьте исправления'} description={correctionFields === undefined ? 'Перед отправкой убедитесь, что данные заполнены верно.' : 'Показаны только разделы и документы, которые были возвращены на исправление.'}/>
        <View style={s.stack}>{steps.map(item => { const validation = validateRegistrationStep(item.id, a, config); const skipped = d.skippedSteps.includes(item.id); return <Pressable key={item.id} onPress={() => onGoTo(item.id)} style={[s.reviewRow, { borderColor: palette.line, backgroundColor: palette.surface }]}><View style={[s.reviewIcon, { backgroundColor: validation.valid || skipped ? '#EAF8F1' : palette.elevated }]}><Icon name={validation.valid || skipped ? 'checkmark' : 'alert-outline'} size={20} color={validation.valid || skipped ? '#15945A' : '#A46900'}/></View><View style={{ flex: 1, gap: 3 }}><Text style={[s.reviewTitle, { color: palette.ink }]}>{item.title}</Text><Text style={[s.reviewSubtitle, { color: palette.muted }]}>{skipped ? 'Необязательно · пропущено' : validation.valid ? 'Заполнено' : item.optional ? 'Необязательно' : 'Требует внимания'}</Text></View><Text style={[s.edit, { color: palette.accent }]}>Изменить</Text></Pressable>; })}</View>
        {config.legalConsents.map(consent => {
          const checked = consent.id === 'truth-confirmation' ? d.agreements.truthConfirmed : consent.id === 'performer-terms' ? d.agreements.termsAccepted : d.agreements.acceptedIds.includes(consent.id);
          const errorKey = consent.id === 'truth-confirmation' ? 'truthConfirmed' : consent.id === 'performer-terms' ? 'termsAccepted' : `consent_${consent.id}`;
          return <CheckboxRow key={consent.id} label={`${consent.title}${consent.required ? '' : ' · необязательно'}`} checked={checked} onPress={() => {
            const acceptedIds = checked ? d.agreements.acceptedIds.filter(id => id !== consent.id) : [...new Set([...d.agreements.acceptedIds, consent.id])];
            patch('agreements', { acceptedIds, legalTermsVersion: config.legalTermsVersion, ...(consent.id === 'truth-confirmation' ? { truthConfirmed: !checked } : {}), ...(consent.id === 'performer-terms' ? { termsAccepted: !checked } : {}) });
          }} error={errors[errorKey]}/>;
        })}
      </>;
      break;
    }
    default: content = null;
  }
  return <>{correctionFields !== undefined && step !== 'REVIEW' ? <InfoCard title="Исправление замечаний" text="Поля и файлы, которые не были возвращены на исправление, доступны только для просмотра."/> : null}{content}<OptionSheet visible={!!picker} title={picker?.title || ''} options={picker?.options || []} selected={picker?.selected} onSelect={value => picker?.choose(value)} onClose={() => setPicker(null)}/></>;
}

function ConfiguredUpload({ item, upload, expiry, error, expiryError, profile, disabled, expiryDisabled, onExpiry, onUpload, onDelete }: { item: ConfiguredUploadSlot; upload?: RegistrationUpload; expiry: string; error?: string; expiryError?: string; profile?: boolean; disabled?: boolean; expiryDisabled?: boolean; onExpiry: (value: string) => void; onUpload: () => void; onDelete?: () => void }) {
  return <View style={s.uploadField}>
    {item.exampleImageUrl ? <InfoCard title="Пример фотографии" text="Перед загрузкой сверьтесь с примером, указанным в требованиях документа."/> : null}
    <UploadCard title={item.title} required={item.required} upload={upload} hint={item.description || (item.required ? 'Обязательный файл' : 'Необязательно')} image={item.kind === 'PROFILE_PHOTO' || item.kind === 'VEHICLE_PHOTO' || profile} profile={profile} disabled={disabled} onPress={onUpload} onDelete={upload && onDelete ? onDelete : undefined}/>
    {error ? <Text style={s.error}>{error}</Text> : null}
    {item.requiresExpiry ? <FormInput label="Действителен до" value={expiry} onChangeText={onExpiry} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" error={expiryError} disabled={expiryDisabled ?? disabled}/> : null}
    {upload?.expiresAt ? <InfoCard text={`${upload.status === 'EXPIRING' ? 'Срок действия скоро закончится' : upload.status === 'EXPIRED' ? 'Срок действия закончился' : 'Срок действия документа'}: ${new Date(upload.expiresAt).toLocaleDateString('ru-RU')}.` } tone={upload.status === 'EXPIRING' || upload.status === 'EXPIRED' ? 'amber' : 'green'}/> : null}
  </View>;
}

function Requirements({ items }: { items: string[] }) {
  const { palette } = useTheme(); return <View style={[s.requirements, { backgroundColor: palette.surface, borderColor: palette.line }]}><Text style={[s.requirementsTitle, { color: palette.ink }]}>Требования к фотографии</Text>{items.map(item => <View key={item} style={s.requirement}><View style={[s.requirementIcon, { backgroundColor: palette.elevated }]}><Icon name="checkmark-circle-outline" size={20} color={palette.accent}/></View><Text style={[s.requirementText, { color: palette.muted }]}>{item}</Text></View>)}</View>;
}

function VehicleForm({ title, description, vehicle, path, onChange, canEdit, config, errors, taxi, cargo, select }: { title: string; description: string; vehicle: VehicleDraft; path: string; onChange: (value: Partial<VehicleDraft>) => void; canEdit: (path: string) => boolean; config: RegistrationConfig; errors: Record<string, string>; taxi?: boolean; cargo?: boolean; select: (title: string, options: { value: string; label: string }[], selected: string | undefined, choose: (value: string) => void) => void }) {
  const { palette } = useTheme(); return <>
    <SectionTitle title={title} description={description}/>
    <Text style={[s.label, { color: palette.muted }]}>Владение *</Text><MultiSelect options={[{ value: 'OWN', label: 'Собственный' }, { value: 'RENT', label: 'Арендованный' }]} values={vehicle.ownership ? [vehicle.ownership] : []} onChange={values => onChange({ ownership: (values.at(-1) || '') as VehicleDraft['ownership'] })} disabled={!canEdit(`${path}.ownership`)}/>
    {cargo ? <SelectInput label="Тип транспорта" value={config.cargoVehicleTypes.find(value => value === vehicle.type)} placeholder="Выберите тип" disabled={!canEdit(`${path}.type`)} onPress={() => select('Тип транспорта', config.cargoVehicleTypes.map(value => ({ value, label: value })), vehicle.type, type => onChange({ type }))}/> : null}
    <View style={s.twoColumns}><View style={s.half}><FormInput label="Марка" value={vehicle.brand} onChangeText={brand => onChange({ brand })} disabled={!canEdit(`${path}.brand`)}/></View><View style={s.half}><FormInput label="Модель" value={vehicle.model} onChangeText={model => onChange({ model })} disabled={!canEdit(`${path}.model`)}/></View></View>
    <View style={s.twoColumns}><View style={s.half}><FormInput label="Год" value={vehicle.year} onChangeText={year => onChange({ year: year.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" maxLength={4} disabled={!canEdit(`${path}.year`)}/></View><View style={s.half}><FormInput label="Цвет" value={vehicle.color} onChangeText={color => onChange({ color })} disabled={!canEdit(`${path}.color`)}/></View></View>
    <FormInput label="Государственный номер" value={vehicle.plateNumber} onChangeText={plateNumber => onChange({ plateNumber: plateNumber.toUpperCase() })} autoCapitalize="characters" disabled={!canEdit(`${path}.plateNumber`)}/>
    {errors.vehicle ? <Text style={s.error}>{errors.vehicle}</Text> : null}
    {cargo ? <><FormInput label="VIN" optional value={vehicle.vin} onChangeText={vin => onChange({ vin: vin.toUpperCase() })} autoCapitalize="characters" disabled={!canEdit(`${path}.vin`)}/><View style={s.twoColumns}><View style={s.half}><FormInput label="Грузоподъёмность" value={vehicle.capacityKg} onChangeText={capacityKg => onChange({ capacityKg })} placeholder="кг" keyboardType="decimal-pad" disabled={!canEdit(`${path}.capacityKg`)}/></View><View style={s.half}><FormInput label="Объём кузова" optional value={vehicle.volumeM3} onChangeText={volumeM3 => onChange({ volumeM3 })} placeholder="м³" keyboardType="decimal-pad" disabled={!canEdit(`${path}.volumeM3`)}/></View></View><Text style={[s.label, { color: palette.muted }]}>Размеры кузова · м</Text><View style={s.threeColumns}>{(['lengthM', 'widthM', 'heightM'] as const).map((field, index) => <View key={field} style={s.third}><FormInput label={['Длина', 'Ширина', 'Высота'][index]} optional value={vehicle[field]} onChangeText={value => onChange({ [field]: value })} keyboardType="decimal-pad" disabled={!canEdit(`${path}.${field}`)}/></View>)}</View></> : null}
    {taxi ? <><View style={s.twoColumns}><View style={s.half}><FormInput label="Пассажирских мест" value={vehicle.passengerSeats} onChangeText={passengerSeats => onChange({ passengerSeats })} keyboardType="number-pad" disabled={!canEdit(`${path}.passengerSeats`)}/></View><View style={s.half}><SelectInput label="Тип кузова" value={vehicle.bodyType} placeholder="Выберите" disabled={!canEdit(`${path}.bodyType`)} onPress={() => select('Тип кузова', config.taxiBodyTypes.map(value => ({ value, label: value })), vehicle.bodyType, bodyType => onChange({ bodyType }))}/></View></View><ToggleRow title="Кондиционер" value={vehicle.hasAirConditioning} onValueChange={hasAirConditioning => onChange({ hasAirConditioning })} disabled={!canEdit(`${path}.hasAirConditioning`)}/><Text style={[s.label, { color: palette.muted }]}>Предпочтительные тарифы *</Text><MultiSelect options={config.tariffs.map(item => ({ value: item.id, label: item.title }))} values={vehicle.tariffs} onChange={tariffs => onChange({ tariffs })} error={errors.tariffs} disabled={!canEdit(`${path}.tariffs`)}/></> : null}
  </>;
}

function AdditionalVehicleForms({ usage, vehicles, config, errors, correctionFields, onAdd, onRemove, onChange, select }: { usage: VehicleUsage; vehicles: AdditionalVehicleDraft[]; config: RegistrationConfig; errors: Record<string, string>; correctionFields?: string[]; onAdd: () => void; onRemove: (vehicle: AdditionalVehicleDraft) => void; onChange: (vehicle: AdditionalVehicleDraft, value: Partial<VehicleDraft>) => void; select: (title: string, options: { value: string; label: string }[], selected: string | undefined, choose: (value: string) => void) => void }) {
  const { palette } = useTheme();
  const matching = vehicles.filter(vehicle => vehicle.usage === usage);
  const addDisabled = correctionFields !== undefined || vehicles.length >= MAX_ADDITIONAL_VEHICLES;
  const canEdit = (path: string) => scopeAllows(correctionFields, path);
  return <View style={s.stack}>
    <SectionTitle title="Дополнительные машины" description={`До ${MAX_ADDITIONAL_VEHICLES} дополнительных машин суммарно для всех направлений. Сейчас добавлено: ${vehicles.length}.`}/>
    {matching.map((vehicle, roleIndex) => {
      const index = vehicles.findIndex(item => item.clientId === vehicle.clientId);
      return <View key={vehicle.clientId} style={[s.additionalCard, { borderColor: palette.line, backgroundColor: palette.surface }]}>
        <View style={s.additionalHeader}><Text style={[s.additionalTitle, { color: palette.ink }]}>Дополнительная машина {roleIndex + 1}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Удалить дополнительную машину ${roleIndex + 1}`} accessibilityState={{ disabled: correctionFields !== undefined }} disabled={correctionFields !== undefined} onPress={() => onRemove(vehicle)}><Text style={[s.removeVehicle, { color: correctionFields === undefined ? '#C74747' : palette.muted }]}>Удалить</Text></Pressable></View>
        <VehicleForm title={`${vehicle.brand} ${vehicle.model}`.trim() || 'Новая машина'} description={`Локальный ID: ${vehicle.clientId}`} vehicle={vehicle} path={`vehicles.${vehicle.clientId}`} onChange={value => onChange(vehicle, value)} canEdit={path => correctionVehicleFieldAllowed(correctionFields, vehicle.clientId, index, path)} config={config} errors={{ vehicle: errors[`vehicle_${vehicle.clientId}`], tariffs: errors[`vehicle_${vehicle.clientId}_tariffs`] }} taxi={usage === 'TAXI'} cargo={usage === 'CARGO'} select={select}/>
      </View>;
    })}
    {errors.vehicles ? <Text style={s.error}>{errors.vehicles}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: addDisabled }} disabled={addDisabled} onPress={onAdd} style={[s.addVehicle, { borderColor: palette.accent }, addDisabled && s.readOnly]}><Icon name="add-circle-outline" color={palette.accent}/><Text style={[s.addVehicleText, { color: palette.accent }]}>Добавить машину</Text></Pressable>
  </View>;
}

function CargoEquipmentForm({ title, description, equipment, path, loadingTypes, errors, canEdit, onChange }: { title: string; description: string; equipment: CargoEquipmentDraft; path: string; loadingTypes: { value: string; label: string }[]; errors: Record<string, string | undefined>; canEdit: (path: string) => boolean; onChange: (value: Partial<CargoEquipmentDraft>) => void }) {
  const { palette } = useTheme();
  return <>
    <SectionTitle title={title} description={description}/>
    <Text style={[s.label, { color: palette.muted }]}>Тип загрузки *</Text><MultiSelect options={loadingTypes} values={equipment.loadingTypes} onChange={value => onChange({ loadingTypes: value })} error={errors.loadingTypes} disabled={!canEdit(`${path}.loadingTypes`)}/>
    <FormInput label="Количество паллет" optional value={equipment.palletCount} onChangeText={palletCount => onChange({ palletCount })} keyboardType="number-pad" error={errors.palletCount} disabled={!canEdit(`${path}.palletCount`)}/>
    <ToggleRow title="Рефрижератор" value={equipment.refrigerator} onValueChange={refrigerator => onChange({ refrigerator })} disabled={!canEdit(`${path}.refrigerator`)}/>
    {equipment.refrigerator ? <View style={s.twoColumns}><View style={s.half}><FormInput label="Мин. температура" value={equipment.minTemperature} onChangeText={minTemperature => onChange({ minTemperature })} keyboardType="numbers-and-punctuation" error={errors.temperature} disabled={!canEdit(`${path}.minTemperature`)}/></View><View style={s.half}><FormInput label="Макс. температура" value={equipment.maxTemperature} onChangeText={maxTemperature => onChange({ maxTemperature })} keyboardType="numbers-and-punctuation" disabled={!canEdit(`${path}.maxTemperature`)}/></View></View> : null}
    <ToggleRow title="Гидроборт" value={equipment.tailLift} onValueChange={tailLift => onChange({ tailLift })} disabled={!canEdit(`${path}.tailLift`)}/><ToggleRow title="Манипулятор" value={equipment.manipulator} onValueChange={manipulator => onChange({ manipulator })} disabled={!canEdit(`${path}.manipulator`)}/><ToggleRow title="Работа с грузчиками" value={equipment.worksWithLoaders} onValueChange={worksWithLoaders => onChange({ worksWithLoaders })} disabled={!canEdit(`${path}.worksWithLoaders`)}/>
    {equipment.worksWithLoaders ? <FormInput label="Количество грузчиков" value={equipment.loaderCount} onChangeText={loaderCount => onChange({ loaderCount })} keyboardType="number-pad" error={errors.loaderCount} disabled={!canEdit(`${path}.loaderCount`)}/> : null}
  </>;
}

function AdditionalVehicleUploads({ step, application, data, errors, correctionFields, onData, onUpload, onDelete }: { step: 'TAXI_DOCUMENTS' | 'TAXI_PHOTOS' | 'CARGO_DOCUMENTS' | 'CARGO_PHOTOS' | 'COURIER_VEHICLE'; application: RegistrationApplication; data: RegistrationData; errors: Record<string, string>; correctionFields?: string[]; onData: Props['onData']; onUpload: Props['onUpload']; onDelete: Props['onDeleteUpload'] }) {
  const { palette } = useTheme();
  const slots = additionalVehicleUploadSlotsForStep(step, application);
  if (!slots.length) return null;
  const vehicles = data.vehicles.filter(vehicle => slots.some(item => item.slotKey.startsWith(`vehicle_${vehicle.clientId}_`)));
  const patchExpiry = (slotKey: string, value: string) => onData(current => ({ ...current, documentExpiries: { ...current.documentExpiries, [slotKey]: value } }));
  return <View style={s.stack}>{vehicles.map(vehicle => {
    const vehicleSlots = slots.filter(item => item.slotKey.startsWith(`vehicle_${vehicle.clientId}_`));
    const title = `${vehicle.brand} ${vehicle.model}`.trim() || 'Дополнительная машина';
    const role = performerRoleForVehicleUsage(vehicle.usage);
    return <View key={vehicle.clientId} style={[s.additionalCard, { borderColor: palette.line, backgroundColor: palette.surface }]}><Text accessibilityRole="header" style={[s.additionalTitle, { color: palette.ink }]}>{title} · {vehicle.plateNumber || vehicle.clientId}</Text>{vehicleSlots.map(item => { const disabled = !correctionUploadAllowed(correctionFields, item.slotKey, data.uploads[item.slotKey]); return <ConfiguredUpload key={item.slotKey} item={item} upload={data.uploads[item.slotKey]} expiry={data.documentExpiries[item.slotKey] || ''} error={errors[item.slotKey]} expiryError={errors[`expiry_${item.slotKey}`]} disabled={disabled} expiryDisabled={!correctionExpiryAllowed(correctionFields, item.slotKey)} onExpiry={value => patchExpiry(item.slotKey, value)} onUpload={() => onUpload(item.slotKey, item.kind, item.title, true, false, role, item.requiresExpiry ? data.documentExpiries[item.slotKey] : undefined)} onDelete={correctionUploadDeleteAllowed(correctionFields) ? () => onDelete(item.slotKey) : undefined}/>; })}</View>;
  })}</View>;
}

function DocumentList({ step, application, role, prefix, title, vehicle, data, config, errors, correctionFields, onData, onUpload, onDelete }: { step: 'TAXI_DOCUMENTS' | 'CARGO_DOCUMENTS'; application: RegistrationApplication; role: PerformerRole; prefix: string; title: string; vehicle: VehicleDraft; data: RegistrationData; config: RegistrationConfig; errors: Record<string, string>; correctionFields?: string[]; onData: Props['onData']; onUpload: Props['onUpload']; onDelete: Props['onDeleteUpload'] }) {
  const base = configuredUploadSlotsForStep(step, application, config);
  const additional = config.documents.filter(item => item.role === role && (!item.ownership || item.ownership === vehicle.ownership)).flatMap(item => Array.from({ length: Math.max(1, item.sides || 1) }, (_, index) => ({
    slot: `${prefix}_additional_${item.id}${item.sides > 1 ? index === 0 ? '_front' : index === 1 ? '_back' : `_side_${index + 1}` : ''}`,
    title: item.sides > 1 ? `${item.title} · ${index === 0 ? 'лицевая сторона' : index === 1 ? 'обратная сторона' : `сторона ${index + 1}`}` : item.title,
    hint: item.description,
    required: item.required,
    kind: 'ADDITIONAL_DOCUMENT' as const,
    requiresExpiry: item.requiresExpiry === true,
    exampleImageUrl: item.exampleImageUrl,
  })));
  const patchExpiry = (slotKey: string, value: string) => onData(current => ({ ...current, documentExpiries: { ...current.documentExpiries, [slotKey]: value } }));
  return <><SectionTitle title={title} description="Список требований приходит с сервера и может меняться в зависимости от страны и выбранного транспорта."/><View style={s.stack}>
    {base.map(item => { const disabled = !correctionUploadAllowed(correctionFields, item.slotKey, data.uploads[item.slotKey]); return <ConfiguredUpload key={item.slotKey} item={item} upload={data.uploads[item.slotKey]} expiry={data.documentExpiries[item.slotKey] || ''} error={errors[item.slotKey]} expiryError={errors[`expiry_${item.slotKey}`]} disabled={disabled} expiryDisabled={!correctionExpiryAllowed(correctionFields, item.slotKey)} onExpiry={value => patchExpiry(item.slotKey, value)} onUpload={() => onUpload(item.slotKey, item.kind, item.title, true, false, role, item.requiresExpiry ? data.documentExpiries[item.slotKey] : undefined)} onDelete={correctionUploadDeleteAllowed(correctionFields) ? () => onDelete(item.slotKey) : undefined}/>; })}
    {additional.map(item => { const disabled = !correctionUploadAllowed(correctionFields, item.slot, data.uploads[item.slot]); return <View key={item.slot}><UploadCard title={item.title} required={item.required} upload={data.uploads[item.slot]} hint={item.hint || (item.required ? 'Обязательный документ' : 'Необязательно')} disabled={disabled} onPress={() => onUpload(item.slot, item.kind, item.title, true, false, role, item.requiresExpiry ? data.documentExpiries[item.slot] : undefined)} onDelete={data.uploads[item.slot] && correctionUploadDeleteAllowed(correctionFields) ? () => onDelete(item.slot) : undefined}/>{errors[item.slot] ? <Text style={s.error}>{errors[item.slot]}</Text> : null}{item.requiresExpiry ? <FormInput label="Действителен до" value={data.documentExpiries[item.slot] || ''} onChangeText={value => patchExpiry(item.slot, value)} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" error={errors[`expiry_${item.slot}`]} disabled={!correctionExpiryAllowed(correctionFields, item.slot)}/> : null}</View>; })}
  </View></>;
}

function PhotoList({ title, role, slots, uploads, errors, correctionFields, onUpload, onDelete }: { title: string; role: PerformerRole; slots: ConfiguredUploadSlot[]; uploads: RegistrationData['uploads']; errors: Record<string, string>; correctionFields?: string[]; onUpload: Props['onUpload']; onDelete: Props['onDeleteUpload'] }) {
  const complete = slots.filter(item => uploads[item.slotKey]).length;
  return <><SectionTitle title={title} description={`Добавлено ${complete} из ${slots.length}. Перед съёмкой покажем нужный ракурс.`}/><InfoCard text="Автомобиль должен полностью помещаться в кадре. Номер и детали должны быть хорошо видны."/><View style={s.photoGrid}>{slots.map(item => <View key={item.slotKey} style={s.photoCell}><UploadCard title={knownPhotoTitle(item)} required={item.required} upload={uploads[item.slotKey]} image hint={item.description || 'Обязательный ракурс'} disabled={!correctionUploadAllowed(correctionFields, item.slotKey, uploads[item.slotKey])} onPress={() => onUpload(item.slotKey, item.kind, knownPhotoTitle(item), true, false, role)} onDelete={uploads[item.slotKey] && correctionUploadDeleteAllowed(correctionFields) ? () => onDelete(item.slotKey) : undefined}/>{errors[item.slotKey] ? <Text style={s.error}>{errors[item.slotKey]}</Text> : null}</View>)}</View></>;
}

function knownPhotoTitle(item: ConfiguredUploadSlot) {
  const suffix = item.slotKey.replace(/^(taxi|cargo)_photo_/, '');
  return photoLabels[suffix] || item.title;
}

const s = StyleSheet.create({
  stack: { gap: 11 }, roleIntro: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: 4 }, roleIntroCopy: { flex: 1 }, roleHero: { width: 116, height: 110, marginRight: -4 }, uploadField: { gap: 7 }, readOnly: { opacity: .58 }, error: { color: '#C74747', fontSize: 11, lineHeight: 15, marginTop: -3 }, label: { fontSize: 11, fontWeight: '600', marginBottom: -4 }, twoColumns: { flexDirection: 'row', gap: 8 }, half: { flex: 1 }, threeColumns: { flexDirection: 'row', gap: 7 }, third: { flex: 1 }, requirements: { borderRadius: 20, padding: 17, gap: 13, borderWidth: StyleSheet.hairlineWidth }, requirementsTitle: { fontSize: 19, lineHeight: 24, fontWeight: '800', marginBottom: 2 }, requirement: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 11 }, requirementIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, requirementText: { flex: 1, fontSize: 13, lineHeight: 18 },
  additionalCard: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 10 }, additionalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, additionalTitle: { flex: 1, fontSize: 14, fontWeight: '800' }, removeVehicle: { fontSize: 12, fontWeight: '700' }, addVehicle: { minHeight: 48, borderWidth: 1.2, borderStyle: 'dashed', borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, addVehicleText: { fontSize: 13, fontWeight: '700' },
  locationHero: { borderRadius: 22, padding: 22, alignItems: 'center', gap: 9 }, locationTitle: { fontSize: 18, fontWeight: '800' }, locationText: { fontSize: 12, lineHeight: 18, textAlign: 'center' }, locationChoice: { minHeight: 58, borderWidth: 1.3, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, locationChoiceText: { flex: 1, fontSize: 14, fontWeight: '600' },
  reviewRow: { minHeight: 68, borderWidth: 1, borderRadius: 14, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, reviewIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, reviewTitle: { fontSize: 13, fontWeight: '700' }, reviewSubtitle: { fontSize: 10 }, edit: { fontSize: 11, fontWeight: '700' }, photoGrid: { gap: 9 }, photoCell: { gap: 4 },
});
