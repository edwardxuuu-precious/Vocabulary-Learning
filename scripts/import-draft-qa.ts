import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ImportRow } from '../shared/contracts.ts';
import { createServer } from 'vite';

// Explicit isolated scenario. Never loads real credentials, uses cloud services, or edits real packs.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'artifacts', 'import-draft-qa-' + randomUUID());
await mkdir(fixture, { recursive: true });
await cp(join(root, 'dist'), join(fixture, 'dist'), { recursive: true });
await cp(join(root, 'public'), join(fixture, 'public'), { recursive: true });
const index = join(fixture, 'dist', 'index.html');
await writeFile(index, (await readFile(index, 'utf8')).replace('<body>', '<body><div style="background:#fff1cd;color:#775b21;text-align:center;padding:8px;font:13px sans-serif">隔离工程验收 · 示例词表 · 无云调用 · 不影响正式数据</div>'));
for (const name of Object.keys(process.env)) if (/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name)) delete process.env[name];
const load = process.loadEnvFile; process.loadEnvFile = () => {};
const { createApp } = await import('../server/index.ts'); process.loadEnvFile = load;
const denied: Record<string, number> = {}, calls: string[][] = [];
const deny = (name: string): never => { denied[name] = (denied[name] ?? 0) + 1; throw Error('隔离验收禁止外部服务'); };
globalThis.fetch = async () => deny('fetch');
const none = { configured: false, available: false, status: 'qa_disabled', detail: '仅隔离示例，不连接云服务' };
const definitions: Record<string, string> = { apple: '苹果', banana: '香蕉', cat: '猫', dog: '狗', jump: '跳跃', happy: '开心的', book: '书', elephant: '大象' };
const app = createApp({ rootDir: fixture, dataDir: join(fixture, 'data'), chatEnabled: false,
  dialogue: { status: async () => none, turn: async () => deny('chat'), cancel() {}, reset: async () => {}, close: async () => {} },
  integrations: { probeIntegrations: async () => ({ speech: none, tts: none, codex: none }), ttsStatus: () => none, getCachedSpeech: async () => undefined,
    enrichVocabulary: async input => {
      calls.push(input.rows.map(row => row.term));
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 750); input.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
      return input.rows.map((row): ImportRow => row.term === 'bananna'
        ? { term: row.term, meaning: row.meaning, partOfSpeech: row.partOfSpeech ?? 'other', pictureHint: '', usageNote: '请核对拼写', spellingSuggestion: { term: 'banana', reason: '常见的香蕉拼写为 banana，这里可能多输入了一个 n。' } }
        : { term: row.term, meaning: row.meaning || definitions[row.term] || '隔离示例词义', partOfSpeech: row.partOfSpeech ?? 'noun', pictureHint: row.pictureHint || '隔离示例：主体清楚，背景简洁，不含文字。', usageNote: '' });
    },
    synthesizeSpeech: async () => deny('tts'), streamSpeech: async () => deny('stream'), generateIllustration: async () => deny('image'), beginCodexLogin: async () => deny('oauth'), transcribeSpeech: async () => deny('stt'), createLiveSttSession: async () => deny('live'), estimateTtsCost: () => 0, estimateSttCost: () => 0,
  },
});
const initial = app.store.read();
const vite = await createServer({ root, server: { middlewareMode: true, watch: { ignored: ['**/docs/**', '**/Work_Progress/**', '**/artifacts/**'] } }, appType: 'custom' });
const original = app.server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void;
app.server.removeAllListeners('request');
app.server.on('request', (req, res) => {
  if (req.url === '/__review') { void vite.transformIndexHtml('/__review', '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>词表修复 · 隔离验收</title></head><body><div id="root"></div><script type="module" src="/scripts/import-draft-experience.tsx"></script></body></html>').then(html => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }); return; }
  if (req.method === 'GET' && req.url === '/__qa') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ fixture: true, calls, denied, formalUnchanged: JSON.stringify(initial) === JSON.stringify(app.store.read()) })); return; }
  if (req.url?.startsWith('/api/') || req.url?.startsWith('/media/')) original(req, res);
  else vite.middlewares(req, res, () => original(req, res));
});
await new Promise<void>(resolve => app.server.listen(8794, '127.0.0.1', resolve));
assert.equal(app.store.read().packs[0].enabled, false);
console.log(JSON.stringify({ url: 'http://127.0.0.1:8794/__review', fixture, cloud: false }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void Promise.all([app.close(), vite.close()]).then(() => process.exit(0)));
