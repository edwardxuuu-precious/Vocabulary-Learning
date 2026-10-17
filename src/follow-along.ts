import { MicrophoneAccessError, microphoneFailureMessage } from './microphone-access';

export const FOLLOW_ALONG_ROUNDS = 3;
export type FollowAlongPhase = 'idle' | 'preparing' | 'demo' | 'recording' | 'saving' | 'playing';
export interface FollowAlongState { phase: FollowAlongPhase; recordings: string[]; message: string }
export interface PreparedRecording {
  record(): Promise<Blob | null>;
  stop(): void;
  cancel(): void;
}
export interface FollowAlongRuntime {
  prepare(signal: AbortSignal): Promise<PreparedRecording>;
  demonstrate(): Promise<boolean>;
  stopAudio(): void;
  play(url: string, signal: AbortSignal): Promise<boolean>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  update(state: FollowAlongState): void;
}

/** A take is local practice evidence, never recognition or a pronunciation score. */
export class FollowAlongController {
  state: FollowAlongState = { phase: 'idle', recordings: [], message: '' };
  private owner: AbortController | null = null;
  private capture: PreparedRecording | null = null;
  constructor(private readonly runtime: FollowAlongRuntime) {}
  private update(patch: Partial<FollowAlongState>) {
    this.state = { ...this.state, ...patch };
    this.runtime.update(this.state);
  }
  async start() {
    if (this.state.phase !== 'idle' || this.state.recordings.length >= FOLLOW_ALONG_ROUNDS) return;
    const owner = new AbortController(); this.owner = owner;
    const current = () => this.owner === owner && !owner.signal.aborted;
    this.update({ phase: 'preparing', message: '' });
    try {
      const capture = await this.runtime.prepare(owner.signal);
      if (!current()) { capture.cancel(); return; }
      this.capture = capture;
      this.update({ phase: 'demo' });
      if (!await this.runtime.demonstrate()) {
        if (current()) this.update({ message: '示范声音没播完。可以再试一次，或先跳过。' });
        return;
      }
      if (!current()) return;
      const result = capture.record();
      this.update({ phase: 'recording' });
      const blob = await result;
      if (!current()) return;
      if (!blob?.size) { this.update({ message: '这次没有录到声音。靠近麦克风再读一次吧。' }); return; }
      const url = this.runtime.createUrl(blob);
      this.update({ recordings: [...this.state.recordings, url], message: '' });
    } catch (error) {
      if (current()) this.update({ message: error instanceof MicrophoneAccessError ? error.message : error instanceof Error && error.name === 'NotAllowedError'
        ? microphoneFailureMessage(error)
        : error instanceof Error && error.name === 'NotFoundError'
          ? '没有找到麦克风。连接后再试，或先跳过。'
          : '这次录音没成功。可以再试一次，或先跳过。' });
    } finally {
      if (current()) {
        this.capture?.cancel(); this.capture = null; this.owner = null;
        this.update({ phase: 'idle' });
      }
    }
  }
  stop() {
    if (this.state.phase !== 'recording') return;
    this.update({ phase: 'saving' }); this.capture?.stop();
  }
  async replay(index: number) {
    if (this.state.phase !== 'idle' || !this.state.recordings[index]) return;
    const owner = new AbortController(); this.owner = owner;
    this.runtime.stopAudio(); this.update({ phase: 'playing', message: '' });
    try {
      if (!await this.runtime.play(this.state.recordings[index], owner.signal) && this.owner === owner)
        this.update({ message: '这次回放没成功，可以再点一下。' });
    } catch {
      if (this.owner === owner) this.update({ message: '这次回放没成功，可以再点一下。' });
    } finally {
      if (this.owner === owner) { this.owner = null; this.update({ phase: 'idle' }); }
    }
  }
  cancel() {
    this.owner?.abort(); this.owner = null;
    this.capture?.cancel(); this.capture = null;
    this.runtime.stopAudio(); this.update({ phase: 'idle', message: '' });
  }
  dispose() {
    this.cancel(); this.state.recordings.forEach(url => this.runtime.revokeUrl(url));
    this.update({ recordings: [], message: '' });
  }
}
