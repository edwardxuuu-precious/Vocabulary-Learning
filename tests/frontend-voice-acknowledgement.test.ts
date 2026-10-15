import test from 'node:test';
import assert from 'node:assert/strict';
import { ListeningAcknowledgement, ListeningPauseObserver, listeningPhrase } from '../src/listening-acknowledgement';
import { playBrowserAudio } from '../src/browser-speech';
import type { PlaybackContext } from '../src/speech-controller';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function harness(prepare: (signal: AbortSignal) => Promise<string | null> = async () => '/cached-listening.mp3') {
  let preparations = 0, enabled = true;
  const states: boolean[] = [], plays: { url: string; context: PlaybackContext; resolve: (value: boolean) => void }[] = [];
  const acknowledgement = new ListeningAcknowledgement({ enabled: () => enabled,
    prepare: signal => { preparations++; return prepare(signal); },
    play: (url, context) => { const pending = deferred<boolean>(); plays.push({ url, context, resolve: pending.resolve }); return pending.promise; },
    update: speaking => states.push(speaking),
  });
  return { acknowledgement, states, plays, preparations: () => preparations, mute: () => { enabled = false; } };
}

test('quiet energy before speech and a short noise burst never trigger a listening acknowledgement', () => {
  let quiet = 0; const observer = new ListeningPauseObserver({ onQuiet: () => { quiet++; }, onSpeech: () => {}, onEnd: () => {} });
  observer.frame(0, 5000); observer.frame(.1, 80); observer.frame(0, 5000); assert.equal(quiet, 0);
});

test('actual speech then 1.6 seconds quiet emits once, permits resumed speech and never ends capture', () => {
  const events: string[] = [];
  const observer = new ListeningPauseObserver({ onQuiet: () => events.push('ack'), onSpeech: () => events.push('speech'), onEnd: () => events.push('end') });
  observer.frame(.1, 170); observer.frame(0, 1500); assert.deepEqual(events, ['speech']);
  observer.frame(0, 100); assert.deepEqual(events, ['speech', 'ack']);
  observer.frame(.1, 170); observer.frame(0, 3500); assert.deepEqual(events, ['speech', 'ack', 'speech']);
  observer.end(); observer.end(); observer.frame(.1, 500); assert.deepEqual(events, ['speech', 'ack', 'speech', 'end']);
});

test('a long quiet segment never repeats feedback without new sustained speech', () => {
  let count = 0; const observer = new ListeningPauseObserver({ onQuiet: () => { count++; }, onSpeech: () => {}, onEnd: () => {} });
  observer.frame(.1, 170); observer.frame(0, 1600); for (let second = 0; second < 15; second++) observer.frame(0, 1000);
  assert.equal(count, 1);
});

test('short noise after the first feedback stops sound but never rearms another quiet response', () => {
  let feedback = 0, activity = 0, rearms = 0;
  const observer = new ListeningPauseObserver({ onQuiet: () => { feedback++; }, onSpeech: () => { activity++; }, onRearm: () => { rearms++; }, onEnd: () => {} });
  observer.frame(.1, 170); observer.frame(0, 1600);
  for (let burst = 0; burst < 5; burst++) { observer.frame(.1, 85); observer.frame(0, 1600); }
  assert.equal(feedback, 1); assert.equal(rearms, 0); assert.equal(activity, 6);
});

test('400ms of resumed speech permits the second quiet response, and a third spoken segment reaches the per-capture limit', () => {
  const events: string[] = [];
  const observer = new ListeningPauseObserver({ onQuiet: () => events.push('feedback'), onSpeech: () => {}, onRearm: () => events.push('rearm'), onEnd: () => {} });
  observer.frame(.1, 170); observer.frame(0, 3000);
  observer.frame(.1, 250); observer.frame(0, 100); observer.frame(.1, 150); observer.frame(0, 1600);
  assert.deepEqual(events, ['feedback', 'rearm', 'feedback']);
  observer.frame(.1, 1000); observer.frame(0, 5000); assert.deepEqual(events, ['feedback', 'rearm', 'feedback']);
});

test('the independent player also enforces two responses and only rearms through the sustained-speech callback', async () => {
  const h = harness(); await h.acknowledgement.prepare(); h.acknowledgement.begin();
  const observer = new ListeningPauseObserver({ onQuiet: () => h.acknowledgement.quiet(), onSpeech: () => h.acknowledgement.speech(), onRearm: () => h.acknowledgement.rearm(), onEnd: () => h.acknowledgement.end() });
  observer.frame(.1, 170); observer.frame(0, 1600); h.plays[0].context.onStart();
  observer.frame(.1, 85); assert.equal(h.plays[0].context.signal.aborted, true); observer.frame(0, 1600); assert.equal(h.plays.length, 1);
  observer.frame(.1, 450); observer.frame(0, 1600); assert.equal(h.plays.length, 2);
  observer.frame(.1, 450); observer.frame(0, 1600); h.acknowledgement.rearm(); h.acknowledgement.quiet(); assert.equal(h.plays.length, 2);
  observer.end(); for (const play of h.plays) play.resolve(false); await flush(); assert.equal(h.states.at(-1), false);
});

test('the fixed prepared cloud phrase is reused with no extra preparation or microphone cancellation, once until sustained speech rearms it', async () => {
  const h = harness(); await h.acknowledgement.prepare(); h.acknowledgement.begin(); h.acknowledgement.quiet();
  assert.equal(h.plays.length, 1); assert.equal(h.plays[0].url, '/cached-listening.mp3'); assert.equal(h.states.at(-1), false);
  h.plays[0].context.onStart(); assert.equal(h.states.at(-1), true);
  h.plays[0].resolve(true); await flush(); assert.equal(h.states.at(-1), false);
  h.acknowledgement.quiet(); assert.equal(h.plays.length, 1);
  h.acknowledgement.end(); h.acknowledgement.begin(); h.acknowledgement.quiet(); assert.equal(h.plays.length, 2); assert.equal(h.preparations(), 1);
  h.acknowledgement.end(); h.plays[1].resolve(false);
  assert.deepEqual(listeningPhrase, { text: '嗯，我在听。', locale: 'zh-CN', tone: 'gentle' });
});

test('resumed child speech immediately stops the backchannel, and late playing/end callbacks cannot revive it', async () => {
  const h = harness(); await h.acknowledgement.prepare(); h.acknowledgement.begin(); h.acknowledgement.quiet();
  const previous = h.plays[0]; previous.context.onStart(); h.acknowledgement.speech(); assert.equal(previous.context.signal.aborted, true); assert.equal(h.states.at(-1), false);
  previous.context.onStart(); previous.resolve(true); await flush(); assert.equal(h.states.at(-1), false);
  h.acknowledgement.quiet(); assert.equal(h.plays.length, 1);
});

test('endpoint, manual finish, page change and formal reply all use end to cancel backchannel ownership', async () => {
  const h = harness(); await h.acknowledgement.prepare();
  for (const reason of ['endpoint', 'manual finish', 'page change', 'formal reply']) {
    h.acknowledgement.begin(); h.acknowledgement.quiet(); const current = h.plays.at(-1)!; current.context.onStart();
    h.acknowledgement.end(); assert.equal(current.context.signal.aborted, true, reason);
    current.context.onStart(); current.resolve(true); await flush(); assert.equal(h.states.at(-1), false, reason);
  }
});

test('unready audio is skipped rather than queued behind preparation or the actual Codex answer', async () => {
  const ready = deferred<string | null>(); const h = harness(() => ready.promise);
  h.acknowledgement.begin(); h.acknowledgement.quiet(); assert.equal(h.plays.length, 0);
  ready.resolve('/eventually-ready'); await h.acknowledgement.prepare(); h.acknowledgement.quiet(); assert.equal(h.plays.length, 0);
  h.acknowledgement.end(); h.acknowledgement.begin(); h.acknowledgement.quiet(); assert.equal(h.plays.length, 1); h.acknowledgement.end(); h.plays[0].resolve(false);
});

test('missing cloud preparation and muted speech never manufacture a local replacement or loop requests', async () => {
  const h = harness(async () => null); await h.acknowledgement.prepare(); h.acknowledgement.begin(); h.acknowledgement.quiet(); h.acknowledgement.end();
  h.acknowledgement.begin(); h.acknowledgement.quiet(); assert.equal(h.plays.length, 0); assert.equal(h.preparations(), 1);
  const muted = harness(); muted.mute(); muted.acknowledgement.begin(); muted.acknowledgement.quiet(); await flush(); assert.equal(muted.preparations(), 0); assert.equal(muted.plays.length, 0);
});

test('dispose cancels preparation; a StrictMode remount can prepare again without accepting stale audio', async () => {
  const old = deferred<string | null>(), current = deferred<string | null>(); let count = 0, firstSignal: AbortSignal | undefined;
  const h = harness(signal => { if (++count === 1) { firstSignal = signal; return old.promise; } return current.promise; });
  h.acknowledgement.prepare(); h.acknowledgement.dispose(); assert.equal(firstSignal?.aborted, true);
  h.acknowledgement.activate(); const preparation = h.acknowledgement.prepare(); old.resolve('/old'); current.resolve('/new'); await preparation;
  h.acknowledgement.begin(); h.acknowledgement.quiet(); assert.equal(h.plays[0].url, '/new'); h.acknowledgement.dispose(); h.plays[0].resolve(false);
});

test('backchannel browser audio uses moderate volume and only playing announces audible feedback', async t => {
  let audio!: FakeAudio;
  class FakeAudio {
    volume = 1; onplay: (() => void) | null = null; onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor(_: string) { audio = this; } play() { this.onplay?.(); return Promise.resolve(); } pause() {}
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Audio'); Object.defineProperty(globalThis, 'Audio', { value: FakeAudio, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Audio', previous); else Reflect.deleteProperty(globalThis, 'Audio'); });
  let starts = 0; const abort = new AbortController(); const playing = playBrowserAudio('/fixed', { signal: abort.signal, onStart: () => { starts++; } }, 8000, { volume: .7, onPlayingOnly: true });
  assert.equal(audio.volume, .7); assert.equal(starts, 0); audio.onplaying?.(); assert.equal(starts, 1); abort.abort(); assert.equal(await playing, false); assert.equal(audio.onplaying, null);
});
