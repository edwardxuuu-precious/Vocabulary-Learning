import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElevenLabsProvider } from '../server/integrations/elevenlabs.ts';

const env = { ELEVENLABS_API_KEY: 'server-only-eleven-secret', ELEVENLABS_VOICE_ID_ZH: 'mandarinVoice', ELEVENLABS_VOICE_ID_EN: 'englishVoice' };
const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]);
const fetcher = (callback: (url: string, init: RequestInit) => Promise<Response>) => callback as typeof fetch;
function response() { return new Response(new ReadableStream({ start(controller) { controller.enqueue(audio.subarray(0, 20)); controller.enqueue(audio.subarray(20)); controller.close(); } }), { headers: { 'content-type': 'audio/mpeg' } }); }

test('ElevenLabs uses Text-to-Dialogue HTTP streaming, tone tags, server key and finite stable cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-')); let requests = 0; const payloads: any[] = [];
  const provider = createElevenLabsProvider({ env, fetch: fetcher(async (url, init) => {
    requests++; assert.match(url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-dialogue\/stream\?/);
    assert.equal(new Headers(init.headers).get('xi-api-key'), env.ELEVENLABS_API_KEY);
    payloads.push(JSON.parse(init.body as string)); return response();
  }) });
  try {
    const input = { text: '我们找到恐龙啦！', locale: 'zh-CN' as const, tone: 'excited' as const, dataDir: directory };
    const values = await Promise.all([provider.synthesizeSpeech(input), provider.synthesizeSpeech(input)]);
    assert.equal(requests, 1); assert.equal(values.filter(value => value.cached).length, 1);
    assert.equal(payloads[0].model_id, 'eleven_v4_turbo'); assert.equal(payloads[0].inputs[0].voice_id, 'mandarinVoice');
    assert.equal(payloads[0].inputs[0].text, '[excited] 我们找到恐龙啦！');
    assert.ok(values[0].costCny <= provider.estimateTtsCost(input.text));
    assert.deepEqual(await readFile(values[0].filePath!), audio);
    await provider.synthesizeSpeech({ ...input, tone: 'gentle' }); assert.equal(requests, 2, 'emotion must participate in cache');
    assert.equal(provider.status().provider, 'elevenlabs'); assert.equal(provider.status().available, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('English word demonstration retains literal spelling and has no emotional tags', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-')); let payload: any;
  const provider = createElevenLabsProvider({ env, fetch: fetcher(async (_url, init) => { payload = JSON.parse(init.body as string); return response(); }) });
  try {
    await provider.synthesizeSpeech({ text: 'Apple', locale: 'en-US', tone: 'excited', dataDir: directory });
    assert.equal(payload.inputs[0].text, 'Apple'); assert.equal(payload.inputs[0].voice_id, 'englishVoice');
    assert.equal(payload.settings.stability, 1); assert.equal(payload.apply_text_normalization, 'off'); assert.equal(payload.language_code, 'en');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing key or voice returns explicit local mode, while provider failures throw safe errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-')); let calls = 0;
  try {
    const missing = createElevenLabsProvider({ env: {}, fetch: fetcher(async () => { calls++; return response(); }) });
    const result = await missing.synthesizeSpeech({ text: '你好', locale: 'zh-CN', dataDir: directory });
    assert.equal(result.mode, 'local'); assert.equal(result.costCny, 0); assert.match(result.message!, /不是 ElevenLabs/); assert.equal(calls, 0);
    const failed = createElevenLabsProvider({ env, fetch: fetcher(async () => new Response(env.ELEVENLABS_API_KEY, { status: 401 })) });
    await assert.rejects(failed.synthesizeSpeech({ text: '你好', locale: 'zh-CN', dataDir: directory }), (error: any) => { assert.equal(error.code, 'SPEECH_AUTH'); assert.ok(!error.message.includes(env.ELEVENLABS_API_KEY)); return true; });
    assert.equal(failed.status().available, false); assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('stream size and stalled-body timeout cannot cache incomplete audio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-'));
  try {
    const oversized = createElevenLabsProvider({ env, maxAudioBytes: 64, fetch: fetcher(async () => response()) });
    await assert.rejects(oversized.synthesizeSpeech({ text: '大图片', locale: 'zh-CN', dataDir: directory }), { code: 'SPEECH_OUTPUT_LIMIT' });
    const stalled = createElevenLabsProvider({ env, timeoutMs: 10, fetch: fetcher(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(audio.subarray(0, 20)); } }))) });
    await assert.rejects(stalled.synthesizeSpeech({ text: '慢慢来', locale: 'zh-CN', dataDir: directory }), { code: 'SPEECH_TIMEOUT' });
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('caller cancellation aborts streaming without caching or pretending cloud success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-')); const controller = new AbortController();
  const provider = createElevenLabsProvider({ env, fetch: fetcher(async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(audio.subarray(0, 20)); } }))) });
  try {
    const operation = provider.synthesizeSpeech({ text: '你好', locale: 'zh-CN', dataDir: directory, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(operation, { code: 'CANCELLED' }); assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cache can work offline and bounded pruning retains the just-generated file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-'));
  const provider = createElevenLabsProvider({ env, maxCacheFiles: 1, fetch: fetcher(async () => response()) });
  try {
    await provider.synthesizeSpeech({ text: '第一句', locale: 'zh-CN', dataDir: directory });
    const second = await provider.synthesizeSpeech({ text: '第二句', locale: 'zh-CN', dataDir: directory });
    assert.deepEqual(await readFile(second.filePath!), audio);
    assert.equal((await readdir(join(directory, 'speech', 'elevenlabs'))).length, 1);
    const offline = createElevenLabsProvider({ env: { ...env, ELEVENLABS_API_KEY: '' } });
    const cached = await offline.synthesizeSpeech({ text: '第二句', locale: 'zh-CN', dataDir: directory });
    assert.equal(cached.cached, true); assert.equal(cached.costCny, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cancelling while cache lookup is pending cannot return playable cached audio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-')); let requests = 0;
  const provider = createElevenLabsProvider({ env, fetch: fetcher(async () => { requests++; return response(); }) });
  const input = { text: '缓存里的声音', locale: 'zh-CN' as const, dataDir: directory };
  try {
    const cached = await provider.synthesizeSpeech(input); const controller = new AbortController();
    const operation = provider.synthesizeSpeech({ ...input, signal: controller.signal }); controller.abort();
    await assert.rejects(operation, { code: 'CANCELLED' }); assert.equal(requests, 1);
    assert.deepEqual(await readFile(cached.filePath!), audio);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('a cancelled concurrent cache waiter rejects promptly without cancelling the original paid request or returning its late result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-')); let release!: () => void, started!: () => void, requests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; }), fetching = new Promise<void>(resolve => { started = resolve; });
  const provider = createElevenLabsProvider({ env, fetch: fetcher(async () => { requests++; started(); await pending; return response(); }) });
  const input = { text: '同一句并发朗读', locale: 'zh-CN' as const, dataDir: directory };
  try {
    const original = provider.synthesizeSpeech(input); await fetching;
    const controller = new AbortController(), duplicate = provider.synthesizeSpeech({ ...input, signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 10)); controller.abort();
    await assert.rejects(duplicate, { code: 'CANCELLED' });
    release(); const result = await original;
    assert.equal(requests, 1); assert.equal(result.cached, false); assert.deepEqual(await readFile(result.filePath!), audio);
  } finally { release(); await rm(directory, { recursive: true, force: true }); }
});
test('a changed key or model does not inherit a previous provider failure or verification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-')), settings: NodeJS.ProcessEnv = { ...env };
  let unauthorized = true;
  const provider = createElevenLabsProvider({ env: settings, fetch: fetcher(async () => unauthorized ? new Response('private authentication details', { status: 401 }) : response()) });
  try {
    const input = { text: '试音', locale: 'zh-CN' as const, dataDir: directory };
    await assert.rejects(provider.synthesizeSpeech(input), { code: 'SPEECH_AUTH' }); assert.equal(provider.status().status, 'error');
    settings.ELEVENLABS_API_KEY = 'new-unverified-key'; assert.equal(provider.status().status, 'unverified'); assert.equal(provider.status().available, false);
    unauthorized = false; await provider.synthesizeSpeech(input); assert.equal(provider.status().status, 'verified');
    settings.ELEVENLABS_TTS_MODEL = 'eleven_v4'; assert.equal(provider.status().status, 'unverified'); assert.equal(provider.status().available, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('the request timeout also aborts waiting for HTTP headers and never marks the provider verified', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-eleven-'));
  const provider = createElevenLabsProvider({ env, timeoutMs: 10, fetch: fetcher(async (_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  })) });
  try {
    await assert.rejects(provider.synthesizeSpeech({ text: '等待响应头', locale: 'zh-CN', dataDir: directory }), { code: 'SPEECH_TIMEOUT' });
    assert.equal(provider.status().available, false); assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
