export const RECALL_DEMONSTRATIONS = 3;
export interface RecallDemonstrationState {
  phase: 'idle' | 'demo' | 'gap' | 'ready' | 'error';
  round: number;
  completed: number;
}
interface RecallDemonstrationRuntime {
  demonstrate(): Promise<boolean>;
  stopAudio(): void;
  update(state: RecallDemonstrationState): void;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}
const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal.addEventListener('abort', done, { once: true });
  if (signal.aborted) done();
});

/** Listen three times before opening the child's separate, unscored recording. */
export class RecallDemonstrationController {
  state: RecallDemonstrationState = { phase: 'idle', round: 0, completed: 0 };
  private owner?: AbortController;
  constructor(private readonly runtime: RecallDemonstrationRuntime) {}
  private update(patch: Partial<RecallDemonstrationState>) {
    this.state = { ...this.state, ...patch };
    this.runtime.update(this.state);
  }
  pause() {
    this.owner?.abort(); this.owner = undefined; this.runtime.stopAudio();
    if (this.state.phase !== 'ready') this.update({ phase: 'idle', round: 0, completed: 0 });
  }
  skip() {
    this.owner?.abort(); this.owner = undefined; this.runtime.stopAudio();
    this.update({ phase: 'ready', round: 0 });
  }
  async start(replay = false) {
    if (this.owner || this.state.phase === 'ready' && !replay) return;
    const owner = new AbortController(); this.owner = owner;
    const current = () => this.owner === owner && !owner.signal.aborted;
    this.update({ phase: 'gap', round: 1, completed: 0 });
    try {
      for (let round = 1; round <= RECALL_DEMONSTRATIONS; round++) {
        // Leave a clear listening beat, and let the prior recording UI release its audio.
        this.update({ phase: 'gap', round });
        await (this.runtime.wait ?? wait)(round === 1 ? 350 : 650, owner.signal);
        if (!current()) return;
        this.update({ phase: 'demo' });
        const played = await this.runtime.demonstrate();
        if (!current()) return;
        if (!played) { this.update({ phase: 'error' }); return; }
        this.update({ completed: round });
      }
      this.update({ phase: 'ready' });
    } catch {
      if (current()) this.update({ phase: 'error' });
    } finally {
      if (this.owner === owner) this.owner = undefined;
    }
  }
}
