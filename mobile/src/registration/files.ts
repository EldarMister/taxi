import * as FileSystem from 'expo-file-system/legacy';

type LocalFile = { uri: string; name: string; type: string; isImage: boolean; width?: number; height?: number };

function safeSegment(value: string) {
  return value.replace(/[^a-z0-9_.-]+/gi, '_').slice(0, 100) || 'file';
}

function userDirectory(userId: string) {
  if (!FileSystem.documentDirectory) throw new Error('Постоянное хранилище файлов недоступно на этом устройстве.');
  return `${FileSystem.documentDirectory}atlas-registration/${safeSegment(userId)}/`;
}

export function isManagedRegistrationFile(userId: string, uri: string) {
  try { return uri.startsWith(userDirectory(userId)); }
  catch { return false; }
}

export async function registrationFileExists(uri: string | undefined) {
  if (!uri) return false;
  try { return (await FileSystem.getInfoAsync(uri)).exists; }
  catch { return false; }
}

export async function persistRegistrationFile(userId: string, slotKey: string, file: LocalFile): Promise<LocalFile> {
  const source = await FileSystem.getInfoAsync(file.uri);
  if (!source.exists) throw new Error('Выбранный файл больше недоступен. Выберите его ещё раз.');
  if (isManagedRegistrationFile(userId, file.uri)) return file;
  const directory = userDirectory(userId);
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = /\.[a-z0-9]{1,8}$/i.exec(file.name)?.[0]?.toLowerCase() || (file.type === 'application/pdf' ? '.pdf' : '.jpg');
  const destination = `${directory}${safeSegment(slotKey)}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${extension}`;
  await FileSystem.copyAsync({ from: file.uri, to: destination });
  return { ...file, uri: destination };
}

export async function deleteRegistrationFile(userId: string, uri: string | undefined) {
  if (!uri || !isManagedRegistrationFile(userId, uri)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

export async function clearRegistrationFiles(userId: string) {
  let directory: string;
  try { directory = userDirectory(userId); }
  catch { return; }
  await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined);
}

export async function pruneRegistrationFiles(userId: string, keepUris: Iterable<string>) {
  let directory: string;
  try { directory = userDirectory(userId); }
  catch { return; }
  const keep = new Set(keepUris);
  const names = await FileSystem.readDirectoryAsync(directory).catch(() => [] as string[]);
  await Promise.all(names.map(name => {
    const uri = `${directory}${name}`;
    return keep.has(uri) ? Promise.resolve() : FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }));
}
