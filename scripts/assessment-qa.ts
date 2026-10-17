import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Explicit synthetic history and sample opt-in. No real child data, credentials or cloud generation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const experience = process.argv.includes('--experience');
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 8796);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || process.argv.slice(2).some(arg => !['--serve', '--experience'].includes(arg) && !/^--port=\d+$/.test(arg))) throw Error('仅支持 --serve、--experience、--port=本机端口。');
const clientDir = join(root, 'artifacts', 'assessment-experience-client');
if (experience && process.argv.includes('--serve')) assert.ok(existsSync(join(clientDir, 'scripts', 'assessment-experience.html')), '请先运行 npm.cmd run build:assessment-experience');
const dir = join(root, 'artifacts', `assessment-${experience ? 'experience' : 'qa'}-${randomUUID()}`), dataDir = join(dir, 'data');
await mkdir(join(dataDir, 'speech', 'fixture'), { recursive: true });
for (const name of Object.keys(process.env)) if (/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name)) delete process.env[name];
const realLoad = process.loadEnvFile; process.loadEnvFile = () => {};
const { createApp } = await import('../server/index.ts'); process.loadEnvFile = realLoad;
const denied: Record<string, number> = {}, audio = new Map<string, string>(), playback: string[] = [];
const deny = (name: string): never => { denied[name] = (denied[name] ?? 0) + 1; throw Error('隔离测试禁止外部服务。'); };
globalThis.fetch = async () => deny('fetch');
const manifest = JSON.parse(await readFile(join(root, 'artifacts', 'adaptive-qa-cache.json'), 'utf8')) as { term: string; file: string }[];
const speechRoot = realpathSync(join(root, 'data', 'speech'));
for (const row of manifest) {
  const source = realpathSync(row.file); assert.ok(source.startsWith(speechRoot + sep)); assert.ok(statSync(source).isFile());
  const target = join(dataDir, 'speech', 'fixture', `${row.term}.mp3`); await copyFile(source, target); audio.set(row.term, target);
}
let offset = 0;
const now = () => new Date(Date.now() + offset);
const disabled = { configured: false, available: false, status: 'qa_disabled', detail: '隔离测试只使用既有缓存。' };
const app = createApp({ rootDir: root, dataDir, clock: now, learningGames: { forcedKind: 'portal' }, chatEnabled: false,
  dialogue: { status: async () => disabled, turn: async () => deny('chat'), cancel() {}, reset: async () => {}, close: async () => {} },
  integrations: { probeIntegrations: async () => ({ speech: disabled, codex: disabled }), ttsStatus: () => disabled,
    getCachedSpeech: async input => { playback.push(input.text); return input.locale === 'en-US' && input.tone === 'clear' ? audio.get(input.text) : undefined; },
    synthesizeSpeech: async () => deny('tts'), streamSpeech: async () => deny('stream'), generateIllustration: async () => deny('image'), enrichVocabulary: async () => deny('vocabulary'),
    transcribeSpeech: async () => deny('stt'), createLiveSttSession: async () => deny('live'), beginCodexLogin: async () => deny('oauth'), estimateTtsCost: () => 0, estimateSttCost: () => 0,
  } });
app.store.enablePack('starter', true);
const ids = app.store.read().words.slice(0, 6).map(word => word.id);
if (experience) {
  const { ParentGate } = await import('../server/parent-gate.ts');
  new ParentGate(dataDir).setup('735924'); // Disposable example archive only; never the family's PIN.
  assert.ok(app.store.read().words.slice(0, 6).every(word => audio.has(word.term)), '示例发音缓存不齐，未启动体验。');
}
app.store.mutate(data => {
  data.profile.nickname = '测试体验（独立档案）'; data.settings.monthlyBudgetCny = 0;
  data.sessions.push({ id: 'qa-history', wordIds: ids, completedWordIds: ids, startedAt: new Date(now().getTime() - 3600000).toISOString(), completedAt: now().toISOString(), rewardGranted: true });
  data.attempts.push(...ids.map(wordId => ({ id: `qa-history:${wordId}`, sessionId: 'qa-history', wordId, skill: 'recall' as const, learningVersion: 0, correct: false, hinted: false, practiceOnly: true, source: 'click' as const, createdAt: now().toISOString() })));
});
// Two historical tests give the sixth word one due reading item and three later review dates.
for (const days of experience ? [] : [-2, -1]) {
  offset = days * 86_400_000;
  let history = app.store.createAssessment({ wordIds: [ids[5]] });
  for (const item of history.items) history = app.store.assessmentAction(history.id, item.dimension === 'look'
    ? { itemId: item.id, action: 'choose', selectedId: item.word.id }
    : { itemId: item.id, action: 'judge', judgement: days === -1 && item.dimension === 'read' ? 'incorrect' : 'correct' });
}
offset = 0;
const initialData = structuredClone(app.store.read());
const original = app.server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void;
app.server.removeAllListeners('request');
const audit = async () => { const data = app.store.read(); const value = { isolated: true, now: now().toISOString(), dataDir, denied, playback, assessments: data.assessments, attempts: data.assessmentAttempts, progress: data.assessmentProgress, practices: data.assessmentPractices, charges: data.charges, sessions: data.sessions }; await writeFile(join(dir, 'audit.json'), JSON.stringify(value, null, 2)); return value; };
app.server.on('request', (req, res) => { void (async () => {
  const route = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname;
  if (req.method === 'GET' && route === '/__qa/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await audit())); return; }
  if (req.method === 'GET' && route === '/__qa/info') { res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ isolated: true, dayOffset: offset / 86_400_000 })); return; }
  if (req.method === 'POST' && (route === '/__qa/next-day' || experience && route === '/__qa/reset')) {
    if (req.headers.origin !== `http://127.0.0.1:${port}` || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end(); return; }
    if (route === '/__qa/reset') { offset = 0; app.store.mutate(data => Object.assign(data, structuredClone(initialData))); playback.length = 0; }
    else offset += 86_400_000;
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(await audit())); return;
  }
  if (experience && req.method === 'GET' && route.startsWith('/__experience/assets/')) {
    const name = route.slice('/__experience/assets/'.length);
    if (!/^[A-Za-z0-9_.-]+\.(js|css|woff2?)$/.test(name)) { res.writeHead(404); res.end(); return; }
    const file = join(clientDir, 'assets', name);
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'font/woff2');
    res.end(await readFile(file)); return;
  }
  if (req.method === 'GET' && route === '/__qa') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<h1>看读翻译 · 隔离验收</h1><p>显式示例与合成历史，不写正式档案，不调用云服务。</p><button onclick="fetch(\'/__qa/next-day\',{method:\'POST\'}).then(()=>document.querySelector(\'p\').textContent=\'已切换到下一天，请刷新学习页\')">下一天</button><p><a href="/">打开独立体验</a> · <a href="/__qa/state">检查验收记录</a></p>'); return; }
  if (req.method === 'GET' && ['/', '/index.html'].includes(route)) {
    const entry = experience ? join(clientDir, 'scripts', 'assessment-experience.html') : join(root, 'dist', 'index.html');
    assert.ok(existsSync(entry));
    const html = await readFile(entry, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    const clock = `<script>window.Date=new Proxy(Date,{construct(t,a){return Reflect.construct(t,a.length?a:[t.now()+${offset}]);},get(t,p){return p==='now'?()=>t.now()+${offset}:Reflect.get(t,p);}});</script>`;
    res.end(html.replace('</head>', `${clock}</head>`)); return;
  }
  original(req, res);
})().catch(error => { res.writeHead(500); res.end(error instanceof Error ? error.message : 'QA失败'); }); });
await audit();
if (process.argv.includes('--serve')) {
  await new Promise<void>((done, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', done); });
  console.log(JSON.stringify({ url: `http://127.0.0.1:${port}`, dir, isolated: true }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void audit().then(() => app.close()).then(() => process.exit(0)); });
} else { await app.close(); console.log(JSON.stringify({ prepared: true, dir, listening: false })); }
