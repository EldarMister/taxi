import React, { createContext, useContext } from 'react';
import type { Language } from '../types';
import { tr } from '../ui';

const FoodLanguage = createContext<Language>('ru');

export function FoodLanguageProvider({ language, children }: { language: Language; children: React.ReactNode }) {
  return <FoodLanguage.Provider value={language}>{children}</FoodLanguage.Provider>;
}

export function useFoodT() {
  return tr(useContext(FoodLanguage));
}

export function useFoodLanguage() {
  return useContext(FoodLanguage);
}
