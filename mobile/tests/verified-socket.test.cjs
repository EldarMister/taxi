const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const exportsUnderTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/verifiedSocket.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsUnderTest });
const { bindVerifiedSocket, completeOrderSnapshot } = exportsUnderTest;

test('transport connect cannot accept protected events before server session verification', () => {
  const socket = new EventEmitter(), received = [], changes = [];
  const session = bindVerifiedSocket(socket, 'driver-a', { onReady: () => changes.push('sync'), onUnavailable: () => changes.push('unavailable'), onDisconnected: () => changes.push('disconnected') });
  session.on('order:updated', event => received.push(event.id));
  socket.emit('connect'); socket.emit('order:updated', { id: 'premature' });
  socket.emit('session:ready', { userId: 'driver-b' }); socket.emit('order:updated', { id: 'wrong-account' });
  assert.deepEqual(received, []);
  socket.emit('session:ready', { userId: 'driver-a' }); socket.emit('order:updated', { id: 'checked' });
  assert.deepEqual(received, ['checked']);
  assert.equal(changes.filter(value => value === 'sync').length, 1);
  session.dispose();
});

test('database outage blocks incoming data, preserves the session and resynchronizes on recovery/reconnect', () => {
  const socket = new EventEmitter(), seen = [], tokens = { accessToken: 'active', refreshToken: 'retained' };
  let resyncs = 0, disconnected = 0, outages = 0;
  const session = bindVerifiedSocket(socket, 'driver-a', { onReady: () => { resyncs++; }, onUnavailable: () => { outages++; }, onDisconnected: () => { disconnected++; } });
  for (const name of ['order:updated', 'order:offer', 'driver:location', 'food:order:updated', 'chat:message']) session.on(name, () => seen.push(name));
  socket.emit('session:ready', { userId: 'driver-a' });
  socket.emit('session:unavailable', { statusCode: 503 });
  for (const name of ['order:updated', 'order:offer', 'driver:location', 'food:order:updated', 'chat:message']) socket.emit(name, {});
  assert.deepEqual(seen, []);
  assert.equal(tokens.refreshToken, 'retained');
  assert.equal(outages, 1);
  socket.emit('session:ready', { userId: 'driver-a', resyncRequired: true });
  socket.emit('food:order:updated', {});
  assert.deepEqual(seen, ['food:order:updated']);
  socket.emit('disconnect'); socket.emit('connect'); socket.emit('order:updated', {});
  assert.deepEqual(seen, ['food:order:updated']);
  socket.emit('session:ready', { userId: 'driver-a' });
  assert.equal(resyncs, 3, 'canonical taxi and food reads are requested on initial readiness, recovery and reconnect');
  assert.equal(disconnected, 2);
  session.dispose(); socket.emit('session:ready', { userId: 'driver-a' });
  assert.equal(resyncs, 3);
});

test('assignment-removal notifications cannot be mistaken for complete order snapshots', () => {
  assert.equal(completeOrderSnapshot({ id: 'order', status: 'SEARCHING', driver: null }), false);
  assert.equal(completeOrderSnapshot(null), false);
  assert.equal(completeOrderSnapshot({ id: 'order', status: 'SEARCHING', pickup: {}, dropoff: {}, price: 200, distanceMeters: 1000, durationSeconds: 300, geometry: [], createdAt: '2026-10-12T00:00:00Z' }), true);
});
