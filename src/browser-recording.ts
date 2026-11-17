import { markAudioOutputCold } from './buffered-audio';
import type { PreparedRecording } from './follow-along';
import { requestMicrophoneStream } from './microphone-access';
import { VoiceTurnEnd } from './voice-turn';

export interface RecordingTurnOptions { finishOnSilence?: boolean; onLevel?:(level:number)=>void; onFinishing?:()=>void }

/** In-memory MediaRecorder only: no uploads, storage, recognition or scoring. */
export async function prepareBrowserRecording(signal: AbortSignal, options: RecordingTurnOptions = {}): Promise<PreparedRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined')
    throw new Error('此浏览器暂时不能录音。');
  const stream = await requestMicrophoneStream({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
  let context: AudioContext | undefined;
  let recorder: MediaRecorder | undefined;
  let meter: ReturnType<typeof setInterval> | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;
  let stopTimeout: ReturnType<typeof setTimeout> | undefined;
  let settle: ((blob: Blob | null) => void) | undefined;
  let rejectRecording: ((error: unknown) => void) | undefined;
  let closed = false, submitted = false, voicedFrames = 0, detectedVoice = false;
  const chunks: Blob[] = [];
  const cleanup = () => {
    if (closed) return;
    closed = true; clearInterval(meter); clearTimeout(limit); clearTimeout(stopTimeout);
    signal.removeEventListener('abort', cancel);
    stream.getTracks().forEach(track => track.stop());
    markAudioOutputCold();
    if (context) void context.close().catch(() => {});
  };
  const cancel = () => {
    submitted = false;
    if (recorder?.state === 'recording') recorder.stop();
    cleanup(); settle?.(null);
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) { cancel(); throw new DOMException('录音已取消', 'AbortError'); }
  try {
    context = new AudioContext();
    await context.resume();
    if (signal.aborted) throw new DOMException('录音已取消', 'AbortError');
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    const silent = context.createGain(); silent.gain.value = 0;
    source.connect(analyser); analyser.connect(silent); silent.connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const stop = () => {
      if (closed || recorder?.state !== 'recording') return;
      options.onFinishing?.();
      submitted = true; clearInterval(meter); clearTimeout(limit); recorder.stop();
      // A missing onstop must release the microphone and the UI as a failed take.
      stopTimeout = setTimeout(() => { cleanup(); settle?.(null); }, 2000);
    };
    recorder.ondataavailable = event => { if (!closed && event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      // Level detection only distinguishes an empty take; it does not assess the word.
      const blob = submitted && voicedFrames >= 2 && (!options.finishOnSilence || detectedVoice) ? new Blob(chunks, { type: recorder!.mimeType }) : null;
      cleanup(); settle?.(blob);
    };
    recorder.onerror = () => { cleanup(); rejectRecording?.(new Error('录音中断。')); };
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
      if (!closed) { cancel(); }
    }, { once: true }));
    return {
      record: () => new Promise<Blob | null>((resolve, reject) => {
        if (closed || signal.aborted) { resolve(null); return; }
        settle = resolve; rejectRecording = reject;
        try {
          recorder!.start();
          const turn = new VoiceTurnEnd(performance.now());
          meter = setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
            if (rms > 0.012) voicedFrames += 1;
            const state = turn.observe(rms, performance.now());
            detectedVoice = state.heard;
            options.onLevel?.(state.level);
            if (options.finishOnSilence && state.ended) stop();
          }, options.finishOnSilence ? 50 : 100);
          // Other recording flows retain manual stopping; every take has a hard limit.
          limit = setTimeout(stop, 20000);
        } catch (error) { cleanup(); reject(error); }
      }),
      stop, cancel,
    };
  } catch (error) { cleanup(); throw error; }
}
