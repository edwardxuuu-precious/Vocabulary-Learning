import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppState, SpeechResponse } from '../shared/contracts.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const { getCachedSpeech } = await import('../server/integrations/speech-router.ts');
const base = 'http://127.0.0.1:8787';
const dataDir = resolve(root, process.env.PLAYROOM_DATA_DIR ?? 'data');
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('仅支持 --apply；不传参数时只检查缓存。');
const stateResponse = await fetch(base + '/api/state', { signal: AbortSignal.timeout(10000) });
if (!stateResponse.ok) throw new Error('本机应用未就绪。');
const before = await stateResponse.json() as AppState;
const words = [...new Set(before.words.map(word => word.term))];
const input = (text: string) => ({ text, locale: 'en-US' as const, tone: 'clear' as const, dataDir });
const rows = await Promise.all(words.map(async text => ({ text, cachedBefore: Boolean(await getCachedSpeech(input(text))) })));
const missing = rows.filter(row => !row.cachedBefore);
console.log(JSON.stringify({ words: rows.length, cached: rows.length - missing.length, missing: missing.map(row => row.text), apply }));
if (apply) {
  if (missing.length && !(before.integrations.tts ?? before.integrations.speech).configured) throw new Error('云端朗读尚未配置，停止生成。');

  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '');
  const output = resolve(root, 'artifacts', 'word-audio-cache-' + date);
  await mkdir(output, { recursive: true });
  const results: { text: string; generated: boolean; bytes: number; cachedRequestMs: number }[] = [];
  const report: Record<string, unknown> = { at: new Date().toISOString(), words, cachedBefore: rows.filter(row => row.cachedBefore).length, results, completed: false };
  const reportPath = resolve(output, 'precache-' + Date.now() + '.json');
  const persist = () => writeFile(reportPath, JSON.stringify(report, null, 2));
  async function request(text: string): Promise<SpeechResponse> {
    const response = await fetch(base + '/api/speech/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, locale: 'en-US', tone: 'clear' }), signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { code?: string };
      throw new Error(`生成已停止（HTTP ${response.status}，${detail.code ?? 'TTS_ERROR'}）；不会重试、充值或换服务。`);
    }
    const result = await response.json() as SpeechResponse;
    if (result.mode !== 'api' || !result.audioUrl?.startsWith('/media/')) throw new Error('未获得真实云音频，停止生成。');
    return result;
  }
  try {
    for (const row of rows) {
      let generated = false;
      if (!row.cachedBefore) generated = !(await request(row.text)).cached;
      // Never issue a supposed verification request until the current exact cache key exists.
      assert.ok(await getCachedSpeech(input(row.text)), '单词缓存未写入：' + row.text);
      const started = performance.now();
      const cached = await request(row.text);
      assert.equal(cached.cached, true, '重复请求没有命中缓存：' + row.text);
      const cachedRequestMs = Math.round(performance.now() - started);
      const audio = await fetch(base + cached.audioUrl!, { signal: AbortSignal.timeout(10000) });
      const bytes = Buffer.from(await audio.arrayBuffer());
      assert.equal(audio.status, 200);
      assert.ok(bytes.length > 32 && (bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), '音频不是有效MP3：' + row.text);
      results.push({ text: row.text, generated, bytes: bytes.length, cachedRequestMs });
      await persist();
      console.log(JSON.stringify(results.at(-1)));
    }
    const after = await (await fetch(base + '/api/state', { signal: AbortSignal.timeout(10000) })).json() as AppState;
    for (const key of ['profile', 'settings', 'packs', 'words', 'progress', 'attempts', 'activeSession', 'stickers'] as const) assert.deepEqual(after[key], before[key], '学习事实发生变化：' + key);
    assert.equal(after.usage.sttSeconds, before.usage.sttSeconds);
    report.completed = true;
    report.generated = results.filter(row => row.generated).length;
    report.factsPreserved = true;
    report.usageBefore = before.usage;
    report.usageAfter = after.usage;
    console.log(JSON.stringify({ completed: true, cached: results.length, generated: report.generated, report: reportPath }));
  } catch (error) {
    report.error = error instanceof Error ? error.message : '缓存准备失败。';
    process.exitCode = 1;
    console.error(report.error);
  } finally {
    await persist();
  }
}
