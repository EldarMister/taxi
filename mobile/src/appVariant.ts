import Constants from 'expo-constants';
import type { Language, User } from './types';

type AppVariant = 'client' | 'driver';
type MismatchCopy = { title: string; message: string; action: string };
type VariantHelpers = {
  resolveAppVariant: (value?: unknown) => AppVariant;
  expectedRoleForVariant: (value: AppVariant) => User['role'];
  isRoleAllowed: (value: AppVariant, role: User['role']) => boolean;
  roleMismatchCopy: (value: AppVariant, language?: Language) => MismatchCopy;
};

const helpers = require('../config/app-variant.cjs') as VariantHelpers;

export const appVariant = helpers.resolveAppVariant(Constants.expoConfig?.extra?.appVariant);
export const expectedAppRole = helpers.expectedRoleForVariant(appVariant);
export const isRoleAllowed = (role: User['role']) => helpers.isRoleAllowed(appVariant, role);
export const roleMismatchCopy = (language: Language) => helpers.roleMismatchCopy(appVariant, language);

