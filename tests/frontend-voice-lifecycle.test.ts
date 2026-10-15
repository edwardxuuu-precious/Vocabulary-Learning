import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedInterestIntent, microphoneAction, PlaybackBlockedError, SpeechPlaybackController, type PlaybackContext, type SpeechAsset, type SpeechRuntime, type SpeechState } from '../src/speech-controller';
import { playBrowserAudio, playBrowserLocal } from '../src/browser-speech';

const segment = (text: string) => ({ text, locale: 'zh-CN' as const, tone: 'gentle' as const });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }
function harness(overrides: Partial<SpeechRuntime> = {}) {
  const state: SpeechState = { speaking: false, localMode: false, currentText: '', message: '' };
  const requests: string[] = [], audio: { text: string; context: PlaybackContext }[] = [], locals: string[] = [];
  let beforeCount = 0;
  const runtime: SpeechRuntime = {
    isEnabled: () => true, beforeSpeak: () => { beforeCount++; },
    requestAudio: async value => { requests.push(value.text); return { mode: 'api', audioUrl: value.text }; },
    playAudio: async (url, context) => { audio.push({ text: url, context }); context.onStart(); return true; },
    playLocal: async (value, context) => { locals.push(value.text); context.onStart(); return true; },
    update: patch => Object.assign(state, patch), ...overrides,
  };
  return { controller: new SpeechPlaybackController(runtime), runtime, state, requests, audio, locals, beforeCount: () => beforeCount };
}

test('barge-in between settled first sentence and sequence continuation cannot restart the next sentence or cancel a new microphone', async () => {
  const first = deferred<boolean>();
  const h = harness({ playAudio: () => first.promise });
  const speaking = h.controller.speakSequence([segment('第一句'), segment('第二句')]); await flush();
  first.resolve(true); queueMicrotask(() => h.controller.stop());
  assert.equal(await speaking, false);
  assert.deepEqual(h.requests, ['第一句']); assert.equal(h.beforeCount(), 1);
});

test('an uninterrupted sentence sequence cancels recording once and retains a single playback owner', async () => {
  const h = harness(); const pending = h.controller.speakSequence([segment('甲'), segment('乙')]); const owner = h.controller.getPlaybackId();
  assert.equal(await pending, true); assert.deepEqual(h.requests, ['甲', '乙']);
  assert.equal(h.beforeCount(), 1); assert.equal(h.controller.getPlaybackId(), owner);
});

test('muted automatic guidance never cancels a microphone or requests TTS', async () => {
  const h = harness({ isEnabled: () => false });
  assert.equal(await h.controller.speak(segment('静音指导')), false);
  assert.equal(h.beforeCount(), 0); assert.deepEqual(h.requests, []);
});

test('cancelled synthesis resolving late cannot create audio or enter local fallback', async () => {
  const request = deferred<SpeechAsset>(); let signal: AbortSignal | undefined;
  const h = harness({ requestAudio: (_, value) => { signal = value; return request.promise; } });
  const speaking = h.controller.speak(segment('旧回复')); h.controller.stop(); request.resolve({ mode: 'api', audioUrl: '/late' });
  assert.equal(await speaking, false); assert.equal(signal?.aborted, true);
  assert.deepEqual(h.audio, []); assert.deepEqual(h.locals, []);
});

test('old greeting effect cleanup cannot stop a newer Codex reply and stale start callbacks cannot change its subtitle', async () => {
  const first = deferred<boolean>(), second = deferred<boolean>(); let oldStart: (() => void) | undefined;
  const h = harness({ playAudio: (url, context) => { if (url === '问候') { oldStart = context.onStart; return first.promise; } context.onStart(); return second.promise; } });
  const greeting = h.controller.speak(segment('问候')); const greetingId = h.controller.getPlaybackId(); await flush();
  const reply = h.controller.speak(segment('新回复')); await flush();
  h.controller.stopIfPlayback(greetingId); oldStart?.();
  assert.equal(h.state.currentText, '新回复'); second.resolve(true); first.resolve(false);
  assert.equal(await reply, true); assert.equal(await greeting, false);
});

test('real cloud playback failure uses exactly one local fallback, and unavailable local voice releases the interaction', async () => {
  let localCalls = 0;
  const h = harness({ playAudio: async () => false, playLocal: async () => { localCalls++; return false; } });
  assert.equal(await h.controller.speak(segment('失败')), false);
  assert.equal(localCalls, 1); assert.equal(h.state.speaking, false); assert.match(h.state.message, /点按钮继续/);
  h.runtime.playAudio = async () => true;
  assert.equal(await h.controller.speak(segment('恢复')), true);
});

test('autoplay gesture rejection leaves the chosen cloud voice intact and asks for a tap instead of switching to local', async () => {
  const h = harness({ playAudio: async () => { throw new PlaybackBlockedError(); } });
  assert.equal(await h.controller.speak(segment('自动问候')), false);
  assert.equal(h.state.localMode, false); assert.deepEqual(h.locals, []); assert.match(h.state.message, /小喇叭/);
});

test('cancelling a local fallback cannot start the next sentence', async () => {
  const pending = deferred<boolean>(); let localSignal: AbortSignal | undefined;
  const h = harness({ requestAudio: async () => ({ mode: 'local' }), playLocal: (_, context) => { localSignal = context.signal; return pending.promise; } });
  const speaking = h.controller.speakSequence([segment('一句'), segment('两句')]); await flush(); h.controller.stop(); pending.resolve(false);
  assert.equal(await speaking, false); assert.equal(localSignal?.aborted, true); assert.equal(h.beforeCount(), 1);
});

test('the microphone finishes an active recording, cancels pending recognition, and only starts a configured idle capture', () => {
  assert.equal(microphoneAction({ recording: true, processing: false, configured: true }), 'finish');
  assert.equal(microphoneAction({ recording: false, processing: true, configured: true }), 'cancel');
  assert.equal(microphoneAction({ recording: false, processing: false, configured: true }), 'start');
  assert.equal(microphoneAction({ recording: false, processing: false, configured: false }), 'unavailable');
});

test('interest confirmation requires an explicit answer, never an incidental 好/是/对 inside another sentence', () => {
  for (const text of ['我还没想好', '可能是吧', '我喜欢对战', '不是这个', '不对，重说']) {
    assert.notEqual(confirmedInterestIntent('confirm', text), 'yes', text);
  }
  for (const text of ['对', '是的', '没错', '嗯，对', '对的，就是这个']) assert.equal(confirmedInterestIntent('confirm', text), 'yes', text);
  assert.equal(confirmedInterestIntent('confirm', '不是这个'), 'retry');
});

test('after confirmed interest, a short 开始 starts learning without another Codex turn; an unconfirmed page cannot start this way', () => {
  assert.equal(confirmedInterestIntent('ready', '开始吧！'), 'start');
  assert.equal(confirmedInterestIntent('ready', '一起玩'), 'start');
  assert.equal(confirmedInterestIntent('confirm', '开始吧'), 'unknown');
  assert.equal(confirmedInterestIntent('ask', '开始吧'), 'unknown');
});

test('browser audio cancellation detaches old callbacks and settles without waiting for an ended event', async t => {
  let created: FakeAudio | undefined;
  class FakeAudio { onplay: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null; paused = false; constructor(_: string) { created = this; } play() { this.onplay?.(); return Promise.resolve(); } pause() { this.paused = true; } }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Audio'); Object.defineProperty(globalThis, 'Audio', { value: FakeAudio, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Audio', previous); else Reflect.deleteProperty(globalThis, 'Audio'); });
  const abort = new AbortController(); let starts = 0;
  const pending = playBrowserAudio('/test', { signal: abort.signal, onStart: () => starts++ }); abort.abort();
  assert.equal(await pending, false); assert.equal(starts, 1); assert.equal(created?.paused, true);
  assert.equal(created?.onerror, null); assert.equal(created?.onended, null); assert.equal(created?.onplay, null);
});

test('browser NotAllowedError is distinguished from media failure', async t => {
  class FakeAudio { onplay = null; onended = null; onerror = null; play() { return Promise.reject(new DOMException('gesture', 'NotAllowedError')); } pause() {} }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Audio'); Object.defineProperty(globalThis, 'Audio', { value: FakeAudio, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Audio', previous); else Reflect.deleteProperty(globalThis, 'Audio'); });
  await assert.rejects(playBrowserAudio('/test', { signal: new AbortController().signal, onStart: () => {} }), PlaybackBlockedError);
});

test('a browser speech engine that emits no events times out and releases its cancellation listener', async t => {
  let cancelled = 0;
  class FakeUtterance { lang = ''; rate = 1; voice = null; onstart = null; onend = null; onerror = null; constructor(_: string) {} }
  const keys = ['window', 'SpeechSynthesisUtterance'] as const; const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'window', { value: { speechSynthesis: { getVoices: () => [], speak: () => {}, cancel: () => { cancelled++; } } }, configurable: true });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
  t.after(() => keys.forEach((key, index) => { const previous = descriptors[index]; if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); }));
  const abort = new AbortController();
  assert.equal(await playBrowserLocal(segment('没有事件'), { signal: abort.signal, onStart: () => {} }, 5), false);
  assert.equal(cancelled, 1); abort.abort(); assert.equal(cancelled, 1);
});
