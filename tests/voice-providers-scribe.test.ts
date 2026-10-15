import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createElevenLabsSttProvider, estimateElevenLabsSttCost, type ScribeOptions } from '../server/integrations/elevenlabs-stt.ts';
import type { UpstreamSocket } from '../server/integrations/soniox.ts';
import type { VoiceServerMessage } from '../shared/contracts.ts';

class FakeSocket extends EventEmitter implements UpstreamSocket {
  readyState = 0; bufferedAmount = 0; sent: string[] = [];
  open() { this.readyState = 1; this.emit('open'); }
  send(data: string | Buffer, callback?: (error?: Error) => void) { this.sent.push(String(data)); callback?.(); }
  close() { if (this.readyState === 3) return; this.readyState = 3; queueMicrotask(() => this.emit('close', 1000)); }
  terminate() { this.close(); }
  message(data: unknown) { this.emit('message', JSON.stringify(data)); }
  started() { this.message({ message_type: 'session_started', config: { model_id: 'scribe_v2_realtime', sample_rate: 16000, audio_format: 'pcm_16000' } }); }
}
const secret = 'server-only-scribe-test-key';
function setup(extra: ScribeOptions = {}) {
  const socket = new FakeSocket(); const events: VoiceServerMessage[] = [], usage: number[] = []; let handshake: any;
  const provider = createElevenLabsSttProvider({ env: { ELEVENLABS_API_KEY: secret }, now: () => 1000,
    createWebSocket: (url, options) => { handshake = { url, options }; queueMicrotask(() => { socket.open(); socket.started(); }); return socket; }, ...extra });
  const open = () => provider.createSession({ locale: 'zh-CN', vocabulary: ['apple', '恐龙'], onEvent: event => events.push(event), onUsage: seconds => usage.push(seconds) });
  return { socket, events, usage, provider, open, handshake: () => handshake };
}

test('Scribe keeps authentication on local server and configures 16k mixed-language VAD without paid enhancements', async () => {
  const value = setup(); const session = await value.open();
  try {
    const url = new URL(value.handshake().url);
    assert.equal(url.searchParams.get('model_id'), 'scribe_v2_realtime'); assert.equal(url.searchParams.get('audio_format'), 'pcm_16000');
    assert.equal(url.searchParams.get('language_code'), 'zh'); assert.equal(url.searchParams.get('secondary_languages'), 'en');
    assert.equal(url.searchParams.get('commit_strategy'), 'vad'); assert.equal(url.searchParams.get('vad_silence_threshold_secs'), '1');
    assert.equal(url.searchParams.get('keyterms'), null); assert.equal(url.searchParams.get('transcript_edit'), null);
    assert.equal(url.searchParams.get('token'), null); assert.ok(!url.href.includes(secret));
    assert.equal(value.handshake().options.headers['xi-api-key'], secret);
    assert.deepEqual(value.events, [{ type: 'ready' }]);
    assert.equal(value.provider.status().provider, 'elevenlabs'); assert.equal(value.provider.status().available, false);
    session.sendAudio(Buffer.alloc(3200)); const packet = JSON.parse(value.socket.sent[0]);
    assert.equal(packet.message_type, 'input_audio_chunk'); assert.equal(packet.sample_rate, 16000); assert.equal(packet.commit, false);
    assert.deepEqual(Buffer.from(packet.audio_base_64, 'base64'), Buffer.alloc(3200)); assert.equal(value.usage.at(-1), 0.1);
    assert.ok(!JSON.stringify(value.events).includes(secret));
  } finally { session.cancel(); }
});

test('ready waits for session_started; socket opening alone cannot verify a transcription service', async () => {
  const socket = new FakeSocket(); const events: VoiceServerMessage[] = [];
  const provider = createElevenLabsSttProvider({ env: { ELEVENLABS_API_KEY: secret }, createWebSocket: () => socket });
  const pending = provider.createSession({ locale: 'en-US', onEvent: event => events.push(event) }); socket.open();
  assert.equal(events.length, 0); socket.started(); const session = await pending;
  assert.deepEqual(events, [{ type: 'ready' }]); assert.equal(provider.status().available, false); session.cancel();
});

test('partial revisions replace text; committed segments accumulate and do not immediately end a child turn', async () => {
  const value = setup({ endpointGraceMs: 20 }); const session = await value.open();
  try {
    session.sendAudio(spokenPcm());
    value.socket.message({ message_type: 'partial_transcript', text: '我喜' });
    value.socket.message({ message_type: 'partial_transcript', text: '我喜欢' });
    assert.deepEqual(value.events.at(-1), { type: 'transcript', text: '我喜欢', final: false });
    silence(session, 1); value.socket.message({ message_type: 'committed_transcript', text: '我喜欢恐龙' });
    assert.deepEqual(value.events.at(-1), { type: 'transcript', text: '我喜欢恐龙', final: true });
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
    session.sendAudio(spokenPcm()); value.socket.message({ message_type: 'partial_transcript', text: '和 apple' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'child continuation cancels end-of-turn grace');
    silence(session, 3.25); value.socket.message({ message_type: 'committed_transcript', text: '和 apple' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '我喜欢恐龙和 apple' });
    assert.equal(value.events.filter(event => event.type === 'closed').length, 1);
  } finally { session.cancel(); }
});

test('empty keepalives retain captions and do not cancel the endpoint grace after a real committed answer', async () => {
  const value = setup({ endpointGraceMs: 15 }); const session = await value.open(); session.sendAudio(spokenPcm());
  value.socket.message({ message_type: 'partial_transcript', text: 'apple' });
  value.socket.message({ message_type: 'partial_transcript', text: '' });
  assert.deepEqual(value.events.at(-1), { type: 'transcript', text: '', final: true });
  silence(session, 3.25); value.socket.message({ message_type: 'committed_transcript', text: 'apple' });
  value.socket.message({ message_type: 'partial_transcript', text: '' });
  value.socket.message({ message_type: 'committed_transcript_with_timestamps', text: 'apple', words: [] });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: 'apple' });
});

test('manual finish pads very short input to two seconds and commits; partial text never becomes a guessed final answer', async () => {
  const value = setup({ finishGraceMs: 15 }); const session = await value.open(); session.sendAudio(Buffer.alloc(6400));
  value.socket.message({ message_type: 'partial_transcript', text: 'possible' }); session.finish();
  const last = JSON.parse(value.socket.sent.at(-1)!);
  assert.equal(last.commit, true); assert.equal(Buffer.from(last.audio_base_64, 'base64').length, 57600);
  assert.equal(value.usage.at(-1), 2);
  assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
  value.socket.message({ message_type: 'committed_transcript', text: 'apple' });
  assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'a segment does not instantly certify the manual flush');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: 'apple' });
  assert.equal(value.events.filter(event => event.type === 'closed').length, 1);
});

function spokenPcm() {
  const audio = Buffer.alloc(3200);
  for (let at = 0; at < audio.length; at += 2) audio.writeInt16LE(at % 4 ? 2000 : -2000, at);
  return audio;
}
function silence(session: { sendAudio(audio: Buffer): void }, seconds: number) {
  for (let left = Math.round(seconds * 32000); left > 0;) { const length = Math.min(32000, left); session.sendAudio(Buffer.alloc(length)); left -= length; }
}
test('an early real commit overlaps the full 3.25-second PCM pause instead of adding post-commit delay', async () => {
  const value = setup(); const session = await value.open();
  try {
    session.sendAudio(spokenPcm()); silence(session, 1);
    value.socket.message({ message_type: 'committed_transcript', text: '我喜欢恐龙' });
    silence(session, 2.24);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, '3.24 seconds must never satisfy the local child pause');
    silence(session, 0.01);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '我喜欢恐龙' });
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 0, 'a genuine cloud final requires no forced commit');
  } finally { session.cancel(); }
});

test('a three-second child pause followed by PCM before partial cancels closure; a delayed old final after the next quiet period cannot certify it', async () => {
  const value = setup(); const session = await value.open();
  try {
    session.sendAudio(spokenPcm()); silence(session, 1);
    value.socket.message({ message_type: 'committed_transcript', text: '我' }); value.socket.message({ message_type: 'partial_transcript', text: '喜欢' }); silence(session, 2);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
    session.sendAudio(spokenPcm()); // The child resumes before the provider's new partial arrives.
    silence(session, 3.25);
    value.socket.message({ message_type: 'committed_transcript', text: '喜欢' });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'an old pending segment cannot certify newer PCM even after another complete pause');
    value.socket.message({ message_type: 'partial_transcript', text: '恐龙' });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'even a long pause never promotes partial text');
    value.socket.message({ message_type: 'committed_transcript', text: '恐龙' });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '我喜欢恐龙' });
  } finally { session.cancel(); }
});

test('a final arriving after the PCM pause ends without another 800ms and never executes a partial while waiting', async () => {
  const value = setup(); const session = await value.open();
  try {
    session.sendAudio(spokenPcm()); value.socket.message({ message_type: 'partial_transcript', text: '苹果' }); silence(session, 4);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
    value.socket.message({ message_type: 'committed_transcript', text: '苹果' });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '苹果' });
  } finally { session.cancel(); }
});

test('a first resumed 20ms frame blocks a ready endpoint; a solitary noise frame does not restart the full pause', async () => {
  for (const resumes of [false, true]) {
    const value = setup(); const session = await value.open();
    try {
      session.sendAudio(spokenPcm()); silence(session, 1); value.socket.message({ message_type: 'committed_transcript', text: '恐龙' }); silence(session, 2.25);
      session.sendAudio(spokenPcm().subarray(0, 640)); // First candidate resumed frame must beat the pending timer.
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
      if (resumes) {
        session.sendAudio(spokenPcm().subarray(0, 640)); silence(session, 3.25);
        await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'sustained new PCM needs its own genuine final');
        value.socket.message({ message_type: 'committed_transcript', text: '和苹果' });
      } else silence(session, 0.02);
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: resumes ? '恐龙和苹果' : '恐龙' });
    } finally { session.cancel(); }
  }
});

test('a genuine final without locally detected voice still waits for 3.25 seconds of PCM after text activity', async () => {
  const value = setup(); const session = await value.open();
  try {
    silence(session, 5); value.socket.message({ message_type: 'committed_transcript', text: '轻声说的话' }); silence(session, 3);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'low-energy speech cannot bypass the pause with earlier silent PCM');
    silence(session, 0.25); await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '轻声说的话' });
  } finally { session.cancel(); }
});

test('resumed PCM speech prevents an old committed segment closing before its delayed partial arrives', async () => {
  const value = setup({ endpointGraceMs: 15 }); const session = await value.open();
  try {
    session.sendAudio(spokenPcm()); silence(session, 3);
    value.socket.message({ message_type: 'committed_transcript', text: '我喜欢' });
    session.sendAudio(spokenPcm());
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
    silence(session, 2.9);
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'two to three seconds of a child pause are not a whole-turn signal');
    value.socket.message({ message_type: 'partial_transcript', text: '恐龙' }); silence(session, 0.35);
    value.socket.message({ message_type: 'committed_transcript', text: '恐龙' });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '我喜欢恐龙' });
  } finally { session.cancel(); }
});
test('an already delayed commit during current speech cannot arm the whole-turn timer; quiet PCM never extends an armed timer', async () => {
  const value = setup({ endpointGraceMs: 15 }); const session = await value.open();
  try {
    session.sendAudio(spokenPcm());
    value.socket.message({ message_type: 'committed_transcript', text: '我喜欢' });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
    silence(session, 3); value.socket.message({ message_type: 'committed_transcript', text: '苹果' });
    for (let count = 0; count < 10; count++) session.sendAudio(Buffer.alloc(3200));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '我喜欢苹果' });
  } finally { session.cancel(); }
});
test('manual finish drains an in-flight old VAD commit and the last word before ending; missing final words are never guessed', async () => {
  const value = setup({ finishGraceMs: 25 }); const session = await value.open();
  session.sendAudio(spokenPcm()); value.socket.message({ message_type: 'partial_transcript', text: '恐龙和苹果' }); session.finish(); session.finish();
  assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 1, 'finish is idempotent');
  value.socket.message({ message_type: 'committed_transcript', text: '恐龙和' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
  value.socket.message({ message_type: 'partial_transcript', text: '苹果' });
  value.socket.message({ message_type: 'committed_transcript', text: '苹果' });
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '恐龙和苹果' });

  const unfinished = setup({ finishGraceMs: 10, finishTimeoutMs: 30 }); const pending = await unfinished.open();
  pending.sendAudio(spokenPcm()); pending.finish();
  unfinished.socket.message({ message_type: 'committed_transcript', text: '恐龙和' });
  unfinished.socket.message({ message_type: 'partial_transcript', text: '苹果' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(unfinished.events.some(event => event.type === 'error' && event.code === 'SPEECH_TIMEOUT'));
  assert.equal(unfinished.events.filter(event => event.type === 'endpoint').length, 0);
});
test('a stalled repeated partial after a committed short answer requests one real commit only after four seconds of PCM silence', async () => {
  let clock = 0;
  const value = setup({ now: () => clock, finishGraceMs: 15, finishTimeoutMs: 150 }); const session = await value.open();
  try {
    session.sendAudio(spokenPcm()); silence(session, 3); clock = 3100;
    value.socket.message({ message_type: 'committed_transcript', text: '对。' });
    value.socket.message({ message_type: 'partial_transcript', text: '对。' });
    clock = 4700; silence(session, 0.9);
    value.socket.message({ message_type: 'partial_transcript', text: '对。' });
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 0, '3.9s quiet must preserve a child pause');
    silence(session, 0.1);
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 1);
    for (let count = 0; count < 5; count++) {
      clock += 1000; silence(session, 1); value.socket.message({ message_type: 'partial_transcript', text: '对。' });
    }
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 1, 'keepalives cannot spam commits');
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0, 'partial is never guessed as a committed answer');
    // Real empty current-segment messages clear the hanging partial; the only answer is the earlier committed text.
    value.socket.message({ message_type: 'partial_transcript', text: '' });
    value.socket.message({ message_type: 'partial_transcript', text: '' });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '对。' });
    assert.equal(value.events.filter(event => event.type === 'closed').length, 1);
  } finally { session.cancel(); }
});
test('a changed real partial and a resumed child utterance at a three-second pause prevent stalled recovery', async () => {
  let clock = 0;
  const value = setup({ now: () => clock, endpointGraceMs: 15 }); const session = await value.open();
  try {
    session.sendAudio(spokenPcm()); silence(session, 3); clock = 3100;
    value.socket.message({ message_type: 'committed_transcript', text: '我喜欢' });
    value.socket.message({ message_type: 'partial_transcript', text: '恐' });
    clock = 4700; value.socket.message({ message_type: 'partial_transcript', text: '恐龙' }); silence(session, 1);
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 0, 'a fresh partial must get its own stability window');
    session.sendAudio(spokenPcm()); clock = 4800;
    value.socket.message({ message_type: 'partial_transcript', text: '恐龙和苹果' }); silence(session, 3); clock = 7800;
    value.socket.message({ message_type: 'partial_transcript', text: '恐龙和苹果' });
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 0, 'new speech resets the required four seconds of quiet');
    value.socket.message({ message_type: 'committed_transcript', text: '恐龙和苹果' });
    silence(session, 0.25);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '我喜欢恐龙和苹果' });
  } finally { session.cancel(); }
});
test('stalled recovery drains actual new final words and never turns a pending partial into a result', async () => {
  let clock = 0;
  const value = setup({ now: () => clock, finishGraceMs: 15, finishTimeoutMs: 60 }); const session = await value.open();
  try {
    session.sendAudio(spokenPcm()); silence(session, 3); clock = 3100;
    value.socket.message({ message_type: 'committed_transcript', text: '我喜欢' });
    value.socket.message({ message_type: 'partial_transcript', text: '恐龙' }); clock = 4700; silence(session, 1);
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 1);
    value.socket.message({ message_type: 'partial_transcript', text: '恐龙和苹果' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
    value.socket.message({ message_type: 'committed_transcript', text: '恐龙和苹果' });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '我喜欢恐龙和苹果' });
  } finally { session.cancel(); }
});
test('resumed PCM during stalled recovery cancels its drain deadline and a later explicit finish starts a fresh bounded drain', async () => {
  let clock = 0;
  const value = setup({ now: () => clock, finishGraceMs: 10, finishTimeoutMs: 30 }); const session = await value.open();
  try {
    session.sendAudio(spokenPcm()); silence(session, 3); clock = 3100;
    value.socket.message({ message_type: 'committed_transcript', text: '对。' });
    value.socket.message({ message_type: 'partial_transcript', text: '对。' }); clock = 4700; silence(session, 1);
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 1);
    session.sendAudio(spokenPcm()); value.socket.message({ message_type: 'partial_transcript', text: '还有苹果' });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(value.events.filter(event => event.type === 'error' || event.type === 'endpoint').length, 0, 'cancelled recovery timeout cannot stop resumed speech');
    clock = 10000; silence(session, 4); value.socket.message({ message_type: 'partial_transcript', text: '还有苹果' });
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 1, 'recovery stays once per stream even after speech resumes');
    session.finish(); session.finish();
    assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 2, 'later manual hard limit has its own single commit');
    value.socket.message({ message_type: 'committed_transcript', text: '还有苹果' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(value.events.find(event => event.type === 'endpoint'), { type: 'endpoint', text: '对。还有苹果' });
  } finally { session.cancel(); }
});
test('stalled recovery expires even when identical keepalives continue, and manual finish cannot extend or duplicate it', async () => {
  let clock = 0;
  const value = setup({ now: () => clock, finishTimeoutMs: 25 }); const session = await value.open();
  session.sendAudio(spokenPcm()); silence(session, 3); clock = 3100;
  value.socket.message({ message_type: 'committed_transcript', text: '对。' });
  value.socket.message({ message_type: 'partial_transcript', text: '对。' }); clock = 4700; silence(session, 1);
  session.finish(); session.finish();
  for (let count = 0; count < 5; count++) value.socket.message({ message_type: 'partial_transcript', text: '对。' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(value.socket.sent.filter(data => JSON.parse(data).commit).length, 1);
  assert.ok(value.events.some(event => event.type === 'error' && event.code === 'SPEECH_TIMEOUT'));
  assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
  assert.equal(value.events.filter(event => event.type === 'closed').length, 1);
});
test('cancel while waiting for endpoint or manual finish emits closed once and ignores late upstream messages', async () => {
  for (const finish of [false, true]) {
    const value = setup({ endpointGraceMs: 10, finishGraceMs: 10 }); const session = await value.open();
    session.sendAudio(Buffer.alloc(6400)); if (finish) session.finish();
    value.socket.message({ message_type: 'committed_transcript', text: 'apple' });
    session.cancel(); session.cancel(); const before = value.events.length, usageBefore = value.usage.length;
    value.socket.message({ message_type: 'committed_transcript', text: 'late' }); value.socket.message({ message_type: 'session_started' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(value.events.length, before); assert.equal(value.usage.length, usageBefore);
    assert.equal(value.events.filter(event => event.type === 'closed').length, 1); assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
  }
});
test('a changed API key does not inherit the previous key error or verified state', async () => {
  const env = { ELEVENLABS_API_KEY: secret }; const value = setup({ env }); await value.open();
  value.socket.message({ message_type: 'auth_error', error: secret }); assert.equal(value.provider.status().status, 'error');
  env.ELEVENLABS_API_KEY = 'replacement-unverified-key';
  assert.equal(value.provider.status().status, 'unverified'); assert.equal(value.provider.status().available, false);
});

test('quota failures stop without fallback, leaked provider details or an invented transcript', async () => {
  const value = setup(); await value.open();
  value.socket.message({ message_type: 'quota_exceeded', error: `private ${secret}` });
  assert.ok(value.events.some(event => event.type === 'error' && event.code === 'SPEECH_RATE_LIMIT'));
  assert.match((value.events.find(event => event.type === 'error') as any).message, /不会自动充值/);
  assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
  assert.ok(!JSON.stringify(value.events).includes(secret)); assert.equal(value.socket.readyState, 3);
  assert.equal(value.provider.status().available, false);
});

test('abort before connect and during authentication report known zero or current usage before closed', async () => {
  const before = new AbortController(); before.abort(); let connections = 0; const usage: number[] = [];
  const socket = new FakeSocket();
  const provider = createElevenLabsSttProvider({ env: { ELEVENLABS_API_KEY: secret }, createWebSocket: () => { connections++; return socket; }, now: () => 1000 });
  await assert.rejects(provider.createSession({ locale: 'zh-CN', signal: before.signal, onUsage: seconds => usage.push(seconds), onEvent: () => {} }), { code: 'CANCELLED' });
  assert.equal(connections, 0); assert.deepEqual(usage, [0]);
  const during = new AbortController(); const events: VoiceServerMessage[] = [];
  const pending = provider.createSession({ locale: 'zh-CN', signal: during.signal, onUsage: seconds => usage.push(seconds), onEvent: event => events.push(event) });
  during.abort(); await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(socket.readyState, 3); assert.deepEqual(usage, [0, 0]);
  socket.open(); socket.started(); socket.message({ message_type: 'committed_transcript', text: 'late' });
  assert.equal(events.filter(event => event.type === 'ready' || event.type === 'endpoint').length, 0);
});

test('disconnects, malformed frames, silence rejection and timeouts remain service errors', async () => {
  for (const [message, code] of [[null, 'SPEECH_INVALID_RESPONSE'], [{ message_type: 'insufficient_audio_activity', error: secret }, 'SPEECH_UNCLEAR']] as const) {
    const value = setup(); await value.open(); value.socket.message(message);
    assert.ok(value.events.some(event => event.type === 'error' && event.code === code)); assert.equal(value.events.filter(event => event.type === 'endpoint').length, 0);
  }
  const disconnected = setup(); await disconnected.open(); disconnected.socket.close(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(disconnected.events.some(event => event.type === 'error' && event.code === 'SPEECH_DISCONNECTED'));
  const socket = new FakeSocket(); const timeout = createElevenLabsSttProvider({ env: { ELEVENLABS_API_KEY: secret }, connectTimeoutMs: 10, createWebSocket: () => socket });
  await assert.rejects(timeout.createSession({ locale: 'zh-CN', onEvent: () => {} }), { code: 'SPEECH_TIMEOUT' }); assert.equal(socket.readyState, 3);
});

test('missing keys and invalid audio never transmit; STT cost has an independent bounded estimate', async () => {
  let calls = 0;
  const provider = createElevenLabsSttProvider({ env: {}, createWebSocket: () => { calls++; return new FakeSocket(); } });
  await assert.rejects(provider.createSession({ locale: 'zh-CN', onEvent: () => {} }), { code: 'SPEECH_UNCONFIGURED' }); assert.equal(calls, 0);
  const value = setup(); const session = await value.open();
  try { assert.throws(() => session.sendAudio(Buffer.alloc(3)), { code: 'INVALID_AUDIO' }); assert.equal(value.socket.sent.length, 0); }
  finally { session.cancel(); }
  assert.equal(estimateElevenLabsSttCost(3600, {}), 4);
  assert.equal(estimateElevenLabsSttCost(3600, { ELEVENLABS_STT_CNY_PER_HOUR: '5', AZURE_STT_CNY_PER_HOUR: '999' }), 5);
  assert.throws(() => estimateElevenLabsSttCost(NaN), { code: 'INVALID_AUDIO' });
});
