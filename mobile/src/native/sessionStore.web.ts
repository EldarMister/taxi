export interface SessionTokens { accessToken: string; refreshToken: string }
// Browser preview never persists bearer tokens in localStorage.
let tokens: SessionTokens | null = null;
let lastOrderId: string | null = null;
export type PermissionIntroState = 'location' | 'notifications' | 'done';
const permissionIntro = new Map<string, PermissionIntroState>();
export async function readTokens(): Promise<SessionTokens | null> { return tokens; }
export async function writeTokens(value: SessionTokens): Promise<void> { tokens = value; }
export async function clearTokens(): Promise<void> { tokens = null; }
export async function readLastOrderId(): Promise<string | null> { return lastOrderId; }
export async function writeLastOrderId(value: string | null): Promise<void> { lastOrderId = value; }
export async function readPermissionIntro(userId: string): Promise<PermissionIntroState> { return permissionIntro.get(userId) ?? 'location'; }
export async function writePermissionIntro(userId: string, value: PermissionIntroState): Promise<void> { permissionIntro.set(userId, value); }
