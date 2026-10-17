import type { VoiceTone } from '../shared/contracts';

export interface SpeechSegment { text: string; locale: 'zh-CN' | 'en-US'; tone?: VoiceTone; cacheOnly?: boolean; allowLocalFallback?: boolean }
export interface SpeechAsset { mode: 'api' | 'local'; audioUrl?: string }
export interface SpeechState { speaking: boolean; localMode: boolean; currentText: string; message: string }
export interface PlaybackContext { signal: AbortSignal; onStart: () => void }
export type StreamPlaybackResult = 'completed' | 'unsupported' | 'unavailable' | 'failed';
export class PlaybackBlockedError extends Error { constructor() { super('浏览器需要点一下才能播放声音。点小喇叭，再听一次。'); this.name = 'PlaybackBlockedError'; } }
export interface SpeechRuntime {
  isEnabled: () => boolean;
  beforeSpeak: () => void;
  playStream?: (segment: SpeechSegment, context: PlaybackContext) => Promise<StreamPlaybackResult>;
  requestAudio: (segment: SpeechSegment, signal: AbortSignal) => Promise<SpeechAsset>;
  playAudio: (url: string, context: PlaybackContext) => Promise<boolean>;
  playLocal: (segment: SpeechSegment, context: PlaybackContext) => Promise<boolean>;
  update: (state: Partial<SpeechState>) => void;
}

/** One generation owns an entire utterance sequence, including every asynchronous boundary. */
export class SpeechPlaybackController {
  private generation = 0;
  private abort: AbortController | null = null;
  constructor(private readonly runtime: SpeechRuntime) {}
  getPlaybackId() { return this.generation; }
  stopIfPlayback(id: number) { if (id === this.generation) this.stop(); }
  stop() {
    this.generation += 1;
    const abort = this.abort; this.abort = null; abort?.abort();
    this.runtime.update({ speaking: false, currentText: '' });
  }
  speak(segment: SpeechSegment) { return this.speakSequence([segment]); }
  async speakSequence(segments: SpeechSegment[]): Promise<boolean> {
    this.stop();
    if (!this.runtime.isEnabled()) return false;
    const request = this.generation;
    this.runtime.beforeSpeak();
    this.runtime.update({ message: '' });
    const abort = new AbortController(); this.abort = abort;
    const isCurrent = () => request === this.generation && !abort.signal.aborted;
    try {
      for (const segment of segments) {
        if (!isCurrent()) return false;
        const completed = await this.playSegment(segment, abort.signal, isCurrent);
        // stop() may run after the prior segment settles but before this continuation executes.
        if (!isCurrent() || !completed) return false;
      }
      return isCurrent();
    } finally {
      if (request === this.generation) { this.abort = null; this.runtime.update({ speaking: false, currentText: '' }); }
    }
  }
  private async playSegment(segment: SpeechSegment, signal: AbortSignal, isCurrent: () => boolean): Promise<boolean> {
    const context: PlaybackContext = { signal, onStart: () => { if (isCurrent()) this.runtime.update({ speaking: true, currentText: segment.text }); } };
    let asset: SpeechAsset = { mode: 'local' };
    let requestCompleteAudio = true;
    if (this.runtime.playStream) {
      this.runtime.update({ localMode: false });
      let streamed: StreamPlaybackResult;
      try { streamed = await this.runtime.playStream(segment, context); } catch (failure) {
        if (!isCurrent()) return false;
        this.runtime.update({ speaking: false, message: failure instanceof PlaybackBlockedError ? failure.message : '这次声音中断了，点小喇叭再听一次。' });
        return false;
      }
      if (!isCurrent()) return false;
      this.runtime.update({ speaking: false });
      if (streamed === 'completed') return true;
      if (streamed === 'failed') { this.runtime.update({ message: '这次声音中断了，点小喇叭再听一次。' }); return false; }
      requestCompleteAudio = streamed === 'unsupported';
    }
    if (requestCompleteAudio) try { asset = await this.runtime.requestAudio(segment, signal); } catch (failure) {
      if (!isCurrent()) return false;
      if (segment.allowLocalFallback === false) { this.runtime.update({ speaking: false, message: failure instanceof Error ? failure.message : '这次声音没能播放，可以点按钮继续。' }); return false; }
    }
    if (!isCurrent()) return false;
    if (asset.mode === 'api' && asset.audioUrl) {
      this.runtime.update({ localMode: false });
      let played = false;
      try { played = await this.runtime.playAudio(asset.audioUrl, context); } catch (failure) {
        if (isCurrent() && failure instanceof PlaybackBlockedError) { this.runtime.update({ message: failure.message }); return false; }
        /* Try one honest local fallback for a real playback failure, while still owned. */
      }
      if (!isCurrent()) return false;
      this.runtime.update({ speaking: false });
      if (played) return true;
    }
    if (!isCurrent()) return false;
    if (segment.cacheOnly) { this.runtime.update({ speaking: false, message: '缓存声音暂时没能播放，可以重听或跳过。' }); return false; }
    if (segment.allowLocalFallback === false) { this.runtime.update({ speaking: false, message: '讲解声音暂时不可用，可以重听或点箭头继续。' }); return false; }
    this.runtime.update({ localMode: true });
    let played = false;
    try { played = await this.runtime.playLocal(segment, context); } catch { /* A missing browser voice must release the interaction. */ }
    if (!isCurrent()) return false;
    this.runtime.update({ speaking: false });
    if (!played) this.runtime.update({ message: '这次声音没能播放，可以点按钮继续。' });
    return played;
  }
}

export type MicrophoneAction = 'finish' | 'cancel' | 'start' | 'unavailable';
export function microphoneAction(state: { recording: boolean; processing: boolean; configured: boolean }): MicrophoneAction {
  if (state.recording) return 'finish';
  if (state.processing) return 'cancel';
  return state.configured ? 'start' : 'unavailable';
}

/** Only a confirmation page accepts yes/no; a ready page accepts starting without another model turn. */
export function confirmedInterestIntent(phase: 'ask' | 'confirm' | 'ready', transcript: string): 'yes' | 'retry' | 'start' | 'unknown' {
  const text = transcript.trim().replace(/[。！？!?，,\s]/g, '');
  if (phase === 'ready') return /^(开始|开始吧|开始玩|开始学习|好|好的|我们开始吧|一起玩|一起玩吧|继续|走吧|出发|好呀|可以)$/.test(text) ? 'start' : 'unknown';
  if (phase !== 'confirm') return 'unknown';
  if (/不是|不对|没听对|没有|重新|重说|再说|听错|不喜欢/.test(text) || /^不[是对]?/.test(text)) return 'retry';
  if (/^(嗯|嗯嗯|好|好的|对|对的|对呀|对啊|是|是的|是呀|是啊|没错|就是这个|就是这样|对就是这个|对的就是这个|对的就这个|没错就是这个|是这个|正确)$/.test(text) || /^嗯(对|是的|没错)$/.test(text)) return 'yes';
  return 'unknown';
}
