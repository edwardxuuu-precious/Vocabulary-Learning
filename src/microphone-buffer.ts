export class MicrophoneBufferOverflowError extends Error {
  constructor() { super('声音连接等得有点久，我们停下来再说一次。'); this.name = 'MicrophoneBufferOverflowError'; }
}
export interface MicrophoneTransport { audio: (pcm: ArrayBuffer) => void; finish: () => void }
export type MicrophoneFinishStatus = 'queued' | 'finished' | 'empty' | 'cancelled';

/** A bounded in-memory bridge between an immediately opened microphone and a ready server. */
export class MicrophoneReadyBuffer {
  private frames: ArrayBuffer[] = [];
  private bytes = 0;
  private totalBytes = 0;
  private ready = false;
  private cancelled = false;
  private finishRequested = false;
  private finishSent = false;
  constructor(private readonly transport: MicrophoneTransport, private readonly limitBytes = 160000) {}
  get pendingBytes() { return this.bytes; }
  append(frame: ArrayBuffer): boolean {
    if (this.cancelled || this.finishRequested || !frame.byteLength) return false;
    if (!this.ready && this.bytes + frame.byteLength > this.limitBytes) { this.cancel(); throw new MicrophoneBufferOverflowError(); }
    this.totalBytes += frame.byteLength;
    if (this.ready) this.transport.audio(frame);
    else { this.frames.push(frame.slice(0)); this.bytes += frame.byteLength; }
    return true;
  }
  markReady(): MicrophoneFinishStatus | 'ready' {
    if (this.cancelled) return 'cancelled';
    if (!this.ready) {
      this.ready = true;
      const frames = this.frames; this.frames = []; this.bytes = 0;
      for (const frame of frames) { if (this.cancelled) return 'cancelled'; this.transport.audio(frame); }
    }
    return this.finishRequested ? this.flushFinish() : 'ready';
  }
  finish(): MicrophoneFinishStatus {
    if (this.cancelled) return 'cancelled';
    this.finishRequested = true;
    if (!this.totalBytes) return 'empty';
    return this.ready ? this.flushFinish() : 'queued';
  }
  cancel() { this.cancelled = true; this.frames = []; this.bytes = 0; this.totalBytes = 0; }
  private flushFinish(): MicrophoneFinishStatus {
    if (!this.totalBytes) return 'empty';
    if (!this.finishSent) { this.finishSent = true; this.transport.finish(); }
    return 'finished';
  }
}
