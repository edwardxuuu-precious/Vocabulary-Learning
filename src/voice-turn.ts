/** Local volume timing only. It cannot recognize words or assess pronunciation. */
export class VoiceTurnEnd {
  private consecutive = 0;
  private heard = false;
  private lastVoiceAt = 0;
  constructor(private readonly startedAt: number) {}
  observe(rms: number, now: number) {
    if (rms > .012) {
      this.consecutive++;
      if (this.consecutive >= 2) this.heard = true;
      this.lastVoiceAt = now;
    } else this.consecutive = 0;
    return {
      heard: this.heard,
      level: Math.min(1, Math.max(0, rms * 9)),
      ended: now - this.startedAt >= 20000
        || this.heard && now - this.lastVoiceAt >= 1800
        || !this.heard && now - this.startedAt >= 10000,
    };
  }
}
