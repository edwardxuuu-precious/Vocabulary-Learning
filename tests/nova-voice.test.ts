import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/index.ts';
import { speechStatus, ttsStatus } from '../server/integrations/speech-router.ts';
import { createPackAudioManager } from '../server/pack-audio.ts';
import { Store } from '../server/store.ts';
import { SpeechPlaybackController } from '../src/speech-controller.ts';

async function workspace() {
  const root = await realpath(tmpdir());
  const dataDir = await mkdtemp(join(root, 'nova-qa-'));
  return { dataDir, async clean() {
    const destination = await realpath(dataDir);
    assert.ok(destination.startsWith(root + sep + 'nova-qa-'));
    await rm(destination, { recursive: true, force: true });
  } };
}

test('Nova is the archive’s English cache, keeps Chinese routing, and never prepares on a listening request', async () => {
  const folder = await workspace(), { dataDir } = folder;
  const setting = join(dataDir, 'nova-voice');
  const cache = join(dataDir, 'speech', 'nova-v1');
  await mkdir(setting);
  await writeFile(join(setting, 'settings.json'), '{"version":1}');
  await mkdir(cache, { recursive: true });
  const file = createHash('sha256').update('I am a child.').digest('hex') + '.mp3';
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(1500)]);
  await writeFile(join(cache, file), mp3);
  let syntheses = 0;
  const service = ttsStatus({ locale: 'en-US', dataDir });
  assert.equal(service.provider, 'nova');
  assert.notEqual(ttsStatus({ locale: 'zh-CN', dataDir }).provider, 'nova');
  const app = createApp({ dataDir, chatEnabled: false, integrations: {
    probeIntegrations: async () => ({ tts: service, speech: speechStatus(dataDir), codex: { ...service, provider: 'codex' } }),
    synthesizeSpeech: async () => { syntheses++; throw Error('listening must not synthesize'); },
  } });
  try {
    await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
    const address = app.server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const before = app.store.read();
    const request = (text: string, stream = false) => fetch(base + '/api/speech/tts' + (stream ? '/stream' : ''), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, locale: 'en-US', rate: 0.5 }),
    });
    const path = '/media/speech/nova-v1/' + file;
    assert.deepEqual(await (await request('I am a child.')).json(), { mode: 'api', audioUrl: path, cached: true, preset: 'nova' });
    const stream = await request('I am a child.', true);
    assert.equal(stream.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await stream.arrayBuffer()), mp3);
    for (const streaming of [false, true]) {
      const missing = await request('Unprepared text', streaming);
      assert.equal(missing.status, 409);
      assert.equal((await missing.json() as { code: string }).code, 'NOVA_AUDIO_PENDING');
    }
    assert.equal(syntheses, 0);
    assert.deepEqual(app.store.read(), before);
  } finally { await app.close(); await folder.clean(); }
});

test('parent preparation includes approved usage sentences for Nova and never reserves a cloud charge', async () => {
  const folder = await workspace(), { dataDir } = folder;
  const store = new Store(dataDir);
  const pack = store.createPack('英语试验词表', [{ term: 'am', meaning: '是' }]);
  const prepared = new Map<string, string>();
  const manager = createPackAudioManager({ store, dataDir, toMediaUrl: file => file, integration: {
    ttsStatus: () => ({ provider: 'nova', configured: true, available: true, status: 'ready', detail: 'Nova' }),
    getCachedSpeech: async input => prepared.get(input.text),
    synthesizeSpeech: async input => {
      const filePath = join(dataDir, `clip-${prepared.size}.mp3`);
      prepared.set(input.text, filePath);
      return { mode: 'api', filePath, cached: false, costCny: 0 };
    }, estimateTtsCost: () => 0,
  } });
  try {
    const before = store.read();
    assert.equal((await manager.start(pack.id)).status, 'running');
    while (manager.busy()) await new Promise<void>(done => setImmediate(done));
    assert.equal((await manager.getStatus(pack.id)).status, 'ready');
    assert.deepEqual([...prepared.keys()], ['am', 'I am a child.']);
    assert.deepEqual(store.read(), before);
  } finally { await manager.close(); store.close(); await folder.clean(); }
});

test('a missing or failed Nova asset does not fall back to a different browser voice', async () => {
  for (const missing of [true, false]) {
    let fallback = 0;
    const playback = new SpeechPlaybackController({
      isEnabled: () => true, beforeSpeak() {}, update() {}, playAudio: async () => false,
      requestAudio: async () => {
        if (missing) throw Object.assign(Error('Not prepared'), { code: 'NOVA_AUDIO_PENDING' });
        return { mode: 'api', audioUrl: '/media/sound.mp3', preset: 'nova' };
      }, playLocal: async () => { fallback++; return true; },
    });
    assert.equal(await playback.speak({ text: 'am', locale: 'en-US' }), false);
    assert.equal(fallback, 0);
  }
});
