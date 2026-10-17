import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { assessmentCurrent } from '../shared/assessment.ts';

// Explicit offline examples and synthetic history. Never loads .env or opens the real child's store.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 8795);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || process.argv.slice(2).some(arg => !/^--(?:port|dist)=.+$/.test(arg))) throw Error('仅支持 --port=本机端口、--dist=项目内构建目录。');
const distDir = resolve(root, process.argv.find(arg => arg.startsWith('--dist='))?.slice(7) ?? 'dist');
if (!distDir.startsWith(root + sep) || !existsSync(distDir) || !realpathSync(distDir).startsWith(realpathSync(root) + sep)) throw Error('构建目录必须在本项目内且已存在。');
const origin = `http://127.0.0.1:${port}`, dataDir = join(root, 'artifacts', `growth-qa-${randomUUID()}`);
await mkdir(join(dataDir, 'speech', 'fixture'), { recursive: true });
for (const name of Object.keys(process.env)) if (/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name)) delete process.env[name];
const originalEnvLoad = process.loadEnvFile; process.loadEnvFile = () => {};
const { createApp } = await import('../server/index.ts'); process.loadEnvFile = originalEnvLoad;
const denied: Record<string, number> = {};
const deny = (service: string): never => { denied[service] = (denied[service] ?? 0) + 1; throw Error('隔离体验禁止云服务。'); };
globalThis.fetch = async () => deny('fetch');
const audio = new Map<string, string>();
if (existsSync(join(root, 'artifacts', 'adaptive-qa-cache.json'))) {
  const rows = JSON.parse(await readFile(join(root, 'artifacts', 'adaptive-qa-cache.json'), 'utf8')) as { term: string; file: string }[];
  const speechRoot = realpathSync(join(root, 'data', 'speech'));
  for (const row of rows) {
    const source = realpathSync(row.file);
    if (!source.startsWith(speechRoot + sep)) throw Error('缓存必须位于本项目发音目录。');
    const target = join(dataDir, 'speech', 'fixture', `${row.term}.mp3`);
    await copyFile(source, target); audio.set(row.term, target);
  }
}
const disabled = { configured: false, available: false, status: 'qa_disabled', detail: '仅使用已有缓存，不调用云服务。' };
const baseTime = new Date(), DAY = 86_400_000;
let clock = new Date(baseTime);
const app = createApp({ rootDir: root, dataDir, clock: () => clock, chatEnabled: false, learningGames: { forcedKind: 'portal' },
  dialogue: { status: async () => disabled, turn: async () => deny('chat'), cancel() {}, reset: async () => {}, close: async () => {} },
  integrations: { probeIntegrations: async () => ({ speech: disabled, codex: disabled }), ttsStatus: () => disabled,
    getCachedSpeech: async input => input.locale === 'en-US' ? audio.get(input.text) : undefined,
    synthesizeSpeech: async () => deny('tts'), streamSpeech: async () => deny('stream'), generateIllustration: async () => deny('image'), enrichVocabulary: async () => deny('vocabulary'),
    transcribeSpeech: async () => deny('stt'), createLiveSttSession: async () => deny('live'), beginCodexLogin: async () => deny('oauth'), estimateTtsCost: () => 0, estimateSttCost: () => 0 } });
app.store.enablePack('starter', true);
const ids = app.store.read().words.slice(0, 3).map(word => word.id);
function seed(scenario: string) {
  clock = new Date(baseTime);
  app.store.mutate(data => {
    data.profile.nickname = '成长体验（独立示例）'; data.settings.monthlyBudgetCny = 0;
    data.sessions = []; data.attempts = []; data.progress = []; data.stickers = []; data.badgeAwards = [];
    data.assessments = []; data.assessmentAttempts = []; data.assessmentProgress = []; data.assessmentPractices = [];
    if (scenario === 'empty') return;
    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date(baseTime.getTime() - offset * DAY - 3_600_000).toISOString(), id = `qa-history-${offset}`;
      data.sessions.push({ id, wordIds: ids, completedWordIds: ids, startedAt: date, completedAt: date, rewardGranted: true });
      data.attempts.push(...ids.map(wordId => ({ id: `${id}:${wordId}`, sessionId: id, wordId, learningVersion: 0, skill: 'recall' as const, practiceOnly: true, correct: false, hinted: false, source: 'click' as const, createdAt: date })));
    }
  });
  if (scenario === 'verified') {
    for (const offset of [2, 0]) {
      clock = new Date(baseTime.getTime() - offset * DAY - 1_800_000);
      let assessment = app.store.createAssessment({ wordIds: ids });
      while (!assessment.completedAt) {
        const item = assessmentCurrent(assessment)!;
        assessment = app.store.assessmentAction(assessment.id, item.dimension === 'look' ? { itemId: item.id, action: 'choose', selectedId: item.word.id } : { itemId: item.id, action: 'judge', judgement: offset === 0 && item.word.id === ids[2] && item.dimension === 'read' ? 'hinted' : 'correct' });
      }
    }
    clock = new Date(baseTime);
  }
}
seed('verified');
const original = app.server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void;
app.server.removeAllListeners('request');
app.server.on('request', (req, res) => { void (async () => {
  const route = new URL(req.url ?? '/', origin).pathname;
  if (req.method === 'GET' && !route.startsWith('/api/') && !route.startsWith('/__qa')) {
    const file = resolve(distDir, route === '/' ? 'index.html' : '.' + decodeURIComponent(route));
    if (file.startsWith(distDir + sep) && existsSync(file) && realpathSync(file).startsWith(realpathSync(distDir) + sep)) {
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
      if (mime[extname(file)]) { res.setHeader('Content-Type', mime[extname(file)]); res.setHeader('Cache-Control', 'no-store'); res.end(await readFile(file)); return; }
    }
  }
  if (req.method === 'GET' && route === '/__qa') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<h1>成长系统 · 隔离体验</h1><p>示例与合成学习历史，不写正式档案，不调用云服务。</p><form method="post" action="/__qa/scenario"><button name="scenario" value="empty">全新档案</button> <button name="scenario" value="practice">只练未测</button> <button name="scenario" value="verified">已测成长</button> <button name="scenario" value="next-day">下一天</button></form><p><a href="/">打开应用</a> · <a href="/__qa/audit">检查记录</a></p>'); return; }
  if (req.method === 'GET' && route === '/__qa/audit') { res.setHeader('Content-Type', 'application/json'); const data = app.store.read(); res.end(JSON.stringify({ isolated: true, dataDir, denied, chargeCount: data.charges.length, attemptCount: data.attempts.length, assessmentAttempts: data.assessmentAttempts?.length, growth: app.store.state({ speech: disabled, codex: disabled }).growth })); return; }
  if (req.method === 'POST' && route === '/__qa/scenario') {
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end(); return; }
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100) throw Error('请求过大。'); }
    const scenario = new URLSearchParams(body).get('scenario');
    if (scenario === 'next-day') clock = new Date(clock.getTime() + DAY);
    else if (scenario && ['empty', 'practice', 'verified'].includes(scenario)) seed(scenario);
    else throw Error('未知场景。');
    res.writeHead(303, { Location: '/' }); res.end(); return;
  }
  original(req, res);
})().catch(error => { res.writeHead(500); res.end(error instanceof Error ? error.message : '体验失败。'); }); });
await new Promise<void>((done, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', done); });
console.log(JSON.stringify({ url: `${origin}/__qa`, isolated: true, dataDir }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
