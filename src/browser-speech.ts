import { PlaybackBlockedError, type PlaybackContext, type SpeechSegment } from './speech-controller';

/** Every browser player settles on cancellation, error, end or a bounded missing-event timeout. */
export function playBrowserAudio(url: string, context: PlaybackContext, timeoutMs = 90000, options: { volume?: number; onPlayingOnly?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let audio: HTMLAudioElement;
    try { audio = new Audio(url); } catch { resolve(false); return; }
    let settled = false;
    const done = (completed: boolean, blocked = false) => {
      if (settled) return; settled = true;
      clearTimeout(timer); context.signal.removeEventListener('abort', cancelled);
      audio.onplay = null; audio.onplaying = null; audio.onended = null; audio.onerror = null;
      try { audio.pause(); } catch { /* Cleanup is best effort; the generation already prevents stale callbacks. */ }
      if (blocked) reject(new PlaybackBlockedError()); else resolve(completed);
    };
    const cancelled = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    context.signal.addEventListener('abort', cancelled, { once: true });
    if (context.signal.aborted) { done(false); return; }
    if (options.volume !== undefined) audio.volume = Math.max(0, Math.min(1, options.volume));
    const started = () => { if (!settled && !context.signal.aborted) context.onStart(); };
    if (options.onPlayingOnly) audio.onplaying = started; else audio.onplay = started;
    audio.onended = () => done(true); audio.onerror = () => done(false);
    const failed = (failure: unknown) => done(false, typeof failure === 'object' && failure !== null && 'name' in failure && failure.name === 'NotAllowedError');
    try { void audio.play().catch(failed); } catch (failure) { failed(failure); }
  });
}

export function playBrowserLocal(segment: SpeechSegment, context: PlaybackContext, timeoutMs = Math.min(90000, Math.max(12000, segment.text.length * 500))): Promise<boolean> {
  return new Promise(resolve => {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') { resolve(false); return; }
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = new SpeechSynthesisUtterance(segment.text); utterance.lang = segment.locale;
      utterance.rate = segment.locale === 'en-US' ? .75 : .93;
      const voices = synth.getVoices();
      const chosen = voices.find(voice => voice.lang.toLowerCase() === segment.locale.toLowerCase()) ?? voices.find(voice => voice.lang.startsWith(segment.locale.slice(0, 2)));
      if (chosen) utterance.voice = chosen;
    } catch { resolve(false); return; }
    let settled = false;
    const done = (completed: boolean) => {
      if (settled) return; settled = true;
      clearTimeout(timer); context.signal.removeEventListener('abort', cancelled);
      utterance.onstart = null; utterance.onend = null; utterance.onerror = null;
      if (!completed) { try { synth.cancel(); } catch { /* A failed system engine must never keep the learning UI pending. */ } }
      resolve(completed);
    };
    const cancelled = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    context.signal.addEventListener('abort', cancelled, { once: true });
    if (context.signal.aborted) { done(false); return; }
    utterance.onstart = () => { if (!settled && !context.signal.aborted) context.onStart(); };
    utterance.onend = () => done(true); utterance.onerror = () => done(false);
    try { synth.speak(utterance); } catch { done(false); }
  });
}
