const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup(options = {}) {
  const files = new Map(), requests = [], players = [], system = [];
  class MockFile {
    constructor(...parts) { this.uri = `file:///cache/${parts.at(-1)}`; }
    get exists() { return files.has(this.uri); }
    info() { return { size: files.get(this.uri)?.byteLength || 0 }; }
    write(bytes) { files.set(this.uri, bytes); }
  }
  const dependencies = {
    'expo-file-system': { File: MockFile, Paths: { cache: 'file:///cache' } },
    'expo-audio': {
      setAudioModeAsync: async mode => { assert.equal(mode.shouldPlayInBackground, true); },
      createAudioPlayer: uri => {
        const player = { uri, volume: 0, played: false, removed: false, listener: undefined,
          addListener: (_event, listener) => { player.listener = listener; },
          play: () => { if (options.playbackFail) throw new Error('Playback failed'); player.played = true; }, pause: () => {}, remove: () => { player.removed = true; } };
        players.push(player); return player;
      },
    },
    'expo-speech': {
      speak: (text, config) => { system.push({ text, config }); config.onStart?.(); },
      stop: async () => {},
    },
    'react-native': { Platform: { OS: 'android' } },
    '../appVariant': { isRoleAllowed: role => options.variant !== 'client' && role === 'DRIVER' },
    '../types': {},
  };
  const source = fs.readFileSync(require.resolve('../src/native/routeVoice.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => dependencies[id], process: { env: {} }, AbortController,
    Uint8Array, Math, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      if (options.fail) return { ok: false, status: 503, headers: { get: () => 'application/json' } };
      return { ok: true, status: 200, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => new Uint8Array(100).buffer };
    } });
  return { voice: exports.routeVoice, normalize: exports.sileroNavigationText, requests, players, system, wait: () => new Promise(resolve => setTimeout(resolve, 0)) };
}

test('Silero receives the complete distance in words and bypasses old cached audio', async () => {
  const app = setup();
  app.voice.speak('Через 440 метров поверните налево на улицу Лермонтова.', { language: 'ru' });
  await app.wait(); await app.wait();
  assert.equal(app.requests[0].body.text, 'Через четыреста сорок метров поверните налево на улицу Лермонтова.');
  assert.match(app.players[0].uri, /atlas-route-v2-/);
  app.players[0].listener({ didJustFinish: true });
  app.voice.speak('Через четыреста сорок метров поверните налево на улицу Лермонтова.', { language: 'ru' });
  await app.wait(); await app.wait();
  assert.equal(app.requests.length, 1, 'the normalized phrase uses the same valid cache entry');
  await app.voice.stop();
});

test('distance verbalization covers navigation thresholds without changing street names', () => {
  const app = setup();
  for (const [value, words] of [[50, 'пятьдесят'], [80, 'восемьдесят'], [100, 'сто'], [110, 'сто десять'],
    [200, 'двести'], [350, 'триста пятьдесят'], [440, 'четыреста сорок'], [500, 'пятьсот'], [550, 'пятьсот пятьдесят']]) {
    assert.equal(app.normalize(`Через ${value} метров поверните на улицу 8 Марта.`), `Через ${words} метров поверните на улицу 8 Марта.`);
  }
  assert.equal(app.normalize('Поверните налево на улицу 8 Марта.'), 'Поверните налево на улицу 8 Марта.');
  assert.equal(app.normalize('440 метрден кийин солго бурулуңуз.'), '440 метрден кийин солго бурулуңуз.');
});

test('TTS outage reports an error without switching the driver to the phone synthesizer', async () => {
  const app = setup({ fail: true });
  const text = 'Через 440 метров поверните налево на улицу Лермонтова.';
  let reportedError;
  app.voice.speak(text, { language: 'ru', onError: error => { reportedError = error; } });
  await app.wait(); await app.wait();
  assert.equal(app.requests[0].body.text, 'Через четыреста сорок метров поверните налево на улицу Лермонтова.');
  assert.match(reportedError.message, /503/);
  assert.equal(app.system.length, 0);
  await app.voice.stop();
});

test('Russian route prompts use the hosted Silero xenia voice and cache the WAV', async () => {
  const app = setup();
  let starts = 0, done = 0;
  app.voice.speak('Через сто метров поверните направо', { language: 'ru', onStart: () => starts++, onDone: () => done++ });
  await app.wait(); await app.wait();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, 'https://tts-production-9005d.up.railway.app/synthesize');
  assert.equal(app.requests[0].body.speaker, 'xenia');
  assert.equal(app.requests[0].body.sample_rate, 48000);
  assert.equal(app.players.length, 1); assert.equal(app.players[0].played, true); assert.equal(starts, 1);
  app.players[0].listener({ didJustFinish: true });
  assert.equal(done, 1);

  app.voice.speak('Через сто метров поверните направо', { language: 'ru' });
  await app.wait(); await app.wait();
  assert.equal(app.requests.length, 1, 'the same generated phrase is reused from cache');
  assert.equal(app.players.length, 2);
});

test('TTS playback failure never invokes the phone synthesizer', async () => {
  const app = setup({ playbackFail: true });
  let reportedError;
  app.voice.speak('Поверните налево', { language: 'ru', onError: error => { reportedError = error; } });
  await app.wait(); await app.wait();
  assert.match(reportedError.message, /Playback failed/);
  assert.equal(app.system.length, 0);
  assert.equal(app.players[0].removed, true);
});

test('Kyrgyz driver guidance still uses the Kyrgyz phone voice', async () => {
  const app = setup();
  app.voice.speak('Солго бурулуңуз', { language: 'ky', systemVoice: 'ky-offline' });
  assert.equal(app.requests.length, 0);
  assert.equal(app.system.length, 1);
  assert.equal(app.system[0].config.language, 'ky-KG');
  await app.voice.stop();
});

test('client app cannot start either hosted TTS or the phone synthesizer', async () => {
  const app = setup({ variant: 'client' });
  app.voice.speak('Через 440 метров поверните налево', { language: 'ru' });
  app.voice.speak('Солго бурулуңуз', { language: 'ky' });
  await app.wait();
  assert.equal(app.requests.length, 0);
  assert.equal(app.players.length, 0);
  assert.equal(app.system.length, 0);
});
