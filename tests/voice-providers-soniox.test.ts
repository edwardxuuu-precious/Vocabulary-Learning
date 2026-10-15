import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSonioxProvider, type SonioxOptions, type UpstreamSocket } from '../server/integrations/soniox.ts';
import type { VoiceServerMessage } from '../shared/contracts.ts';

class FakeSocket extends EventEmitter implements UpstreamSocket {
  readyState = 0; bufferedAmount = 0; sent: (string | Buffer)[] = [];
  open() { this.readyState = 1; this.emit('open'); }
  send(data: string | Buffer, callback?: (error?: Error) => void) { this.sent.push(data); callback?.(); }
  close() { if (this.readyState === 3) return; this.readyState = 3; queueMicrotask(() => this.emit('close', 1000)); }
  terminate() { this.close(); }
  message(data: unknown) { this.emit('message', JSON.stringify(data)); }
}
const secret = 'server-only-soniox-key';
function setup(extra: Partial<SonioxOptions> = {}) {
  const socket = new FakeSocket();
  const events: VoiceServerMessage[] = [];
  const usage: number[] = [];
  let handshake: any;
  const provider = createSonioxProvider({ env: { SONIOX_API_KEY: secret }, createWebSocket: (url, options) => { handshake = { url, options }; queueMicrotask(() => socket.open()); return socket; }, ...extra });
  return { socket, events, usage, provider, handshake: () => handshake };
}

test('Soniox authenticates only over server WS header and configures mixed Chinese/English conservative endpoints', async () => {
  const value = setup();
  const session = await value.provider.createSession({ locale: 'zh-CN', vocabulary: ['apple', '恐龙'], onEvent: event => value.events.push(event), onUsage: seconds => value.usage.push(seconds) });
  try {
    assert.equal(value.handshake().options.headers.Authorization, `Bearer ${secret}`);
    const config = JSON.parse(value.socket.sent[0] as string);
    assert.equal(config.api_key, undefined); assert.equal(config.model, 'stt-rt-v5');
    assert.equal(config.audio_format, 'pcm_s16le'); assert.equal(config.sample_rate, 16000); assert.equal(config.num_channels, 1);
    assert.deepEqual(config.language_hints, ['zh', 'en']); assert.equal(config.language_hints_strict, false);
    assert.equal(config.endpoint_sensitivity, -0.3); assert.equal(config.max_endpoint_delay_ms, 3000);
    assert.deepEqual(config.context.terms, ['apple', '恐龙']);
    assert.deepEqual(value.events[0], { type: 'ready' });
    assert.equal(value.provider.status().available, false, 'opening a socket does not verify ASR');
    session.sendAudio(Buffer.alloc(3200)); assert.ok(value.usage.at(-1)! >= 0.1);
    assert.ok(!JSON.stringify(value.events).includes(secret));
  } finally { session.cancel(); }
});

test('Soniox replaces partials, appends final tokens once and emits endpoint only for explicit boundary', async () => {
  const value = setup();
  const session = await value.provider.createSession({ locale: 'zh-CN', onEvent: event => value.events.push(event) });
  try {
    value.socket.message({ tokens: [{ text: '我喜', is_final: false }] });
    value.socket.message({ tokens: [{ text: '我喜欢', is_final: true }, { text: '恐', is_final: false }] });
    value.socket.message({ tokens: [{ text: '恐龙', is_final: true }] });
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'final tokens are not a whole utterance ending');
    assert.deepEqual(value.events.at(-1), { type: 'transcript', text: '我喜欢恐龙', final: true });
    value.socket.message({ tokens: [{ text: '<end>', is_final: true }] });
    assert.deepEqual(value.events.at(-1), { type: 'endpoint', text: '我喜欢恐龙' });
    value.socket.message({ tokens: [{ text: '和 apple', is_final: true }, { text: '<end>', is_final: true }] });
    assert.deepEqual(value.events.at(-1), { type: 'endpoint', text: '我喜欢恐龙和 apple' });
    assert.equal(value.socket.readyState, 1, 'semantic boundary does not close the transport by itself');
    assert.equal(value.provider.status().available, true);
  } finally { session.cancel(); }
});

test('manual finish sends 200ms silence, finalize control and empty text; clean finished event closes exactly once', async () => {
  const value = setup({ now: () => 1000 });
  const session = await value.provider.createSession({ locale: 'en-US', onEvent: event => value.events.push(event), onUsage: seconds => value.usage.push(seconds) });
  session.sendAudio(Buffer.alloc(32000)); session.finish();
  assert.equal((value.socket.sent.at(-3) as Buffer).length, 6400);
  assert.deepEqual(JSON.parse(value.socket.sent.at(-2) as string), { type: 'finalize' });
  assert.equal(value.socket.sent.at(-1), '');
  assert.equal(value.usage.at(-1), 1.2);
  value.socket.message({ tokens: [{ text: 'apple', is_final: true }, { text: '<fin>', is_final: true }], finished: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(value.events.filter(event => event.type === 'endpoint').length, 1);
  assert.equal(value.events.filter(event => event.type === 'closed').length, 1);
  assert.equal(value.events.filter(event => event.type === 'error').length, 0);
});

test('upstream auth error and disconnect never expose provider bodies or turn partial guesses into final answers', async () => {
  const value = setup();
  await value.provider.createSession({ locale: 'zh-CN', onEvent: event => value.events.push(event) });
  value.socket.message({ error_code: 401, error_type: 'unauthenticated', error_message: secret });
  assert.ok(value.events.some(event => event.type === 'error' && event.code === 'SPEECH_AUTH'));
  assert.ok(!JSON.stringify(value.events).includes(secret));
  const disconnected = setup();
  await disconnected.provider.createSession({ locale: 'zh-CN', onEvent: event => disconnected.events.push(event) });
  disconnected.socket.message({ tokens: [{ text: 'possible answer', is_final: false }] }); disconnected.socket.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(disconnected.events.some(event => event.type === 'error' && event.code === 'SPEECH_DISCONNECTED'));
  assert.equal(disconnected.events.filter(event => event.type === 'endpoint').length, 0);
});

test('cancellation ignores late upstream results and malformed frames fail safely', async () => {
  const value = setup();
  const session = await value.provider.createSession({ locale: 'zh-CN', onEvent: event => value.events.push(event) });
  session.cancel(); value.socket.message({ tokens: [{ text: 'late', is_final: true }], finished: true });
  assert.equal(value.events.filter(event => event.type === 'transcript').length, 0);
  assert.throws(() => session.sendAudio(Buffer.alloc(2)), { code: 'SPEECH_DISCONNECTED' });
  const malformed = setup(); await malformed.provider.createSession({ locale: 'zh-CN', onEvent: event => malformed.events.push(event) });
  malformed.socket.emit('message', 'null');
  assert.ok(malformed.events.some(event => event.type === 'error' && event.code === 'SPEECH_INVALID_RESPONSE'));
});

test('missing keys and invalid vocabulary do not open an upstream connection', async () => {
  let calls = 0;
  const provider = createSonioxProvider({ env: {}, createWebSocket: () => { calls++; return new FakeSocket(); } });
  await assert.rejects(provider.createSession({ locale: 'zh-CN', onEvent: () => {} }), { code: 'SPEECH_UNCONFIGURED' });
  await assert.rejects(provider.createSession({ locale: 'zh-CN', vocabulary: ['x'.repeat(81)], onEvent: () => {} }), { code: 'INVALID_VOCABULARY' });
  assert.equal(calls, 0);
});

test('connection and finalization timeouts close the owned socket and report recoverable errors', async () => {
  const socket = new FakeSocket(); const events: VoiceServerMessage[] = [];
  const provider = createSonioxProvider({ env: { SONIOX_API_KEY: secret }, connectTimeoutMs: 10, createWebSocket: () => socket });
  await assert.rejects(provider.createSession({ locale: 'zh-CN', onEvent: event => events.push(event) }), { code: 'SPEECH_TIMEOUT' });
  assert.equal(socket.readyState, 3); assert.ok(events.some(event => event.type === 'closed'));
  const value = setup({ finishTimeoutMs: 10 });
  const session = await value.provider.createSession({ locale: 'zh-CN', onEvent: event => value.events.push(event) });
  session.sendAudio(Buffer.alloc(3200)); session.finish();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(value.events.some(event => event.type === 'error' && event.code === 'SPEECH_TIMEOUT'));
  assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
  assert.equal(value.socket.readyState, 3);
});

test('abort before connect prevents an upstream call; abort during handshake immediately terminates and rejects CANCELLED', async () => {
  let connections = 0; const usage: number[] = [];
  const socket = new FakeSocket(); const events: VoiceServerMessage[] = [];
  const provider = createSonioxProvider({ env: { SONIOX_API_KEY: secret }, createWebSocket: () => { connections++; return socket; } });
  const before = new AbortController(); before.abort();
  await assert.rejects(provider.createSession({ locale: 'zh-CN', signal: before.signal, onUsage: seconds => usage.push(seconds), onEvent: event => events.push(event) }), { code: 'CANCELLED' });
  assert.equal(connections, 0);
  const during = new AbortController();
  const pending = provider.createSession({ locale: 'zh-CN', signal: during.signal, onUsage: seconds => usage.push(seconds), onEvent: event => events.push(event) });
  during.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(socket.readyState, 3);
  assert.deepEqual(usage, [0, 0], 'an unopened cancelled connection has known zero usage');
  socket.open(); socket.message({ tokens: [{ text: 'ignored', is_final: true }], finished: true });
  assert.equal(events.filter(event => event.type === 'closed').length, 1);
  assert.equal(events.filter(event => event.type === 'ready' || event.type === 'endpoint').length, 0);
});

test('abort after open synchronously reports cumulative usage before closed and ignores late provider text', async () => {
  let clock = 1000; const order: string[] = []; const controller = new AbortController();
  const value = setup({ now: () => clock });
  const session = await value.provider.createSession({ locale: 'zh-CN', signal: controller.signal, onUsage: seconds => order.push(`usage:${seconds}`), onEvent: event => { order.push(event.type); value.events.push(event); } });
  session.sendAudio(Buffer.alloc(3200)); clock = 1500; controller.abort();
  assert.ok(order.indexOf('usage:0.5') < order.indexOf('closed'));
  assert.equal(value.socket.readyState, 3);
  value.socket.message({ tokens: [{ text: 'late', is_final: true }], finished: true });
  assert.equal(value.events.filter(event => event.type === 'transcript').length, 0);
});
