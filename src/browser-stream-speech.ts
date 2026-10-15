import { PlaybackBlockedError, type PlaybackContext, type SpeechSegment, type StreamPlaybackResult } from './speech-controller';

export interface StreamingSpeechEnvironment {
  supported: () => boolean;
  fetch: typeof fetch;
  createMediaSource: () => MediaSource;
  createAudio: () => HTMLAudioElement;
  createObjectURL: (source: MediaSource) => string;
  revokeObjectURL: (url: string) => void;
}
const browserEnvironment: StreamingSpeechEnvironment = {
  supported: () => typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function' && MediaSource.isTypeSupported('audio/mpeg'),
  fetch: (...args) => fetch(...args),
  createMediaSource: () => new MediaSource(),
  createAudio: () => new Audio(),
  createObjectURL: source => URL.createObjectURL(source),
  revokeObjectURL: url => URL.revokeObjectURL(url),
};
class StreamDecoderUnavailableError extends Error {}

/** MP3 chunks are appended serially with network backpressure; playback never waits for the complete body. */
export function playBrowserStream(segment: SpeechSegment, context: PlaybackContext, environment = browserEnvironment, limits = { firstSoundMs: 20000, totalMs: 90000 }): Promise<StreamPlaybackResult> {
  if (context.signal.aborted) return Promise.resolve('failed');
  try { if (!environment.supported()) return Promise.resolve('unsupported'); } catch { return Promise.resolve('unsupported'); }
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false, started = false, received = false, inputEnded = false;
    let source: MediaSource | null = null, buffer: SourceBuffer | null = null, audio: HTMLAudioElement | null = null;
    let url = '', reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let detachSourceOpen = () => {};
    const complete = (result: StreamPlaybackResult, blocked = false) => {
      if (settled) return;
      settled = true; clearTimeout(firstSoundTimer); clearTimeout(totalTimer);
      context.signal.removeEventListener('abort', cancelled);
      controller.abort(); detachSourceOpen();
      try { void reader?.cancel().catch(() => {}); } catch { /* The reader may already be released. */ }
      if (audio) {
        audio.onplaying = null; audio.onended = null; audio.onerror = null;
        try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch { /* The generation is already closed. */ }
      }
      try { if (buffer?.updating && source?.readyState === 'open') buffer.abort(); } catch { /* A failed decoder may already be detached. */ }
      if (url) environment.revokeObjectURL(url);
      if (blocked) reject(new PlaybackBlockedError()); else resolve(result);
    };
    const cancelled = () => complete('failed');
    const mediaFailed = () => complete(started ? 'failed' : 'unsupported');
    const firstSoundTimer = setTimeout(() => complete(started ? 'failed' : received ? 'unsupported' : 'unavailable'), limits.firstSoundMs);
    const totalTimer = setTimeout(() => complete(started ? 'failed' : 'unavailable'), limits.totalMs);
    context.signal.addEventListener('abort', cancelled, { once: true });
    if (context.signal.aborted) { cancelled(); return; }
    try {
      source = environment.createMediaSource(); audio = environment.createAudio();
      const media = source;
      const opened = new Promise<SourceBuffer>((yes, no) => {
        const abort = () => no(new DOMException('Cancelled', 'AbortError'));
        const onOpen = () => {
          if (settled || controller.signal.aborted) return;
          detachSourceOpen();
          try { buffer = media.addSourceBuffer('audio/mpeg'); yes(buffer); } catch { no(new StreamDecoderUnavailableError()); }
        };
        detachSourceOpen = () => { media.removeEventListener('sourceopen', onOpen); controller.signal.removeEventListener('abort', abort); };
        media.addEventListener('sourceopen', onOpen, { once: true }); controller.signal.addEventListener('abort', abort, { once: true });
      });
      audio.onplaying = () => { if (!settled && !controller.signal.aborted && !started) { started = true; clearTimeout(firstSoundTimer); context.onStart(); } };
      audio.onended = () => complete(inputEnded && received ? 'completed' : 'failed');
      audio.onerror = mediaFailed;
      url = environment.createObjectURL(media); audio.preload = 'auto'; audio.src = url;

      // Establish both operations immediately. play() may wait for the first MP3 frame; an autoplay rejection must stop the fetch rather than switch voices.
      const response = environment.fetch('/api/speech/tts/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ ...segment, tone: segment.tone ?? 'clear' }), signal: controller.signal,
      }).then(result => { if (settled) { try { void result.body?.cancel().catch(() => {}); } catch {} } return result; });
      const ready = Promise.all([response, opened]);
      const playbackRejected = (failure: unknown) => {
        if (settled) return;
        if (typeof failure === 'object' && failure !== null && 'name' in failure && failure.name === 'NotAllowedError') complete('failed', true);
        else mediaFailed();
      };
      try { void audio.play().catch(playbackRejected); } catch (failure) { playbackRejected(failure); }
      const append = (target: SourceBuffer, chunk: Uint8Array) => new Promise<void>((yes, no) => {
        const cleanup = () => { target.removeEventListener('updateend', updated); target.removeEventListener('error', failed); controller.signal.removeEventListener('abort', abort); };
        const updated = () => { cleanup(); yes(); };
        const failed = () => { cleanup(); no(new Error('MP3 decode failed')); };
        const abort = () => { cleanup(); no(new DOMException('Cancelled', 'AbortError')); };
        target.addEventListener('updateend', updated, { once: true }); target.addEventListener('error', failed, { once: true }); controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) { abort(); return; }
        try { target.appendBuffer(new Uint8Array(chunk)); } catch (failure) { cleanup(); no(failure); }
      });
      void (async () => {
        try {
          const [result, target] = await ready;
          if (settled) { try { await result.body?.cancel(); } catch {} return; }
          if (!result.ok || !result.headers.get('Content-Type')?.toLowerCase().startsWith('audio/mpeg') || !result.body) {
            try { await result.body?.cancel(); } catch {}
            complete('unavailable'); return;
          }
          reader = result.body.getReader();
          while (!settled && !controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (settled || controller.signal.aborted) return;
            if (done) {
              if (!received) { complete('unavailable'); return; }
              inputEnded = true; media.endOfStream(); return;
            }
            if (value.byteLength) { received = true; await append(target, value); }
          }
        } catch (failure) {
          if (!settled) complete(started ? 'failed' : failure instanceof StreamDecoderUnavailableError || received ? 'unsupported' : 'unavailable');
        } finally { try { reader?.releaseLock(); } catch { /* Cancellation already owns cleanup. */ } }
      })();
    } catch { mediaFailed(); }
  });
}
