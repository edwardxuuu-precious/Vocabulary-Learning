import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.ELEVENLABS_API_KEY?.trim();
assert.ok(key, '未配置 ElevenLabs API key。');
const outputDir = resolve('artifacts/voice-previews/2026-10-17-mecha-cn');
const receiptPath = resolve(outputDir, 'generation.json');
assert.ok(!existsSync(receiptPath), '已有生成记录，停止重复请求。');
const text = '小小勇士，欢迎来到单词游乐园。我是你的机甲伙伴。今天，我们将一起探索新的单词，解锁新的力量。遇到困难不要害怕，认真听，勇敢说，每一次尝试都会让你更强大。准备好了吗？抬起头，深呼吸。让我们并肩出发，开启今天的学习任务。你已经迈出了勇敢的第一步。';
const description = 'An original heroic science-fiction robot commander, speaking native Standard Mandarin Chinese with accurate clear pronunciation. A mature masculine voice with a very deep bass register, massive resonant chest tone, rich gravelly texture and subtle metallic robotic overtones. Calm, wise, noble and protective, with dignified authority and warmth toward a young child. Slow deliberate cinematic delivery, powerful but reassuring, never shouting, frightening or villainous. Natural clear articulation, no music, no background sounds. Studio-quality recording.';
assert.ok([...text].length >= 100 && [...text].length <= 130);
async function api(path, options = {}) {
  const response = await fetch('https://api.elevenlabs.io' + path, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(180000),
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    const code = data.detail?.status ?? 'UNKNOWN';
    const message = String(data.detail?.message ?? '').replaceAll(key, '[redacted]').slice(0, 600);
    throw new Error(`HTTP ${response.status} ${code}: ${message}`);
  }
  return data;
}
const summarizeQuota = q => ({ tier: q.tier, status: q.status, used: q.character_count, limit: q.character_limit, overage: q.max_credit_limit_extension });
const before = await api('/v1/user/subscription');
assert.equal(before.tier, 'free', '仅允许免费方案。');
assert.equal(before.max_credit_limit_extension, 0, '必须关闭超额计费。');
assert.ok(['free', 'active', 'trialing'].includes(before.status));
assert.ok(Number.isFinite(before.character_limit) && Number.isFinite(before.character_count));
assert.ok(before.character_limit - before.character_count >= 1000, '试听要求至少有1000个剩余免费credits。');
await mkdir(outputDir, { recursive: true });
const report = { at: new Date().toISOString(), state: 'requesting', provider: 'ElevenLabs', endpoint: '/v1/text-to-voice/design', model: 'eleven_ttv_v3', text, description, quotaBefore: summarizeQuota(before), previews: [] };
await writeFile(receiptPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ stage: 'generating', characters: [...text].length, remainingFreeCredits: before.character_limit - before.character_count }));
try {
  const result = await api('/v1/text-to-voice/design?output_format=mp3_44100_128', {
    method: 'POST', body: JSON.stringify({ voice_description: description, model_id: report.model, text, auto_generate_text: false, loudness: 0.3, seed: 20261017, guidance_scale: 6, should_enhance: false }),
  });
  assert.ok(Array.isArray(result.previews) && result.previews.length > 0 && result.previews.length <= 5);
  report.returnedText = result.text;
  for (const [index, preview] of result.previews.entries()) {
    const bytes = Buffer.from(preview.audio_base_64, 'base64');
    assert.ok(bytes.length > 1000 && bytes.length < 10_000_000);
    assert.ok(bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0, '未获得MP3音频。');
    const filePath = resolve(outputDir, `mecha-cn-${index + 1}.mp3`);
    await writeFile(filePath, bytes);
    report.previews.push({ filePath, bytes: bytes.length, generatedVoiceId: preview.generated_voice_id, durationSeconds: preview.duration_secs, language: preview.language, mediaType: preview.media_type });
  }
  report.state = 'generated';
  await writeFile(receiptPath, JSON.stringify(report, null, 2));
  try {
    const after = await api('/v1/user/subscription');
    report.quotaAfter = summarizeQuota(after);
    report.observedCreditDifference = after.character_count - before.character_count;
  } catch { report.quotaAfterUnavailable = true; }
  await writeFile(receiptPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ stage: report.state, previews: report.previews, quotaBefore: report.quotaBefore, quotaAfter: report.quotaAfter, observedCreditDifference: report.observedCreditDifference }));
} catch (error) {
  report.state = 'failed';
  report.error = String(error.message).replaceAll(key, '[redacted]');
  await writeFile(receiptPath, JSON.stringify(report, null, 2));
  throw new Error(report.error);
}
