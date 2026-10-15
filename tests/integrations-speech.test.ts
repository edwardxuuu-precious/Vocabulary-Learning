import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpeechProvider, estimateSttCost, estimateTtsCost, getCachedSpeech, validateWav } from '../server/integrations/speech.ts';

function wav(seconds = 1, sampleRate = 16_000): Buffer {
  const bytes = Math.floor(seconds * sampleRate) * 2;
  const audio = Buffer.alloc(44 + bytes);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(sampleRate, 24); audio.writeUInt32LE(sampleRate * 2, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(bytes, 40);
  return audio;
}
const credentials = { AZURE_SPEECH_KEY: 'test-secret-never-print', AZURE_SPEECH_REGION: 'eastus' };
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
const mockFetch = (implementation: (url: string, init: RequestInit) => Promise<Response>) => implementation as typeof fetch;

test('unconfigured speech never uploads audio or invents a transcript', async () => {
  let requests = 0;
  const provider = createSpeechProvider({ env: {}, fetch: mockFetch(async () => { requests++; throw Error('must not call'); }) });
  const directory = await mkdtemp(join(tmpdir(), 'word-speech-'));
  try {
    assert.equal(provider.status().configured, false);
    assert.deepEqual(await provider.transcribeSpeech({ audio: wav(), locale: 'zh-CN' }), {
      transcript: '', status: 'unavailable', costCny: 0, message: 'Azure 语音识别尚未配置，可以点击图片继续；没有上传录音。',
    });
    const result = await provider.synthesizeSpeech({ text: 'apple', locale: 'en-US', dataDir: directory });
    assert.equal(result.mode, 'local'); assert.equal(result.costCny, 0);
    assert.equal(requests, 0); assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('TTS escapes SSML, selects locale voice, caches across instances and charges one concurrent request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'word-speech-'));
  let requests = 0;
  const bodies: string[] = [];
  const provider = createSpeechProvider({ env: credentials, fetch: mockFetch(async (url, init) => {
    requests++;
    assert.match(String(url), /^https:\/\/eastus\.tts\.speech\.microsoft\.com\//);
    assert.equal(new Headers(init.headers).get('Ocp-Apim-Subscription-Key'), credentials.AZURE_SPEECH_KEY);
    bodies.push(String(init.body));
    await new Promise(resolve => setTimeout(resolve, 10));
    return new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } });
  }) });
  try {
    const input = { text: 'apple & <friend>', locale: 'en-US' as const, dataDir: directory };
    const results = await Promise.all([provider.synthesizeSpeech(input), provider.synthesizeSpeech(input)]);
    assert.equal(requests, 1);
    assert.equal(results.filter(x => x.cached).length, 1);
    assert.equal(results.reduce((sum, x) => sum + x.costCny, 0), estimateTtsCost(input.text));
    assert.match(bodies[0], /en-US-JennyNeural/); assert.match(bodies[0], /apple &amp; &lt;friend&gt;/);
    assert.match(bodies[0], /rate="-15%"/);
    const path = await getCachedSpeech(input); assert.ok(path);
    assert.deepEqual(await readFile(path), mp3);
    const offlineProvider = createSpeechProvider({ env: {} });
    assert.equal((await offlineProvider.synthesizeSpeech(input)).cached, true);
    await provider.synthesizeSpeech({ ...input, locale: 'zh-CN' });
    assert.equal(requests, 2); assert.match(bodies[1], /zh-CN-XiaoxiaoNeural/);
    await provider.synthesizeSpeech({ ...input, rate: 1 });
    assert.equal(requests, 3, 'rate must participate in the cache key');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('TTS invalid input cannot make a paid request; provider errors never echo secrets', async () => {
  let requests = 0;
  const provider = createSpeechProvider({ env: credentials, fetch: mockFetch(async () => {
    requests++; return new Response(credentials.AZURE_SPEECH_KEY, { status: 401 });
  }) });
  const input = { text: 'apple', locale: 'en-US' as const, dataDir: tmpdir() };
  await assert.rejects(provider.synthesizeSpeech({ ...input, text: '' }), { code: 'INVALID_TEXT' });
  await assert.rejects(provider.synthesizeSpeech({ ...input, text: 'x'.repeat(501) }), { code: 'INVALID_TEXT' });
  await assert.rejects(provider.synthesizeSpeech({ ...input, rate: NaN }), { code: 'INVALID_RATE' });
  await assert.rejects(provider.synthesizeSpeech({ ...input, locale: 'toString' as any }), { code: 'INVALID_LOCALE' });
  assert.equal(requests, 0);
  await assert.rejects(provider.synthesizeSpeech(input), (error: any) => {
    assert.equal(error.code, 'SPEECH_PROVIDER'); assert.ok(!error.message.includes(credentials.AZURE_SPEECH_KEY)); return true;
  });
});

test('STT preserves real text, reports silence as unclear and never writes recordings', async () => {
  let count = 0;
  const provider = createSpeechProvider({ env: credentials, fetch: mockFetch(async (url, init) => {
    assert.match(String(url), /language=zh-CN/);
    assert.ok(init.body instanceof Uint8Array);
    return new Response(JSON.stringify(++count === 1 ? { RecognitionStatus: 'Success', DisplayText: '我喜欢恐龙。' } : { RecognitionStatus: 'NoMatch' }));
  }) });
  const result = await provider.transcribeSpeech({ audio: wav(), locale: 'zh-CN' });
  assert.equal(result.transcript, '我喜欢恐龙。'); assert.equal(result.status, 'recognized'); assert.ok(result.costCny > 0);
  const silence = await provider.transcribeSpeech({ audio: wav(), locale: 'zh-CN' });
  assert.equal(silence.status, 'unclear'); assert.equal(silence.transcript, '');
  assert.match(silence.message!, /不算答错/);
});

test('WAV validation rejects wrong sampling, overlong, corrupt, empty or non-PCM recordings', () => {
  assert.equal(validateWav(wav(15)).seconds, 15);
  for (const audio of [wav(15.001), wav(1, 48_000), wav(0), Buffer.from('not audio')]) {
    assert.throws(() => validateWav(audio), { code: 'INVALID_AUDIO' });
  }
  const stereo = wav(); stereo.writeUInt16LE(2, 22);
  assert.throws(() => validateWav(stereo), { code: 'INVALID_AUDIO' });
  const truncated = wav().subarray(0, 100);
  assert.throws(() => validateWav(truncated), { code: 'INVALID_AUDIO' });
});

test('STT invalid response and network failure remain service failures, never incorrect answers', async () => {
  const malformed = createSpeechProvider({ env: credentials, fetch: mockFetch(async () => new Response('no json')) });
  await assert.rejects(malformed.transcribeSpeech({ audio: wav(), locale: 'en-US' }), { code: 'SPEECH_INVALID_RESPONSE' });
  const offline = createSpeechProvider({ env: credentials, fetch: mockFetch(async () => { throw new Error(credentials.AZURE_SPEECH_KEY); }) });
  await assert.rejects(offline.transcribeSpeech({ audio: wav(), locale: 'en-US' }), (error: any) => {
    assert.equal(error.code, 'SPEECH_NETWORK'); assert.ok(!error.message.includes(credentials.AZURE_SPEECH_KEY)); return true;
  });
});

test('cost estimates honor explicit prices and use conservative defaults for invalid values', () => {
  assert.equal(estimateTtsCost('abcd', { AZURE_TTS_CNY_PER_MILLION: '100' }), 0.0004);
  assert.equal(estimateSttCost(360, { AZURE_STT_CNY_PER_HOUR: '10' }), 1);
  assert.ok(estimateTtsCost('apple', { AZURE_TTS_CNY_PER_MILLION: 'NaN' }) > 0);
  assert.throws(() => estimateSttCost(Infinity), { code: 'INVALID_AUDIO' });
});

test('rate limit and timeout failures remain recoverable and cannot establish verified service', async () => {
  const limited = createSpeechProvider({ env: credentials, fetch: mockFetch(async () => new Response('private provider body', { status: 429 })) });
  await assert.rejects(limited.transcribeSpeech({ audio: wav(), locale: 'zh-CN' }), { code: 'SPEECH_RATE_LIMIT' });
  assert.equal(limited.status().available, false);
  const timedOut = createSpeechProvider({ env: credentials, fetch: mockFetch(async () => { throw new DOMException('timeout', 'TimeoutError'); }) });
  await assert.rejects(timedOut.transcribeSpeech({ audio: wav(), locale: 'zh-CN' }), { code: 'SPEECH_TIMEOUT' });
  assert.equal(timedOut.status().available, false);
});
