import test from 'node:test';
import assert from 'node:assert/strict';
import { sttStatus, ttsStatus, speechStatus, transcribeSpeech, createLiveSttSession } from '../server/integrations/speech-router.ts';

test('default input and output are ElevenLabs; an explicitly missing fallback input cannot hide output configuration', async () => {
  const names = ['SPEECH_INPUT_PROVIDER', 'SPEECH_OUTPUT_PROVIDER', 'SONIOX_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.ELEVENLABS_API_KEY = 'local-config-only'; process.env.ELEVENLABS_VOICE_ID = 'voice';
    assert.equal(sttStatus().provider, 'elevenlabs'); assert.equal(sttStatus().configured, true);
    assert.equal(ttsStatus().provider, 'elevenlabs'); assert.equal(ttsStatus().configured, true);
    assert.equal(speechStatus().configured, true);
    const result = await transcribeSpeech({ audio: Buffer.from('must not upload this WAV'), locale: 'zh-CN' });
    assert.equal(result.status, 'unavailable'); assert.equal(result.transcript, ''); assert.match(result.message!, /实时聆听/);
    process.env.SPEECH_INPUT_PROVIDER = 'soniox';
    assert.equal(sttStatus().provider, 'soniox'); assert.equal(sttStatus().configured, false); assert.equal(speechStatus().configured, true);
    process.env.SPEECH_INPUT_PROVIDER = 'azure'; process.env.SPEECH_OUTPUT_PROVIDER = 'azure';
    assert.equal(sttStatus().provider, 'azure'); assert.equal(ttsStatus().provider, 'azure');
    await assert.rejects(createLiveSttSession({ locale: 'zh-CN', onEvent: () => {} }), { code: 'SPEECH_STREAM_UNSUPPORTED' });
  } finally { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } }
});
