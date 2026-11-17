import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StoredData } from '../server/store.ts';
import { assessmentDimensions } from '../shared/assessment.ts';
import { companionIds } from '../shared/companions.ts';

// Explicit disposable engineering profile; never opens the family database or calls a cloud provider.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 8848);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || process.argv.slice(2).some(arg => !/^--port=\d+$/.test(arg))) throw Error('仅支持 --port=未占用本机端口。');
const dataDir = join(root, 'artifacts', `companion-unlocks-qa-${randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const originalEnvLoad = process.loadEnvFile; process.loadEnvFile = () => {};
const { createApp } = await import('../server/index.ts'); process.loadEnvFile = originalEnvLoad;
const { rebuildAssessmentProgress } = await import('../server/assessments.ts');
const disabled = { configured: false, available: false, status: 'qa_disabled', detail: '角色解锁工程示例，禁止云调用。' };
const deny = async (): Promise<never> => { throw Error(disabled.detail); };
globalThis.fetch = deny;
const clock = () => new Date('2026-11-14T04:00:00Z');
const app = createApp({ rootDir: root, dataDir, clock, observationAudience: 'engineering', chatEnabled: false,
  integrations: { probeIntegrations: async () => ({ speech: disabled, codex: disabled }), getCachedSpeech: async () => undefined, ttsStatus: () => disabled,
    synthesizeSpeech: deny, streamSpeech: deny, generateIllustration: deny, enrichVocabulary: deny, transcribeSpeech: deny, createLiveSttSession: deny, beginCodexLogin: deny },
  challengeServices: { transcribe: deny, grade: deny } });
function addTest(data: StoredData, index: number, time: string) {
  const word = data.words[index], other = data.words[(index + 1) % data.words.length];
  const snapshot = (item: typeof word) => ({ id: item.id, term: item.term, meaning: item.meaning, imageUrl: item.imageUrl, learningVersion: 0 });
  const id = `test-${data.assessments!.length}`;
  const items = assessmentDimensions.map(dimension => ({ id: `${word.id}:${dimension}`, dimension, word: snapshot(word), choices: dimension === 'look' ? [snapshot(word), snapshot(other)] : [], result: 'correct' as const, ...(dimension === 'look' ? { selectedId: word.id } : {}) }));
  data.assessments!.push({ id, wordIds: [word.id], startedAt: time, completedAt: time, mode: 'full', items });
  data.assessmentAttempts!.push(...items.map(item => ({ id: `${id}:${item.id}`, itemId: item.id, sessionId: id, wordId: word.id, learningVersion: 0, dimension: item.dimension, result: 'correct', source: item.dimension === 'look' ? 'server' as const : 'parent' as const, createdAt: time })));
}
function seed(scenario: string) {
  app.store.mutate(data => {
    data.profile.nickname = '角色解锁（隔离工程示例）'; data.profile.onboardingCompleted = true; data.settings.voiceEnabled = false; data.settings.monthlyBudgetCny = 0;
    data.packs = [{ id: 'qa-book', title: '隔离工程示例（不用于孩子）', enabled: false, createdAt: clock().toISOString() }];
    data.words = Array.from({ length: 40 }, (_, index) => ({ id: `qa-${index}`, packId: 'qa-book', term: `fixture ${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`, meaning: `隔离工程示例${index + 1}`, imageUrl: index % 2 ? '/assets/words/banana.svg' : '/assets/words/apple.svg', assetStatus: 'approved', imageSource: 'upload', learningVersion: 0 }));
    data.sessions = []; data.attempts = []; data.progress = []; data.stickers = []; data.badgeAwards = []; data.companionRewards = undefined;
    data.assessments = []; data.assessmentAttempts = []; data.assessmentProgress = []; data.assessmentPractices = [];
    const count = scenario.startsWith('new') ? Number(scenario.slice(3)) : scenario === 'both20' ? 20 : 0;
    for (let index = 0; index < count; index++) addTest(data, index, '2026-11-12T03:00:00Z');
    if (scenario === 'both20') for (let index = 0; index < 20; index++) addTest(data, index, '2026-11-13T03:00:00Z');
    // Explicit engineering-only reward history for inspecting every portrait; no formal grades are invented.
    if (scenario === 'catalogue') data.companionRewards = { version: 1, reviewed: [], learned: Array.from({ length: (companionIds.length - 2) * 20 }, (_, index) => ({ term: 'fixture a' + [...index.toString(26)].map(letter => String.fromCharCode(97 + parseInt(letter, 26))).join(''), day: '2026-11-12' })) };
    rebuildAssessmentProgress(data);
  });
}
seed('new10');
const original = app.server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void;
app.server.removeAllListeners('request');
app.server.on('request', (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (url.pathname === '/__qa/scenario' && req.method === 'GET') {
    const scenario = url.searchParams.get('name') ?? '';
    if (!['empty', 'new9', 'new10', 'new19', 'new20', 'new29', 'new30', 'new39', 'new40', 'both20', 'catalogue'].includes(scenario)) { res.writeHead(400); res.end('invalid scenario'); return; }
    seed(scenario); res.writeHead(303, { Location: '/' }); res.end(); return;
  }
  if (url.pathname === '/') {
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8').replace('<body>', '<body><div style="position:relative;z-index:2;padding:10px;text-align:center;background:#fff0b8;color:#684b17;font:14px sans-serif">角色解锁 · 隔离工程示例，不是孩子档案 · <a href="/__qa/scenario?name=empty">初始2位</a> · <a href="/__qa/scenario?name=new9">新词9</a> · <a href="/__qa/scenario?name=new10">新词10·人物</a> · <a href="/__qa/scenario?name=new19">新词19</a> · <a href="/__qa/scenario?name=new20">新词20·动画</a> · <a href="/__qa/scenario?name=new30">新词30·人物</a> · <a href="/__qa/scenario?name=both20">新词20+复习20（不加奖）</a> · <a href="/__qa/scenario?name=new40">新词40</a> · <a href="/__qa/scenario?name=catalogue">全部人物图预览</a></div>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return;
  }
  original(req, res);
});
await new Promise<void>((done, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', done); });
console.log(JSON.stringify({ origin: `http://127.0.0.1:${port}`, dataDir, scenario: 'new10', cloud: 'disabled' }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
