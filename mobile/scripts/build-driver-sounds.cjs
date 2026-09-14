// Preserve the supplied voice recordings; compose short, offline notification WAVs.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../assets/sounds');
const rate = 48000;
function voice(name) {
  const wav = fs.readFileSync(path.join(root, 'voice', name + '.wav'));
  let data;
  for (let p = 12; p + 8 <= wav.length;) {
    const tag = wav.toString('ascii', p, p + 4), size = wav.readUInt32LE(p + 4);
    if (tag === 'fmt ' && (wav.readUInt16LE(p + 8) !== 1 || wav.readUInt16LE(p + 10) !== 1 || wav.readUInt32LE(p + 12) !== rate || wav.readUInt16LE(p + 22) !== 16)) throw new Error('Expected mono 48 kHz PCM16 voice: ' + name);
    if (tag === 'data') data = wav.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  if (!data) throw new Error('Missing WAV data: ' + name);
  return Float64Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768);
}
function bell(samples, start, frequency, duration = .22) {
  for (let i = 0; i < duration * rate; i++) {
    const t = i / rate, envelope = Math.min(1, t / .008) * Math.exp(-t * 15) * Math.min(1, (duration - t) / .025);
    const at = Math.round(start * rate) + i;
    if (at < samples.length) samples[at] += .25 * envelope * (Math.sin(2 * Math.PI * frequency * t) + .18 * Math.sin(4 * Math.PI * frequency * t));
  }
}
function make(name, duration, speech, speechStart, notes, lively = false) {
  const samples = new Float64Array(Math.ceil(duration * rate));
  notes.forEach(([time, frequency]) => {
    if (!lively) { bell(samples, time, frequency); return; }
    const duration = .19;
    for (let i = 0; i < duration * rate; i++) {
      const t = i / rate, envelope = Math.min(1, t / .006) * Math.min(1, (duration - t) / .06);
      const at = Math.round(time * rate) + i;
      if (at < samples.length) samples[at] += .46 * envelope * (Math.sin(2 * Math.PI * frequency * t) + .24 * Math.sin(4 * Math.PI * frequency * t) + .1 * Math.sin(6 * Math.PI * frequency * t));
    }
  });
  const offset = Math.round(speechStart * rate);
  speech.forEach((value, i) => { if (offset + i < samples.length) samples[offset + i] += lively ? Math.tanh(value * 2.6) * .9 : value; });
  if (lively) {
    const peak = samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    const gain = peak ? .95 / peak : 1;
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  }
  const result = Buffer.alloc(44 + samples.length * 2);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(rate, 24); result.writeUInt32LE(rate * 2, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34);
  result.write('data', 36); result.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => result.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2));
  fs.writeFileSync(path.join(root, name + '.wav'), result);
  const raw = path.resolve(__dirname, '../android/app/src/main/res/raw');
  fs.mkdirSync(raw, { recursive: true }); fs.writeFileSync(path.join(raw, name + '.wav'), result);
  console.log(name + ': ' + duration.toFixed(2) + ' seconds');
}
const order = voice('new_order'), message = voice('passenger_message'), completed = voice('trip_completed');
const melody = [659.25, 783.99, 987.77, 783.99, 880, 987.77, 1174.66, 987.77];
const notes = [];
for (const start of [0, 3.1, 5.3, 7.5, 9.7]) melody.forEach((frequency, index) => notes.push([start + index * .2, frequency]));
make('driver_new_order', 12, order, 1.75, notes, true);
make('driver_passenger_message', .5 + message.length / rate + .12, message, .5, [[0, 880], [.16, 1100]]);
make('driver_trip_completed', .48 + completed.length / rate + .12, completed, .48, [[0, 660], [.16, 880]]);
