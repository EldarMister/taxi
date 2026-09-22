import * as SecureStore from 'expo-secure-store';
import type { RegistrationApplication } from './types';

const CHUNK_SIZE = 1800;
const keyFor = (userId: string) => `atlas-registration-${userId}`;
const operations = new Map<string, Promise<void>>();
type Generation = { id: string; count: number };
type Manifest = { current: Generation; previous?: Generation };

function enqueue(base: string, operation: () => Promise<void>) {
  const next = (operations.get(base) || Promise.resolve()).catch(() => undefined).then(operation);
  operations.set(base, next);
  return next.finally(() => { if (operations.get(base) === next) operations.delete(base); });
}

export async function readRegistrationDraft(userId: string): Promise<RegistrationApplication | null> {
  const base = keyFor(userId); await operations.get(base)?.catch(() => undefined);
  const manifest = parseManifest(await SecureStore.getItemAsync(`${base}:manifest`));
  if (manifest) {
    const current = await readGeneration(base, manifest.current);
    if (current) return current;
    if (manifest.previous) {
      const previous = await readGeneration(base, manifest.previous);
      if (previous) return previous;
    }
  }
  // One-time fallback for drafts written before generation manifests existed.
  const countText = await SecureStore.getItemAsync(`${base}:count`); const count = Number(countText || 0);
  if (!validCount(count)) return null;
  const chunks = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${base}:${index}`)));
  return parseDraft(chunks);
}

export function writeRegistrationDraft(userId: string, application: RegistrationApplication) {
  const base = keyFor(userId); const value = JSON.stringify(application);
  return enqueue(base, async() => {
    const chunks = Array.from({ length: Math.ceil(value.length / CHUNK_SIZE) }, (_, index) => value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
    const previousManifest = parseManifest(await SecureStore.getItemAsync(`${base}:manifest`));
    const generation: Generation = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, count: chunks.length };
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(`${base}:g:${generation.id}:${index}`, chunk)));
    // This single-key swap is the commit point: readers see either the complete
    // old generation or the complete new generation, never a mixed chunk set.
    const manifest: Manifest = { current: generation, ...(previousManifest?.current ? { previous: previousManifest.current } : {}) };
    await SecureStore.setItemAsync(`${base}:manifest`, JSON.stringify(manifest));
    if (previousManifest?.previous) await deleteGeneration(base, previousManifest.previous);
    const legacyCount = Number(await SecureStore.getItemAsync(`${base}:count`) || 0);
    if (validCount(legacyCount)) await Promise.all(Array.from({ length: legacyCount }, (_, index) => SecureStore.deleteItemAsync(`${base}:${index}`)));
    await SecureStore.deleteItemAsync(`${base}:count`);
  });
}

export function clearRegistrationDraft(userId: string) {
  const base = keyFor(userId);
  return enqueue(base, async() => {
    const manifest = parseManifest(await SecureStore.getItemAsync(`${base}:manifest`));
    if (manifest) await Promise.all([deleteGeneration(base, manifest.current), manifest.previous ? deleteGeneration(base, manifest.previous) : Promise.resolve()]);
    await SecureStore.deleteItemAsync(`${base}:manifest`);
    const count = Number(await SecureStore.getItemAsync(`${base}:count`) || 0);
    if (validCount(count)) await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(`${base}:${index}`)));
    await SecureStore.deleteItemAsync(`${base}:count`);
  });
}

function validCount(value: number) { return Number.isInteger(value) && value >= 1 && value <= 100; }

function parseManifest(value: string | null): Manifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Manifest>;
    if (!parsed.current || !/^[a-z0-9-]{3,40}$/i.test(parsed.current.id) || !validCount(parsed.current.count)) return null;
    if (parsed.previous && (!/^[a-z0-9-]{3,40}$/i.test(parsed.previous.id) || !validCount(parsed.previous.count))) return null;
    return parsed as Manifest;
  } catch { return null; }
}

async function readGeneration(base: string, generation: Generation) {
  const chunks = await Promise.all(Array.from({ length: generation.count }, (_, index) => SecureStore.getItemAsync(`${base}:g:${generation.id}:${index}`)));
  return parseDraft(chunks);
}

function parseDraft(chunks: Array<string | null>) {
  if (chunks.some(chunk => chunk == null)) return null;
  try { return JSON.parse(chunks.join('')) as RegistrationApplication; } catch { return null; }
}

async function deleteGeneration(base: string, generation: Generation) {
  await Promise.all(Array.from({ length: generation.count }, (_, index) => SecureStore.deleteItemAsync(`${base}:g:${generation.id}:${index}`)));
}
