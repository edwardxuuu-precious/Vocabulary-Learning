import test from 'node:test';
import assert from 'node:assert/strict';
import { WordIntroductionController, meaningNarration, type IntroductionState } from '../src/word-introduction';
import { SpeechPlaybackController, type SpeechSegment } from '../src/speech-controller';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness(speak: (segments: SpeechSegment[]) => Promise<boolean> = async () => true, audioEnabled = true, complete = async () => true) {
  const states: IntroductionState[] = [], audio: SpeechSegment[] = [], events: string[] = [];
  let completions = 0;
  const controller = new WordIntroductionController('make', '制作', {
    speak: segments => { audio.push(...segments); events.push(...segments.map(s => s.locale)); return speak(segments); },
    stop() {}, update: state => { states.push(state); events.push(state.phase); },
    isAudioEnabled: () => audioEnabled,
    complete: async () => { completions++; events.push('complete-exposure'); return complete(); },
    wait: async (ms, signal) => { assert.equal(signal.aborted, false); events.push(ms === 650 ? 'picture-delay' : ms === 1000 ? 'finish-delay' : `visual-delay:${ms}`); },
  });
  return { controller, states, audio, events, completions: () => completions };
}

test('narration automatically completes exposure once after English/Chinese/English/picture/English+Chinese, without narrating POS', async () => {
  const h = harness(); await h.controller.resume();
  assert.deepEqual(h.events, ['english', 'en-US', 'meaning', 'zh-CN', 'english-again', 'en-US', 'picture', 'picture-delay', 'summary', 'en-US', 'zh-CN', 'ready', 'finish-delay', 'complete-exposure']);
  assert.deepEqual(h.audio.map(s => s.text), ['make', '意思是，制作。', 'make', 'make', '意思是，制作。']);
  assert.ok(h.audio.every(s => s.allowLocalFallback === false && s.tone === 'clear'));
  assert.ok(h.audio.filter(s => s.locale === 'en-US').every(s => s.cacheOnly));
  assert.ok(h.audio.filter(s => s.locale === 'zh-CN').every(s => !s.cacheOnly));
  assert.deepEqual(h.states.at(-1), { phase: 'ready', waiting: false, audioFailed: false });
  await h.controller.resume(); await h.controller.replay(); assert.equal(h.completions(), 1);
});

test('failed audio shows its real status and automatically continues with timed visuals', async () => {
  const h = harness(async () => false); await h.controller.resume();
  assert.deepEqual(h.events.filter(event => event.startsWith('visual-delay')), ['visual-delay:1400', 'visual-delay:2200', 'visual-delay:1400', 'visual-delay:2200']);
  assert.ok(h.states.some(state => state.audioFailed && !state.waiting));
  assert.equal(h.states.at(-1)?.phase, 'ready'); assert.equal(h.completions(), 1);
});

test('muted introductions use timed visuals without requesting any speech', async () => {
  const h = harness(async () => { throw Error('Muted must not speak'); }, false); await h.controller.resume();
  assert.equal(h.audio.length, 0); assert.equal(h.completions(), 1);
  assert.deepEqual([...new Set(h.states.map(state => state.phase))], ['english', 'meaning', 'english-again', 'picture', 'summary', 'ready']);
});

test('thrown speech failures and long meanings remain bounded visual introductions', async () => {
  const waits: number[] = []; let completions = 0;
  const controller = new WordIntroductionController('make', '制作'.repeat(60), {
    speak: async () => { throw Error('Unavailable'); }, stop() {}, update() {}, complete: () => { completions++; return true; },
    wait: async ms => { waits.push(ms); },
  });
  await controller.resume(); assert.deepEqual(waits, [1400, 6000, 1400, 650, 6000, 1000]); assert.equal(completions, 1);
});

test('leaving during English cancels continuation even when playback resolves late', async () => {
  const pending = deferred<boolean>(), h = harness(() => pending.promise);
  const running = h.controller.resume(); h.controller.cancel(); pending.resolve(true); await running;
  assert.deepEqual(h.audio.map(s => s.text), ['make']);
  assert.equal(h.states.at(-1)?.phase, 'english');
});

test('pause preserves the current phase, and resume replays that phase without revealing the picture early', async () => {
  const pending = deferred<boolean>(); let calls = 0;
  const h = harness(async () => ++calls === 2 ? pending.promise : true);
  const old = h.controller.resume(); await flush(); h.controller.pause();
  assert.equal(h.states.at(-1)?.phase, 'meaning');
  await h.controller.resume(); pending.resolve(true); await old;
  assert.equal(h.states.filter(s => s.phase === 'ready').length, 1);
  assert.deepEqual(h.audio.map(s => s.locale), ['en-US', 'zh-CN', 'zh-CN', 'en-US', 'en-US', 'zh-CN']);
});

test('replay invalidates an earlier playback and cannot finish from stale audio', async () => {
  const first = deferred<boolean>(), second = deferred<boolean>(); let calls = 0;
  const h = harness(() => ++calls === 1 ? first.promise : second.promise);
  const old = h.controller.resume(), replay = h.controller.replay();
  first.resolve(true); await old;
  assert.equal(h.states.at(-1)?.phase, 'english'); assert.equal(h.completions(), 0);
  h.controller.cancel(); second.resolve(true); await replay;
  assert.equal(h.completions(), 0); assert.equal(h.audio.length, 2);
});

test('leaving during image reveal cancels the final bilingual replay', async () => {
  const pending = deferred<void>(), audio: string[] = []; let imageSignal: AbortSignal | undefined;
  const controller = new WordIntroductionController('make', '制作', {
    speak: async segments => { audio.push(...segments.map(s => s.text)); return true; }, stop() {}, update() {}, complete: () => { assert.fail('Cancelled introduction cannot finish'); },
    wait: (_, signal) => { imageSignal = signal; return pending.promise; },
  });
  const running = controller.resume(); await flush(); controller.cancel();
  assert.equal(imageSignal?.aborted, true); pending.resolve(); await running;
  assert.deepEqual(audio, ['make', '意思是，制作。', 'make']);
});

test('pausing during the final delay prevents automatic completion, and resume completes once', async () => {
  const pending = deferred<void>(); let completions = 0, holds = 0;
  const controller = new WordIntroductionController('make', '制作', {
    speak: async () => true, stop() {}, update() {}, complete: () => { completions++; return true; },
    wait: async ms => { if (ms === 1000 && ++holds === 1) await pending.promise; },
  });
  const old = controller.resume(); await flush(); controller.pause(); pending.resolve(); await old;
  assert.equal(completions, 0); await controller.resume(); assert.equal(completions, 1);
});

test('concurrent resumes cannot duplicate an in-flight exposure completion', async () => {
  const pending = deferred<boolean>(), h = harness(async () => true, true, () => pending.promise);
  const old = h.controller.resume(); await flush(); assert.equal(h.completions(), 1);
  const resumed = h.controller.resume(); pending.resolve(true); await Promise.all([old, resumed]); await h.controller.resume();
  assert.equal(h.completions(), 1);
});

test('a failed transition is reported honestly and can be retried without repeating narration', async () => {
  let requests = 0; const h = harness(async () => true, true, async () => ++requests > 1);
  await h.controller.resume(); assert.equal(h.states.at(-1)?.transitionFailed, true);
  const audioCount = h.audio.length; await h.controller.resume();
  assert.equal(h.completions(), 2); assert.equal(h.audio.length, audioCount); assert.equal(h.states.at(-1)?.transitionFailed, undefined);
});

test('a failed in-flight transition remains recoverable after pause and resume', async () => {
  const pending = deferred<boolean>(); let requests = 0;
  const h = harness(async () => true, true, () => ++requests === 1 ? pending.promise : Promise.resolve(true));
  const old = h.controller.resume(); await flush(); h.controller.pause();
  const resumed = h.controller.resume(); pending.resolve(false); await Promise.all([old, resumed]);
  assert.equal(h.completions(), 1); assert.equal(h.states.at(-1)?.transitionFailed, true);
  await h.controller.resume(); assert.equal(h.completions(), 2); assert.equal(h.states.at(-1)?.transitionFailed, undefined);
});

test('a strict chosen voice never falls back to an unchosen device voice on cloud errors', async () => {
  let locals = 0; let message = '';
  const controller = new SpeechPlaybackController({
    isEnabled: () => true, beforeSpeak() {}, requestAudio: async () => { throw Error('免费额度无法确认'); },
    playAudio: async () => false, playLocal: async () => { locals++; return true; }, update: patch => { if (patch.message) message = patch.message; },
  });
  assert.equal(await controller.speak({ text: '意思是，制作。', locale: 'zh-CN', allowLocalFallback: false }), false);
  assert.equal(locals, 0); assert.match(message, /免费额度无法确认/);
});

test('the same approved meaning creates the same cache text, with no generated additional explanation', () => {
  assert.equal(meaningNarration('制作'), meaningNarration('制作。'));
  assert.equal(meaningNarration('制作一只纸船'), '意思是，制作一只纸船。');
});
