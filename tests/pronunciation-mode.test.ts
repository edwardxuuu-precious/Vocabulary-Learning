import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';

test('pronunciation mode never opens dialogue and cached word audio remains usable without chat or budget', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'word-pronunciation-'));
  await mkdir(join(dataDir, 'speech'));
  const filePath = join(dataDir, 'speech', 'word.mp3');
  const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]);
  await writeFile(filePath, audio);
  let dialogueCalls = 0, speechCalls = 0;
  const unavailable = { configured: false, available: false, status: 'unconfigured', detail: 'mock only' };
  const forbidden = async () => { dialogueCalls++; throw new Error('dialogue must stay closed'); };
  const app = createApp({
    dataDir,
    dialogue: { status: forbidden, prepare: forbidden, prepareTurn: forbidden, turn: forbidden, cancel() { dialogueCalls++; }, reset: forbidden, close: async () => {} },
    integrations: {
      probeIntegrations: async () => ({ speech: unavailable, codex: unavailable }),
      getCachedSpeech: async input => {
        assert.equal(input.text, 'apple'); assert.equal(input.locale, 'en-US'); assert.equal(input.tone, 'clear');
        speechCalls++; return filePath;
      },
    },
  });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    app.store.updateSettings({ monthlyBudgetCny: 0 });
    const before = app.store.read();
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.integrations.dialogue.status, 'disabled');
    assert.equal((await (await fetch(base + '/api/chat/status')).json()).status, 'disabled');
    for (const route of ['turn', 'prepare', 'prepare/cancel', 'cancel', 'reset']) {
      const response = await post('/api/chat/' + route, {});
      assert.equal(response.status, 409); assert.equal((await response.json()).code, 'CHAT_DISABLED');
    }
    const response = await post('/api/speech/tts/stream', { text: 'apple', locale: 'en-US', tone: 'clear' });
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-tts-cached'), 'true');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
    assert.equal(speechCalls, 1); assert.equal(dialogueCalls, 0);
    const after = app.store.read();
    for (const key of ['profile', 'attempts', 'progress', 'charges', 'sessions', 'stickers'] as const) assert.deepEqual(after[key], before[key]);
  } finally {
    await app.close();
    // mkdtemp is the sole source of this test-owned directory.
    assert.ok(dataDir.startsWith(join(tmpdir(), 'word-pronunciation-')));
    await rm(dataDir, { recursive: true, force: true });
  }
});
