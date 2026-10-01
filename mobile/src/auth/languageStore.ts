import * as SecureStore from 'expo-secure-store';
import { appVariant } from '../appVariant';
import type { Language } from '../types';

const key = `atlas.${appVariant}.interfaceLanguage.v1`;
let selected: Language = 'ru';
let writeQueue: Promise<unknown> = Promise.resolve();

export function selectedLanguage(): Language { return selected; }

export async function readSelectedLanguage(): Promise<Language> {
  try {
    const value = await SecureStore.getItemAsync(key);
    if (value === 'ru' || value === 'ky' || value === 'en') selected = value;
  } catch { /* Keep the default when secure storage is unavailable. */ }
  return selected;
}

export function writeSelectedLanguage(language: Language): Promise<void> {
  selected = language;
  const operation = writeQueue.then(() => SecureStore.setItemAsync(key, language));
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function withSelectedLanguage<T extends { language: Language }>(profile: T): T {
  return selected === 'en' ? { ...profile, language: 'en' } : profile;
}
