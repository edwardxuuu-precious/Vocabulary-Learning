export interface ConversationPreparationRequest { preparationId: string; conversationId?: string }
export interface ConversationPreparationRuntime {
  prepare: (request: ConversationPreparationRequest, signal: AbortSignal) => Promise<unknown>;
  cancel: (preparationId: string) => Promise<unknown>;
  createId: () => string;
}
interface Lease { request: ConversationPreparationRequest; abort: AbortController; started: boolean }

/** Opportunistic thread preparation owns no child message, microphone, UI state or model turn. */
export class ConversationPreparationController {
  private lease: Lease | null = null;
  private cancellation: Promise<unknown> = Promise.resolve();
  constructor(private readonly runtime: ConversationPreparationRuntime) {}
  prepare(conversationId?: string): Promise<void> {
    void this.cancel();
    const lease: Lease = { request: { preparationId: this.runtime.createId(), ...(conversationId ? { conversationId } : {}) }, abort: new AbortController(), started: false };
    this.lease = lease;
    return (async () => {
      // Only warmup requests wait for old cleanup. Recording and an actual turn never wait on this queue.
      await this.cancellation;
      if (this.lease !== lease || lease.abort.signal.aborted) return;
      lease.started = true;
      try { await this.runtime.prepare(lease.request, lease.abort.signal); }
      catch { if (this.lease === lease) void this.cancel(); }
    })();
  }
  claim() {
    const lease = this.lease; this.lease = null;
    if (!lease) return;
    // A real turn shares the server's in-flight owned thread. Aborting its preparation subscription here could race the handoff.
    if (!lease.started) lease.abort.abort();
  }
  cancel(): Promise<unknown> {
    const lease = this.lease; this.lease = null;
    if (!lease) return this.cancellation;
    lease.abort.abort();
    if (lease.started) this.cancellation = this.cancellation.catch(() => {}).then(() => this.runtime.cancel(lease.request.preparationId)).catch(() => {});
    return this.cancellation;
  }
}
