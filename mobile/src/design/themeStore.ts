import * as SecureStore from 'expo-secure-store';
import { appVariant } from '../appVariant';

export type ThemePreference = 'system' | 'light' | 'dark';
const key = `atlas.${appVariant}.themePreference.v1`;
let writeQueue: Promise<unknown> = Promise.resolve();

export async function readThemePreference(): Promise<ThemePreference> {
  try {
    const value = await SecureStore.getItemAsync(key);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export async function writeThemePreference(value: ThemePreference): Promise<void> {
  const operation = writeQueue.then(() => SecureStore.setItemAsync(key, value));
  writeQueue = operation.catch(() => undefined);
  await operation;
}
