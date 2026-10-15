import test from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneBufferOverflowError, MicrophoneReadyBuffer } from '../src/microphone-buffer';

function pcm(values: number[]) { const data = new ArrayBuffer(values.length * 2); const view = new DataView(data); values.forEach((value, index) => view.setInt16(index * 2, value, true)); return data; }
function decoded(frame: ArrayBuffer) { const view = new DataView(frame); return Array.from({ length: frame.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true)); }
function harness(limit = 160000) {
  const events: (number[] | 'finish')[] = [];
  const buffer = new MicrophoneReadyBuffer({ audio: frame => events.push(decoded(frame)), finish: () => events.push('finish') }, limit);
  return { buffer, events };
}

test('speech captured immediately on click stays local until ready, then the complete first syllable arrives in order', () => {
  const h = harness();
  h.buffer.append(pcm([101, 102, 103])); h.buffer.append(pcm([201, 202]));
  assert.deepEqual(h.events, []); assert.equal(h.buffer.pendingBytes, 10);
  assert.equal(h.buffer.markReady(), 'ready');
  assert.deepEqual(h.events, [[101, 102, 103], [201, 202]]); assert.equal(h.buffer.pendingBytes, 0);
  h.buffer.append(pcm([301, 302])); assert.deepEqual(h.events.at(-1), [301, 302]);
});

test('manual finish before provider ready queues the ending after every buffered sample, exactly once', () => {
  const h = harness(); h.buffer.append(pcm([11, 12])); h.buffer.append(pcm([21, 22]));
  assert.equal(h.buffer.finish(), 'queued'); assert.deepEqual(h.events, []);
  assert.equal(h.buffer.append(pcm([99])), false);
  assert.equal(h.buffer.markReady(), 'finished');
  assert.deepEqual(h.events, [[11, 12], [21, 22], 'finish']);
  h.buffer.markReady(); h.buffer.finish(); assert.equal(h.events.filter(event => event === 'finish').length, 1);
});

test('a microphone stopped before its first audio frame never sends an empty finish request', () => {
  const h = harness();
  assert.equal(h.buffer.finish(), 'empty'); assert.equal(h.buffer.markReady(), 'empty');
  assert.deepEqual(h.events, []); assert.equal(h.buffer.append(pcm([1])), false);
});

test('160KB captures five seconds of 16kHz mono PCM; exceeding it stops the pending recording instead of dropping its beginning', () => {
  const h = harness();
  assert.equal(h.buffer.append(new ArrayBuffer(16000 * 2 * 5)), true); assert.equal(h.buffer.pendingBytes, 160000);
  assert.throws(() => h.buffer.append(pcm([1])), MicrophoneBufferOverflowError);
  assert.equal(h.buffer.pendingBytes, 0); assert.equal(h.buffer.markReady(), 'cancelled'); assert.deepEqual(h.events, []);
});

test('cancellation clears queued speech and queued finish; a late ready cannot upload it', () => {
  const h = harness(); h.buffer.append(pcm([1, 2, 3])); h.buffer.finish(); h.buffer.cancel();
  assert.equal(h.buffer.pendingBytes, 0); assert.equal(h.buffer.markReady(), 'cancelled'); assert.equal(h.buffer.finish(), 'cancelled');
  assert.equal(h.buffer.append(pcm([4])), false); assert.deepEqual(h.events, []);
});

test('cancelled prior generation cannot contaminate a newly started microphone buffer', () => {
  const h = harness(); h.buffer.append(pcm([111])); h.buffer.cancel();
  const current = new MicrophoneReadyBuffer({ audio: frame => h.events.push(decoded(frame)), finish: () => h.events.push('finish') });
  current.append(pcm([222])); h.buffer.markReady(); current.markReady(); current.finish();
  assert.deepEqual(h.events, [[222], 'finish']);
});

test('ready input is streamed directly without retaining an unbounded local copy', () => {
  let bytesSent = 0; const buffer = new MicrophoneReadyBuffer({ audio: frame => { bytesSent += frame.byteLength; }, finish: () => {} });
  buffer.markReady(); for (let second = 0; second < 44; second++) buffer.append(new ArrayBuffer(32000));
  assert.equal(bytesSent, 44 * 32000); assert.equal(buffer.pendingBytes, 0);
});

test('buffer owns its queued samples even if the capture scratch array is reused before ready', () => {
  const h = harness(); const source = pcm([17, 19]); h.buffer.append(source); new DataView(source).setInt16(0, 99, true);
  h.buffer.markReady(); assert.deepEqual(h.events, [[17, 19]]);
});

test('a cancellation during ready flush prevents remaining frames and finish from leaking into the socket', () => {
  const events: string[] = []; let buffer!: MicrophoneReadyBuffer;
  buffer = new MicrophoneReadyBuffer({ audio: () => { events.push('one'); buffer.cancel(); }, finish: () => events.push('finish') });
  buffer.append(pcm([1])); buffer.append(pcm([2])); buffer.finish(); buffer.markReady();
  assert.deepEqual(events, ['one']); assert.equal(buffer.pendingBytes, 0);
});
