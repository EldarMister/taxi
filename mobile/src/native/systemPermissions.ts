import { NativeModules, Platform } from 'react-native';

export type SystemPermissionStep = 'overlay' | 'battery';
export interface SystemPermissionState { granted: boolean; canAskAgain: boolean; supported: boolean }
type SystemPermissionModule = {
  canDrawOverlays(): Promise<boolean>;
  isBatterySaverDisabled(): Promise<boolean>;
  openOverlaySettings(): Promise<void>;
  openBatterySaverSettings(): Promise<void>;
};

function androidModule(): SystemPermissionModule {
  const module = NativeModules.AtlasSystemPermissions as SystemPermissionModule | undefined;
  if (!module) throw new Error('Настройки устройства недоступны. Обновите приложение и попробуйте снова.');
  return module;
}

export async function getSystemPermissionState(step: SystemPermissionStep): Promise<SystemPermissionState> {
  if (Platform.OS !== 'android') return { granted: false, canAskAgain: false, supported: false };
  const module = androidModule();
  const granted = step === 'overlay' ? await module.canDrawOverlays() : await module.isBatterySaverDisabled();
  return { granted, canAskAgain: false, supported: true };
}

export async function openSystemPermissionSettings(step: SystemPermissionStep): Promise<void> {
  if (Platform.OS !== 'android') return;
  const module = androidModule();
  if (step === 'overlay') await module.openOverlaySettings();
  else await module.openBatterySaverSettings();
}
