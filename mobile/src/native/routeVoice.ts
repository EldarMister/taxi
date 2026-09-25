import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { isRoleAllowed } from '../appVariant';
import type { Language } from '../types';

const DEFAULT_TTS_URL = 'https://tts-production-9005d.up.railway.app';
const TTS_URL = (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_TTS_URL || DEFAULT_TTS_URL).replace(/\/+$/, '');
const TTS_SPEAKER = typeof process !== 'undefined' && process.env.EXPO_PUBLIC_TTS_SPEAKER || 'xenia';
const FETCH_TIMEOUT_MS = 15_000;
const PLAYBACK_TIMEOUT_MS = 20_000;

export type RouteVoiceOptions = {
  language: Language;
  systemVoice?: string;
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: unknown) => void;
};

type ActiveSpeech = {
  generation: number;
  controller?: AbortController;
  player?: AudioPlayer;
  timer?: ReturnType<typeof setTimeout>;
  onStopped?: () => void;
};

let generation = 0;
let active: ActiveSpeech | undefined;
let audioMode: Promise<void> | undefined;

// Guidance distances are below 550 m. Silero must receive words rather than
// relying on the model to verbalize digits; keep street names/numbers intact.
export function sileroNavigationText(text: string): string {
  const ones = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  return text.replace(/^(Через\s+)(\d{1,3})(\s+метр(?:ов|а)?)(?=\s|[,.!?;:]|$)/iu, (_match, prefix, digits, unit) => {
    const value = Number(digits), rest = value % 100;
    const words = [hundreds[Math.floor(value / 100)]];
    if (rest >= 10 && rest < 20) words.push(teens[rest - 10]);
    else {
      words.push(tens[Math.floor(rest / 10)]);
      if (rest % 10 || value === 0) words.push(ones[rest % 10]);
    }
    return `${prefix}${words.filter(Boolean).join(' ')}${unit}`;
  });
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function cachedFile(text: string) {
  return new File(Paths.cache, `atlas-route-v2-${TTS_SPEAKER}-${text.length}-${hash(text)}.wav`);
}

function release(item: ActiveSpeech | undefined) {
  if (!item) return;
  item.controller?.abort();
  if (item.timer) clearTimeout(item.timer);
  if (item.player) {
    try { item.player.pause(); item.player.remove(); }
    catch { /* The native player may already have been released. */ }
  }
}

function finish(item: ActiveSpeech, callback?: () => void) {
  if (active !== item || generation !== item.generation) return;
  active = undefined;
  release(item);
  callback?.();
}

async function synthesize(text: string, item: ActiveSpeech): Promise<File> {
  const spokenText = sileroNavigationText(text);
  const file = cachedFile(spokenText);
  if (file.exists && (file.info().size || 0) > 44) return file;

  const controller = new AbortController();
  item.controller = controller;
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${TTS_URL}/synthesize`, {
      method: 'POST',
      headers: { Accept: 'audio/wav', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: spokenText, speaker: TTS_SPEAKER, sample_rate: 48_000 }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Silero TTS returned ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('audio/')) throw new Error('Silero TTS did not return audio');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength <= 44 || bytes.byteLength > 8 * 1024 * 1024) throw new Error('Silero TTS returned invalid audio');
    if (active !== item || generation !== item.generation) throw new Error('Speech cancelled');
    file.write(bytes);
    return file;
  } finally {
    clearTimeout(timeout);
    if (item.controller === controller) item.controller = undefined;
  }
}

function speakWithSystem(text: string, options: RouteVoiceOptions, item: ActiveSpeech) {
  if (active !== item || generation !== item.generation) return;
  Speech.speak(text, {
    language: options.language === 'ky' ? 'ky-KG' : Platform.OS === 'android' ? 'ru' : 'ru-RU',
    voice: options.systemVoice,
    rate: .9,
    volume: 1,
    useApplicationAudioSession: false,
    onStart: () => { if (active === item) options.onStart?.(); },
    onDone: () => finish(item, options.onDone),
    onStopped: () => finish(item, options.onStopped),
    onError: error => finish(item, () => options.onError?.(error)),
  });
}

async function speakWithSilero(text: string, options: RouteVoiceOptions, item: ActiveSpeech) {
  try {
    const file = await synthesize(text, item);
    if (active !== item || generation !== item.generation) return;
    audioMode ??= setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    }).catch(error => { audioMode = undefined; throw error; });
    await audioMode;
    if (active !== item || generation !== item.generation) return;
    const player = createAudioPlayer(file.uri, { updateInterval: 100 });
    item.player = player;
    player.volume = 1;
    player.addListener('playbackStatusUpdate', status => {
      if (status.didJustFinish) finish(item, options.onDone);
    });
    item.timer = setTimeout(() => finish(item, () => options.onError?.(new Error('Silero TTS playback timed out'))), PLAYBACK_TIMEOUT_MS);
    player.play();
    if (active === item && generation === item.generation) options.onStart?.();
  } catch (error) {
    if (active !== item || generation !== item.generation) return;
    finish(item, () => options.onError?.(error));
  }
}

export const routeVoice = {
  speak(text: string, options: RouteVoiceOptions) {
    if (!isRoleAllowed('DRIVER')) return;
    const item: ActiveSpeech = { generation: ++generation, onStopped: options.onStopped };
    if (active) release(active);
    active = item;
    if (options.language === 'ru') void speakWithSilero(text.slice(0, 2000), options, item);
    else speakWithSystem(text, options, item);
  },
  async stop() {
    const item = active;
    generation++;
    active = undefined;
    release(item);
    await Speech.stop().catch(() => undefined);
    item?.onStopped?.();
  },
  configuration: { url: TTS_URL, speaker: TTS_SPEAKER },
};
