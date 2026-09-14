import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { DriverSound, DriverSoundEvents } from '../driverSoundEvents';

const sources = {
  'new-order': require('../../assets/sounds/driver_new_order.wav'),
  'passenger-message': require('../../assets/sounds/driver_passenger_message.wav'),
  'trip-completed': require('../../assets/sounds/driver_trip_completed.wav'),
};
type Pending = { kind: DriverSound; key: string; expiresAt?: number };
let queue: Pending[] = [];
let current: Pending | undefined;
let player: AudioPlayer | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let modeReady: Promise<void> | undefined;

function release() {
  generation++;
  if (timer) clearTimeout(timer);
  timer = undefined;
  const old = player; player = undefined; current = undefined;
  if (old) { try { old.pause(); old.remove(); } catch { /* Already released by the native lifecycle. */ } }
}
function next() {
  if (current) return;
  const item = queue.shift();
  if (!item) return;
  if (item.expiresAt && item.expiresAt <= Date.now()) { next(); return; }
  current = item;
  const run = ++generation;
  const finish = () => { if (generation === run) { release(); next(); } };
  // A broken audio load must never leave the queue or an alert running indefinitely.
  timer = setTimeout(finish, Math.min(item.kind === 'new-order' ? 60000 : 8000, item.expiresAt ? Math.max(0, item.expiresAt - Date.now()) : Infinity));
  modeReady ??= setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false, interruptionMode: 'duckOthers' }).catch(error => { modeReady = undefined; throw error; });
  void modeReady.then(() => {
    if (generation !== run) return;
    player = createAudioPlayer(sources[item.kind], { updateInterval: 100 });
    player.volume = 1;
    player.loop = item.kind === 'new-order';
    player.addListener('playbackStatusUpdate', status => { if (status.didJustFinish && item.kind !== 'new-order') finish(); });
    player.play();
  }).catch(finish);
}
export const driverSounds = new DriverSoundEvents({
  play(kind, key, expiresAt) {
    // A burst of offers/messages gets one alert, not a backlog of repeated phrases.
    if (kind !== 'trip-completed' && (current?.kind === kind || queue.some(item => item.kind === kind))) return;
    queue.push({ kind, key, expiresAt }); next();
  },
  cancel(key) {
    queue = queue.filter(item => item.key !== key);
    if (current?.key === key) { release(); next(); }
  },
  stop() { queue = []; release(); },
});
