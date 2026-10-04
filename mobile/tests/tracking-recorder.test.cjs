const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/native/trackingRecorder.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-recorder-test-'));
  t.after(() => { assert.ok(path.basename(root).startsWith('atlas-recorder-test-')); fs.rmSync(root, { recursive: true }); });
  let failWrites = false;
  const exported = [], shared = [];
  class File {
    constructor(...parts) { this.uri = path.join(...parts); }
    get name() { return path.basename(this.uri); }
    get exists() { return fs.existsSync(this.uri); }
    get size() { return fs.statSync(this.uri).size; }
    create() { fs.writeFileSync(this.uri, '', { flag: 'wx' }); }
    write(text) { if (failWrites) throw Error('disk full'); fs.writeFileSync(this.uri, text); }
    textSync() { return fs.readFileSync(this.uri, 'utf8'); }
    async text() { return this.textSync(); }
    open() {
      const fd = fs.openSync(this.uri, 'r+');
      return { offset: 0, size: this.size, close: () => fs.closeSync(fd),
        writeBytes(bytes) { if (failWrites) throw Error('disk full'); fs.writeSync(fd, bytes, 0, bytes.length, this.offset); } };
    }
  }
  class Directory {
    constructor(uri) { this.uri = uri; }
    list() { return fs.readdirSync(this.uri).map(name => new File(this.uri, name)); }
  }
  function load() {
    const exports = {};
    vm.runInNewContext(code, { exports, Date, TextEncoder: options.noEncoder ? undefined : TextEncoder, process: { env: { EXPO_PUBLIC_TRACKING_DIAGNOSTICS: options.disabled ? undefined : '1' } },
      require: id => {
        if (id === 'expo-file-system') return { File, Directory, Paths: { document: root } };
        if (id === 'expo-constants') return { __esModule: true, default: { nativeAppVersion: '1.1.64' } };
        if (id === 'react-native') return { Platform: { OS: options.ios ? 'ios' : 'android', Version: 36 }, Share: { share: async value => shared.push(value) } };
        if (id === 'expo-file-system/legacy') return {
          StorageAccessFramework: { requestDirectoryPermissionsAsync: async () => ({ granted: !options.cancel, directoryUri: root }),
            createFileAsync: async (_dir, name, mime) => { const uri = path.join(root, `export-${name}`); exported.push({ uri, mime }); return uri; } },
          writeAsStringAsync: async (uri, text) => { if (options.exportFailure) throw Error('folder denied'); fs.writeFileSync(uri, text); },
        };
        throw Error(id);
      } });
    return exports;
  }
  const records = module => fs.readFileSync(path.join(root, module.getTrackingRecording().fileName), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { root, load, records, exported, shared, failWrites: () => { failWrites = true; } };
}

test('a long drive is durable, resumes after process restart and exports the whole journal', async t => {
  const h = fixture(t);
  let recorder = h.load();
  assert.equal(recorder.startTrackingRecording(), true);
  for (let i = 0; i < 1505; i++) recorder.recordTrackingEvent('gps', { raw: { latitude: 41, longitude: 72, timestamp: i, speed: 0 },
    processed: i === 20 ? null : { heading: null }, dropReason: i === 20 ? 'accuracy' : null });
  recorder.recordTrackingEvent('upload', { stage: 'failed', status: 0 });
  recorder = h.load();
  assert.equal(recorder.getTrackingRecording().recording, true);
  assert.equal(recorder.getTrackingRecording().points, 1505, 'the replay memory limit never truncates the saved drive');
  recorder.recordTrackingEvent('navigation', { gpsStatus: 'Местоположение обновляется' });
  recorder.stopTrackingRecording();
  const before = h.records(recorder);
  assert.equal(before[0].data.appVersion, '1.1.64');
  assert.equal(before[21].data.processed, null, 'rejected raw measurements remain available for diagnosis');
  assert.equal(before.at(-1).type, 'stop');
  const uri = await recorder.exportTrackingRecording();
  assert.deepEqual(fs.readFileSync(uri, 'utf8'), fs.readFileSync(path.join(h.root, recorder.getTrackingRecording().fileName), 'utf8'));
  recorder = h.load();
  assert.equal(recorder.getTrackingRecording().recording, false);
  assert.equal(recorder.getTrackingRecording().points, 1505);
});

test('an interrupted pointer and partial last event do not lose the existing drive', async t => {
  const h = fixture(t);
  let recorder = h.load();
  recorder.startTrackingRecording();
  recorder.recordTrackingEvent('gps', { raw: { timestamp: 1 } });
  const name = recorder.getTrackingRecording().fileName;
  fs.writeFileSync(path.join(h.root, 'atlas-tracking-latest.json'), '{');
  fs.appendFileSync(path.join(h.root, name), '{"type":"gps"');
  recorder = h.load();
  assert.equal(recorder.getTrackingRecording().points, 1);
  recorder.recordTrackingEvent('gps', { raw: { timestamp: 2 } });
  recorder.stopTrackingRecording();
  recorder = h.load();
  assert.equal(recorder.getTrackingRecording().points, 2);
  assert.equal(recorder.getTrackingRecording().recording, false);
  const uri = await recorder.exportTrackingRecording();
  const events = fs.readFileSync(uri, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.type === 'gps').length, 2, 'the exported file contains only complete JSON lines');
});

test('cancelled or failed export retains the drive for another attempt', async t => {
  for (const options of [{ cancel: true }, { exportFailure: true }]) {
    const h = fixture(t, options), recorder = h.load();
    recorder.startTrackingRecording();
    recorder.recordTrackingEvent('gps', { raw: { timestamp: 1 } });
    await assert.rejects(recorder.exportTrackingRecording(), /остановите/);
    recorder.stopTrackingRecording();
    const before = h.records(recorder);
    if (options.cancel) assert.equal(await recorder.exportTrackingRecording(), null);
    else await assert.rejects(recorder.exportTrackingRecording(), /folder denied/);
    assert.deepEqual(h.records(recorder), before);
    assert.equal(h.load().getTrackingRecording().points, 1);
  }
});

test('storage failure cannot throw into the live GPS path and previously saved points remain', t => {
  const h = fixture(t), recorder = h.load();
  recorder.startTrackingRecording();
  recorder.recordTrackingEvent('gps', { raw: { timestamp: 1 } });
  h.failWrites();
  assert.doesNotThrow(() => recorder.recordTrackingEvent('gps', { raw: { timestamp: 2 } }));
  assert.equal(recorder.getTrackingRecording().recording, false);
  assert.match(recorder.getTrackingRecording().error, /хранения/);
  assert.equal(h.records(recorder).filter(event => event.type === 'gps').length, 1);
});

test('recording stays disabled in ordinary releases and iOS shares a stopped local file', async t => {
  const disabled = fixture(t, { disabled: true }), off = disabled.load();
  assert.equal(off.startTrackingRecording(), false);
  off.recordTrackingEvent('gps', {});
  assert.equal(fs.readdirSync(disabled.root).length, 0);
  const h = fixture(t, { ios: true }), recorder = h.load();
  recorder.startTrackingRecording();
  recorder.stopTrackingRecording();
  const uri = await recorder.exportTrackingRecording();
  assert.equal(h.shared[0].url, uri);
});

test('Cyrillic and emoji survive UTF-8 encoding even without a global TextEncoder', async t => {
  const h = fixture(t, { noEncoder: true }), recorder = h.load();
  recorder.startTrackingRecording();
  const instruction = 'Через 100 метров поверните направо 🚗';
  recorder.recordTrackingEvent('navigation', { instruction });
  recorder.stopTrackingRecording();
  assert.equal(h.records(recorder)[1].data.instruction, instruction);
  const uri = await recorder.exportTrackingRecording();
  assert.equal(JSON.parse(fs.readFileSync(uri, 'utf8').split('\n')[1]).data.instruction, instruction);
});
