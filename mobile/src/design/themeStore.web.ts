import { appVariant } from '../appVariant';
import type { ThemePreference } from './themeStore';

const key = `atlas.${appVariant}.themePreference.v1`;

export async function readThemePreference(): Promise<ThemePreference> {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export async function writeThemePreference(value: ThemePreference): Promise<void> {
  globalThis.localStorage?.setItem(key, value);
}
