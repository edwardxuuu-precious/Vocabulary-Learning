import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.loadEnvFile('.env');
const key = process.env.ELEVENLABS_API_KEY?.trim();
assert.ok(key);
const out = resolve('artifacts/voice-previews/2026-10-17-mecha-cn');
const receipt = resolve(out, 'generation-tts.json');
assert.ok(!existsSync(receipt), '已有请求记录，停止重复生成。');
const text = '小小勇士，欢迎来到单词游乐园。我是你的机甲伙伴。别害怕挑战，每学会一个单词，你就会更强大。准备好了吗？让我们一起出发！';
const voiceId = 'nPczCjzI2devNBz1zQrb';
const quota = async () => {
  const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  assert.equal(r.status, 200, '免费额度读取失败。');
  const q = await r.json();
  return { tier: q.tier, status: q.status, used: q.character_count, limit: q.character_limit, overage: q.max_credit_limit_extension };
};
const before = await quota();
assert.equal(before.tier, 'free');
assert.equal(before.overage, 0);
assert.ok(['free', 'active', 'trialing'].includes(before.status));
assert.ok(Number.isFinite(before.limit) && Number.isFinite(before.used) && before.limit - before.used >= 500);
await mkdir(out, { recursive: true });
const report = { at: new Date().toISOString(), state: 'requesting', provider: 'ElevenLabs', voice: 'Brian - Deep, Resonant and Comforting', voiceId, model: process.env.ELEVENLABS_TTS_MODEL || 'eleven_v4_turbo', text, quotaBefore: before, artifacts: [] };
await writeFile(receipt, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ stage: 'generating-preset', remainingFreeCredits: before.limit - before.used, characters: [...text].length }));
function wav(samples, sampleRate) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + 2 * i);
  return data;
}
try {
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=pcm_24000', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/pcm' },
    body: JSON.stringify({ model_id: report.model, language_code: 'zh', inputs: [{ text, voice_id: voiceId }], settings: { stability: 0.5 }, seed: 20261017, apply_text_normalization: 'auto' }),
  });
  if (!response.ok) {
    const d = await response.json();
    throw new Error(`HTTP ${response.status} ${d.detail?.status}: ${String(d.detail?.message ?? '').replaceAll(key, '[redacted]').slice(0, 500)}`);
  }
  const pcm = Buffer.from(await response.arrayBuffer());
  assert.ok(pcm.length > 48000 && pcm.length < 5_000_000 && pcm.length % 2 === 0, 'PCM音频大小异常。');
  assert.ok(!['ID3', 'RIF'].includes(pcm.toString('ascii', 0, 3)), '响应并非预期的裸PCM。');
  const sampleRate = 24000;
  const source = Float64Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768);
  const naturalPath = resolve(out, 'mecha-cn-natural.wav');
  await writeFile(naturalPath, wav(source, sampleRate));
  const rate = 0.89;
  const lowered = Float64Array.from({ length: Math.floor(source.length / rate) }, (_, i) => {
    const p = i * rate, j = Math.floor(p), f = p - j;
    return source[j] * (1 - f) + (source[Math.min(j + 1, source.length - 1)] ?? 0) * f;
  });
  const processed = new Float64Array(lowered.length);
  const delay = Math.round(sampleRate * 0.0087);
  let bass = 0, peak = 0, sumSquares = 0;
  const smoothing = Math.exp(-2 * Math.PI * 220 / sampleRate);
  for (let i = 0; i < processed.length; i++) {
    bass = smoothing * bass + (1 - smoothing) * lowered[i];
    const metallic = lowered[i] * Math.sin(2 * Math.PI * 62 * i / sampleRate);
    const value = 0.86 * lowered[i] + 0.20 * bass + 0.10 * (lowered[i - delay] ?? 0) + 0.06 * metallic;
    processed[i] = Math.tanh(value * 1.12); peak = Math.max(peak, Math.abs(processed[i]));
  }
  assert.ok(peak > 0.02, '合成音频接近静音。');
  for (let i = 0; i < processed.length; i++) { processed[i] *= 0.88 / peak; sumSquares += processed[i] ** 2; }
  const mainPath = resolve(out, 'mecha-cn-preview.wav');
  await writeFile(mainPath, wav(processed, sampleRate));
  report.artifacts = [mainPath, naturalPath];
  report.durationSeconds = Math.round(processed.length / sampleRate * 100) / 100;
  report.processing = { playbackRate: rate, pitchChangeSemitones: Number((12 * Math.log2(rate)).toFixed(2)), subtleMetallicEffect: true, normalizedPeak: 0.88, rms: Number(Math.sqrt(sumSquares / processed.length).toFixed(4)) };
  report.state = 'generated';
  await writeFile(receipt, JSON.stringify(report, null, 2));
  try { report.quotaAfter = await quota(); report.observedCreditDifference = report.quotaAfter.used - before.used; } catch { report.quotaAfterUnavailable = true; }
  await writeFile(receipt, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  report.state = 'failed'; report.error = String(error.message).replaceAll(key, '[redacted]');
  await writeFile(receipt, JSON.stringify(report, null, 2));
  throw new Error(report.error);
}
