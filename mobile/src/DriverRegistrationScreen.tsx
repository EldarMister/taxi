import NetInfo from '@react-native-community/netinfo';
import { Camera, CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ImageStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api, messageOf, requestId } from './api';
import { useTheme } from './design/theme';
import { trackRegistration } from './registration/analytics';
import { BottomActionSheet, ErrorCard, FormInput, InfoCard, LoadingState, OfflineState, PrimaryButton, RegistrationHeader, SecondaryButton, StatusBadge } from './registration/components';
import { additionalVehicleForUploadSlot, buildRegistrationSteps, firstIncompleteStep, normalizeStep, performerRoleForVehicleUsage, validateRegistrationStep } from './registration/flow';
import { clearRegistrationFiles, deleteRegistrationFile, isManagedRegistrationFile, persistRegistrationFile, pruneRegistrationFiles, registrationFileExists } from './registration/files';
import { clearRegistrationDraft, readRegistrationDraft, writeRegistrationDraft } from './registration/storage';
import { RegistrationStepContent } from './registration/steps';
import { MAX_ADDITIONAL_VEHICLES, additionalVehicleClientIdPattern, emptyCargoEquipmentDraft, emptyRegistrationApplication, emptyRegistrationData, emptyVehicleDraft, performerRoles, registrationStatuses, vehicleUsages, type AdditionalVehicleDraft, type PerformerRole, type RegistrationApplication, type RegistrationConfig, type RegistrationData, type RegistrationEnvelope, type RegistrationStatus, type RegistrationStepId, type RegistrationUpload } from './registration/types';
import type { User } from './types';
import { Icon, colors } from './ui';

type SelectedFile = { uri: string; name: string; type: string; isImage: boolean; width?: number; height?: number };
type UploadRequest = { slotKey: string; kind: RegistrationUpload['kind']; title: string; image: boolean; profile: boolean; role?: PerformerRole; expiresAt?: string };
type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

const fallbackConfig: RegistrationConfig = {
  roles: [
    { id: 'TAXI_DRIVER', title: 'Водитель такси', description: 'Перевозите пассажиров на легковом автомобиле.' },
    { id: 'CARGO_DRIVER', title: 'Грузовой водитель', description: 'Выполняйте грузовые перевозки на своём или арендованном транспорте.' },
    { id: 'COURIER', title: 'Курьер', description: 'Доставляйте посылки, документы, продукты и другие заказы.' },
  ],
  minimumAge: 18,
  minimumAgeByRole: { TAXI_DRIVER: 18, CARGO_DRIVER: 18, COURIER: 18 },
  countries: ['Кыргызстан', 'Казахстан', 'Россия', 'Узбекистан', 'Таджикистан'],
  cities: ['Бишкек', 'Ош', 'Джалал-Абад', 'Каракол', 'Токмок', 'Нарын', 'Талас', 'Баткен'],
  districts: { Бишкек: ['Ленинский', 'Октябрьский', 'Первомайский', 'Свердловский'], Ош: ['Центр', 'Ак-Тилек', 'Черёмушки'] },
  driverLicenseCategories: ['A', 'A1', 'B', 'B1', 'C', 'C1', 'D', 'D1', 'BE', 'CE'],
  cargoVehicleTypes: ['Пикап', 'Минивэн', 'Каблук', 'Фургон', 'Бортовой', 'Тентованный', 'Рефрижератор', 'Эвакуатор', 'Самосвал', 'Тягач', 'Другое'],
  taxiBodyTypes: ['Седан', 'Хэтчбек', 'Универсал', 'Кроссовер', 'Минивэн'],
  tariffs: [{ id: 'ECONOMY', title: 'Эконом' }, { id: 'COMFORT', title: 'Комфорт' }, { id: 'BUSINESS', title: 'Бизнес' }],
  payoutMethods: ['CARD', 'BANK_ACCOUNT', 'WALLET'],
  courierTransportModes: ['FOOT', 'BICYCLE', 'E_BICYCLE', 'MOPED', 'SCOOTER', 'MOTORCYCLE', 'CAR', 'TRUCK'],
  courierOrderTypes: ['DOCUMENTS', 'PARCELS', 'GROCERIES', 'MEALS', 'MEDICINE', 'LARGE'],
  languages: [{ id: 'ru', name: 'Русский' }, { id: 'ky', name: 'Кыргызча' }],
  loadingTypes: ['REAR', 'SIDE', 'TOP'],
  documents: [],
  documentRequirements: [
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
  ],
  legalConsents: [{ id: 'truth-confirmation', required: true, title: 'Подтверждаю достоверность указанных данных' }, { id: 'performer-terms', required: true, title: 'Принимаю условия работы исполнителя' }],
  upload: { maxBytes: 12 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
  legalTermsVersion: '1',
};

const editableStatuses = new Set<RegistrationStatus>(['NOT_STARTED', 'DRAFT', 'CORRECTION_REQUIRED', 'REJECTED']);
const pendingStatuses = new Set<RegistrationStatus>(['SUBMITTED', 'UNDER_REVIEW']);
const serverOwnedStatuses = new Set<RegistrationStatus>(['SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'BLOCKED']);

function mergeRegistrationData(base: RegistrationData, raw: unknown): RegistrationData {
  const source = raw && typeof raw === 'object' ? raw as Partial<RegistrationData> : {};
  return {
    ...base, ...source,
    personal: { ...base.personal, ...source.personal }, identity: { ...base.identity, ...source.identity }, driverLicense: { ...base.driverLicense, ...source.driverLicense }, courier: { ...base.courier, ...source.courier },
    taxiVehicle: { ...base.taxiVehicle, ...source.taxiVehicle }, cargoVehicle: { ...base.cargoVehicle, ...source.cargoVehicle }, courierVehicle: { ...base.courierVehicle, ...source.courierVehicle }, cargoEquipment: { ...base.cargoEquipment, ...source.cargoEquipment },
    vehicles: normalizeAdditionalVehicles(source.vehicles ?? base.vehicles), work: { ...base.work, ...source.work }, location: { ...base.location, ...source.location }, payment: { ...base.payment, ...source.payment }, agreements: { ...base.agreements, ...source.agreements }, documentExpiries: { ...base.documentExpiries, ...source.documentExpiries }, uploads: { ...base.uploads, ...source.uploads },
    skippedSteps: Array.isArray(source.skippedSteps) ? source.skippedSteps : base.skippedSteps,
    completedSteps: Array.isArray(source.completedSteps) ? source.completedSteps : base.completedSteps,
  };
}

function normalizeAdditionalVehicles(raw: unknown): AdditionalVehicleDraft[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const vehicles: AdditionalVehicleDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Partial<AdditionalVehicleDraft>;
    if (typeof source.clientId !== 'string' || !additionalVehicleClientIdPattern.test(source.clientId) || seen.has(source.clientId) || !vehicleUsages.includes(source.usage as AdditionalVehicleDraft['usage'])) continue;
    seen.add(source.clientId);
    vehicles.push({ ...emptyVehicleDraft(), ...source, clientId: source.clientId, usage: source.usage as AdditionalVehicleDraft['usage'], tariffs: Array.isArray(source.tariffs) ? source.tariffs.filter((tariff): tariff is string => typeof tariff === 'string') : [], equipment: { ...emptyCargoEquipmentDraft(), ...(source.equipment || {}), loadingTypes: Array.isArray(source.equipment?.loadingTypes) ? source.equipment.loadingTypes.filter((type): type is string => typeof type === 'string') : [] } });
    if (vehicles.length === MAX_ADDITIONAL_VEHICLES) break;
  }
  return vehicles;
}

function normalizeStoredApplication(application: RegistrationApplication, language: 'ru' | 'ky'): RegistrationApplication {
  return { ...application, data: mergeRegistrationData(emptyRegistrationData(language), application.data) };
}

function normalizeConfig(raw: unknown): RegistrationConfig {
  if (!raw || typeof raw !== 'object') return fallbackConfig;
  const value = raw as Partial<RegistrationConfig>;
  return {
    ...fallbackConfig,
    ...value,
    roles: Array.isArray(value.roles) && value.roles.length ? value.roles : fallbackConfig.roles,
    minimumAgeByRole: { ...fallbackConfig.minimumAgeByRole, ...(value.minimumAgeByRole || {}) },
    districts: { ...fallbackConfig.districts, ...(value.districts || {}) },
    courierTransportModes: Array.isArray(value.courierTransportModes) && value.courierTransportModes.length ? value.courierTransportModes : fallbackConfig.courierTransportModes,
    courierOrderTypes: Array.isArray(value.courierOrderTypes) && value.courierOrderTypes.length ? value.courierOrderTypes : fallbackConfig.courierOrderTypes,
    languages: Array.isArray(value.languages) && value.languages.length ? value.languages : fallbackConfig.languages,
    loadingTypes: Array.isArray(value.loadingTypes) && value.loadingTypes.length ? value.loadingTypes : fallbackConfig.loadingTypes,
    documents: Array.isArray(value.documents) ? value.documents : fallbackConfig.documents,
    documentRequirements: Array.isArray(value.documentRequirements) && value.documentRequirements.length ? value.documentRequirements : fallbackConfig.documentRequirements,
    legalConsents: Array.isArray(value.legalConsents) && value.legalConsents.length ? value.legalConsents : fallbackConfig.legalConsents,
    upload: { ...fallbackConfig.upload, ...(value.upload || {}) },
  };
}

function normalizedStatus(value: unknown, fallback: RegistrationStatus = 'DRAFT'): RegistrationStatus {
  return typeof value === 'string' && (registrationStatuses as readonly string[]).includes(value) ? value as RegistrationStatus : fallback;
}

function normalizeApplication(raw: unknown, language: 'ru' | 'ky', localUploads: Record<string, RegistrationUpload> = {}): RegistrationApplication {
  const empty = emptyRegistrationApplication(language);
  if (!raw || typeof raw !== 'object') return empty;
  const source = raw as Record<string, unknown>;
  const rolesSource = Array.isArray(source.roles) ? source.roles : [];
  const roles = rolesSource.map(item => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, unknown>).role || (item as Record<string, unknown>).type || '') : '').filter((role): role is PerformerRole => (performerRoles as readonly string[]).includes(role));
  const roleStatuses = (Array.isArray(source.roleStatuses) ? source.roleStatuses : rolesSource).filter(item => item && typeof item === 'object').map(item => {
    const value = item as Record<string, unknown>; const role = String(value.role || value.type || '') as PerformerRole;
    return {
      role,
      status: normalizedStatus(value.status),
      reason: typeof value.reason === 'string' ? value.reason : typeof value.reasonText === 'string' ? value.reasonText : null,
      reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode : null,
      reasonText: typeof value.reasonText === 'string' ? value.reasonText : typeof value.reason === 'string' ? value.reason : null,
      canResubmit: value.canResubmit === true,
      blockedUntil: typeof value.blockedUntil === 'string' ? value.blockedUntil : null,
      correctionFields: Array.isArray(value.correctionFields) ? value.correctionFields.filter((field): field is string => typeof field === 'string') : [],
      operational: value.operational === true,
      projectedAt: typeof value.projectedAt === 'string' ? value.projectedAt : null,
      projectionIssueCode: typeof value.projectionIssueCode === 'string' ? value.projectionIssueCode : null,
      projectionIssueText: typeof value.projectionIssueText === 'string' ? value.projectionIssueText : null,
    };
  }).filter(item => (performerRoles as readonly string[]).includes(item.role));
  let data = mergeRegistrationData(empty.data, source.data);
  const uploadList = Array.isArray(source.uploads) ? source.uploads : [];
  const serverUploads: Record<string, RegistrationUpload> = {};
  uploadList.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const value = item as Record<string, unknown>; const slotKey = String(value.slotKey || ''); if (!slotKey) return;
    serverUploads[slotKey] = { id: typeof value.id === 'string' ? value.id : undefined, slotKey, kind: String(value.kind || 'ADDITIONAL_DOCUMENT') as RegistrationUpload['kind'], name: typeof value.name === 'string' ? value.name : undefined, remoteUrl: typeof value.url === 'string' ? value.url : typeof value.remoteUrl === 'string' ? value.remoteUrl : undefined, mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined, status: String(value.status || 'UPLOADED') as RegistrationUpload['status'], reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode : null, reasonText: typeof value.reasonText === 'string' ? value.reasonText : null, canReupload: value.canReupload !== false, expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined };
  });
  data = { ...data, uploads: { ...serverUploads, ...localUploads } };
  const application: RegistrationApplication = {
    id: typeof source.id === 'string' ? source.id : undefined,
    applicationId: typeof source.applicationId === 'string' ? source.applicationId : typeof source.publicId === 'string' ? source.publicId : undefined,
    applicationNumber: typeof source.applicationNumber === 'string' ? source.applicationNumber : undefined,
    status: normalizedStatus(source.status, roles.length ? 'DRAFT' : 'NOT_STARTED'), roles, roleStatuses,
    currentStep: typeof source.currentStep === 'string' ? source.currentStep as RegistrationStepId : 'ROLES', data,
    version: typeof source.version === 'number' ? source.version : typeof source.revision === 'number' ? source.revision : 0,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : undefined,
    submittedAt: typeof source.submittedAt === 'string' ? source.submittedAt : null,
    reviewEta: typeof source.reviewEta === 'string' ? source.reviewEta : null,
    rejectionReason: typeof source.rejectionReason === 'string' ? source.rejectionReason : null,
    blockedReason: typeof source.blockedReason === 'string' ? source.blockedReason : null,
    canResubmit: source.canResubmit !== false,
    canActivate: source.canActivate === true,
    activatedAt: typeof source.activatedAt === 'string' ? source.activatedAt : null,
  };
  return { ...application, currentStep: normalizeStep(application) };
}

function serverData(data: RegistrationData) {
  const { uploads: _uploads, cameraIntroSeen: _cameraIntroSeen, ...safe } = data;
  return safe;
}

function responseApplication(value: unknown) {
  if (value && typeof value === 'object' && 'application' in value) return (value as { application: unknown }).application;
  return value;
}

function vehicleFormStep(usage: AdditionalVehicleDraft['usage']): RegistrationStepId {
  return usage === 'TAXI' ? 'TAXI_VEHICLE' : usage === 'CARGO' ? 'CARGO_VEHICLE' : 'COURIER_VEHICLE';
}

function registrationFieldStep(field: string, data?: RegistrationData): RegistrationStepId {
  const value = field.replace(/^data\./, '').replace(/^uploads\./, '');
  if (value.startsWith('documentExpiries.')) return registrationUploadStep(value.slice('documentExpiries.'.length), data);
  if (value.startsWith('vehicle_')) return registrationUploadStep(value, data);
  if (value === 'vehicles' || value.startsWith('vehicles.')) {
    const token = value.split('.')[1];
    const vehicle = data?.vehicles?.find(item => item.clientId === token) || (/^\d+$/.test(token || '') ? data?.vehicles?.[Number(token)] : undefined);
    if (vehicle?.usage === 'CARGO' && value.includes('.equipment')) return 'CARGO_EQUIPMENT';
    return vehicle ? vehicleFormStep(vehicle.usage) : 'REVIEW';
  }
  if (value === 'roles') return 'ROLES';
  if (value === 'profile_photo') return 'PROFILE_PHOTO';
  if (value.startsWith('personal.')) return 'PERSONAL_DATA';
  if (value.startsWith('identity') || value.startsWith('identity_')) return 'IDENTITY_DOCUMENT';
  if (value.startsWith('driverLicense') || value.startsWith('license_')) return 'DRIVER_LICENSE';
  if (value.startsWith('taxi_photo')) return 'TAXI_PHOTOS';
  if (value.startsWith('taxi_')) return 'TAXI_DOCUMENTS';
  if (value.startsWith('taxiVehicle')) return 'TAXI_VEHICLE';
  if (value.startsWith('cargo_photo')) return 'CARGO_PHOTOS';
  if (value.startsWith('cargo_')) return 'CARGO_DOCUMENTS';
  if (value.startsWith('cargoEquipment')) return 'CARGO_EQUIPMENT';
  if (value.startsWith('cargoVehicle')) return 'CARGO_VEHICLE';
  if (value === 'courier_health_book' || value.startsWith('courier_additional_')) return 'COURIER_SETTINGS';
  if (value.startsWith('courier_registration') || value.startsWith('courier_insurance') || value.startsWith('courier_photo') || value.startsWith('courierVehicle')) return 'COURIER_VEHICLE';
  if (value.startsWith('courier.transportModes')) return 'COURIER_TRANSPORT';
  if (value.startsWith('courier')) return 'COURIER_SETTINGS';
  if (value.startsWith('work')) return 'WORK_PREFERENCES';
  if (value.startsWith('location')) return 'LOCATION';
  if (value.startsWith('payment')) return 'PAYMENT';
  return 'REVIEW';
}

function registrationFieldKey(field: string, data?: RegistrationData) {
  const value = field.replace(/^data\./, '').replace(/^uploads\./, '');
  if (value.startsWith('documentExpiries.')) return `expiry_${value.slice('documentExpiries.'.length)}`;
  const direct: Record<string, string> = {
    'personal.firstName': 'firstName', 'personal.lastName': 'lastName', 'personal.birthDate': 'birthDate', 'personal.city': 'city',
    'identity.number': 'identityNumber', 'identity.issuedAt': 'identityIssuedAt', 'identity.expiresAt': 'identityExpiresAt', 'identity.issuedBy': 'identityIssuedBy',
    'driverLicense.number': 'licenseNumber', 'driverLicense.categories': 'licenseCategories', 'driverLicense.expiresAt': 'licenseExpiresAt',
    'courier.transportModes': 'transportModes', 'courier.existingVehicleUsage': 'existingVehicleUsage', 'courier.existingVehicleClientId': 'existingVehicleUsage', 'courier.orderTypes': 'orderTypes', 'courier.maxWeightKg': 'maxWeightKg', 'courier.city': 'courierCity',
    'cargoEquipment.loadingTypes': 'loadingTypes', 'cargoEquipment.minTemperature': 'temperature', 'cargoEquipment.maxTemperature': 'temperature', 'cargoEquipment.loaderCount': 'loaderCount',
    'payment.last4': 'paymentLast4',
  };
  if (direct[value]) return direct[value];
  if (value.startsWith('vehicles.')) {
    const [, token, ...rest] = value.split('.');
    const vehicle = data?.vehicles?.find(item => item.clientId === token) || (/^\d+$/.test(token || '') ? data?.vehicles?.[Number(token)] : undefined);
    if (vehicle) {
      const fieldName = rest.at(-1);
      if (rest[0] === 'equipment' && fieldName) return `vehicle_${vehicle.clientId}_${['minTemperature', 'maxTemperature'].includes(fieldName) ? 'temperature' : fieldName}`;
      if (fieldName === 'tariffs') return `vehicle_${vehicle.clientId}_tariffs`;
      return `vehicle_${vehicle.clientId}`;
    }
  }
  if (/^(taxi|cargo|courier)Vehicle(?:\.|$)/.test(value)) return 'vehicle';
  return value;
}

function uploadRoleForSlot(slotKey: string, data?: RegistrationData): PerformerRole | undefined {
  const additionalVehicle = data ? additionalVehicleForUploadSlot(data, slotKey) : undefined;
  if (additionalVehicle) return performerRoleForVehicleUsage(additionalVehicle.usage);
  if (slotKey.startsWith('taxi_')) return 'TAXI_DRIVER';
  if (slotKey.startsWith('cargo_')) return 'CARGO_DRIVER';
  if (slotKey.startsWith('courier_')) return 'COURIER';
  return undefined;
}

function displayDateAsExpiry(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return undefined;
  if (date.getTime() < Date.now()) return undefined;
  return date.toISOString();
}

function uploadExpiryForSlot(slotKey: string, data: RegistrationData) {
  const configuredExpiry = data.documentExpiries?.[slotKey];
  if (configuredExpiry) return displayDateAsExpiry(configuredExpiry);
  if (slotKey.startsWith('identity_')) return displayDateAsExpiry(data.identity.expiresAt);
  if (slotKey.startsWith('license_')) return displayDateAsExpiry(data.driverLicense.expiresAt);
  return undefined;
}

const uploadSlotTitles: Record<string, string> = {
  profile_photo: 'Фотография профиля',
  identity_front: 'Удостоверение личности · лицевая сторона',
  identity_back: 'Удостоверение личности · обратная сторона',
  license_front: 'Водительское удостоверение · лицевая сторона',
  license_back: 'Водительское удостоверение · обратная сторона',
  taxi_registration: 'Такси · свидетельство о регистрации',
  taxi_insurance: 'Такси · страховой полис',
  taxi_inspection: 'Такси · технический осмотр',
  taxi_rental: 'Такси · договор аренды или доверенность',
  cargo_registration: 'Грузовой транспорт · свидетельство о регистрации',
  cargo_insurance: 'Грузовой транспорт · страховой полис',
  cargo_inspection: 'Грузовой транспорт · технический осмотр',
  cargo_rental: 'Грузовой транспорт · договор аренды или доверенность',
  courier_registration: 'Транспорт курьера · свидетельство о регистрации',
  courier_insurance: 'Транспорт курьера · страховой полис',
  courier_photo: 'Фотография транспорта курьера',
  courier_health_book: 'Санитарная книжка',
};
const vehiclePhotoTitles: Record<string, string> = {
  front: 'спереди', back: 'сзади', left: 'левая сторона', right: 'правая сторона', interior_front: 'передняя часть салона', interior_back: 'задний ряд', trunk: 'багажник', cabin: 'кабина', cargo_bay: 'грузовой отсек', plate: 'государственный номер',
};

function registrationUploadTitle(upload: RegistrationUpload, data?: RegistrationData) {
  const configured = uploadSlotTitles[upload.slotKey];
  if (configured) return configured;
  const additionalVehicle = data ? additionalVehicleForUploadSlot(data, upload.slotKey) : undefined;
  if (additionalVehicle) {
    const usage = additionalVehicle.usage === 'TAXI' ? 'Такси' : additionalVehicle.usage === 'CARGO' ? 'Грузовой транспорт' : 'Транспорт курьера';
    const suffix = upload.slotKey.slice(`vehicle_${additionalVehicle.clientId}_`.length);
    if (suffix === 'registration') return `${usage} · свидетельство о регистрации`;
    if (suffix === 'insurance') return `${usage} · страховой полис`;
    if (suffix === 'rental') return `${usage} · договор аренды или доверенность`;
    if (suffix.startsWith('photo_')) return `${usage} · ${vehiclePhotoTitles[suffix.slice('photo_'.length)] || 'фотография транспорта'}`;
  }
  const photo = /^(taxi|cargo)_photo_(.+)$/.exec(upload.slotKey);
  if (photo) return `${photo[1] === 'taxi' ? 'Такси' : 'Грузовой транспорт'} · ${vehiclePhotoTitles[photo[2]] || 'фотография транспорта'}`;
  if (upload.slotKey.includes('_additional_')) return upload.name || 'Дополнительный документ';
  return upload.name || upload.slotKey.replace(/[_.:-]+/g, ' ');
}

function registrationUploadExpiry(upload: RegistrationUpload) {
  if (!upload.expiresAt) return null;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(upload.expiresAt);
  const formatted = isoDate ? `${isoDate[3]}.${isoDate[2]}.${isoDate[1]}` : (() => {
    const date = new Date(upload.expiresAt!);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('ru-RU');
  })();
  if (!formatted) return null;
  const prefix = upload.status === 'EXPIRED' ? 'Истёк' : upload.status === 'EXPIRING' ? 'Истекает' : 'Действует до';
  return `${prefix}: ${formatted}`;
}

function registrationUploadStep(slot: string, data?: RegistrationData): RegistrationStepId {
  const additionalVehicle = data ? additionalVehicleForUploadSlot(data, slot) : undefined;
  if (additionalVehicle) {
    if (additionalVehicle.usage === 'COURIER') return 'COURIER_VEHICLE';
    const photos = slot.includes('_photo_');
    return additionalVehicle.usage === 'TAXI' ? photos ? 'TAXI_PHOTOS' : 'TAXI_DOCUMENTS' : photos ? 'CARGO_PHOTOS' : 'CARGO_DOCUMENTS';
  }
  return slot.startsWith('license_') ? 'DRIVER_LICENSE' : slot.startsWith('identity_') ? 'IDENTITY_DOCUMENT' : slot.startsWith('taxi_photo') ? 'TAXI_PHOTOS' : slot.startsWith('cargo_photo') ? 'CARGO_PHOTOS' : slot === 'courier_health_book' || slot.startsWith('courier_additional_') ? 'COURIER_SETTINGS' : slot.startsWith('courier_') ? 'COURIER_VEHICLE' : slot.startsWith('taxi_') ? 'TAXI_DOCUMENTS' : slot.startsWith('cargo_') ? 'CARGO_DOCUMENTS' : slot === 'profile_photo' ? 'PROFILE_PHOTO' : 'REVIEW';
}

async function recoverPendingFiles(userId: string, application: RegistrationApplication) {
  let changed = false;
  const uploads = Object.fromEntries(await Promise.all(Object.entries(application.data.uploads).map(async([slotKey, upload]) => {
    if (upload.pendingDelete || !['QUEUED', 'UPLOADING'].includes(upload.status)) return [slotKey, upload] as const;
    let next: RegistrationUpload = upload.status === 'UPLOADING' ? { ...upload, status: 'QUEUED', progress: 0 } : upload;
    changed ||= next !== upload;
    if (!upload.localUri || !await registrationFileExists(upload.localUri)) {
      changed = true;
      return [slotKey, { ...next, status: 'NOT_UPLOADED', progress: 0, localUri: undefined, reasonText: 'Локальный файл недоступен. Выберите его ещё раз.' } satisfies RegistrationUpload] as const;
    }
    if (!isManagedRegistrationFile(userId, upload.localUri)) {
      try {
        const durable = await persistRegistrationFile(userId, slotKey, { uri: upload.localUri, name: upload.name || `${slotKey}.jpg`, type: upload.mimeType || 'image/jpeg', isImage: upload.mimeType?.startsWith('image/') !== false });
        next = { ...next, localUri: durable.uri };
        changed = true;
      } catch {
        next = { ...next, status: 'NOT_UPLOADED', progress: 0, localUri: undefined, reasonText: 'Не удалось сохранить файл для офлайн-загрузки. Выберите его ещё раз.' };
        changed = true;
      }
    }
    return [slotKey, next] as const;
  })));
  return changed ? { ...application, data: { ...application.data, uploads } } : application;
}

function reconcileLegalConsents(application: RegistrationApplication, config: RegistrationConfig) {
  const agreements = application.data.agreements;
  const sameVersion = agreements.legalTermsVersion === config.legalTermsVersion;
  const allowed = new Set(config.legalConsents.map(item => item.id));
  const acceptedIds = sameVersion ? agreements.acceptedIds.filter(id => allowed.has(id)) : [];
  const next = {
    ...agreements,
    legalTermsVersion: config.legalTermsVersion,
    truthConfirmed: sameVersion && agreements.truthConfirmed,
    termsAccepted: sameVersion && agreements.termsAccepted,
    acceptedIds,
  };
  const changed = agreements.legalTermsVersion !== next.legalTermsVersion
    || agreements.truthConfirmed !== next.truthConfirmed
    || agreements.termsAccepted !== next.termsAccepted
    || agreements.acceptedIds.length !== acceptedIds.length
    || agreements.acceptedIds.some((id, index) => id !== acceptedIds[index]);
  return { application: changed ? { ...application, data: { ...application.data, agreements: next } } : application, changed };
}

export function DriverRegistrationScreen({ user, deepLink, statusRevision = 0, onRegistered, onLogout, onClose }: { user: User; deepLink?: { event: string; slotKey?: string } | null; statusRevision?: number; onRegistered: (user: User) => void; onLogout: () => Promise<void>; onClose?: () => void }) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [application, setApplicationState] = useState(() => emptyRegistrationApplication(user.language));
  const [config, setConfig] = useState(fallbackConfig);
  const [booting, setBooting] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sourceRequest, setSourceRequest] = useState<UploadRequest | null>(null);
  const [cameraIntro, setCameraIntro] = useState(false);
  const [cameraRequest, setCameraRequest] = useState<UploadRequest | null>(null);
  const [preview, setPreview] = useState<{ request: UploadRequest; file: SelectedFile } | null>(null);
  const [previewSaving, setPreviewSaving] = useState(false);
  const [exitSheet, setExitSheet] = useState(false);
  const [supportSheet, setSupportSheet] = useState(false);
  const [correctionEditing, setCorrectionEditing] = useState(false);
  const activeRef = useRef(true);
  const appRef = useRef(application);
  const configRef = useRef(config);
  const onlineRef = useRef(online);
  const syncingRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncFailureRef = useRef<unknown>(null);
  const mutationRef = useRef(0);
  const hydratedRef = useRef(false);
  const refreshingRef = useRef(false);
  const deepLinkHandledRef = useRef<string | null>(null);
  const statusRevisionRef = useRef(statusRevision);
  const uploadFilesRef = useRef<Record<string, SelectedFile>>({});
  const uploadGenerationRef = useRef<Record<string, number>>({});
  const uploadOperationsRef = useRef<Record<string, Promise<void>>>({});
  const steps = useMemo(() => buildRegistrationSteps(application, config), [application, config]);
  const correctionFields = correctionEditing ? [...new Set(application.roleStatuses.filter(item => item.status === 'CORRECTION_REQUIRED' || item.status === 'REJECTED' && item.canResubmit).flatMap(item => item.correctionFields || []))] : undefined;
  const stepIndex = Math.max(0, steps.findIndex(item => item.id === application.currentStep));
  const current = steps[stepIndex] || steps[0];
  const hasServerOwnedStatus = serverOwnedStatuses.has(application.status) || application.roleStatuses.some(item => serverOwnedStatuses.has(item.status));
  const exitRegistration = useCallback(() => onClose ? onClose() : void onLogout(), [onClose, onLogout]);

  const applyApplication = useCallback((next: RegistrationApplication) => {
    if (!activeRef.current) return;
    appRef.current = next;
    setApplicationState(next);
  }, []);

  const persistLocal = useCallback((next: RegistrationApplication) => {
    if (!activeRef.current) return;
    setSaveState(onlineRef.current ? 'saving' : 'offline');
    void writeRegistrationDraft(user.id, next)
      .then(() => { if (!onlineRef.current) setSaveState('offline'); })
      .catch(() => setSaveState('error'));
  }, [user.id]);

  const mutate = useCallback((updater: (previous: RegistrationApplication) => RegistrationApplication) => {
    if (!activeRef.current) return;
    const previous = appRef.current;
    const changed = updater(previous);
    const next = {
      ...changed,
      updatedAt: new Date().toISOString(),
      localSync: { dirty: true, baseVersion: previous.localSync?.dirty ? previous.localSync.baseVersion : previous.version },
    };
    mutationRef.current += 1;
    applyApplication(next);
    setDirty(true);
    persistLocal(next);
  }, [applyApplication, persistLocal]);

  useEffect(() => () => { activeRef.current = false; }, []);

  const mergeServerMetadata = useCallback((raw: unknown, local: RegistrationApplication) => {
    const remote = normalizeApplication(raw, user.language, local.data.uploads);
    return {
      ...local,
      id: remote.id || local.id,
      applicationId: remote.applicationId || local.applicationId,
      applicationNumber: remote.applicationNumber || local.applicationNumber,
      status: remote.status,
      version: remote.version,
      updatedAt: remote.updatedAt,
      submittedAt: remote.submittedAt,
      reviewEta: remote.reviewEta,
      rejectionReason: remote.rejectionReason,
      blockedReason: remote.blockedReason,
      canResubmit: remote.canResubmit,
      canActivate: remote.canActivate,
      activatedAt: remote.activatedAt,
      roleStatuses: remote.roleStatuses.length ? remote.roleStatuses : local.roleStatuses,
      data: { ...local.data, uploads: { ...local.data.uploads, ...remote.data.uploads } },
    };
  }, [user.language]);

  const syncNow = useCallback(async() => {
    if (!activeRef.current || !hydratedRef.current || !onlineRef.current || !editableStatuses.has(appRef.current.status) || !appRef.current.roles.length) {
      if (!onlineRef.current) setSaveState('offline');
      return;
    }
    if (syncingRef.current) { syncQueuedRef.current = true; return; }
    syncingRef.current = true;
    syncQueuedRef.current = false;
    const mutation = mutationRef.current;
    const snapshot = appRef.current;
    syncFailureRef.current = null;
    setSaveState('saving');
    try {
      const response = await api.patch<{ application?: unknown }>('/driver/registration', { currentStep: snapshot.currentStep, roles: snapshot.roles, data: serverData(snapshot.data), version: snapshot.version });
      if (!activeRef.current) return;
      const clean = mutationRef.current === mutation;
      const merged = mergeServerMetadata(responseApplication(response), appRef.current);
      const next = clean
        ? { ...merged, localSync: { dirty: false, baseVersion: merged.version } }
        : { ...merged, localSync: appRef.current.localSync || { dirty: true, baseVersion: snapshot.version } };
      applyApplication(next);
      await writeRegistrationDraft(user.id, next);
      if (clean) { setDirty(false); setSaveState('saved'); }
      else syncQueuedRef.current = true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && onlineRef.current) {
        try {
          const latest = await api.request<RegistrationEnvelope>('/driver/registration');
          if (latest.application) {
            const rebased = mergeServerMetadata(latest.application, appRef.current);
            applyApplication(rebased);
            await writeRegistrationDraft(user.id, rebased);
            syncQueuedRef.current = true;
            setSaveState('saving');
          }
        } catch (refreshError) { syncFailureRef.current = refreshError; setSaveState('error'); setError(messageOf(refreshError)); }
      } else {
        syncFailureRef.current = caught;
        setSaveState(onlineRef.current ? 'error' : 'offline');
        if (onlineRef.current) setError(messageOf(caught));
      }
    } finally {
      syncingRef.current = false;
      if (activeRef.current && syncQueuedRef.current && onlineRef.current) void syncNow();
    }
  }, [applyApplication, mergeServerMetadata, user.id]);

  const flushSync = useCallback(async() => {
    if (!onlineRef.current) throw new Error('Для отправки анкеты нужно подключение к интернету.');
    for (let pass = 0; pass < 4; pass += 1) {
      const uploads = Object.values(uploadOperationsRef.current);
      if (!uploads.length) break;
      await Promise.allSettled(uploads);
    }
    const pendingUploads = Object.values(appRef.current.data.uploads).filter(upload => upload.pendingDelete || ['QUEUED', 'UPLOADING'].includes(upload.status));
    if (pendingUploads.length) throw new Error('Дождитесь загрузки всех файлов или повторите неудачную загрузку.');
    await syncNow();
    for (let attempt = 0; attempt < 200 && (syncingRef.current || syncQueuedRef.current); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (syncingRef.current || syncQueuedRef.current) throw new Error('Сохранение занимает больше времени, чем обычно. Повторите попытку.');
    if (syncFailureRef.current) throw syncFailureRef.current;
  }, [syncNow]);

  const refresh = useCallback(async(silent = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!silent) setBooting(true);
    setError('');
    try {
      const response = await api.request<RegistrationEnvelope>('/driver/registration');
      const nextConfig = normalizeConfig(response.config);
      setConfig(nextConfig);
      configRef.current = nextConfig;
      const storedDraft = await readRegistrationDraft(user.id);
      const storedLocal = storedDraft ? normalizeStoredApplication(storedDraft, user.language) : null;
      const local = storedLocal ? await recoverPendingFiles(user.id, storedLocal) : null;
      let next: RegistrationApplication;
      let shouldSync = false;
      if (response.application) {
        const remote = normalizeApplication(response.application, user.language);
        const pendingUploads = local ? Object.fromEntries(Object.entries(local.data.uploads)
          .filter(([, upload]) => (upload.localUri && upload.status === 'QUEUED') || upload.pendingDelete)) : {};
        const hasPending = Object.keys(pendingUploads).length > 0;
        const legacyLocalAhead = !!local?.updatedAt && !!remote.updatedAt && new Date(local.updatedAt) > new Date(remote.updatedAt);
        const localAhead = !!local && editableStatuses.has(remote.status) && (local.localSync?.dirty === true || hasPending || local.localSync == null && legacyLocalAhead);
        if (localAhead && local) {
          shouldSync = true;
          next = {
            ...local,
            id: remote.id || local.id,
            applicationId: remote.applicationId || local.applicationId,
            applicationNumber: remote.applicationNumber || local.applicationNumber,
            version: remote.version,
            status: remote.status,
            roleStatuses: remote.roleStatuses,
            submittedAt: remote.submittedAt,
            reviewEta: remote.reviewEta,
            canResubmit: remote.canResubmit,
            canActivate: remote.canActivate,
            activatedAt: remote.activatedAt,
            data: { ...local.data, uploads: { ...remote.data.uploads, ...pendingUploads } },
            localSync: { dirty: true, baseVersion: local.localSync?.baseVersion ?? remote.version },
          };
        } else next = { ...remote, localSync: { dirty: false, baseVersion: remote.version } };
      } else if (local) {
        next = { ...local, localSync: { dirty: true, baseVersion: local.localSync?.baseVersion ?? local.version } };
        shouldSync = !!next.roles.length;
      } else next = emptyRegistrationApplication(user.language);
      const reconciled = reconcileLegalConsents(next, nextConfig);
      next = reconciled.application;
      if (reconciled.changed && editableStatuses.has(next.status)) shouldSync = true;
      await pruneRegistrationFiles(user.id, Object.values(next.data.uploads).flatMap(upload => upload.localUri ? [upload.localUri] : []));
      applyApplication(next);
      await writeRegistrationDraft(user.id, next);
      hydratedRef.current = true;
      setHydrated(true);
      setDirty(shouldSync);
      setSaveState(shouldSync ? onlineRef.current ? 'saving' : 'offline' : response.application ? 'saved' : 'idle');
      if (shouldSync && onlineRef.current) void syncNow();
    } catch (caught) {
      const storedDraft = await readRegistrationDraft(user.id);
      const storedLocal = storedDraft ? normalizeStoredApplication(storedDraft, user.language) : null;
      const local = storedLocal ? await recoverPendingFiles(user.id, storedLocal) : null;
      if (local) {
        const restored = { ...local, localSync: { dirty: true, baseVersion: local.localSync?.baseVersion ?? local.version } };
        await pruneRegistrationFiles(user.id, Object.values(restored.data.uploads).flatMap(upload => upload.localUri ? [upload.localUri] : []));
        applyApplication(restored); hydratedRef.current = true; setHydrated(true); setDirty(true); setSaveState('offline');
      }
      else setError(messageOf(caught));
    } finally { refreshingRef.current = false; setBooting(false); }
  }, [applyApplication, syncNow, user.id, user.language]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => NetInfo.addEventListener(state => {
    const connected = state.isConnected !== false && state.isInternetReachable !== false;
    const recovered = !onlineRef.current && connected;
    onlineRef.current = connected;
    setOnline(connected);
    if (connected && hydratedRef.current) { setError(''); if (recovered) void refresh(true); else void syncNow(); }
    else setSaveState('offline');
  }), [refresh, syncNow]);
  useEffect(() => api.subscribe(event => {
    if (event === 'offline') { onlineRef.current = false; setOnline(false); setSaveState('offline'); }
    if (event === 'online') { const recovered = !onlineRef.current; onlineRef.current = true; setOnline(true); if (recovered && hydratedRef.current) void refresh(true); }
  }), [refresh]);
  useEffect(() => {
    if (!hydratedRef.current || !dirty) return;
    const timer = setTimeout(() => void syncNow(), 650);
    return () => clearTimeout(timer);
  }, [application, dirty, syncNow]);
  useEffect(() => {
    if (!hasServerOwnedStatus || correctionEditing) return;
    const timer = setInterval(() => { if (onlineRef.current) void refresh(true); }, 20000);
    return () => clearInterval(timer);
  }, [correctionEditing, hasServerOwnedStatus, refresh]);
  useEffect(() => {
    if (statusRevisionRef.current === statusRevision) return;
    if (!hydrated || !online) return;
    statusRevisionRef.current = statusRevision;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshWhenIdle = () => {
      if (!activeRef.current || !hydratedRef.current || !onlineRef.current) return;
      if (refreshingRef.current) {
        timer = setTimeout(refreshWhenIdle, 250);
        return;
      }
      void refresh(true);
    };
    refreshWhenIdle();
    return () => { if (timer) clearTimeout(timer); };
  }, [hydrated, online, refresh, statusRevision]);
  useEffect(() => { if (application.currentStep) trackRegistration('registration_step_opened', { step: application.currentStep }); }, [application.currentStep]);
  useEffect(() => {
    if (application.status === 'CORRECTION_REQUIRED') trackRegistration('registration_correction_opened');
    if (application.status === 'APPROVED') trackRegistration('registration_approved');
    if (application.status === 'REJECTED') trackRegistration('registration_rejected');
  }, [application.status]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!editableStatuses.has(appRef.current.status)) {
        if (onClose) { onClose(); return true; }
        return false;
      }
      const flow = buildRegistrationSteps(appRef.current, configRef.current);
      const index = flow.findIndex(item => item.id === appRef.current.currentStep);
      if (index > 0) { mutate(previous => ({ ...previous, currentStep: flow[index - 1].id })); return true; }
      if (dirty) setExitSheet(true); else exitRegistration();
      return true;
    });
    return () => subscription.remove();
  }, [dirty, exitRegistration, mutate, onClose]);

  const updateData = useCallback((updater: (data: RegistrationData) => RegistrationData) => mutate(previous => ({ ...previous, status: previous.status === 'NOT_STARTED' ? 'DRAFT' : previous.status, data: updater(previous.data), updatedAt: new Date().toISOString() })), [mutate]);
  const updateRoles = useCallback((roles: PerformerRole[]) => {
    if (!appRef.current.roles.length && roles.length) trackRegistration('registration_started');
    trackRegistration('role_selected', { role: roles.join(',') });
    mutate(previous => {
      const existingVehicleUsage = previous.data.courier.existingVehicleUsage;
      const existingVehicleClientId = previous.data.courier.existingVehicleClientId;
      const usageStillSelected = existingVehicleUsage === 'TAXI' ? roles.includes('TAXI_DRIVER') : existingVehicleUsage === 'CARGO' ? roles.includes('CARGO_DRIVER') : false;
      const selectedVehicleExists = !existingVehicleClientId || previous.data.vehicles.some(vehicle => vehicle.clientId === existingVehicleClientId && vehicle.usage === existingVehicleUsage);
      const canReuseVehicle = usageStillSelected && selectedVehicleExists;
      const data = canReuseVehicle ? previous.data : { ...previous.data, courier: { ...previous.data.courier, useExistingVehicle: false, existingVehicleUsage: '' as const, existingVehicleClientId: '' } };
      const next = { ...previous, status: roles.length ? 'DRAFT' as const : previous.status, roles, data, updatedAt: new Date().toISOString() };
      return { ...next, currentStep: normalizeStep(next) };
    });
  }, [mutate]);

  const openUpload = useCallback((slotKey: string, kind: RegistrationUpload['kind'], title: string, image = true, profile = false, role?: PerformerRole, expiresAt?: string) => {
    const existing = appRef.current.data.uploads[slotKey];
    if (['CORRECTION_REQUIRED', 'REJECTED'].includes(appRef.current.status) && (!existing || !['CORRECTION_REQUIRED', 'REJECTED', 'EXPIRED'].includes(existing.status) || existing.canReupload === false)) {
      setError('Во время исправления можно заменить только отмеченный проверкой файл.');
      return;
    }
    setSourceRequest({ slotKey, kind, title, image, profile, role, expiresAt });
  }, []);
  const normalizePicked = async(file: SelectedFile, profile: boolean) => {
    if (!file.isImage) return file;
    const crop = profile && file.width && file.height ? { crop: { originX: Math.max(0, (file.width - Math.min(file.width, file.height)) / 2), originY: Math.max(0, (file.height - Math.min(file.width, file.height)) / 2), width: Math.min(file.width, file.height), height: Math.min(file.width, file.height) } } as ImageManipulator.Action : null;
    const actions: ImageManipulator.Action[] = profile ? [...(crop ? [crop] : []), { resize: { width: 900, height: 900 } }] : [{ resize: { width: 1800 } }];
    const result = await ImageManipulator.manipulateAsync(file.uri, actions, { compress: .84, format: ImageManipulator.SaveFormat.JPEG });
    return { ...file, uri: result.uri, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', isImage: true };
  };

  const chooseSource = async(source: 'camera' | 'gallery' | 'file', request = sourceRequest) => {
    if (!request) return;
    setSourceRequest(null);
    setError('');
    try {
      if (source === 'camera') {
        const permission = await Camera.getCameraPermissionsAsync();
        if (permission.granted) { setCameraRequest(request); return; }
        if (!appRef.current.data.cameraIntroSeen) { setSourceRequest(request); setCameraIntro(true); return; }
      }
      let file: SelectedFile | null = null;
      if (source === 'camera') {
        setCameraRequest(request);
        return;
      } else if (source === 'gallery') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) throw new Error('Разрешите доступ к фотографиям или выберите файл.');
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: request.profile, aspect: request.profile ? [1, 1] : undefined, quality: .92, allowsMultipleSelection: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
        const asset = !result.canceled ? result.assets[0] : undefined;
        if (asset) {
          const mimeType = asset.mimeType || 'image/jpeg';
          if (!configRef.current.upload.allowedMimeTypes.includes(mimeType)) throw new Error('Этот формат файла не поддерживается.');
          if ((asset.fileSize || 0) > configRef.current.upload.maxBytes) throw new Error(`Файл должен быть не больше ${Math.floor(configRef.current.upload.maxBytes / 1024 / 1024)} МБ.`);
          file = { uri: asset.uri, name: asset.fileName || `${request.slotKey}.jpg`, type: mimeType, isImage: true, width: asset.width, height: asset.height };
        }
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: configRef.current.upload.allowedMimeTypes, copyToCacheDirectory: true, multiple: false });
        const asset = !result.canceled ? result.assets[0] : undefined;
        if (asset) {
          const mimeType = asset.mimeType || 'application/octet-stream';
          if (!configRef.current.upload.allowedMimeTypes.includes(mimeType)) throw new Error('Этот формат файла не поддерживается.');
          if ((asset.size || 0) > configRef.current.upload.maxBytes) throw new Error(`Файл должен быть не больше ${Math.floor(configRef.current.upload.maxBytes / 1024 / 1024)} МБ.`);
          file = { uri: asset.uri, name: asset.name, type: mimeType, isImage: mimeType.startsWith('image/') };
        }
      }
      if (file) setPreview({ request, file: await normalizePicked(file, request.profile) });
    } catch (caught) { setError(messageOf(caught)); }
  };

  const queueUploadOperation = useCallback((slotKey: string, operation: () => Promise<void>) => {
    const previous = uploadOperationsRef.current[slotKey] || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    uploadOperationsRef.current[slotKey] = next;
    void next.finally(() => { if (uploadOperationsRef.current[slotKey] === next) delete uploadOperationsRef.current[slotKey]; }).catch(() => undefined);
    return next;
  }, []);

  const uploadFile = useCallback((request: UploadRequest, file: SelectedFile, requestedGeneration?: number) => {
    const generation = requestedGeneration ?? ((uploadGenerationRef.current[request.slotKey] || 0) + 1);
    uploadGenerationRef.current[request.slotKey] = Math.max(uploadGenerationRef.current[request.slotKey] || 0, generation);
    return queueUploadOperation(request.slotKey, async() => {
      if (!activeRef.current || uploadGenerationRef.current[request.slotKey] !== generation) return;
      if (!onlineRef.current) {
        updateData(data => ({ ...data, uploads: { ...data.uploads, [request.slotKey]: { ...data.uploads[request.slotKey], status: 'QUEUED', progress: 0 } } }));
        return;
      }
      trackRegistration('document_upload_started', { documentType: request.kind });
      updateData(data => ({ ...data, uploads: { ...data.uploads, [request.slotKey]: { ...data.uploads[request.slotKey], slotKey: request.slotKey, kind: request.kind, name: file.name, localUri: file.uri, mimeType: file.type, status: 'UPLOADING', progress: .2 } } }));
      try {
        const form = new FormData();
        form.append('kind', request.kind);
        const role = request.role || uploadRoleForSlot(request.slotKey, appRef.current.data);
        const expiresAt = uploadExpiryForSlot(request.slotKey, appRef.current.data);
        if (role) form.append('role', role);
        if (expiresAt) form.append('expiresAt', expiresAt);
        form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
        const response = await api.upload<{ upload?: RegistrationUpload }>(`/driver/registration/uploads/${encodeURIComponent(request.slotKey)}`, form);
        if (!activeRef.current || uploadGenerationRef.current[request.slotKey] !== generation) return;
        const remote = (response && typeof response === 'object' && 'upload' in response ? response.upload : response) as RegistrationUpload;
        updateData(data => ({ ...data, uploads: { ...data.uploads, [request.slotKey]: { ...data.uploads[request.slotKey], ...remote, slotKey: request.slotKey, kind: request.kind, localUri: undefined, name: file.name, mimeType: file.type, status: remote?.status || 'UPLOADED', progress: 1, pendingDelete: false } } }));
        delete uploadFilesRef.current[request.slotKey];
        await deleteRegistrationFile(user.id, file.uri);
        trackRegistration('document_upload_success', { documentType: request.kind });
      } catch (caught) {
        if (uploadGenerationRef.current[request.slotKey] !== generation) return;
        updateData(data => ({ ...data, uploads: { ...data.uploads, [request.slotKey]: { ...data.uploads[request.slotKey], status: 'QUEUED', progress: 0 } } }));
        setError(messageOf(caught));
        trackRegistration('document_upload_failed', { documentType: request.kind });
      }
    });
  }, [queueUploadOperation, updateData, user.id]);

  const acceptPreview = async() => {
    if (!preview || previewSaving) return;
    const selected = preview;
    setPreviewSaving(true);
    try {
      const file = await persistRegistrationFile(user.id, selected.request.slotKey, selected.file);
      const generation = (uploadGenerationRef.current[selected.request.slotKey] || 0) + 1;
      uploadGenerationRef.current[selected.request.slotKey] = generation;
      uploadFilesRef.current[selected.request.slotKey] = file;
      updateData(data => ({ ...data, uploads: { ...data.uploads, [selected.request.slotKey]: { ...data.uploads[selected.request.slotKey], slotKey: selected.request.slotKey, kind: selected.request.kind, name: file.name, localUri: file.uri, mimeType: file.type, status: onlineRef.current ? 'UPLOADING' : 'QUEUED', progress: 0, reasonCode: null, reasonText: null, pendingDelete: false } } }));
      setPreview(null);
      if (onlineRef.current) void uploadFile(selected.request, file, generation);
    } catch (caught) { setError(messageOf(caught)); }
    finally { setPreviewSaving(false); }
  };

  const removeRemoteUpload = useCallback((slotKey: string, generation: number) => queueUploadOperation(slotKey, async() => {
    if (!activeRef.current || !onlineRef.current || uploadGenerationRef.current[slotKey] !== generation) return;
    try {
      await api.request(`/driver/registration/uploads/${encodeURIComponent(slotKey)}`, { method: 'DELETE' });
      if (!activeRef.current || uploadGenerationRef.current[slotKey] !== generation) return;
      updateData(data => { const uploads = { ...data.uploads }; delete uploads[slotKey]; return { ...data, uploads }; });
    } catch (caught) {
      if (uploadGenerationRef.current[slotKey] === generation) setError(messageOf(caught));
    }
  }), [queueUploadOperation, updateData]);

  const deleteUpload = useCallback((slotKey: string) => {
    const existing = appRef.current.data.uploads[slotKey];
    if (['CORRECTION_REQUIRED', 'REJECTED'].includes(appRef.current.status) && (!existing || !['CORRECTION_REQUIRED', 'REJECTED', 'EXPIRED'].includes(existing.status) || existing.canReupload === false)) {
      setError('Во время исправления можно удалить только отмеченный проверкой файл.');
      return;
    }
    const generation = (uploadGenerationRef.current[slotKey] || 0) + 1;
    uploadGenerationRef.current[slotKey] = generation;
    updateData(data => ({ ...data, uploads: { ...data.uploads, [slotKey]: { ...data.uploads[slotKey], localUri: undefined, remoteUrl: undefined, status: 'NOT_UPLOADED', pendingDelete: true } } }));
    delete uploadFilesRef.current[slotKey];
    void deleteRegistrationFile(user.id, existing?.localUri);
    if (onlineRef.current) void removeRemoteUpload(slotKey, generation);
  }, [removeRemoteUpload, updateData, user.id]);

  const drainUploadQueue = useCallback(() => {
    if (!onlineRef.current || !hydratedRef.current) return;
    Object.entries(appRef.current.data.uploads).forEach(([slotKey, upload]) => {
      if (upload.pendingDelete) {
        const generation = (uploadGenerationRef.current[slotKey] || 0) + 1;
        uploadGenerationRef.current[slotKey] = generation;
        void removeRemoteUpload(slotKey, generation);
        return;
      }
      const file = uploadFilesRef.current[slotKey] || (upload.localUri && upload.mimeType ? { uri: upload.localUri, name: upload.name || `${slotKey}.jpg`, type: upload.mimeType, isImage: upload.mimeType.startsWith('image/') } : null);
      if (upload.status === 'QUEUED' && file) void uploadFile({ slotKey, kind: upload.kind, title: upload.name || slotKey, image: file.isImage, profile: upload.kind === 'PROFILE_PHOTO' }, file);
    });
  }, [removeRemoteUpload, uploadFile]);
  useEffect(() => { if (online && hydrated) drainUploadQueue(); }, [drainUploadQueue, hydrated, online]);

  const goTo = useCallback((step: RegistrationStepId) => { setFieldErrors({}); mutate(previous => ({ ...previous, currentStep: step })); }, [mutate]);
  useEffect(() => {
    if (!hydrated || !deepLink?.event.startsWith('registration:')) return;
    const deepLinkKey = `${statusRevision}:${deepLink.event}:${deepLink.slotKey || ''}`;
    if (deepLinkHandledRef.current === deepLinkKey) return;
    if (deepLink.event !== 'registration:correction_required') {
      deepLinkHandledRef.current = deepLinkKey;
      return;
    }
    if (!['CORRECTION_REQUIRED', 'REJECTED'].includes(appRef.current.status)) return;
    deepLinkHandledRef.current = deepLinkKey;
    const roleIssue = appRef.current.roleStatuses.find(item => item.status === 'CORRECTION_REQUIRED') || appRef.current.roleStatuses.find(item => item.status === 'REJECTED' && item.canResubmit);
    const target = deepLink.slotKey ? registrationFieldStep(deepLink.slotKey, appRef.current.data) : roleIssue?.correctionFields?.length ? registrationFieldStep(roleIssue.correctionFields[0], appRef.current.data) : 'REVIEW';
    setCorrectionEditing(true);
    goTo(target);
  }, [application.roleStatuses, application.status, deepLink, goTo, hydrated, statusRevision]);
  const back = () => {
    if (correctionEditing) { setCorrectionEditing(false); return; }
    if (stepIndex > 0) goTo(steps[stepIndex - 1].id);
    else if (dirty) setExitSheet(true);
    else exitRegistration();
  };
  const continueFlow = () => {
    const validation = validateRegistrationStep(current.id, appRef.current, configRef.current);
    if (!validation.valid) { setFieldErrors(validation.errors); return; }
    setFieldErrors({});
    trackRegistration('registration_step_completed', { step: current.id });
    const next = steps[stepIndex + 1];
    if (next) mutate(previous => ({ ...previous, currentStep: next.id, data: { ...previous.data, completedSteps: [...new Set([...previous.data.completedSteps, current.id])] } }));
  };
  const skip = () => {
    const next = steps[stepIndex + 1];
    if (next) mutate(previous => ({ ...previous, currentStep: next.id, data: { ...previous.data, skippedSteps: [...new Set([...previous.data.skippedSteps, current.id])] } }));
  };
  const finishCorrection = async() => {
    const validation = validateRegistrationStep(current.id, appRef.current, configRef.current);
    if (!validation.valid) { setFieldErrors(validation.errors); return; }
    setFieldErrors({});
    if (await submit(true, true)) setCorrectionEditing(false);
  };

  const submit = async(resubmit = false, allowWhileBusy = false) => {
    const review = validateRegistrationStep('REVIEW', appRef.current, configRef.current);
    if (!review.valid) { if (current.id !== 'REVIEW') goTo('REVIEW'); setFieldErrors(review.errors); return false; }
    if (!resubmit) {
      const incomplete = firstIncompleteStep(appRef.current, configRef.current);
      if (incomplete !== 'REVIEW') { setError('Заполните обязательный раздел перед отправкой.'); goTo(incomplete); return false; }
    }
    if (busy && !allowWhileBusy) return false;
    setBusy(true); setError('');
    try {
      await flushSync();
      const endpoint = resubmit ? '/driver/registration/resubmit' : '/driver/registration/submit';
      const response = await api.request<{ application?: unknown }>(endpoint, { method: 'POST', headers: { 'Idempotency-Key': requestId() }, body: JSON.stringify({ truthConfirmed: true, termsAccepted: true, acceptedConsentIds: appRef.current.data.agreements.acceptedIds, legalTermsVersion: configRef.current.legalTermsVersion }) });
      const submitted = normalizeApplication(responseApplication(response), user.language, appRef.current.data.uploads);
      const next = { ...submitted, localSync: { dirty: false, baseVersion: submitted.version } };
      applyApplication(next);
      await writeRegistrationDraft(user.id, next);
      setDirty(false); setSaveState('saved');
      trackRegistration(resubmit ? 'registration_resubmitted' : 'registration_submitted');
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'REGISTRATION_TERMS_CHANGED') {
        await refresh(true);
        goTo('REVIEW');
        setFieldErrors({ truthConfirmed: 'Подтвердите обновлённые условия', termsAccepted: 'Примите обновлённые условия' });
      }
      if (caught instanceof ApiError && caught.fieldErrors.length) {
        const target = registrationFieldStep(caught.fieldErrors[0].field, appRef.current.data);
        goTo(target);
        setFieldErrors(Object.fromEntries(caught.fieldErrors.filter(item => registrationFieldStep(item.field, appRef.current.data) === target).map(item => [registrationFieldKey(item.field, appRef.current.data), item.message])));
      }
      setError(messageOf(caught));
      return false;
    }
    finally { setBusy(false); }
  };

  const requestLocation = async() => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) updateData(data => ({ ...data, location: { ...data.location, choice: 'MANUAL', city: data.personal.city } }));
    } catch (caught) { setError(messageOf(caught)); }
  };
  const openSupport = () => { trackRegistration('support_opened', { step: appRef.current.currentStep }); setSupportSheet(true); };
  const contactSupport = (topic: string, message: string, attachmentName?: string) => {
    const phone = config.supportPhone || '+996000000000';
    const problemDocuments = Object.values(application.data.uploads).filter(upload => ['CORRECTION_REQUIRED', 'REJECTED', 'BLOCKED', 'EXPIRED'].includes(upload.status)).map(upload => upload.slotKey).join(', ');
    const body = [
      `Пользователь ${user.id}`,
      `Анкета ${application.applicationNumber || application.applicationId || application.id || 'черновик'}`,
      `Направления: ${application.roles.join(', ') || 'не выбраны'}`,
      `Шаг: ${application.currentStep}; статус: ${application.status}`,
      `Тема: ${topic}`,
      problemDocuments ? `Проблемные документы: ${problemDocuments}` : '',
      message.trim() ? `Сообщение: ${message.trim()}` : '',
      attachmentName ? `Вложение для отправки: ${attachmentName}` : '',
    ].filter(Boolean).join('\n');
    setSupportSheet(false);
    void Linking.openURL(Platform.OS === 'ios' ? `sms:${phone}&body=${encodeURIComponent(body)}` : `sms:${phone}?body=${encodeURIComponent(body)}`).catch(() => Linking.openURL(`tel:${phone}`));
  };
  const discardAndExit = async() => {
    setExitSheet(false);
    activeRef.current = false;
    Object.keys(uploadGenerationRef.current).forEach(slotKey => { uploadGenerationRef.current[slotKey] += 1; });
    await Promise.allSettled(Object.values(uploadOperationsRef.current));
    try { await Promise.all([clearRegistrationDraft(user.id), clearRegistrationFiles(user.id)]); }
    finally { exitRegistration(); }
  };

  if (booting && !hydratedRef.current) return <SafeAreaView style={[r.screen, { backgroundColor: palette.background }]}><View style={r.loadingWrap}><RegistrationHeader onBack={onClose ? exitRegistration : undefined} onHelp={openSupport}/><LoadingState/></View></SafeAreaView>;
  if (error && !hydratedRef.current) return <RegistrationLoadFailure error={error} onRetry={() => void refresh()} onExit={exitRegistration} exitLabel={onClose ? 'Закрыть' : 'Выйти из аккаунта'}/>;

  if (!editableStatuses.has(application.status) || (['CORRECTION_REQUIRED', 'REJECTED'].includes(application.status) && !correctionEditing)) return <RegistrationStatusScreen
    application={application}
    busy={busy}
    error={error}
    onRefresh={() => void refresh(true)}
    onSupport={openSupport}
    onClose={onClose ? exitRegistration : undefined}
    onOpenCorrection={step => { setCorrectionEditing(true); goTo(step); }}
    onStart={async() => {
      if (busy) return;
      setBusy(true);
      try {
        const activation = await api.post<{ user?: User }>('/driver/registration/activate');
        const profile = activation?.user || await api.request<User>('/users/me');
        if (profile.role === 'DRIVER') {
          activeRef.current = false;
          Object.keys(uploadGenerationRef.current).forEach(slotKey => { uploadGenerationRef.current[slotKey] += 1; });
          await Promise.allSettled(Object.values(uploadOperationsRef.current));
          await Promise.all([clearRegistrationDraft(user.id), clearRegistrationFiles(user.id)]);
          onRegistered(profile);
        }
        else setError('Допуск уже одобрен. Обновите приложение через несколько секунд.');
      } catch (caught) { setError(messageOf(caught)); }
      finally { if (activeRef.current) setBusy(false); }
    }}
  ><SupportSheet visible={supportSheet} application={application} onClose={() => setSupportSheet(false)} onContact={contactSupport}/></RegistrationStatusScreen>;

  return <SafeAreaView style={[r.screen, { backgroundColor: palette.background }]}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
      <RegistrationHeader onBack={back} onHelp={openSupport} step={stepIndex + 1} total={steps.length}/>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[r.content, { paddingBottom: 24 }]}>
        {!online ? <OfflineState queued onRetry={() => void refresh(true)}/> : null}
        {error ? <ErrorCard text={error} onRetry={() => { setError(''); drainUploadQueue(); void syncNow(); }}/> : null}
        <RegistrationStepContent step={current.id} application={application} config={config} errors={fieldErrors} correctionFields={correctionFields} onRoles={updateRoles} onData={updateData} onUpload={openUpload} onDeleteUpload={deleteUpload} onRequestLocation={requestLocation} onGoTo={goTo}/>
        <View style={{ height: 12 }}/>
      </ScrollView>
      <View style={[r.bottom, { borderColor: palette.line, backgroundColor: palette.background, paddingBottom: Math.max(10, insets.bottom) }]}>
        <SaveIndicator state={saveState}/>
        {correctionEditing && current.id === 'REVIEW' ? <PrimaryButton label="Отправить исправления" busy={busy} onPress={() => void submit(true)}/> : correctionEditing ? <PrimaryButton label="Сохранить исправление" busy={busy} onPress={() => void finishCorrection()}/> : current.id === 'REVIEW' ? <PrimaryButton label="Отправить на проверку" busy={busy} onPress={() => void submit()}/> : <PrimaryButton label="Продолжить" busy={busy} disabled={current.id === 'ROLES' && !application.roles.length} onPress={continueFlow}/>}
        {!correctionEditing && current.optional && current.id !== 'REVIEW' ? <SecondaryButton label="Пропустить" onPress={skip}/> : null}
      </View>
    </KeyboardAvoidingView>

    <BottomActionSheet visible={!!sourceRequest} title={sourceRequest?.title || 'Добавить файл'} onClose={() => setSourceRequest(null)}>
      <SheetAction icon="camera-outline" title="Сфотографировать" text="Откроется камера" onPress={() => void chooseSource('camera')}/>
      <SheetAction icon="images-outline" title="Выбрать из галереи" text="JPEG, PNG или WEBP" onPress={() => void chooseSource('gallery')}/>
      <SheetAction icon="document-outline" title="Выбрать файл" text="Изображение или PDF, до 12 МБ" onPress={() => void chooseSource('file')}/>
    </BottomActionSheet>
    <CameraIntro
      visible={cameraIntro}
      onClose={() => { setCameraIntro(false); setSourceRequest(null); }}
      onContinue={() => { const request = sourceRequest; setCameraIntro(false); setSourceRequest(null); if (request) { updateData(data => ({ ...data, cameraIntroSeen: true })); setCameraRequest(request); } }}
      onGallery={() => { const request = sourceRequest; setCameraIntro(false); if (request) void chooseSource('gallery', request); }}
    />
    <DocumentCameraModal request={cameraRequest} onClose={() => setCameraRequest(null)} onGallery={() => { const request = cameraRequest; setCameraRequest(null); if (request) void chooseSource('gallery', request); }} onCaptured={async file => { const request = cameraRequest; setCameraRequest(null); if (request) setPreview({ request, file: await normalizePicked(file, request.profile) }); }}/>
    <PreviewModal preview={preview} busy={previewSaving} onClose={() => { if (!previewSaving) setPreview(null); }} onAccept={() => void acceptPreview()} onRetake={() => { if (previewSaving) return; const request = preview?.request; setPreview(null); if (request) setSourceRequest(request); }}/>
    <BottomActionSheet visible={exitSheet} title="Есть несохранённые изменения" onClose={() => setExitSheet(false)}>
      <InfoCard text="Черновик сохранён на этом устройстве. При наличии интернета мы также отправим его на сервер."/>
      <PrimaryButton label={onClose ? 'Сохранить и закрыть' : 'Сохранить и выйти'} onPress={() => { setExitSheet(false); void syncNow().finally(exitRegistration); }}/>
      <SecondaryButton label="Продолжить заполнение" onPress={() => setExitSheet(false)}/>
      <SecondaryButton danger label={onClose ? 'Закрыть без сохранения' : 'Выйти без сохранения'} onPress={() => void discardAndExit()}/>
    </BottomActionSheet>
    <SupportSheet visible={supportSheet} application={application} onClose={() => setSupportSheet(false)} onContact={contactSupport}/>
  </SafeAreaView>;
}

function SaveIndicator({ state }: { state: SaveState }) {
  const { palette } = useTheme();
  const data = state === 'saving' ? ['sync-outline', 'Сохраняем изменения'] : state === 'saved' ? ['checkmark', 'Черновик сохранён'] : state === 'offline' ? ['cloud-offline-outline', 'Сохранено на устройстве'] : state === 'error' ? ['alert-circle-outline', 'Не удалось сохранить локально'] : ['', ''];
  if (!data[1]) return null;
  return <View style={r.save}><Icon name={data[0] as React.ComponentProps<typeof Icon>['name']} size={14} color={state === 'error' ? colors.danger : palette.muted}/><Text style={[r.saveText, { color: state === 'error' ? colors.danger : palette.muted }]}>{data[1]}</Text></View>;
}

function RegistrationLoadFailure({ error, onRetry, onExit, exitLabel }: { error: string; onRetry: () => void; onExit: () => void; exitLabel: string }) {
  const { palette } = useTheme();
  return <SafeAreaView style={[r.failureScreen, { backgroundColor: palette.background }]}><View style={r.failureDecorationTop}/><View style={r.failureDecorationSide}/><View style={r.failureContent}><View style={r.failureHero}><View style={[r.failureCloud, { backgroundColor: palette.elevated }]}><Icon name="cloud-offline-outline" size={72} color={palette.accent}/><View style={r.failureBadge}><Icon name="close" size={20} color="#FFFFFF"/></View></View></View><Text style={[r.failureTitle, { color: palette.ink }]}>Не удалось загрузить данные</Text><Text style={[r.failureText, { color: palette.muted }]}>Проверьте подключение к интернету и попробуйте ещё раз. Ваши заполненные данные останутся на устройстве.</Text>{error ? <Text accessibilityRole="alert" style={r.failureReason}>{error}</Text> : null}</View><View style={r.failureBottom}><PrimaryButton icon="refresh-outline" label="Попробовать снова" onPress={onRetry}/><SecondaryButton label={exitLabel} onPress={onExit}/></View></SafeAreaView>;
}

function SheetAction({ icon, title, text, onPress }: { icon: React.ComponentProps<typeof Icon>['name']; title: string; text: string; onPress: () => void }) {
  const { palette } = useTheme();
  return <Pressable onPress={onPress} style={[r.sheetAction, { borderColor: palette.line }]}><View style={[r.sheetIcon, { backgroundColor: palette.elevated }]}><Icon name={icon} color={palette.accent}/></View><View style={{ flex: 1, gap: 3 }}><Text style={[r.sheetTitle, { color: palette.ink }]}>{title}</Text><Text style={[r.sheetText, { color: palette.muted }]}>{text}</Text></View><Icon name="chevron-forward" color={palette.muted}/></Pressable>;
}

function CameraIntro({ visible, onClose, onContinue, onGallery }: { visible: boolean; onClose: () => void; onContinue: () => void; onGallery: () => void }) {
  const { palette } = useTheme();
  const benefits: { icon: React.ComponentProps<typeof Icon>['name']; title: string; text: string }[] = [
    { icon: 'person-outline', title: 'Фото профиля', text: 'Чтобы клиенты узнавали вас' },
    { icon: 'card-outline', title: 'Документы', text: 'Для быстрой и безопасной проверки' },
    { icon: 'car-sport-outline', title: 'Транспорт', text: 'Чтобы подтвердить данные автомобиля' },
    { icon: 'shield-checkmark-outline', title: 'Безопасность', text: 'Фото защищены и доступны только проверке' },
  ];
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><SafeAreaView style={[r.permissionScreen, { backgroundColor: palette.background }]}><View style={r.modalHeader}><Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} style={[r.modalClose, { backgroundColor: palette.surface, borderColor: palette.line }]}><Icon name="close" color={palette.ink}/></Pressable></View><ScrollView bounces={false} contentContainerStyle={r.permissionScroll}><View style={r.permissionContent}><View style={r.permissionHero}><View style={r.permissionHalo}/><View style={[r.permissionCamera, { backgroundColor: palette.accent }]}><Icon name="camera" size={44} color="#FFFFFF"/></View><View style={r.permissionSparkOne}/><View style={r.permissionSparkTwo}/></View><Text style={[r.permissionTitle, { color: palette.ink }]}>Разрешите доступ к камере</Text><Text style={[r.permissionText, { color: palette.muted }]}>Камера нужна, чтобы быстро сделать фотографию профиля, документов и транспорта.</Text><View style={[r.permissionBenefits, { backgroundColor: palette.surface, borderColor: palette.line }]}>{benefits.map(item => <View key={item.title} style={r.permissionBenefit}><View style={[r.permissionBenefitIcon, { backgroundColor: palette.elevated }]}><Icon name={item.icon} size={20} color={palette.accent}/></View><View style={{ flex: 1, gap: 2 }}><Text style={[r.permissionBenefitTitle, { color: palette.ink }]}>{item.title}</Text><Text style={[r.permissionBenefitText, { color: palette.muted }]}>{item.text}</Text></View></View>)}</View><View style={r.privacyRow}><Icon name="lock-closed-outline" size={15} color={palette.muted}/><Text style={[r.privacyText, { color: palette.muted }]}>Мы не используем камеру без вашего действия</Text></View></View></ScrollView><View style={r.permissionBottom}><PrimaryButton icon="camera-outline" label="Продолжить" onPress={onContinue}/><SecondaryButton label="Выбрать из галереи" onPress={onGallery}/></View></SafeAreaView></Modal>;
}

function DocumentCameraModal({ request, onClose, onGallery, onCaptured }: { request: UploadRequest | null; onClose: () => void; onGallery: () => void; onCaptured: (file: SelectedFile) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [capturing, setCapturing] = useState(false);
  const camera = useRef<CameraView>(null);
  const permissionRequestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!request) { permissionRequestedFor.current = null; return; }
    if (permission && !permission.granted && permission.canAskAgain !== false && permissionRequestedFor.current !== request.slotKey) {
      permissionRequestedFor.current = request.slotKey;
      void requestPermission();
    }
  }, [permission, request, requestPermission]);
  if (!request) return null;
  const take = async() => {
    if (capturing || !permission?.granted) return;
    setCapturing(true);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: .92, skipProcessing: false });
      if (photo) onCaptured({ uri: photo.uri, name: `${request.slotKey}.jpg`, type: 'image/jpeg', isImage: true, width: photo.width, height: photo.height });
    } finally { setCapturing(false); }
  };
  return <Modal visible animationType="fade" onRequestClose={onClose}><View style={r.cameraScreen}>{permission?.granted ? <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing}><SafeAreaView style={r.cameraOverlay}><View style={r.cameraTop}><Pressable onPress={onClose} style={r.cameraRound}><Icon name="close" color="#FFFFFF"/></Pressable><View style={r.cameraHint}><Text style={r.cameraHintText}>{request.profile ? 'Расположите лицо в центре' : 'Поместите объект полностью в рамку'}</Text></View><View style={{ width: 44 }}/></View><View style={[request.profile ? r.faceGuide : r.cameraGuide]}><View style={r.guideCorner}/></View><Text style={r.cameraHelp}>Все края видны · без бликов · держите камеру ровно</Text><View style={r.cameraControls}><Pressable onPress={onGallery} style={r.cameraControl}><Icon name="images-outline" size={27} color="#FFFFFF"/></Pressable><Pressable disabled={capturing} onPress={() => void take()} style={[r.shutter, capturing && { opacity: .5 }]}><View style={r.shutterInner}/></Pressable><Pressable onPress={() => setFacing(value => value === 'back' ? 'front' : 'back')} style={r.cameraControl}><Icon name="camera-reverse-outline" size={27} color="#FFFFFF"/></Pressable></View></SafeAreaView></CameraView> : <SafeAreaView style={r.cameraDenied}><Icon name="camera-outline" size={54} color="#FFFFFF"/><Text style={r.cameraDeniedTitle}>{permission ? 'Камера недоступна' : 'Запрашиваем доступ к камере'}</Text><Text style={r.cameraDeniedText}>{permission?.canAskAgain === false ? 'Разрешите доступ в настройках устройства или выберите фото из галереи.' : 'Подтвердите системный запрос, чтобы продолжить.'}</Text>{permission?.canAskAgain === false ? <PrimaryButton label="Открыть настройки" onPress={() => void Linking.openSettings()}/> : null}<SecondaryButton label="Выбрать из галереи" onPress={onGallery}/><SecondaryButton label="Закрыть" onPress={onClose}/></SafeAreaView>}</View></Modal>;
}

function PreviewModal({ preview, busy, onClose, onAccept, onRetake }: { preview: { request: UploadRequest; file: SelectedFile } | null; busy: boolean; onClose: () => void; onAccept: () => void; onRetake: () => void }) {
  const { palette } = useTheme();
  if (!preview) return null;
  return <Modal visible animationType="slide" onRequestClose={onClose}><SafeAreaView style={[r.previewScreen, { backgroundColor: '#101827' }]}><View style={r.previewHeader}><Pressable disabled={busy} onPress={onClose}><Icon name="close" color="#FFFFFF"/></Pressable><Text style={r.previewHeaderText}>Предварительный просмотр</Text><View style={{ width: 24 }}/></View><View style={r.previewBody}>{preview.file.isImage ? <Image source={{ uri: preview.file.uri }} resizeMode="contain" style={r.previewImage as ImageStyle}/> : <View style={r.filePreview}><Icon name="document-text-outline" size={64} color="#FFFFFF"/><Text style={r.fileName}>{preview.file.name}</Text></View>}</View><View style={[r.previewBottom, { backgroundColor: palette.surface }]}><Text style={[r.previewTitle, { color: palette.ink }]}>Проверьте качество</Text><Text style={[r.previewCheck, { color: palette.muted }]}>Все края видны · нет бликов · текст читается</Text><PrimaryButton label="Использовать файл" busy={busy} onPress={onAccept}/><SecondaryButton label="Снять или выбрать заново" disabled={busy} onPress={onRetake}/></View></SafeAreaView></Modal>;
}

function SupportSheet({ visible, application, onClose, onContact }: { visible: boolean; application: RegistrationApplication; onClose: () => void; onContact: (topic: string, message: string, attachmentName?: string) => void }) {
  const { palette } = useTheme();
  const [topic, setTopic] = useState('Документы');
  const [message, setMessage] = useState('');
  const [attachmentName, setAttachmentName] = useState<string>();
  const attach = async() => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
    if (!result.canceled) setAttachmentName(result.assets[0]?.name);
  };
  return <BottomActionSheet visible={visible} title="Поддержка" onClose={onClose}><InfoCard title="Контекст уже добавлен" text={`Анкета: ${application.applicationNumber || application.applicationId || 'черновик'} · шаг: ${application.currentStep} · статус: ${application.status}`}/><Text style={[r.supportTitle, { color: palette.ink }]}>С чем помочь?</Text><View style={r.topicRow}>{['Не приходит сообщение', 'Документы', 'Статус анкеты', 'Транспорт', 'Другая проблема'].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: topic === value }} onPress={() => setTopic(value)} style={[r.topic, { borderColor: topic === value ? palette.accent : palette.line, backgroundColor: topic === value ? palette.elevated : palette.surface }]}><Text style={[r.topicText, { color: topic === value ? palette.accent : palette.ink }]}>{value}</Text></Pressable>)}</View><FormInput label="Сообщение" optional multiline value={message} onChangeText={setMessage} placeholder="Опишите, что произошло"/><SecondaryButton label={attachmentName ? `Файл: ${attachmentName}` : 'Прикрепить изображение или файл'} onPress={() => void attach()}/>{attachmentName ? <InfoCard text="После открытия приложения сообщений добавьте выбранный файл к обращению."/> : null}<PrimaryButton label="Написать в поддержку" onPress={() => onContact(topic, message, attachmentName)}/></BottomActionSheet>;
}

function RegistrationDocumentStatusList({ uploads, data, allowCorrection, onOpenCorrection }: { uploads: RegistrationUpload[]; data: RegistrationData; allowCorrection: boolean; onOpenCorrection: (step: RegistrationStepId) => void }) {
  const { palette } = useTheme();
  if (!uploads.length) return null;
  return <View style={r.statusList}>
    <Text accessibilityRole="header" style={[r.statusSectionTitle, { color: palette.ink }]}>Документы и фотографии</Text>
    {uploads.map(upload => {
      const problematic = ['CORRECTION_REQUIRED', 'REJECTED', 'BLOCKED', 'EXPIRED'].includes(upload.status);
      const actionable = ['CORRECTION_REQUIRED', 'REJECTED', 'EXPIRED'].includes(upload.status) && upload.canReupload !== false;
      const expiry = registrationUploadExpiry(upload);
      return <View key={upload.slotKey} style={[r.roleStatus, { borderColor: problematic ? colors.danger : palette.line, backgroundColor: palette.surface }]}>
        <View style={r.roleStatusTop}>
          <Text style={[r.roleName, { color: palette.ink }]}>{registrationUploadTitle(upload, data)}</Text>
          <StatusBadge status={upload.status}/>
        </View>
        {expiry ? <Text style={[r.documentMeta, { color: upload.status === 'EXPIRED' ? colors.danger : upload.status === 'EXPIRING' ? '#A46900' : palette.muted }]}>{expiry}</Text> : null}
        {upload.reasonText ? <Text style={r.issueReason}>{upload.reasonText}</Text> : problematic ? <Text style={r.issueReason}>Документ требует внимания</Text> : null}
        {allowCorrection && actionable ? <SecondaryButton label={upload.status === 'EXPIRED' ? 'Загрузить новый документ' : 'Загрузить заново'} onPress={() => onOpenCorrection(registrationUploadStep(upload.slotKey, data))}/> : null}
      </View>;
    })}
  </View>;
}

function RegistrationStatusScreen({ application, busy, error, onRefresh, onSupport, onClose, onOpenCorrection, onStart, children }: {
  application: RegistrationApplication;
  busy: boolean;
  error: string;
  onRefresh: () => void;
  onSupport: () => void;
  onClose?: () => void;
  onOpenCorrection: (step: RegistrationStepId) => void;
  onStart: () => void;
  children?: React.ReactNode;
}) {
  const { palette } = useTheme();
  const status = application.status;
  const uploads = Object.values(application.data.uploads);
  const issues = uploads.filter(upload => ['CORRECTION_REQUIRED', 'REJECTED', 'BLOCKED', 'EXPIRED'].includes(upload.status));
  const actionableIssues = issues.filter(upload => ['CORRECTION_REQUIRED', 'REJECTED', 'EXPIRED'].includes(upload.status) && upload.canReupload !== false);
  const actionableRoleIssue = application.roleStatuses.find(item => item.status === 'CORRECTION_REQUIRED') || application.roleStatuses.find(item => item.status === 'REJECTED' && item.canResubmit);
  const statusIssue = application.status === 'BLOCKED' ? application.roleStatuses.find(item => item.status === 'BLOCKED') : application.status === 'REJECTED' ? application.roleStatuses.find(item => item.status === 'REJECTED') : actionableRoleIssue;
  const targetStep = actionableIssues.length ? registrationUploadStep(actionableIssues[0].slotKey, application.data) : actionableRoleIssue?.correctionFields?.length ? registrationFieldStep(actionableRoleIssue.correctionFields[0], application.data) : 'REVIEW';
  const pending = pendingStatuses.has(status); const correction = status === 'CORRECTION_REQUIRED'; const approved = status === 'APPROVED'; const rejected = status === 'REJECTED'; const blocked = status === 'BLOCKED'; const activatable = application.canActivate === true && !application.activatedAt;
  const icon: React.ComponentProps<typeof Icon>['name'] = approved ? 'checkmark-circle-outline' : correction ? 'construct-outline' : rejected || blocked ? 'close-circle-outline' : 'time-outline';
  const color = approved ? '#15945A' : correction || pending ? '#D18A00' : colors.danger;
  const title = approved ? 'Вы готовы к работе!' : correction ? 'Нужны исправления' : rejected ? 'Регистрация отклонена' : blocked ? 'Доступ ограничен' : status === 'SUBMITTED' ? 'Анкета отправлена' : 'Анкета на проверке';
  const reason = statusIssue?.reasonText || statusIssue?.reason || null;
  const blockedUntil = statusIssue?.status === 'BLOCKED' && statusIssue.blockedUntil ? new Date(statusIssue.blockedUntil) : null;
  const text = approved ? 'Направления с допуском уже готовы к работе.' : correction ? 'Исправьте только отмеченные пункты — проходить регистрацию заново не нужно.' : rejected ? application.rejectionReason || reason || 'Причину и возможные дальнейшие действия можно уточнить в поддержке.' : blocked ? application.blockedReason || reason || 'Некоторые возможности аккаунта временно ограничены.' : 'Мы получили анкету. Статусы обновляются с сервера автоматически.';
  return <SafeAreaView style={[r.screen, { backgroundColor: palette.background }]}><RegistrationHeader onBack={onClose} onHelp={onSupport}/><ScrollView contentContainerStyle={r.statusContent}><View style={[r.statusHero, { backgroundColor: approved ? '#EAF8F1' : correction || pending ? '#FFF6DE' : '#FFF0F1' }]}><Icon name={icon} size={52} color={color}/></View><Text style={[r.statusTitle, { color: palette.ink }]}>{title}</Text><Text style={[r.statusText, { color: palette.muted }]}>{text}</Text><InfoCard title={`Анкета ${application.applicationNumber || application.applicationId || application.id || 'создана'}`} text={application.reviewEta ? `Ориентировочный срок: ${application.reviewEta}` : 'Срок проверки обновляется сервером и появится здесь.'}/>
    {blockedUntil && blockedUntil.getTime() > Date.now() ? <InfoCard tone="amber" title="Временное ограничение" text={`До ${blockedUntil.toLocaleString('ru-RU')}`}/> : null}
    {application.roleStatuses.length ? <View style={r.statusList}>{application.roleStatuses.map(item => { const badge = item.status === 'APPROVED' ? 'APPROVED' : item.status === 'CORRECTION_REQUIRED' ? 'CORRECTION_REQUIRED' : item.status === 'REJECTED' ? 'REJECTED' : item.status === 'BLOCKED' ? 'BLOCKED' : 'UNDER_REVIEW'; const projectionText = item.status === 'APPROVED' && item.operational === false ? item.projectionIssueText || ({ DEPENDENCY_NOT_APPROVED: 'Допуск зависит от другого направления, которое ещё не одобрено.', MISSING_VEHICLE_DATA: 'Не хватает данных транспорта для подключения направления.', LEGACY_PROFILE_CONFLICT: 'Направление одобрено, но профиль требует проверки поддержки.', LEGACY_PROFILE_CAPABILITY_CONFLICT: 'Эти возможности пока нельзя одновременно подключить к профилю.', LEGACY_SINGLE_VEHICLE_LIMIT: 'Направление одобрено, но текущая версия поддерживает один активный транспорт.' } as Record<string, string>)[item.projectionIssueCode || ''] || 'Направление одобрено, но пока не подключено к рабочему профилю.' : null; return <View key={item.role} style={[r.roleStatus, { borderColor: palette.line, backgroundColor: palette.surface }]}><View style={r.roleStatusTop}><Text style={[r.roleName, { color: palette.ink }]}>{item.role === 'TAXI_DRIVER' ? 'Такси' : item.role === 'CARGO_DRIVER' ? 'Грузовые перевозки' : 'Курьер'}</Text><StatusBadge status={badge}/></View>{item.reasonText || item.reason ? <Text style={r.issueReason}>{item.reasonText || item.reason}</Text> : null}{projectionText ? <Text style={r.projectionNote}>{projectionText}</Text> : null}</View>; })}</View> : null}
    <RegistrationDocumentStatusList uploads={uploads} data={application.data} allowCorrection={correction || rejected && application.canResubmit === true} onOpenCorrection={onOpenCorrection}/>
    {correction && !actionableIssues.length ? <InfoCard text="Откройте отмеченный сервером раздел и исправьте только указанные данные."/> : null}
    {error ? <ErrorCard text={error} onRetry={onRefresh}/> : null}</ScrollView><View style={r.statusBottom}>{correction ? <PrimaryButton label="Перейти к исправлениям" onPress={() => onOpenCorrection(targetStep)}/> : application.canResubmit && rejected ? <PrimaryButton label="Исправить анкету" onPress={() => onOpenCorrection(targetStep)}/> : activatable ? <PrimaryButton label="Начать работу" busy={busy} onPress={onStart}/> : pending ? <PrimaryButton label="Обновить статус" busy={busy} onPress={onRefresh}/> : null}{activatable && (correction || rejected) ? <SecondaryButton label="Начать работу по одобренному направлению" disabled={busy} onPress={onStart}/> : null}<SecondaryButton label="Связаться с поддержкой" onPress={onSupport}/></View>{children}</SafeAreaView>;
}

const r = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  loadingWrap: { flex: 1, gap: 22 },
  center: { flex: 1, justifyContent: 'center', gap: 12 },
  content: { gap: 14, paddingTop: 18 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9, gap: 3 },
  save: { minHeight: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  saveText: { fontSize: 10, fontWeight: '600' },
  sheetAction: { minHeight: 72, borderWidth: 1, borderRadius: 15, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  sheetIcon: { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { fontSize: 14, fontWeight: '700' },
  sheetText: { fontSize: 11 },
  modalHeader: { height: 52, justifyContent: 'center', alignItems: 'flex-start' },
  modalClose: { width: 42, height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  permissionScreen: { flex: 1, paddingHorizontal: 20 },
  permissionScroll: { flexGrow: 1, paddingBottom: 12 },
  permissionContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 15 },
  permissionHero: { width: 190, height: 150, alignItems: 'center', justifyContent: 'center' },
  permissionHalo: { position: 'absolute', width: 146, height: 146, borderRadius: 73, backgroundColor: '#E6F3FF' },
  permissionCamera: { width: 90, height: 72, borderRadius: 21, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#246BFD', shadowOffset: { width: 0, height: 8 }, shadowOpacity: .24, shadowRadius: 14 },
  permissionSparkOne: { position: 'absolute', right: 22, top: 28, width: 13, height: 13, borderRadius: 7, backgroundColor: '#71D4FF' },
  permissionSparkTwo: { position: 'absolute', left: 19, bottom: 27, width: 9, height: 9, borderRadius: 5, backgroundColor: '#8AA6FF' },
  documentFrame: { width: 120, height: 82, borderWidth: 3, borderStyle: 'dashed', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  permissionTitle: { fontSize: 25, lineHeight: 31, fontWeight: '800', textAlign: 'center' },
  permissionText: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 330 },
  permissionBenefits: { width: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 8, gap: 2 },
  permissionBenefit: { minHeight: 59, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 11 },
  permissionBenefitIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  permissionBenefitTitle: { fontSize: 13, fontWeight: '800' },
  permissionBenefitText: { fontSize: 11, lineHeight: 15 },
  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  privacyText: { fontSize: 11, lineHeight: 15 },
  permissionBottom: { paddingTop: 10, paddingBottom: 12, gap: 2 },
  failureScreen: { flex: 1, paddingHorizontal: 24, overflow: 'hidden' },
  failureDecorationTop: { position: 'absolute', top: -100, right: -90, width: 270, height: 270, borderRadius: 135, backgroundColor: '#E8F4FF' },
  failureDecorationSide: { position: 'absolute', left: -80, bottom: 130, width: 190, height: 190, borderRadius: 95, backgroundColor: '#F0F7FF' },
  failureContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  failureHero: { width: 220, height: 170, alignItems: 'center', justifyContent: 'center' },
  failureCloud: { width: 148, height: 118, borderRadius: 42, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-2deg' }], elevation: 3, shadowColor: '#246BFD', shadowOffset: { width: 0, height: 9 }, shadowOpacity: .10, shadowRadius: 16 },
  failureBadge: { position: 'absolute', right: 18, bottom: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: '#F45D68', borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  failureTitle: { fontSize: 27, lineHeight: 33, fontWeight: '800', textAlign: 'center' },
  failureText: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 340 },
  failureReason: { color: '#A34A52', backgroundColor: '#FFF0F1', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 11, lineHeight: 16, textAlign: 'center', maxWidth: 340 },
  failureBottom: { paddingVertical: 14, gap: 2 },
  cameraScreen: { flex: 1, backgroundColor: '#081220' },
  cameraOverlay: { flex: 1, paddingHorizontal: 18, justifyContent: 'space-between' },
  cameraTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  cameraRound: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(5,13,25,.62)', alignItems: 'center', justifyContent: 'center' },
  cameraHint: { backgroundColor: 'rgba(5,13,25,.68)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  cameraHintText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  cameraGuide: { alignSelf: 'center', width: '92%', aspectRatio: 1.58, borderWidth: 2, borderColor: '#55E49B', borderRadius: 15, backgroundColor: 'transparent' },
  faceGuide: { alignSelf: 'center', width: 230, height: 310, borderWidth: 3, borderColor: '#55E49B', borderRadius: 115, backgroundColor: 'transparent' },
  guideCorner: { position: 'absolute', top: -4, left: -4, width: 36, height: 36, borderLeftWidth: 6, borderTopWidth: 6, borderColor: '#55E49B', borderTopLeftRadius: 15 },
  cameraHelp: { color: '#FFFFFF', fontSize: 12, lineHeight: 17, textAlign: 'center', alignSelf: 'center', maxWidth: 290, backgroundColor: 'rgba(5,13,25,.62)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  cameraControls: { minHeight: 118, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  cameraControl: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(5,13,25,.65)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF' },
  cameraDenied: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 14 },
  cameraDeniedTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '800', textAlign: 'center' },
  cameraDeniedText: { color: '#B9C7D8', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 8 },
  previewScreen: { flex: 1 },
  previewHeader: { height: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewHeaderText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  previewBody: { flex: 1, margin: 16, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%' },
  filePreview: { alignItems: 'center', gap: 15 },
  fileName: { color: '#FFFFFF', fontSize: 14, maxWidth: 280, textAlign: 'center' },
  previewBottom: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 8 },
  previewTitle: { fontSize: 18, fontWeight: '800' },
  previewCheck: { fontSize: 12, marginBottom: 4 },
  supportTitle: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  topicRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  topic: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  topicText: { fontSize: 12, fontWeight: '600' },
  statusContent: { paddingVertical: 28, gap: 14, alignItems: 'stretch' },
  statusHero: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  statusTitle: { fontSize: 27, lineHeight: 33, fontWeight: '800', textAlign: 'center' },
  statusText: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginHorizontal: 12 },
  statusList: { gap: 8 },
  statusSectionTitle: { fontSize: 16, fontWeight: '800', marginTop: 3 },
  roleStatus: { minHeight: 58, borderWidth: 1, borderRadius: 14, padding: 13, gap: 7 },
  roleStatusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  roleName: { fontSize: 14, fontWeight: '700' },
  documentMeta: { fontSize: 12, lineHeight: 17 },
  issueCard: { borderWidth: 1, borderRadius: 15, padding: 13, gap: 6 },
  issueTitle: { fontSize: 14, fontWeight: '700' },
  issueReason: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  projectionNote: { color: '#A46900', fontSize: 12, lineHeight: 17 },
  statusBottom: { paddingVertical: 10, gap: 2 },
});
