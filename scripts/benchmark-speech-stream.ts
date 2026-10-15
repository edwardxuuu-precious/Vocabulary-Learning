import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (!process.argv.includes('--live')) throw new Error('添加 --live 才会使用真实语音额度；只发送固定测试文字。');
const base = new URL(process.argv.find(value => value.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:8788');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('仅允许已启动的本机验收服务。');
const text = '慢慢说，小栗在这里听着。';
const results = [];
for (const phase of ['first', 'repeat']) {
  const start = performance.now();
  const response = await fetch(new URL('/api/speech/tts/stream', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, locale: 'zh-CN', tone: 'gentle' }), signal: AbortSignal.timeout(35000),
  });
  const headersMs = Math.round(performance.now() - start);
  if (!response.ok || !response.headers.get('content-type')?.includes('audio/mpeg') || !response.body) {
    throw new Error(`流音频请求未通过：HTTP ${response.status}。`);
  }
  const reader = response.body.getReader(); let firstBytesMs: number | undefined, bytes = 0, chunks = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      firstBytesMs ??= Math.round(performance.now() - start); bytes += result.value.byteLength; chunks++;
    }
  } finally { reader.releaseLock(); }
  if (bytes < 32) throw new Error('流音频没有有效内容。');
  const result = { phase, cached: response.headers.get('x-tts-cached'), headersMs, firstBytesMs, completeMs: Math.round(performance.now() - start), chunks, bytes };
  results.push(result); console.log(JSON.stringify(result));
}
await mkdir(resolve('artifacts'), { recursive: true });
await writeFile(resolve('artifacts/tts-stream-latency.json'), JSON.stringify({ at: new Date().toISOString(), text, metric: 'HTTP payload, not browser sound', results }, null, 2));
