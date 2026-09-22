export const performerRoles = ['TAXI_DRIVER', 'CARGO_DRIVER', 'COURIER'] as const;
export type PerformerRole = typeof performerRoles[number];

export const registrationStatuses = ['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'BLOCKED'] as const;
export type RegistrationStatus = typeof registrationStatuses[number];

export type VerificationStatus =
  | 'NOT_UPLOADED'
  | 'DRAFT'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'ACTIVE'
  | 'BLOCKED'
  | 'CORRECTION_REQUIRED'
  | 'REJECTED'
  | 'EXPIRING'
  | 'EXPIRED'
  | 'QUEUED';

export const courierTransportModes = ['FOOT', 'BICYCLE', 'E_BICYCLE', 'MOPED', 'SCOOTER', 'MOTORCYCLE', 'CAR', 'TRUCK'] as const;
export type CourierTransportMode = typeof courierTransportModes[number];

export type RegistrationStepId =
  | 'ROLES'
  | 'PERSONAL_DATA'
  | 'PROFILE_PHOTO'
  | 'IDENTITY_DOCUMENT'
  | 'COURIER_TRANSPORT'
  | 'DRIVER_LICENSE'
  | 'TAXI_VEHICLE'
  | 'TAXI_DOCUMENTS'
  | 'TAXI_PHOTOS'
  | 'CARGO_VEHICLE'
  | 'CARGO_EQUIPMENT'
  | 'CARGO_DOCUMENTS'
  | 'CARGO_PHOTOS'
  | 'COURIER_SETTINGS'
  | 'COURIER_VEHICLE'
  | 'WORK_PREFERENCES'
  | 'LOCATION'
  | 'PAYMENT'
  | 'REVIEW';

export type RegistrationUpload = {
  id?: string;
  slotKey: string;
  kind: 'PROFILE_PHOTO' | 'IDENTITY_DOCUMENT' | 'DRIVER_LICENSE' | 'VEHICLE_DOCUMENT' | 'VEHICLE_PHOTO' | 'ADDITIONAL_DOCUMENT';
  name?: string;
  localUri?: string;
  remoteUrl?: string;
  mimeType?: string;
  status: VerificationStatus;
  progress?: number;
  reasonCode?: string | null;
  reasonText?: string | null;
  canReupload?: boolean;
  pendingDelete?: boolean;
  expiresAt?: string | null;
  updatedAt?: string;
};

export type VehicleDraft = {
  id?: string;
  ownership: 'OWN' | 'RENT' | '';
  type: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  plateNumber: string;
  vin: string;
  passengerSeats: string;
  bodyType: string;
  hasAirConditioning: boolean;
  tariffs: string[];
  capacityKg: string;
  volumeM3: string;
  lengthM: string;
  widthM: string;
  heightM: string;
};

export type CargoEquipmentDraft = {
  loadingTypes: string[];
  palletCount: string;
  refrigerator: boolean;
  minTemperature: string;
  maxTemperature: string;
  tailLift: boolean;
  manipulator: boolean;
  worksWithLoaders: boolean;
  loaderCount: string;
};

export const vehicleUsages = ['TAXI', 'CARGO', 'COURIER'] as const;
export type VehicleUsage = typeof vehicleUsages[number];
export type AdditionalVehicleDraft = VehicleDraft & { clientId: string; usage: VehicleUsage; equipment: CargoEquipmentDraft };
export const MAX_ADDITIONAL_VEHICLES = 5;
export const additionalVehicleClientIdPattern = /^v-[a-z0-9]+$/;

export type RegistrationData = {
  personal: {
    firstName: string;
    lastName: string;
    middleName: string;
    birthDate: string;
    city: string;
    citizenship: string;
    language: 'ru' | 'ky';
  };
  identity: { number: string; issuedAt: string; expiresAt: string; issuedBy: string };
  driverLicense: { number: string; categories: string[]; issuedAt: string; expiresAt: string; experienceYears: string };
  courier: {
    transportModes: CourierTransportMode[];
    hasThermalBag: boolean;
    orderTypes: string[];
    maxWeightKg: string;
    acceptsCash: boolean;
    city: string;
    districts: string[];
    useExistingVehicle: boolean;
    existingVehicleUsage: 'TAXI' | 'CARGO' | '';
    existingVehicleClientId: string;
  };
  taxiVehicle: VehicleDraft;
  cargoVehicle: VehicleDraft;
  courierVehicle: VehicleDraft;
  vehicles: AdditionalVehicleDraft[];
  cargoEquipment: CargoEquipmentDraft;
  work: {
    city: string;
    districts: string[];
    intercity: boolean;
    night: boolean;
    schedule: 'FULL' | 'FLEXIBLE' | '';
    preferredTime: string;
    maxPickupDistanceKm: string;
    notifications: boolean;
  };
  location: { choice: 'PRECISE' | 'MANUAL' | ''; city: string };
  payment: { type: 'CARD' | 'BANK_ACCOUNT' | 'WALLET' | ''; last4: string; taxIdLast4: string };
  agreements: { truthConfirmed: boolean; termsAccepted: boolean; acceptedIds: string[]; legalTermsVersion?: string };
  documentExpiries: Record<string, string>;
  uploads: Record<string, RegistrationUpload>;
  skippedSteps: RegistrationStepId[];
  completedSteps: RegistrationStepId[];
  cameraIntroSeen: boolean;
};

export type RoleReview = {
  role: PerformerRole;
  status: RegistrationStatus;
  reason?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  canResubmit?: boolean;
  blockedUntil?: string | null;
  correctionFields?: string[];
  operational?: boolean;
  projectedAt?: string | null;
  projectionIssueCode?: string | null;
  projectionIssueText?: string | null;
};

export type RegistrationApplication = {
  id?: string;
  applicationId?: string;
  applicationNumber?: string;
  status: RegistrationStatus;
  roles: PerformerRole[];
  roleStatuses: RoleReview[];
  currentStep: RegistrationStepId;
  data: RegistrationData;
  version: number;
  updatedAt?: string;
  submittedAt?: string | null;
  reviewEta?: string | null;
  rejectionReason?: string | null;
  blockedReason?: string | null;
  canResubmit?: boolean;
  canActivate?: boolean;
  activatedAt?: string | null;
  localSync?: { dirty: boolean; baseVersion: number };
};

export type DocumentRequirement = {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  sides: number;
  role?: PerformerRole;
  ownership?: 'OWN' | 'RENT';
  requiresExpiry?: boolean;
  exampleImageUrl?: string;
};

export type BaseDocumentRequirement = {
  id: string;
  title: string;
  description?: string;
  kind: RegistrationUpload['kind'];
  slots: string[];
  slotTitles?: Record<string, string>;
  requiredFor: PerformerRole[];
  required?: boolean;
  condition?: string;
  expirySlots?: string[];
  exampleImageUrl?: string;
};

export type RegistrationConfig = {
  roles: Array<{ id: PerformerRole; title: string; description: string }>;
  minimumAge: number;
  minimumAgeByRole: Record<PerformerRole, number>;
  countries: string[];
  cities: string[];
  districts: Record<string, string[]>;
  driverLicenseCategories: string[];
  cargoVehicleTypes: string[];
  taxiBodyTypes: string[];
  tariffs: { id: string; title: string }[];
  payoutMethods: Array<'CARD' | 'BANK_ACCOUNT' | 'WALLET'>;
  courierTransportModes: CourierTransportMode[];
  courierOrderTypes: string[];
  languages: Array<{ id: 'ru' | 'ky'; name: string }>;
  loadingTypes: string[];
  documents: DocumentRequirement[];
  documentRequirements: BaseDocumentRequirement[];
  legalConsents: Array<{ id: string; required: boolean; title: string }>;
  upload: { maxBytes: number; allowedMimeTypes: string[] };
  legalTermsVersion: string;
  supportPhone?: string;
};

export type RegistrationEnvelope = { application: RegistrationApplication | null; config: RegistrationConfig };

export const emptyVehicleDraft = (): VehicleDraft => ({
  ownership: '', type: '', brand: '', model: '', year: '', color: '', plateNumber: '', vin: '', passengerSeats: '', bodyType: '', hasAirConditioning: false,
  tariffs: [], capacityKg: '', volumeM3: '', lengthM: '', widthM: '', heightM: '',
});

export const emptyCargoEquipmentDraft = (): CargoEquipmentDraft => ({
  loadingTypes: [], palletCount: '', refrigerator: false, minTemperature: '', maxTemperature: '', tailLift: false, manipulator: false, worksWithLoaders: false, loaderCount: '',
});

export function createAdditionalVehicle(usage: VehicleUsage, clientId = `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`): AdditionalVehicleDraft {
  return { ...emptyVehicleDraft(), clientId, usage, equipment: emptyCargoEquipmentDraft() };
}

export function emptyRegistrationData(language: 'ru' | 'ky' = 'ru'): RegistrationData {
  return {
    personal: { firstName: '', lastName: '', middleName: '', birthDate: '', city: '', citizenship: '', language },
    identity: { number: '', issuedAt: '', expiresAt: '', issuedBy: '' },
    driverLicense: { number: '', categories: [], issuedAt: '', expiresAt: '', experienceYears: '' },
    courier: { transportModes: [], hasThermalBag: false, orderTypes: [], maxWeightKg: '', acceptsCash: false, city: '', districts: [], useExistingVehicle: false, existingVehicleUsage: '', existingVehicleClientId: '' },
    taxiVehicle: emptyVehicleDraft(), cargoVehicle: emptyVehicleDraft(), courierVehicle: emptyVehicleDraft(), vehicles: [],
    cargoEquipment: emptyCargoEquipmentDraft(),
    work: { city: '', districts: [], intercity: false, night: false, schedule: '', preferredTime: '', maxPickupDistanceKm: '', notifications: true },
    location: { choice: '', city: '' },
    payment: { type: '', last4: '', taxIdLast4: '' },
    agreements: { truthConfirmed: false, termsAccepted: false, acceptedIds: [] }, documentExpiries: {}, uploads: {}, skippedSteps: [], completedSteps: [], cameraIntroSeen: false,
  };
}

export function emptyRegistrationApplication(language: 'ru' | 'ky' = 'ru'): RegistrationApplication {
  return { status: 'NOT_STARTED', roles: [], roleStatuses: [], currentStep: 'ROLES', data: emptyRegistrationData(language), version: 0 };
}
