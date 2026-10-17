import test from 'node:test';
import assert from 'node:assert/strict';
import { FollowAlongController, type FollowAlongRuntime, type PreparedRecording } from '../src/follow-along';
import { MicrophoneAccessError } from '../src/microphone-access';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function harness(overrides: Partial<FollowAlongRuntime> = {}) {
  const events: string[] = [], revoked: string[] = [];
  let result = deferred<Blob | null>(), sequence = 0;
  const recording: PreparedRecording = {
    record: () => { events.push('record'); return result.promise; },
    stop: () => { events.push('stop'); result.resolve(new Blob(['test recording'])); },
    cancel: () => { events.push('cancel'); result.resolve(null); },
  };
  const runtime: FollowAlongRuntime = {
    prepare: async () => { events.push('prepare'); result = deferred<Blob | null>(); return recording; },
    demonstrate: async () => { events.push('demo'); return true; }, stopAudio: () => events.push('stopAudio'),
    play: async () => { events.push('replay'); return true; },
    createUrl: () => `blob:take-${++sequence}`, revokeUrl: url => revoked.push(url), update() {}, ...overrides,
  };
  const controller = new FollowAlongController(runtime);
  return { controller, runtime, events, revoked, recording, result: () => result };
}

test('three distinct captured takes each follow a completed demo; a fourth cannot start', async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) {
    const pending = h.controller.start(); await flush();
    assert.equal(h.controller.state.phase, 'recording');
    assert.equal(h.controller.state.recordings.length, i);
    h.controller.stop(); await pending;
    assert.equal(h.controller.state.recordings.length, i + 1);
  }
  assert.deepEqual(h.events.filter(value => ['prepare', 'demo', 'record'].includes(value)), Array(3).fill(['prepare', 'demo', 'record']).flat());
  await h.controller.start(); assert.equal(h.events.filter(value => value === 'record').length, 3);
  await h.controller.replay(0); assert.equal(h.events.at(-1), 'replay');
  h.controller.dispose(); assert.deepEqual(h.revoked, ['blob:take-1', 'blob:take-2', 'blob:take-3']);
});

test('repeated clicks while opening, demonstrating or saving cannot capture a second take', async () => {
  const demo = deferred<boolean>(); const h = harness({ demonstrate: () => demo.promise });
  const pending = h.controller.start(); await h.controller.start(); await flush();
  assert.equal(h.controller.state.phase, 'demo'); await h.controller.start();
  demo.resolve(true); await flush(); h.controller.stop(); await h.controller.start(); await pending;
  assert.equal(h.events.filter(value => value === 'prepare').length, 1);
  assert.equal(h.controller.state.recordings.length, 1);
});

test('denied permission and a silent take keep the current round incomplete and allow a retry', async () => {
  const h = harness({ prepare: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
  await h.controller.start(); assert.match(h.controller.state.message, /权限/);
  assert.equal(h.controller.state.recordings.length, 0); assert.equal(h.controller.state.phase, 'idle');
  h.runtime.prepare = async () => h.recording;
  const retry = h.controller.start(); await flush(); h.result().resolve(null); await retry;
  assert.match(h.controller.state.message, /没有录到声音/); assert.equal(h.controller.state.recordings.length, 0);
});

test('system-level microphone denial remains distinct from an unapproved website and never counts a take', async () => {
  const message = '网页已允许麦克风，但系统仍在拦截当前浏览器。';
  const h = harness({ prepare: async () => { throw new MicrophoneAccessError(message, new DOMException('Permission denied by system', 'NotAllowedError')); } });
  await h.controller.start(); assert.equal(h.controller.state.message, message);
  assert.equal(h.controller.state.recordings.length, 0); assert.equal(h.controller.state.phase, 'idle');
  assert.equal(h.events.includes('record'), false);
});

test('a failed or interrupted demonstration never starts recording', async () => {
  const h = harness({ demonstrate: async () => false }); await h.controller.start();
  assert.equal(h.events.includes('record'), false); assert.equal(h.events.includes('cancel'), true);
  assert.equal(h.controller.state.recordings.length, 0); assert.match(h.controller.state.message, /示范声音/);
});

test('cancel while permission is pending releases the late stream without starting a demo', async () => {
  const permission = deferred<PreparedRecording>(); let signal: AbortSignal | undefined;
  const h = harness({ prepare: value => { signal = value; return permission.promise; } });
  const pending = h.controller.start(); h.controller.cancel(); permission.resolve(h.recording); await pending;
  assert.equal(signal?.aborted, true); assert.deepEqual(h.events, ['stopAudio', 'cancel']);
  assert.equal(h.controller.state.recordings.length, 0); assert.equal(h.controller.state.phase, 'idle');
});

test('pause during a demo or capture cannot revive recording or count a discarded take', async () => {
  const demo = deferred<boolean>(); const h = harness({ demonstrate: () => demo.promise });
  const pending = h.controller.start(); await flush(); h.controller.cancel(); demo.resolve(true); await pending;
  assert.equal(h.events.includes('record'), false);
  h.runtime.demonstrate = async () => true;
  const retry = h.controller.start(); await flush(); h.controller.cancel(); await retry;
  assert.equal(h.controller.state.recordings.length, 0); assert.equal(h.controller.state.phase, 'idle');
});

test('cancelled playback cannot overwrite a newer take state, and partial takes survive a pause', async () => {
  const playback = deferred<boolean>(); const h = harness({ play: () => playback.promise });
  const first = h.controller.start(); await flush(); h.controller.stop(); await first;
  const replay = h.controller.replay(0); h.controller.cancel();
  const second = h.controller.start(); await flush(); playback.resolve(false); await replay;
  assert.equal(h.controller.state.phase, 'recording'); assert.equal(h.controller.state.message, '');
  h.controller.stop(); await second; assert.equal(h.controller.state.recordings.length, 2);
});

test('a hardware recording error leaves prior takes playable and releases the interaction', async () => {
  const h = harness(); const pending = h.controller.start(); await flush();
  h.result().reject(new Error('device lost')); await pending;
  assert.equal(h.controller.state.phase, 'idle'); assert.match(h.controller.state.message, /录音没成功/);
  assert.equal(h.controller.state.recordings.length, 0); assert.equal(h.events.at(-1), 'cancel');
});
