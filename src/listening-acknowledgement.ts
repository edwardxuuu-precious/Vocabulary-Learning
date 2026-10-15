import type { PlaybackContext } from './speech-controller';

export const listeningPhrase = { text: '嗯，我在听。', locale: 'zh-CN' as const, tone: 'gentle' as const };
export interface ListeningFeedbackCallbacks { onBegin?: () => void; onQuiet: () => void; onSpeech: () => void; onRearm?: () => void; onEnd: () => void }

/** Energy only: this observer never finishes an utterance, changes PCM upload or claims to understand it. */
export class ListeningPauseObserver {
  private heard = false;
  private voiceMs = 0;
  private quietMs = 0;
  private inSpeech = false;
  private emitted = false;
  private feedbackCount = 0;
  private ended = false;
  constructor(private readonly callbacks: ListeningFeedbackCallbacks, private readonly quietAfterMs = 1600, private readonly threshold = .015) {}
  frame(rms: number, durationMs: number) {
    if (this.ended) return;
    if (rms > this.threshold) {
      if (!this.inSpeech) { this.inSpeech = true; this.callbacks.onSpeech(); }
      // Brief gaps within a phrase may contain unvoiced sounds; separate noise bursts must not accumulate indefinitely.
      if (this.quietMs >= 300) this.voiceMs = 0;
      this.voiceMs += durationMs; if (this.voiceMs >= 120) this.heard = true;
      if (this.emitted && this.feedbackCount < 2 && this.voiceMs >= 400) { this.emitted = false; this.callbacks.onRearm?.(); }
      this.quietMs = 0;
    } else {
      this.inSpeech = false;
      this.quietMs += durationMs;
      if (!this.heard) { this.voiceMs = 0; return; }
      if (!this.emitted && this.feedbackCount < 2 && this.quietMs >= this.quietAfterMs) { this.emitted = true; this.feedbackCount++; this.callbacks.onQuiet(); }
    }
  }
  end() { if (!this.ended) { this.ended = true; this.callbacks.onEnd(); } }
}

interface AcknowledgementRuntime {
  enabled: () => boolean;
  prepare: (signal: AbortSignal) => Promise<string | null>;
  play: (url: string, context: PlaybackContext) => Promise<boolean>;
  update: (speaking: boolean) => void;
}
/** A separate owner with no beforeSpeak: a backchannel can never cancel or pause the child's microphone. */
export class ListeningAcknowledgement {
  private preparedUrl: string | null = null;
  private preparation: Promise<void> | null = null;
  private prepareAbort: AbortController | null = null;
  private playbackAbort: AbortController | null = null;
  private generation = 0;
  private capturing = false;
  private used = false;
  private feedbackCount = 0;
  private disposed = false;
  constructor(private readonly runtime: AcknowledgementRuntime) {}
  activate() { this.disposed = false; }
  prepare() {
    if (this.disposed || !this.runtime.enabled()) return Promise.resolve();
    if (this.preparation) return this.preparation;
    const controller = new AbortController(); this.prepareAbort = controller;
    this.preparation = this.runtime.prepare(controller.signal).then(url => { if (!this.disposed && !controller.signal.aborted) this.preparedUrl = url; }).catch(() => {}).finally(() => { if (this.prepareAbort === controller) this.prepareAbort = null; });
    return this.preparation;
  }
  begin() { this.end(); this.capturing = true; this.used = false; this.feedbackCount = 0; void this.prepare(); }
  quiet() {
    if (!this.capturing || this.used || this.feedbackCount >= 2 || this.disposed || !this.runtime.enabled()) return;
    this.used = true; this.feedbackCount++;
    // Never queue an unready phrase behind cloud preparation or behind the actual reply.
    if (!this.preparedUrl) return;
    this.stopPlayback(); const request = this.generation;
    const controller = new AbortController(); this.playbackAbort = controller;
    const current = () => this.capturing && !this.disposed && !controller.signal.aborted && request === this.generation;
    void this.runtime.play(this.preparedUrl, { signal: controller.signal, onStart: () => { if (current()) this.runtime.update(true); } })
      .catch(() => false).finally(() => { if (current()) { this.playbackAbort = null; this.runtime.update(false); } });
  }
  speech() { this.stopPlayback(); }
  rearm() { if (this.capturing && this.feedbackCount < 2) this.used = false; }
  end() { this.capturing = false; this.stopPlayback(); }
  dispose() { this.disposed = true; this.end(); this.prepareAbort?.abort(); this.prepareAbort = null; this.preparation = null; this.preparedUrl = null; }
  private stopPlayback() { this.generation++; this.playbackAbort?.abort(); this.playbackAbort = null; this.runtime.update(false); }
}
