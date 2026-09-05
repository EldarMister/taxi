export interface SessionTokens { accessToken: string; refreshToken: string }
// Browser preview never persists bearer tokens in localStorage.
let tokens: SessionTokens | null = null;
let lastOrderId: string | null = null;
export async function readTokens(): Promise<SessionTokens | null> { return tokens; }
export async function writeTokens(value: SessionTokens): Promise<void> { tokens = value; }
export async function clearTokens(): Promise<void> { tokens = null; }
export async function readLastOrderId(): Promise<string | null> { return lastOrderId; }
export async function writeLastOrderId(value: string | null): Promise<void> { lastOrderId = value; }
