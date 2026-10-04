import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { Platform, Share } from 'react-native';

type RecordingState = { recording: boolean; points: number; fileName: string | null; error: string | null };
const pointer = () => new File(Paths.document, 'atlas-tracking-latest.json');
const MAX_BYTES = 32 * 1024 * 1024;
let state: RecordingState = { recording: false, points: 0, fileName: null, error: null };
let loaded = false;
let needsBoundary = false;
const file = () => state.fileName ? new File(Paths.document, state.fileName) : null;
const enabled = () => process.env.EXPO_PUBLIC_TRACKING_DIAGNOSTICS === '1';
function utf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const bytes = encodeURIComponent(text).replace(/%([A-F0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Uint8Array.from(bytes, character => character.charCodeAt(0));
}

function restoreJournal(fileName: string, recording?: boolean) {
  const target = new File(Paths.document, fileName);
  const text = target.textSync();
  const events = text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  if (events[0]?.type !== 'start' || events[0]?.data?.schemaVersion !== 1) throw new Error('Invalid recording');
  needsBoundary = text.length > 0 && !text.endsWith('\n');
  state = { recording: recording !== false && events.at(-1)?.type !== 'stop',
    points: events.filter(event => event.type === 'gps').length, fileName, error: null };
}
function restore() {
  if (loaded) return;
  loaded = true;
  try {
    if (!pointer().exists) throw new Error('Missing pointer');
    const saved = JSON.parse(pointer().textSync());
    if (typeof saved.fileName !== 'string' || !/^atlas-gps-[a-z0-9_-]+\.jsonl$/i.test(saved.fileName)) throw new Error('Invalid pointer');
    restoreJournal(saved.fileName, saved.recording);
  } catch {
    // A process can die while rewriting the small pointer. The append-only
    // journal remains recoverable, including an incomplete final event.
    try {
      const names = new Directory(Paths.document).list().filter(entry => entry instanceof File
        && /^atlas-gps-[a-z0-9_-]+\.jsonl$/i.test(entry.name)).map(entry => entry.name)
        .sort((a, b) => Number(b.split('-')[2]) - Number(a.split('-')[2]));
      if (!names.length) return;
      restoreJournal(names[0]);
    } catch { state.error = 'Не удалось восстановить запись. Сохранённые файлы не удалены.'; }
  }
}
function persist() {
  const target = pointer();
  if (!target.exists) target.create();
  target.write(JSON.stringify(state));
}
function append(type: string, data: unknown) {
  const target = file();
  if (!target) throw new Error('Запись отсутствует.');
  if (target.size >= MAX_BYTES) throw new Error('Запись достигла 32 МБ. Сохраните её и начните новую.');
  const handle = target.open();
  try {
    handle.offset = handle.size ?? 0;
    handle.writeBytes(utf8((needsBoundary ? '\n' : '') + JSON.stringify({ type, recordedAtMs: Date.now(), data }) + '\n'));
    needsBoundary = false;
  } finally { handle.close(); }
}
export function getTrackingRecording(): RecordingState { restore(); return { ...state }; }
export function startTrackingRecording(): boolean {
  if (!enabled()) return false;
  restore();
  if (state.recording) return true;
  try {
    const name = `atlas-gps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`;
    new File(Paths.document, name).create();
    needsBoundary = false;
    state = { recording: true, points: 0, fileName: name, error: null };
    append('start', { schemaVersion: 1, appVersion: Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? null,
      platform: Platform.OS, platformVersion: Platform.Version });
    persist();
    return true;
  } catch {
    state.recording = false; state.error = 'Не удалось начать запись. Проверьте свободное место.';
    return false;
  }
}
/** Called on GPS/network events, never from the animation frame loop. */
export function recordTrackingEvent(type: 'gps' | 'upload' | 'navigation' | 'route' | 'voice', data: unknown) {
  if (!enabled()) return;
  restore();
  if (!state.recording) return;
  try {
    append(type, data);
    if (type === 'gps') { state.points++; persist(); }
  } catch {
    state.recording = false; state.error = 'Запись остановлена: ошибка хранения или лимит 32 МБ. Уже записанные точки сохранены.';
    try { persist(); } catch { /* Keep the journal even if the pointer cannot be updated. */ }
  }
}
export function stopTrackingRecording(): RecordingState {
  restore();
  if (state.recording) {
    try { append('stop', { points: state.points }); }
    catch { state.error = 'Не удалось дописать отметку остановки. Уже записанные точки сохранены.'; }
    state.recording = false;
    try { persist(); } catch { state.error = 'Не удалось сохранить состояние записи.'; }
  }
  return { ...state };
}
export async function exportTrackingRecording(): Promise<string | null> {
  restore();
  const source = file();
  if (!source?.exists) throw new Error('Сначала запишите поездку.');
  if (state.recording) throw new Error('Перед сохранением остановите запись.');
  if (Platform.OS !== 'android') { await Share.share({ url: source.uri }); return source.uri; }
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  const destination = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, state.fileName!, 'application/octet-stream');
  // A killed process may leave one incomplete line. Export every complete
  // event as valid JSONL while keeping the original journal for recovery.
  const lines = (await source.text()).split('\n').filter(line => {
    try { return typeof JSON.parse(line)?.type === 'string'; } catch { return false; }
  });
  await FileSystem.writeAsStringAsync(destination, lines.join('\n') + '\n');
  return destination;
}
