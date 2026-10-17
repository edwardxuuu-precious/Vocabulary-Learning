import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ParentGate } from '../server/parent-gate.ts';
import { createApp } from '../server/index.ts';

function fixture() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'word-parent-pin-'));
  return { dataDir, cleanup() { assert.ok(dataDir.startsWith(path.join(os.tmpdir(), 'word-parent-pin-'))); rmSync(dataDir, { recursive: true, force: true }); } };
}

test('PIN has no default, persists a salted hash, and changes only with the current PIN', () => {
  const f = fixture();
  try {
    const gate = new ParentGate(f.dataDir);
    assert.deepEqual(gate.status(), { configured: false, retryAfterSeconds: 0 });
    assert.throws(() => gate.unlock('2468'), /先由家长设置/);
    for (const pin of ['2468', '12345a', 123456, '1234567']) assert.throws(() => gate.setup(pin), /6 位/);
    assert.equal(gate.setup('097531').configured, true);
    const record = readFileSync(path.join(f.dataDir, 'parent-pin.json'), 'utf8');
    assert.ok(!record.includes('097531'));
    const reopened = new ParentGate(f.dataDir);
    assert.equal(reopened.unlock('097531').configured, true);
    assert.throws(() => reopened.setup('111111'), /已经设置/);
    assert.throws(() => reopened.unlock('2468'), /不正确/);
    assert.throws(() => reopened.change('000000', '082642'), /不正确/);
    reopened.change('097531', '082642');
    assert.throws(() => reopened.unlock('097531'), /不正确/);
    reopened.unlock('082642');
    const second = fixture();
    try { new ParentGate(second.dataDir).setup('082642'); assert.notEqual(readFileSync(path.join(second.dataDir, 'parent-pin.json'), 'utf8'), readFileSync(path.join(f.dataDir, 'parent-pin.json'), 'utf8')); }
    finally { second.cleanup(); }
  } finally { f.cleanup(); }
});

test('five incorrect attempts block even the correct PIN for 30 seconds; successful unlock clears failures', () => {
  const f = fixture(); let now = 0;
  try {
    const gate = new ParentGate(f.dataDir, () => now); gate.setup('097531');
    for (let i = 0; i < 4; i++) assert.throws(() => gate.unlock('000000'), /不正确/);
    gate.unlock('097531');
    for (let i = 0; i < 4; i++) assert.throws(() => gate.unlock('000000'), /不正确/);
    assert.throws(() => gate.unlock('000000'), /30 秒/);
    assert.equal(gate.status().retryAfterSeconds, 30);
    assert.throws(() => gate.unlock('097531'), /次数过多/);
    assert.throws(() => gate.change('097531', '082642'), /次数过多/);
    assert.throws(() => gate.setup('082642'), /已经设置/);
    now = 29_001; assert.equal(gate.status().retryAfterSeconds, 1);
    now = 30_000; gate.unlock('097531'); assert.equal(gate.status().retryAfterSeconds, 0);
  } finally { f.cleanup(); }
});

test('a corrupt PIN file fails closed instead of allowing a new setup', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.dataDir, 'parent-pin.json'), '{}');
    const gate = new ParentGate(f.dataDir);
    assert.throws(() => gate.status(), /无法读取/);
    assert.throws(() => gate.setup('097531'), /无法读取/);
  } finally { f.cleanup(); }
});

test('HTTP gate rejects replacement and cross-origin requests; state, media and backups never expose the PIN', async () => {
  const f = fixture();
  const unavailable = { configured: false, available: false, status: 'test_disabled', detail: '隔离测试不上云' };
  const app = createApp({ dataDir: f.dataDir, dialogue: { status: async () => unavailable, turn: async () => { throw Error('unused'); }, cancel() {}, reset: async () => {}, close: async () => {} }, integrations: { probeIntegrations: async () => ({ speech: unavailable, codex: unavailable }), ttsStatus: () => unavailable, getCachedSpeech: async () => undefined } });
  try {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const call = (route: string, method = 'GET', body?: unknown, headers = {}) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.deepEqual(await (await call('/api/parent-gate')).json(), { configured: false, retryAfterSeconds: 0 });
    assert.equal((await call('/api/parent-gate', 'POST', { pin: '097531' }, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call('/api/parent-gate', 'POST', { pin: '097531' })).status, 200);
    const before = app.store.read();
    assert.equal((await call('/api/parent-gate', 'POST', { pin: '000000' })).status, 409);
    assert.equal((await call('/api/parent-gate/unlock', 'POST', { pin: '000000' })).status, 403);
    assert.equal((await call('/api/parent-gate/unlock', 'POST', { pin: '097531' })).status, 200);
    assert.equal((await call('/api/parent-gate/pin', 'PATCH', { currentPin: '000000', pin: '082642' })).status, 403);
    assert.equal((await call('/api/parent-gate/pin', 'PATCH', { currentPin: '097531', pin: '082642' })).status, 200);
    const hash = JSON.parse(readFileSync(path.join(f.dataDir, 'parent-pin.json'), 'utf8')).hash;
    for (const route of ['/api/state', '/api/backup', '/api/parent-gate']) {
      const response = await call(route); assert.equal(response.headers.get('cache-control'), 'no-store');
      const text = await response.text();
      for (const secret of ['097531', '082642', hash, 'parent-pin.json']) assert.ok(!text.includes(secret));
    }
    assert.equal((await call('/media/parent-pin.json')).status, 404);
    const backup = await (await call('/api/backup')).json();
    assert.equal((await call('/api/restore', 'POST', backup)).status, 200);
    assert.equal((await call('/api/parent-gate/unlock', 'POST', { pin: '082642' })).status, 200);
    assert.deepEqual(app.store.read().words, before.words);
    for (let i = 0; i < 5; i++) assert.equal((await call('/api/parent-gate/unlock', 'POST', { pin: '000000' })).status, i === 4 ? 429 : 403);
    assert.equal((await call('/api/parent-gate/unlock', 'POST', { pin: '082642' })).status, 429);
  } finally { await app.close(); f.cleanup(); }
});
