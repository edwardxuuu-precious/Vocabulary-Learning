import { prepareBrowserRecording } from './browser-recording';
import { toWav } from './voice';
import type { PreparedRecording } from './follow-along';

/** Capture locally, then normalize the saved take. Upload is an explicit separate operation. */
export async function prepareChallengeRecording(signal: AbortSignal): Promise<PreparedRecording> {
  const capture = await prepareBrowserRecording(signal);
  return { stop: capture.stop, cancel: capture.cancel, async record() {
    const blob = await capture.record();
    if (!blob || signal.aborted) return null;
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (signal.aborted) return null;
      const samples = decoded.getChannelData(0).slice(0, Math.floor(decoded.sampleRate * 20));
      return new Blob([toWav(samples, decoded.sampleRate)], { type: 'audio/wav' });
    } finally { await context.close().catch(() => {}); }
  } };
}
