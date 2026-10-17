import test from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneAccessError, microphoneFailureMessage, requestMicrophoneStream } from '../src/microphone-access';

async function withNavigator(value: unknown, run: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  try { await run(); }
  finally { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else Reflect.deleteProperty(globalThis, 'navigator'); }
}

test('system denial is distinguished from a granted website permission', () => {
  const message = microphoneFailureMessage(new DOMException('Permission denied by system', 'NotAllowedError'), 'granted');
  assert.match(message, /网页已允许/); assert.match(message, /系统/); assert.match(message, /Codex/);
  assert.doesNotMatch(message, /麦克风还没打开/);
  assert.match(microphoneFailureMessage({ name: 'NotAllowedError', message: '' }, 'granted'), /网页已允许/);
});

test('denied, unknown, missing and unavailable devices have separate actionable messages', () => {
  assert.match(microphoneFailureMessage({ name: 'NotAllowedError' }, 'denied'), /网页的麦克风访问被阻止/);
  assert.match(microphoneFailureMessage({ name: 'NotAllowedError' }), /网页与系统两处/);
  assert.match(microphoneFailureMessage({ name: 'NotFoundError' }), /没有找到/);
  assert.match(microphoneFailureMessage({ name: 'NotReadableError' }), /占用/);
  assert.match(microphoneFailureMessage({ name: 'OverconstrainedError' }), /录音设置/);
  assert.doesNotMatch(microphoneFailureMessage(new Error('device lost')), /权限|授权/);
});

test('normal microphone requests preserve constraints and return the provided stream', async () => {
  const constraints = { audio: true, video: false }, stream = {} as MediaStream;
  await withNavigator({ mediaDevices: { getUserMedia: async (value: MediaStreamConstraints) => { assert.equal(value, constraints); return stream; } } }, async () => {
    assert.equal(await requestMicrophoneStream(constraints), stream);
  });
});

test('a granted website plus system denial is reported without retrying or changing grants', async () => {
  const denied = new DOMException('Permission denied by system', 'NotAllowedError'); let requests = 0;
  await withNavigator({
    mediaDevices: { getUserMedia: async () => { requests++; throw denied; } },
    permissions: { query: async (descriptor: { name: string }) => { assert.equal(descriptor.name, 'microphone'); return { state: 'granted' }; } },
  }, async () => {
    await assert.rejects(requestMicrophoneStream({ audio: true }), error => {
      assert.ok(error instanceof MicrophoneAccessError); assert.equal(error.cause, denied);
      assert.match(error.message, /网页已允许/); return true;
    });
    assert.equal(requests, 1);
  });
});

test('unsupported permission queries preserve the original denial instead of inventing a grant', async () => {
  await withNavigator({
    mediaDevices: { getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); } },
    permissions: { query: async () => { throw Error('Unsupported'); } },
  }, async () => {
    await assert.rejects(requestMicrophoneStream({ audio: true }), /网页与系统两处/);
  });
});
