import type { SpeechSegment } from './speech-controller';

export const introductionPhases = ['english', 'meaning', 'english-again', 'picture', 'summary', 'ready'] as const;
export type IntroductionPhase = typeof introductionPhases[number];
export interface IntroductionState { phase: IntroductionPhase; waiting: boolean; audioFailed: boolean; transitionFailed?: boolean }
export interface IntroductionRuntime {
  compact?: boolean;
  speak: (segments: SpeechSegment[]) => Promise<boolean>;
  stop: () => void;
  update: (state: IntroductionState) => void;
  complete: () => Promise<boolean> | boolean;
  isAudioEnabled?: () => boolean;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}
export const meaningNarration = (meaning: string) => `意思是，${meaning.replace(/[。！？!?]+$/u, '')}。`;
const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
  const timer = setTimeout(finish, ms);
  signal.addEventListener('abort', finish, { once: true });
  if (signal.aborted) finish();
});

/** Only exposure is completed automatically; no answer or mastery evidence is recorded. */
export class WordIntroductionController {
  private index = 0;
  private generation = 0;
  private abort: AbortController | undefined;
  private completed = false;
  private completion: Promise<boolean> | undefined;
  constructor(private readonly term: string, private readonly meaning: string, private readonly runtime: IntroductionRuntime) {}
  cancel() { this.generation++; this.abort?.abort(); this.abort = undefined; this.runtime.stop(); }
  pause() { this.cancel(); this.publish(true); }
  replay() { this.index = 0; return this.resume(); }
  private publish(waiting: boolean, audioFailed = false) { this.runtime.update({ phase: introductionPhases[this.index], waiting, audioFailed }); }
  async resume() {
    if (this.completed) return;
    this.cancel();
    const generation = this.generation, abort = new AbortController(); this.abort = abort;
    const current = () => generation === this.generation && !abort.signal.aborted;
    const english: SpeechSegment = { text: this.term, locale: 'en-US', tone: 'clear', cacheOnly: true, allowLocalFallback: false };
    const chinese: SpeechSegment = { text: meaningNarration(this.meaning), locale: 'zh-CN', tone: 'clear', allowLocalFallback: false };
    while (current()) {
      const phase = introductionPhases[this.index]; this.publish(false);
      if (phase === 'ready') {
        if (!this.completion) {
          await (this.runtime.wait ?? wait)(1000, abort.signal);
          if (!current() || this.completed) return;
          if (!this.completion) {
            try { this.completion = Promise.resolve(this.runtime.complete()).catch(() => false); }
            catch { this.completion = Promise.resolve(false); }
          }
        }
        const completion = this.completion;
        this.completed = await completion;
        if (this.completion === completion) this.completion = undefined;
        if (current() && !this.completed) this.runtime.update({ phase, waiting: true, audioFailed: false, transitionFailed: true });
        return;
      }
      let completed = true;
      try {
        if (phase === 'picture') await (this.runtime.wait ?? wait)(650, abort.signal);
        else completed = this.runtime.isAudioEnabled?.() === false ? false : await this.runtime.speak(phase === 'summary' ? [english, chinese] : [phase === 'meaning' ? chinese : english]);
      } catch { completed = false; }
      if (!current()) return;
      if (!completed) {
        this.publish(false, true);
        const readingTime = Math.min(6000, Math.max(2200, [...this.meaning].length * 160));
        await (this.runtime.wait ?? wait)(phase === 'meaning' || phase === 'summary' ? readingTime : 1400, abort.signal);
        if (!current()) return;
      }
      this.index = this.runtime.compact && phase === 'meaning' ? introductionPhases.indexOf('ready') : this.index + 1;
    }
  }
}
