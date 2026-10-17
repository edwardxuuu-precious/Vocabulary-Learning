import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.loadEnvFile('.env');
const voiceId = 'MRZduN7kKNaKuttBSyOA';
assert.equal(process.env.ELEVENLABS_VOICE_ID_ZH, voiceId, 'C音色配置已变化，停止生成。');
assert.equal(process.env.SPEECH_OUTPUT_PROVIDER, 'elevenlabs', '朗读供应商已变化，停止生成。');
const { createElevenLabsProvider } = await import('../../server/integrations/elevenlabs.ts');
const provider = createElevenLabsProvider();
const root = 'http://127.0.0.1:8787';
const directory = resolve('artifacts/voice-previews/2026-10-17-c-child-explanation');
const receiptPath = resolve(directory, 'receipt.json');
await mkdir(directory, { recursive: true });
let previous;
try { previous = JSON.parse(await readFile(receiptPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
assert.ok(!previous, '此试听已有生成记录，停止重复请求；请先核对缓存和记录。');

const text = '小勇士，准备好了吗？今天，我们来认识苹果。它圆圆的，尝起来甜甜的。先看看图片，再听一遍英文。听清以后，按下麦克风，自己试着说一说。没听清也没关系，点一下小喇叭，就能再听一次。慢慢来，我们一起完成今天的学习！';
const input = { text, locale: 'zh-CN', tone: 'clear', dataDir: resolve(process.env.PLAYROOM_DATA_DIR || 'data') };
const requestJson = async (path, body) => {
  const response = await fetch(root + path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  assert.equal(response.status, 200, `本机接口失败：${response.status} ${result.code || ''}`);
  return result;
};
const quota = async () => {
  assert.ok(process.env.ELEVENLABS_API_KEY, '缺少语音密钥。');
  const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, '无法确认免费额度，停止生成。');
  const value = await response.json();
  assert.equal(value.tier, 'free', '账户不在免费方案，停止生成。');
  assert.equal(value.max_credit_limit_extension, 0, '无法确认超额计费关闭，停止生成。');
  assert.ok(['free', 'active', 'trialing'].includes(value.status));
  assert.ok(Number.isFinite(value.character_count) && Number.isFinite(value.character_limit));
  return { tier: value.tier, used: value.character_count, limit: value.character_limit, remaining: value.character_limit - value.character_count, overage: value.max_credit_limit_extension };
};
const countLearning = state => ({ words: state.words.length, packs: state.packs.length, attempts: state.attempts.length, progress: state.progress.length });
const receipt = { state: 'preflight', createdAt: new Date().toISOString(), voiceId, voiceName: '机甲伙伴 C - 浑厚普通话男声', model: process.env.ELEVENLABS_TTS_MODEL, locale: input.locale, tone: input.tone, text, textCharacters: [...text].length, freeOnly: true, effects: 'none' };
const persist = () => writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
await writeFile(resolve(directory, '讲解文稿.txt'), text + '\n');
try {
  receipt.quotaBefore = await quota();
  assert.ok(receipt.quotaBefore.remaining >= [...text].length + 16, '免费额度不足，停止生成。');
  receipt.learningBefore = countLearning(await requestJson('/api/state'));
  receipt.cachedBefore = Boolean(await provider.getCachedSpeech(input));
  receipt.state = 'request-started';
  await persist();
  const result = await requestJson('/api/speech/tts', { text, locale: input.locale, tone: input.tone });
  assert.equal(result.mode, 'api');
  const cacheFile = await provider.getCachedSpeech(input);
  assert.ok(cacheFile, 'C音色缓存不存在。');
  const expectedUrl = '/media/' + cacheFile.slice(input.dataDir.length + 1).replaceAll('\\', '/');
  assert.equal(decodeURIComponent(result.audioUrl), expectedUrl, '服务使用的音色与C配置不一致。');
  const bytes = await readFile(cacheFile);
  assert.ok(bytes.length > 1000 && (bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224), '生成结果不是MP3音频。');
  const outputFile = resolve(directory, 'C-儿童学习讲解.mp3');
  await writeFile(outputFile, bytes);
  const replay = await requestJson('/api/speech/tts', { text, locale: input.locale, tone: input.tone, cacheOnly: true });
  assert.equal(replay.cached, true);
  assert.equal(replay.audioUrl, result.audioUrl);
  receipt.learningAfter = countLearning(await requestJson('/api/state'));
  assert.deepEqual(receipt.learningAfter, receipt.learningBefore);
  receipt.quotaAfter = await quota();
  receipt.usedCredits = receipt.quotaAfter.used - receipt.quotaBefore.used;
  receipt.state = 'generated-and-cache-verified';
  Object.assign(receipt, { outputFile, cacheFile, cachedFirst: result.cached, cachedReplay: replay.cached, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), finishedAt: new Date().toISOString() });
  await persist();
  console.log(JSON.stringify({ state: receipt.state, outputFile, textCharacters: receipt.textCharacters, bytes: bytes.length, usedCredits: receipt.usedCredits, quotaAfter: receipt.quotaAfter, cachedReplay: receipt.cachedReplay }));
} catch (error) {
  receipt.state = 'stopped-review-needed';
  receipt.error = { name: error.name, message: String(error.message).slice(0, 500) };
  await persist();
  console.error(receipt.error.message);
  process.exitCode = 1;
}
