import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationPreparationController, type ConversationPreparationRequest } from '../src/conversation-preparation';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function harness() {
  const events: string[] = [], prepared: { request: ConversationPreparationRequest; signal: AbortSignal; pending: ReturnType<typeof deferred<unknown>> }[] = [];
  const cancelled: { id: string; pending: ReturnType<typeof deferred<unknown>> }[] = [];
  let serial = 0;
  const controller = new ConversationPreparationController({
    createId: () => `lease-${++serial}`,
    prepare: (request, signal) => { events.push(`prepare:${request.preparationId}`); const pending = deferred<unknown>(); prepared.push({ request, signal, pending }); return pending.promise; },
    cancel: id => { events.push(`cancel:${id}`); const pending = deferred<unknown>(); cancelled.push({ id, pending }); return pending.promise; },
  });
  return { controller, events, prepared, cancelled };
}

test('opening the microphone never awaits prepare and sends only an opaque conversation id with a unique lease', async () => {
  const h = harness(); const preparation = h.controller.prepare('opaque-conversation');
  h.events.push('capture-started'); await flush();
  assert.deepEqual(h.events, ['capture-started', 'prepare:lease-1']);
  assert.deepEqual(h.prepared[0].request, { preparationId: 'lease-1', conversationId: 'opaque-conversation' });
  h.prepared[0].pending.resolve({ prepared: true }); await preparation;
});

test('a recognized result hands its still-running preparation to turn without aborting its HTTP subscription or cancelling the owned thread', async () => {
  const h = harness(); const preparation = h.controller.prepare(); await flush();
  h.controller.claim(); await h.controller.cancel();
  assert.equal(h.prepared[0].signal.aborted, false); assert.deepEqual(h.cancelled, []);
  assert.deepEqual(h.prepared[0].request, { preparationId: 'lease-1' });
  h.prepared[0].pending.resolve({ prepared: true }); await preparation;
});

test('manual PCM finish may keep preparing while STT is pending; only an explicit cancellation releases its matching lease', async () => {
  const h = harness(); const preparing = h.controller.prepare(); await flush();
  // Ending PCM is intentionally independent of this controller; STT still owns the potential turn.
  await flush(); assert.equal(h.prepared[0].signal.aborted, false); assert.equal(h.cancelled.length, 0);
  const cleanup = h.controller.cancel(); await flush(); assert.equal(h.prepared[0].signal.aborted, true); assert.equal(h.cancelled[0].id, 'lease-1');
  h.prepared[0].pending.reject(new DOMException('Cancelled', 'AbortError')); h.cancelled[0].pending.resolve({ cancelled: true }); await preparing; await cleanup;
});

test('old cancellation must finish before the next warmup starts, while the next microphone remains free to capture', async () => {
  const h = harness(); const old = h.controller.prepare(); await flush();
  const next = h.controller.prepare('same-history'); h.events.push('next-capture-started'); await flush();
  assert.equal(h.prepared.length, 1); assert.equal(h.cancelled[0].id, 'lease-1'); assert.ok(h.events.includes('next-capture-started'));
  h.cancelled[0].pending.resolve({}); await flush(); assert.equal(h.prepared.length, 2); assert.equal(h.prepared[1].request.preparationId, 'lease-2');
  h.prepared[0].pending.resolve({}); await old; assert.equal(h.prepared[1].signal.aborted, false);
  h.controller.claim(); await h.controller.cancel(); assert.equal(h.cancelled.length, 1); h.prepared[1].pending.resolve({}); await next;
});

test('a real turn arriving while warmup cleanup is queued never waits for that cleanup or sends an obsolete prepare', async () => {
  const h = harness(); const old = h.controller.prepare(); await flush();
  const next = h.controller.prepare(); await flush(); h.controller.claim(); h.events.push('turn-requested');
  assert.ok(h.events.includes('turn-requested')); assert.equal(h.prepared.length, 1);
  h.cancelled[0].pending.resolve({}); h.prepared[0].pending.resolve({}); await next; await old;
  assert.equal(h.prepared.length, 1);
});

test('cancellation before prepare dispatch neither sends an empty cleanup nor revives warmup on a later microtask', async () => {
  const h = harness(); const pending = h.controller.prepare(); await h.controller.cancel(); await pending;
  assert.deepEqual(h.events, []);
});

test('prepare errors are opportunistic failures and cannot release a thread already claimed by an actual turn', async () => {
  const h = harness(); const pending = h.controller.prepare(); await flush(); h.controller.claim();
  h.prepared[0].pending.reject(new Error('warmup HTTP lost')); await pending; await flush(); assert.deepEqual(h.cancelled, []);
});

test('an unclaimed failed preparation releases its lease once and never retries or sends a model message', async () => {
  const h = harness(); const pending = h.controller.prepare(); await flush(); h.prepared[0].pending.reject(new Error('unknown history'));
  await pending; await flush(); assert.deepEqual(h.events, ['prepare:lease-1', 'cancel:lease-1']);
  const cleanup = h.controller.cancel(); h.cancelled[0].pending.resolve({}); await cleanup; assert.equal(h.prepared.length, 1); assert.equal(h.cancelled.length, 1);
});

test('failed cleanup does not poison future microphone warmups or leak a prior generation into the new lease', async () => {
  const h = harness(); const old = h.controller.prepare(); await flush(); const next = h.controller.prepare(); await flush();
  h.cancelled[0].pending.reject(new Error('network unavailable')); await flush(); assert.equal(h.prepared.length, 2);
  h.prepared[0].pending.reject(new Error('late aborted warmup')); await old; assert.equal(h.prepared[1].signal.aborted, false);
  h.controller.claim(); h.prepared[1].pending.resolve({}); await next; assert.equal(h.cancelled.length, 1);
});
