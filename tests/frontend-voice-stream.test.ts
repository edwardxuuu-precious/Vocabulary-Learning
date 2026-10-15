import test from 'node:test';
import assert from 'node:assert/strict';
import { playBrowserStream, type StreamingSpeechEnvironment } from '../src/browser-stream-speech';
import { PlaybackBlockedError, SpeechPlaybackController, type SpeechRuntime, type SpeechState } from '../src/speech-controller';

const phrase = { text: '你好，我们一起玩吧。', locale: 'zh-CN' as const, tone: 'gentle' as const };
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function harness(options: { supported?: boolean; rejectPlay?: boolean; failSetup?: boolean; autoAppend?: boolean } = {}) {
  const events: string[] = []; let cancelled = 0, fetches = 0, signal: AbortSignal | undefined;
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: controller => { input = controller; }, cancel: () => { cancelled++; } });
  class Buffer extends EventTarget {
    updating = false; frames: number[][] = []; aborts = 0;
    appendBuffer(bytes: Uint8Array) { assert.equal(this.updating, false); this.updating = true; this.frames.push([...bytes]); events.push('append'); if (options.autoAppend !== false) queueMicrotask(() => this.complete()); }
    complete() { this.updating = false; this.dispatchEvent(new Event('updateend')); }
    abort() { this.aborts++; this.updating = false; }
  }
  const buffer = new Buffer();
  class Source extends EventTarget {
    readyState = 'closed'; ended = false;
    addSourceBuffer(mime: string) { assert.equal(mime, 'audio/mpeg'); if (options.failSetup) throw new Error('codec rejected'); return buffer; }
    endOfStream() { assert.equal(buffer.updating, false); this.ended = true; events.push('endOfStream'); }
    open() { this.readyState = 'open'; this.dispatchEvent(new Event('sourceopen')); }
  }
  const source = new Source();
  const audio = {
    onplaying: null as (() => void) | null, onended: null as (() => void) | null, onerror: null as (() => void) | null,
    preload: '', src: '', paused: false, loads: 0,
    play() { events.push('play'); return options.rejectPlay ? Promise.reject(new DOMException('gesture', 'NotAllowedError')) : Promise.resolve(); },
    pause() { this.paused = true; }, removeAttribute() { this.src = ''; }, load() { this.loads++; },
  };
  const environment: StreamingSpeechEnvironment = {
    supported: () => options.supported !== false,
    fetch: async (_, init) => { fetches++; signal = init?.signal as AbortSignal; return new Response(body, { headers: { 'Content-Type': 'audio/mpeg', 'X-TTS-Mode': 'api' } }); },
    createMediaSource: () => source as unknown as MediaSource,
    createAudio: () => audio as unknown as HTMLAudioElement,
    createObjectURL: () => { queueMicrotask(() => source.open()); return 'blob:stream'; },
    revokeObjectURL: url => { assert.equal(url, 'blob:stream'); events.push('revoke'); },
  };
  const abort = new AbortController(); let starts = 0;
  const begin = () => playBrowserStream(phrase, { signal: abort.signal, onStart: () => { starts++; } }, environment);
  return { environment, input, buffer, source, audio, abort, events, begin, starts: () => starts, cancelled: () => cancelled, fetches: () => fetches, signal: () => signal };
}

test('MP3 starts on its first appended frames while the network response is still open; only playing counts as speech', async () => {
  const h = harness(); let settled = false;
  const playing = h.begin().finally(() => { settled = true; });
  h.input.enqueue(new Uint8Array([1, 2])); await flush();
  assert.deepEqual(h.buffer.frames, [[1, 2]]); assert.equal(h.starts(), 0);
  h.audio.onplaying?.(); assert.equal(h.starts(), 1); assert.equal(settled, false); assert.equal(h.source.ended, false);
  h.input.enqueue(new Uint8Array([3, 4])); h.input.close(); await flush();
  assert.deepEqual(h.buffer.frames, [[1, 2], [3, 4]]); assert.equal(h.source.ended, true); assert.equal(settled, false);
  h.audio.onended?.(); assert.equal(await playing, 'completed'); assert.equal(h.audio.paused, true); assert.equal(h.signal()?.aborted, true); assert.equal(h.events.at(-1), 'revoke');
});

test('stream cancellation aborts the fetch, cancels the reader, detaches Audio and aborts an in-flight append', async () => {
  const h = harness({ autoAppend: false }); const pending = h.begin();
  h.input.enqueue(new Uint8Array([1])); await flush(); const latePlaying = h.audio.onplaying;
  h.abort.abort(); assert.equal(await pending, 'failed'); await flush();
  assert.equal(h.cancelled(), 1); assert.equal(h.buffer.aborts, 1); assert.equal(h.signal()?.aborted, true);
  assert.equal(h.audio.paused, true); assert.equal(h.audio.onplaying, null); assert.equal(h.audio.onended, null);
  latePlaying?.(); h.buffer.complete(); await flush(); assert.equal(h.starts(), 0); assert.equal(h.buffer.frames.length, 1);
});

test('an unsupported browser skips the stream HTTP request so the controller can retain complete cloud playback', async () => {
  const h = harness({ supported: false }); assert.equal(await h.begin(), 'unsupported'); assert.equal(h.fetches(), 0);
});

test('an MP3 SourceBuffer creation failure means browser compatibility fallback, not unavailable cloud', async () => {
  const h = harness({ failSetup: true }); assert.equal(await h.begin(), 'unsupported'); assert.equal(h.audio.paused, true);
});

test('stream autoplay rejection reports a gesture block and does not masquerade as cloud failure', async () => {
  const h = harness({ rejectPlay: true }); await assert.rejects(h.begin(), PlaybackBlockedError);
  assert.equal(h.signal()?.aborted, true); assert.equal(h.audio.paused, true);
});

test('JSON cloud error is unavailable, while transport failure after playing remains a partial playback failure', async () => {
  const h = harness(); h.environment.fetch = async () => new Response(JSON.stringify({ error: 'No key' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  assert.equal(await h.begin(), 'unavailable');
  const partial = harness(); const pending = partial.begin(); partial.input.enqueue(new Uint8Array([1, 2])); await flush(); partial.audio.onplaying?.(); partial.input.error(new Error('provider disconnected'));
  assert.equal(await pending, 'failed'); assert.equal(partial.starts(), 1);
});

function controllerHarness(playStream: NonNullable<SpeechRuntime['playStream']>) {
  const calls: string[] = []; const state: SpeechState = { speaking: false, localMode: false, currentText: '', message: '' };
  const controller = new SpeechPlaybackController({ isEnabled: () => true, beforeSpeak: () => {}, playStream,
    requestAudio: async () => { calls.push('complete-cloud'); return { mode: 'api', audioUrl: '/complete' }; },
    playAudio: async () => { calls.push('audio'); return true; }, playLocal: async () => { calls.push('local'); return true; }, update: patch => Object.assign(state, patch) });
  return { controller, state, calls };
}

test('unsupported stream retains the original complete-cloud API, but actual unavailable cloud alone uses local fallback', async () => {
  const unsupported = controllerHarness(async () => 'unsupported'); assert.equal(await unsupported.controller.speak(phrase), true); assert.deepEqual(unsupported.calls, ['complete-cloud', 'audio']);
  const unavailable = controllerHarness(async () => 'unavailable'); assert.equal(await unavailable.controller.speak(phrase), true); assert.deepEqual(unavailable.calls, ['local']); assert.equal(unavailable.state.localMode, true);
});

test('a partially spoken stream never restarts in local voice and never continues the next sentence', async () => {
  const h = controllerHarness(async (_, context) => { context.onStart(); return 'failed'; });
  assert.equal(await h.controller.speakSequence([phrase, { ...phrase, text: '下一句' }]), false);
  assert.deepEqual(h.calls, []); assert.equal(h.state.localMode, false); assert.equal(h.state.speaking, false); assert.match(h.state.message, /再听一次/);
});

test('a late stream completion after barge-in cannot revive fallback or begin the next sentence', async () => {
  let finish!: (value: 'completed') => void;
  const h = controllerHarness(async () => new Promise(resolve => { finish = resolve; }));
  const pending = h.controller.speakSequence([phrase, { ...phrase, text: '下一句' }]); h.controller.stop(); finish('completed');
  assert.equal(await pending, false); assert.deepEqual(h.calls, []); assert.equal(h.state.speaking, false);
});

test('a stream gesture rejection never retries complete audio or a different local voice', async () => {
  const h = controllerHarness(async () => { throw new PlaybackBlockedError(); }); assert.equal(await h.controller.speak(phrase), false); assert.deepEqual(h.calls, []); assert.match(h.state.message, /小喇叭/);
});
