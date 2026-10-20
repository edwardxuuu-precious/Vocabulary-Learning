import { PlaybackBlockedError, type PlaybackContext } from './speech-controller';

export type FeedbackCue = 'correct' | 'retry' | 'saved';
export interface AudioTrace { source: 'cache' | 'recording' | 'feedback'; durationMs: number; warmupMs: number; completed: boolean; started: boolean }
export interface BufferedAudioEnvironment {
  createContext(): AudioContext;
  fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer>;
  now(): number;
}
const abortError = () => new DOMException('播放已取消', 'AbortError');
function owned<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(abortError()); };
    if (signal.aborted) { reject(abortError()); return; }
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => { signal.removeEventListener('abort', cancel); signal.aborted ? reject(abortError()) : resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

/** A document owns one output context. Short samples are complete before any audible word starts. */
export class BufferedAudioEngine {
  private context?: AudioContext;
  private owner?: AbortController;
  private cache = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer>>();
  private cold = true;
  private lastOutput = -Infinity;
  lastTrace?: AudioTrace;
  constructor(private environment: BufferedAudioEnvironment) {}
  private audioContext() { return this.context ??= this.environment.createContext(); }
  async unlock() {
    const context = this.audioContext();
    if (context.state === 'suspended') { this.cold = true; await context.resume(); }
    if (context.state !== 'running') throw new PlaybackBlockedError();
  }
  markCold() { this.cold = true; }
  stop() { this.owner?.abort(); this.owner = undefined; }
  get busy() { return !!this.owner; }
  private async decode(url: string): Promise<AudioBuffer> {
    const shared = url.startsWith('/media/') || url.startsWith('/assets/');
    const cached = this.cache.get(url);
    if (shared && cached) { this.cache.delete(url); this.cache.set(url, cached); return cached; }
    const pending = shared ? this.inflight.get(url) : undefined;
    if (pending) return pending;
    const load = (async () => {
      const bytes = await this.environment.fetchBytes(url, AbortSignal.timeout(20000));
      const buffer = await this.audioContext().decodeAudioData(bytes);
      if (!buffer.length || !Number.isFinite(buffer.duration) || buffer.duration <= 0) throw Error('声音文件无法完整解码。');
      if (shared) {
        this.cache.set(url, buffer);
        let total = [...this.cache.values()].reduce((n, b) => n + b.length * b.numberOfChannels * 4, 0);
        while (this.cache.size > 32 || total > 24 * 1024 * 1024 && this.cache.size > 1) {
          const key = this.cache.keys().next().value!, old = this.cache.get(key)!;
          total -= old.length * old.numberOfChannels * 4; this.cache.delete(key);
        }
      }
      return buffer;
    })();
    if (shared) this.inflight.set(url, load);
    try { return await load; } finally { if (shared && this.inflight.get(url) === load) this.inflight.delete(url); }
  }
  async prefetch(url: string) { if (url.startsWith('/media/') || url.startsWith('/assets/')) await this.decode(url); }
  private sample(buffer: AudioBuffer, signal: AbortSignal, volume: number, callbacks?: PlaybackContext): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const context = this.audioContext(), source = context.createBufferSource(), gain = context.createGain();
      let settled = false, started = false;
      let tail: ReturnType<typeof setTimeout> | undefined;
      const finish = (completed: boolean, error?: unknown) => {
        if (settled) return; settled = true; clearInterval(progress); clearTimeout(tail); clearTimeout(timeout);
        signal.removeEventListener('abort', cancel); source.onended = null;
        try { if (!completed) source.stop(); source.disconnect(); gain.disconnect(); } catch { /* Already detached. */ }
        if (error) reject(error); else resolve(completed);
      };
      const cancel = () => finish(false);
      const startAt = context.currentTime + .02;
      const progress = setInterval(() => {
        if (!settled && !signal.aborted && context.state === 'running' && context.currentTime >= startAt) {
          if (!started) { started = true; callbacks?.onStart(); }
          callbacks?.onProgress?.(Math.min(1, Math.max(0, (context.currentTime - startAt) / buffer.duration)));
        }
      }, 16);
      const timeout = setTimeout(() => finish(false), Math.min(90000, buffer.duration * 1000 + 10000));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { finish(false); return; }
      source.buffer = buffer; gain.gain.value = volume; source.connect(gain); gain.connect(context.destination);
      source.onended = () => {
        if (signal.aborted || context.state !== 'running') { finish(false); return; }
        if (!started) { started = true; callbacks?.onStart(); }
        callbacks?.onProgress?.(1);
        // Let the output device drain its final samples before another owner can replace it.
        tail = setTimeout(() => finish(true), callbacks ? 100 : 0);
      };
      try { source.start(startAt, 0); } catch (error) { finish(false, error); }
    });
  }
  private async warm(signal: AbortSignal) {
    if (!this.cold && this.environment.now() - this.lastOutput < 5000) return 0;
    const context = this.audioContext(), buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .4), context.sampleRate), data = buffer.getChannelData(0);
    // A very soft neutral pulse opens the physical output, followed by a quiet settling interval.
    for (let i = 0; i < Math.min(data.length, context.sampleRate * .08); i++) data[i] = .002 * Math.sin(i * 2 * Math.PI * 180 / context.sampleRate) * Math.sin(Math.PI * i / (context.sampleRate * .08));
    if (!await this.sample(buffer, signal, 1)) throw abortError();
    this.cold = false; return 400;
  }
  async play(url: string, callbacks: PlaybackContext, volume = 1): Promise<boolean> {
    this.stop(); const owner = new AbortController(); this.owner = owner;
    const signal = AbortSignal.any([callbacks.signal, owner.signal]);
    const trace: AudioTrace = { source: url.startsWith('blob:') || url.startsWith('/api/') ? 'recording' : 'cache', durationMs: 0, warmupMs: 0, completed: false, started: false }; this.lastTrace = trace;
    try {
      await owned(this.unlock(), signal);
      const buffer = await owned(this.decode(url), signal); trace.durationMs = buffer.duration * 1000;
      trace.warmupMs = await this.warm(signal);
      trace.completed = await this.sample(buffer, signal, volume, { ...callbacks, onStart: () => { trace.started = true; callbacks.onStart(); } });
      return trace.completed;
    } catch (error) {
      if (signal.aborted) return false;
      if (error instanceof PlaybackBlockedError || error instanceof DOMException && error.name === 'NotAllowedError') throw new PlaybackBlockedError();
      return false;
    } finally { this.lastOutput = this.environment.now(); if (this.owner === owner) this.owner = undefined; }
  }
  async cue(kind: FeedbackCue): Promise<boolean> {
    // Feedback never cuts through a word or recording playback.
    if (this.owner) return false;
    const owner = new AbortController(); this.owner = owner;
    try {
      await this.unlock(); await this.warm(owner.signal);
      const context = this.audioContext(), seconds = kind === 'saved' ? .13 : .23, buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate), data = buffer.getChannelData(0);
      const notes = kind === 'correct' ? [554, 740] : kind === 'retry' ? [262, 220] : [440];
      for (let i = 0; i < data.length; i++) { const t = i / context.sampleRate, note = Math.min(notes.length - 1, Math.floor(t / seconds * notes.length)), local = t / seconds * notes.length % 1; data[i] = .09 * Math.sin(2 * Math.PI * notes[note] * t) * Math.sin(Math.PI * local) ** 2; }
      return await this.sample(buffer, owner.signal, 1);
    } catch { return false; } finally { this.lastOutput = this.environment.now(); if (this.owner === owner) this.owner = undefined; }
  }
}

let engine: BufferedAudioEngine | undefined;
let feedbackEnabled = true;
const feedbackKeys = new Set<string>();
export function browserAudioAvailable() { return typeof AudioContext !== 'undefined'; }
export function audioEngine() {
  if (!engine) {
    engine = new BufferedAudioEngine({ createContext: () => new AudioContext(), now: () => performance.now(), fetchBytes: async (url, signal) => { const response = await fetch(url, { signal }); if (!response.ok) throw Error('声音文件暂不可用。'); return response.arrayBuffer(); } });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { engine?.markCold(); if (document.hidden) engine?.stop(); });
      window.addEventListener('pagehide', () => { engine?.stop(); engine?.markCold(); });
      navigator.mediaDevices?.addEventListener?.('devicechange', () => engine?.markCold());
    }
  }
  return engine;
}
export async function unlockBrowserAudio() { if (browserAudioAvailable()) { try { await audioEngine().unlock(); } catch { /* A real play reports the gesture error in place. */ } } }
export function markAudioOutputCold() { engine?.markCold(); }
export function stopBrowserAudio() { engine?.stop(); }
export function configureFeedback(enabled: boolean) { feedbackEnabled = enabled; }
export async function playFeedbackCue(kind: FeedbackCue, key: string) {
  if (!feedbackEnabled || !browserAudioAvailable() || typeof document !== 'undefined' && document.hidden || feedbackKeys.has(key)) return;
  feedbackKeys.add(key); if (feedbackKeys.size > 128) feedbackKeys.delete(feedbackKeys.values().next().value!);
  await audioEngine().cue(kind);
}
