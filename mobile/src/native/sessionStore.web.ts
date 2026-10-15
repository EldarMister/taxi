import { savedPermissionStep, type PermissionIntroState, type PermissionRole } from '../permissionFlow';
export type { PermissionIntroState } from '../permissionFlow';
export interface SessionTokens { accessToken: string; refreshToken: string }
// Browser preview never persists bearer tokens in localStorage.
let tokens: SessionTokens | null = null;
let lastOrderId: string | null = null;
const permissionIntro = new Map<string, PermissionIntroState>();
const permissionIntroKey = (userId: string, role: PermissionRole) => `${role}:${userId}`;
export async function readTokens(): Promise<SessionTokens | null> { return tokens; }
export async function writeTokens(value: SessionTokens): Promise<void> { tokens = value; }
export async function clearTokens(): Promise<void> { tokens = null; }
export async function readLastOrderId(): Promise<string | null> { return lastOrderId; }
export async function writeLastOrderId(value: string | null): Promise<void> { lastOrderId = value; }
export async function readPermissionIntro(userId: string, role: PermissionRole = 'CLIENT'): Promise<PermissionIntroState> { return savedPermissionStep(permissionIntro.get(permissionIntroKey(userId, role)), role); }
export async function writePermissionIntro(userId: string, value: PermissionIntroState, role: PermissionRole = 'CLIENT'): Promise<void> { permissionIntro.set(permissionIntroKey(userId, role), savedPermissionStep(value, role)); }
export async function clearPermissionIntro(userId: string): Promise<void> { permissionIntro.delete(permissionIntroKey(userId, 'CLIENT')); permissionIntro.delete(permissionIntroKey(userId, 'DRIVER')); }
