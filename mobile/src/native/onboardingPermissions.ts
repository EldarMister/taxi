import type { PermissionStep } from '../permissionFlow';
import { getLocationPermissionState, openLocationSettings, requestLocationAccess } from './location';
import { getNotificationPermissionState, openNotificationSettings, requestNotificationAccess } from './push';
import { getSystemPermissionState, openSystemPermissionSettings } from './systemPermissions';

export interface OnboardingPermissionState {
  granted: boolean;
  canAskAgain: boolean;
  supported?: boolean;
  servicesEnabled?: boolean;
}

export async function getOnboardingPermissionState(step: PermissionStep): Promise<OnboardingPermissionState> {
  if (step === 'notifications') return getNotificationPermissionState();
  if (step === 'location') return getLocationPermissionState();
  return getSystemPermissionState(step);
}

export async function openOnboardingPermissionSettings(step: PermissionStep): Promise<void> {
  if (step === 'notifications') await openNotificationSettings();
  else if (step === 'location') await openLocationSettings();
  else await openSystemPermissionSettings(step);
}

export async function requestOnboardingPermission(step: PermissionStep): Promise<OnboardingPermissionState> {
  if (step === 'notifications') return requestNotificationAccess();
  if (step === 'location') return requestLocationAccess();
  const state = await getSystemPermissionState(step);
  if (state.supported && !state.granted) await openSystemPermissionSettings(step);
  // Opening settings is not a grant. Re-read after the app becomes active.
  return state;
}
