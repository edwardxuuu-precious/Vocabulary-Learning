import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElevenLabsProvider } from '../server/integrations/elevenlabs';

const env = { ELEVENLABS_API_KEY: 'test-server-secret', ELEVENLABS_VOICE_ID: 'existingFemaleVoice' };
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]);
const validQuota = { tier: 'free', status: 'free', character_count: 0, character_limit: 10000, max_credit_limit_extension: 0 };

test('unreadable, paid, exhausted, extension-enabled or malformed quota blocks synthesis before budget reservation in file and stream paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'free-quota-'));
  try {
    for (const quota of [null, { ...validQuota, tier: 'starter' }, { ...validQuota, status: 'past_due' }, { ...validQuota, character_count: 10000 }, { ...validQuota, max_credit_limit_extension: 'unlimited' }, { ...validQuota, character_limit: undefined }]) {
      let requests = 0, charges = 0;
      const provider = createElevenLabsProvider({ env, fetch: (async url => {
        requests++; assert.equal(String(url), 'https://api.elevenlabs.io/v1/user/subscription');
        return new Response(JSON.stringify(quota), { status: quota ? 200 : 401 });
      }) as typeof fetch });
      const input = { text: '意思是，制作。', locale: 'zh-CN' as const, tone: 'clear' as const, dataDir: directory, freeOnly: true, beforeRequest: () => { charges++; } };
      await assert.rejects(provider.synthesizeSpeech(input), { code: 'SPEECH_FREE_QUOTA_UNAVAILABLE' });
      await assert.rejects(provider.streamSpeech(input), { code: 'SPEECH_FREE_QUOTA_UNAVAILABLE' });
      assert.equal(requests, 2); assert.equal(charges, 0);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('confirmed free synthesis uses the configured voice once; later file and stream replay read cache without account requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'free-quota-')); let quotaCalls = 0, syntheses = 0, charges = 0;
  const provider = createElevenLabsProvider({ env, fetch: (async (url, init) => {
    if (String(url).endsWith('/subscription')) { quotaCalls++; return Response.json(validQuota); }
    syntheses++; assert.equal(JSON.parse(init!.body as string).inputs[0].voice_id, env.ELEVENLABS_VOICE_ID);
    return new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch });
  const input = { text: '意思是，制作。', locale: 'zh-CN' as const, tone: 'clear' as const, dataDir: directory, freeOnly: true, beforeRequest: () => { charges++; } };
  try {
    assert.equal((await provider.synthesizeSpeech(input)).cached, false);
    assert.equal((await provider.synthesizeSpeech(input)).cached, true);
    const stream = await provider.streamSpeech(input); for await (const _ of stream.stream) {} await stream.completed;
    assert.equal(stream.cached, true); assert.equal(quotaCalls, 1); assert.equal(syntheses, 1); assert.equal(charges, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cancelling while quota verification is pending never sends synthesis or reserves budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'free-quota-')); const abort = new AbortController(); let started!: () => void, release!: () => void, charges = 0;
  const pending = new Promise<void>(resolve => { release = resolve; }), checking = new Promise<void>(resolve => { started = resolve; });
  const provider = createElevenLabsProvider({ env, fetch: (async url => {
    assert.ok(String(url).endsWith('/subscription')); started(); await pending; return Response.json(validQuota);
  }) as typeof fetch });
  try {
    const running = provider.synthesizeSpeech({ text: '制作', locale: 'zh-CN', dataDir: directory, freeOnly: true, signal: abort.signal, beforeRequest: () => { charges++; } });
    await checking; abort.abort(); release(); await assert.rejects(running, { code: 'CANCELLED' }); assert.equal(charges, 0);
  } finally { release(); await rm(directory, { recursive: true, force: true }); }
});
