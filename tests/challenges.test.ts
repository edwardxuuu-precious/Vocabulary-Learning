import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.ts';
import { Store, validateBackup } from '../server/store.ts';
import { createChallengeManager, validateChallengeWav, type ChallengeServices } from '../server/challenges.ts';
import { challenge, reviewChallenge, saveChallengeResponse, submitChallenge } from '../server/challenge-state.ts';
import { assessmentCurrent, dueAssessmentProgress } from '../shared/assessment.ts';
import { dailyLearningPlan } from '../shared/learning.ts';
import { childGrowth } from '../shared/growth.ts';
import { createAssessmentStt, estimateAssessmentStt } from '../server/integrations/assessment-stt.ts';
import { createAssessmentGrader, type GradingAnswer } from '../server/integrations/assessment-grader.ts';
import type { AssessmentSession, IntegrationStatus } from '../shared/contracts.ts';
import type { DialogueTransport } from '../server/integrations/dialogue.ts';

const DAY = 86400000;
const unavailable = { configured: false, available: false, status: 'test_disabled', detail: '测试替身，无外部请求' };
const statuses: IntegrationStatus = { speech: unavailable, codex: unavailable };
export function syntheticWav(seed = 1, seconds = .3) {
  const count = Math.floor(seconds * 16000), audio = Buffer.alloc(44 + count * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; index++) audio.writeInt16LE(Math.round(Math.sin(index * (.05 + seed * .001)) * 3000), 44 + index * 2);
  return audio;
}
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'word-challenge-')); let now = new Date('2026-10-17T04:00:00Z');
  const store = new Store(dir, () => now); store.enablePack('starter', true);
  const ids = store.read().words.slice(0, 6).map(word => word.id);
  store.mutate(data => { data.sessions.push({ id: 'lesson', wordIds: ids, completedWordIds: ids, startedAt: now.toISOString(), completedAt: now.toISOString(), rewardGranted: true }); data.attempts.push(...ids.map(wordId => ({ id: wordId, sessionId: 'lesson', wordId, learningVersion: 0, skill: 'listen' as const, correct: true, hinted: false, source: 'click' as const, createdAt: now.toISOString() }))); });
  return { dir, store, ids, now: () => now, advance: (days = 1) => { now = new Date(now.getTime() + days * DAY); }, dispose: () => { store.close(); assert.ok(dir.startsWith(path.join(tmpdir(), 'word-challenge-'))); rmSync(dir, { recursive: true, force: true }); } };
}
function fill(f: ReturnType<typeof fixture>, manager: ReturnType<typeof createChallengeManager>, ids = f.ids.slice(0, 1)) {
  let session = f.store.createAssessment({ wordIds: ids, workflow: 'recorded' });
  while (assessmentCurrent(session)) {
    const item = assessmentCurrent(session)!;
    session = item.dimension === 'look' ? manager.respond(session.id, { itemId: item.id, expectedVersion: 0, action: 'choose', selectedId: item.word.id }) : manager.upload(session.id, item.id, 0, syntheticWav());
  }
  return session;
}
const reviewRows = (session: AssessmentSession, result = 'correct') => ({ items: session.items.filter(item => item.dimension !== 'look').map(item => ({ itemId: item.id, responseVersion: item.response!.version, proposalVersion: item.proposal?.version ?? 0, reviewVersion: item.reviews?.length ?? 0, result })) });
async function until(predicate: () => boolean) { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('后台测试任务未完成'); }

test('child HTTP can start, upload and resume without PIN; only review/replay/retry and onsite judgement require a grant', async () => {
  const f = fixture(); let stt = 0, grades = 0;
  const app = createApp({ dataDir: f.dir, clock: f.now, integrations: { probeIntegrations: async () => statuses }, challengeServices: { transcribe: async () => { stt++; return 'apple'; }, grade: async answers => { grades++; return answers.map(answer => ({ id: answer.id, verdict: 'matched', reason: '识别内容相符' })); } } });
  try {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const call = (url: string, body?: unknown, token?: string, extra = {}) => fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal((await call('/api/assessments', { wordIds: f.ids })).status, 400);
    assert.equal((await call('/api/assessments', { wordIds: [f.ids[0]] }, undefined, { Origin: 'https://other.example' })).status, 403);
    let session: AssessmentSession = await (await call('/api/assessments', { wordIds: f.ids.slice(0, 5) })).json();
    assert.equal(session.items.length, 20); assert.equal(session.workflow, 'recorded');
    const url = `/api/assessments/${session.id}`;
    assert.equal((await call(url)).status, 200);
    assert.equal((await call(url + '/actions', { itemId: session.items[0].id, action: 'judge', judgement: 'correct' })).status, 400);
    assert.equal((await call(url + '/responses', { itemId: session.items[2].id, action: 'skip', expectedVersion: 0 })).status, 409);
    const upload = (itemId: string, version: number, bytes = syntheticWav()) => fetch(base + `${url}/recordings?itemId=${encodeURIComponent(itemId)}&version=${version}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: bytes });
    assert.equal((await upload(session.items[0].id, 0, Buffer.alloc(44))).status, 400);
    session = await (await upload(session.items[0].id, 0)).json();
    const saved = session.items[0].response;
    session = await (await upload(session.items[0].id, 0)).json(); assert.deepEqual(session.items[0].response, saved);
    session = await (await upload(session.items[0].id, 1, syntheticWav(2))).json(); assert.equal(session.items[0].response!.version, 2);
    while (assessmentCurrent(session)) {
      const item = assessmentCurrent(session)!;
      session = await (await (item.dimension === 'look' ? call(url + '/responses', { itemId: item.id, expectedVersion: 0, action: 'choose', selectedId: item.word.id }) : upload(item.id, 0))).json();
    }
    assert.equal(app.store.read().assessmentAttempts!.length, 0);
    const pin = await (await call('/api/parent-gate', { pin: '097531' })).json(), token = pin.assessmentGrant.token;
    assert.equal((await call(url + '/audio?itemId=' + encodeURIComponent(session.items[0].id))).status, 403);
    assert.equal((await call(url + '/audio?itemId=' + encodeURIComponent(session.items[0].id), undefined, token)).status, 200);
    assert.equal((await call('/media/assessment-recordings/' + session.items[0].response!.recording!.id + '.wav')).status, 404);
    session = await (await call(url + '/submit', {})).json(); assert.ok(session.submittedAt);
    await call(url + '/submit', {});
    await until(() => app.store.read().assessments!.find(row => row.id === session.id)?.job?.status === 'review');
    assert.equal(stt, 15); assert.equal(grades, 1);
    assert.equal(app.store.read().assessmentAttempts!.length, 5);
    assert.equal((await upload(session.items[0].id, 2)).status, 409);
    assert.equal((await call(url + '/review', reviewRows(session))).status, 403);
    assert.equal((await call(url + '/retry', {})).status, 403);
    session = await (await call(url)).json();
    const stale = reviewRows(session); stale.items[0].proposalVersion = 0;
    assert.equal((await call(url + '/review', stale, token)).status, 409);
    assert.equal(app.store.read().assessmentAttempts!.length, 5);
    assert.equal((await call(url + '/review', reviewRows(session), token)).status, 200);
    assert.equal(app.store.read().assessmentAttempts!.length, 20);
    assert.equal(readdirSync(path.join(f.dir, 'assessment-recordings')).length, 0);
    assert.equal((await call(url + '/audio?itemId=' + encodeURIComponent(session.items[0].id), undefined, token)).status, 404);
    assert.equal((await call(url + '/review', reviewRows(session), token)).status, 409);
    f.advance(1 / 48);
    assert.equal((await call(url + '/retry', {}, token)).status, 403);
    assert.equal((await call(url)).status, 200);
  } finally { await app.close(); f.dispose(); }
});

test('AI practice proposals schedule bounded extra practice without advancing formal progress; empty, skipped and unconfirmed remain distinct', async () => {
  const f = fixture();
  const manager = createChallengeManager({ store: f.store, dataDir: f.dir, imageAvailable: () => true, services: { transcribe: async () => '', grade: async answers => answers.map((answer, i) => ({ id: answer.id, verdict: i ? 'unclear' : 'practice', reason: '转写待核对' })) } });
  try {
    const session = fill(f, manager); manager.submit(session.id);
    await until(() => challenge(f.store.read(), session.id).job?.status === 'review');
    assert.deepEqual(f.store.read().assessmentProgress!.map(row => row.dimension), ['look']);
    const plan = dailyLearningPlan(f.store.read(), f.now());
    assert.ok(plan.tasks.some(task => task.steps.includes('practice-zh-en')));
    assert.ok(plan.taskCount <= plan.taskLimit);
    manager.review(session.id, reviewRows(challenge(f.store.read(), session.id), 'unconfirmed'));
    assert.ok(f.store.read().assessmentProgress!.filter(row => row.dimension !== 'look').every(row => row.stage === 0));
    let skipped = f.store.createAssessment({ wordIds: [f.ids[0]], workflow: 'recorded' });
    for (const item of skipped.items) skipped = manager.respond(skipped.id, { itemId: item.id, action: 'skip', expectedVersion: 0 });
    manager.submit(skipped.id); manager.review(skipped.id, reviewRows(skipped, 'skipped'));
    assert.ok(f.store.read().assessmentAttempts!.some(row => row.result === 'skipped'));
    const silence = syntheticWav(); silence.fill(0, 44); assert.throws(() => validateChallengeWav(silence), /没有听到/);
    assert.equal(validateChallengeWav(syntheticWav(1, 20)), 20);
    assert.throws(() => validateChallengeWav(syntheticWav(1, 20.1)), /20秒/);
  } finally { await manager.close(); f.dispose(); }
});

test('late parent review and corrections replay by answer day, respect same-day limits and preserve old senses', async () => {
  const f = fixture(), manager = createChallengeManager({ store: f.store, dataDir: f.dir, imageAvailable: () => true });
  try {
    const a = fill(f, manager); f.store.mutate(data => submitChallenge(data, a.id, f.now(), () => true));
    f.advance(); const b = fill(f, manager); f.store.mutate(data => submitChallenge(data, b.id, f.now(), () => true));
    f.advance(3);
    manager.review(b.id, reviewRows(challenge(f.store.read(), b.id)));
    manager.review(a.id, reviewRows(challenge(f.store.read(), a.id)));
    const read = () => f.store.read().assessmentProgress!.find(row => row.dimension === 'read')!;
    assert.equal(read().stage, 2); assert.equal(read().dueAt, new Date(Date.parse(b.items[0].response!.answeredAt) + 3 * DAY).toISOString());
    assert.ok(dueAssessmentProgress(f.store.read(), f.now()).some(row => row.dimension === 'read'));
    manager.review(a.id, reviewRows(challenge(f.store.read(), a.id), 'incorrect'));
    assert.equal(read().stage, 1); assert.equal(f.store.read().assessmentAttempts!.length, 8);
    const c = fill(f, manager); f.store.mutate(data => submitChallenge(data, c.id, f.now(), () => true)); manager.review(c.id, reviewRows(challenge(f.store.read(), c.id)));
    const d = fill(f, manager); f.store.mutate(data => submitChallenge(data, d.id, f.now(), () => true)); manager.review(d.id, reviewRows(challenge(f.store.read(), d.id)));
    assert.equal(read().stage, 2);
    f.store.mutate(data => { data.words.find(word => word.id === f.ids[0])!.learningVersion = 1; });
    assert.equal(dueAssessmentProgress(f.store.read(), new Date(f.now().getTime() + 90 * DAY)).length, 0);
    assert.equal(f.store.read().assessmentAttempts!.length, 16);
    assert.doesNotThrow(() => validateBackup(f.store.exportBackup()));
  } finally { await manager.close(); f.dispose(); }
});

test('partial parent verification counts only the fully verified word, without waiting for unrelated oral answers', async () => {
  const f = fixture(), manager = createChallengeManager({ store: f.store, dataDir: f.dir, imageAvailable: () => true });
  try {
    const session = fill(f, manager, f.ids.slice(0, 5)); f.store.mutate(data => submitChallenge(data, session.id, f.now(), () => true));
    assert.equal(childGrowth(f.store.read(), f.now()).verifiedWords, 0);
    const rows = reviewRows(challenge(f.store.read(), session.id)); rows.items = rows.items.filter(row => row.itemId.startsWith(f.ids[0] + ':'));
    manager.review(session.id, rows);
    assert.equal(childGrowth(f.store.read(), f.now()).verifiedWords, 1);
    assert.equal(challenge(f.store.read(), session.id).items.filter(item => item.result === undefined).length, 12);
  } finally { await manager.close(); f.dispose(); }
});

test('failed stages retry only unfinished transcription/grading, survive restart, and never overwrite parent decisions with late AI', async () => {
  const f = fixture(); let calls = 0, gradeCalls = 0, failStt = true, failGrade = true;
  const services: ChallengeServices = { transcribe: async () => { calls++; if (calls === 2 && failStt) throw Error('failure'); return 'apple'; }, grade: async answers => { gradeCalls++; if (failGrade) throw Error('failure'); return answers.map(answer => ({ id: answer.id, verdict: 'matched', reason: '相符' })); } };
  let manager = createChallengeManager({ store: f.store, dataDir: f.dir, imageAvailable: () => true, services });
  try {
    const session = fill(f, manager); manager.submit(session.id);
    await until(() => challenge(f.store.read(), session.id).job?.status === 'failed');
    assert.equal(calls, 2); assert.equal(challenge(f.store.read(), session.id).items.filter(item => item.transcript).length, 1);
    failStt = false; manager.retry(session.id);
    await until(() => gradeCalls === 1 && challenge(f.store.read(), session.id).job?.status === 'failed');
    assert.equal(calls, 4);
    failGrade = false; manager.retry(session.id);
    await until(() => challenge(f.store.read(), session.id).job?.status === 'review');
    assert.equal(calls, 4); assert.equal(gradeCalls, 2);
    await manager.close();
    let resolveGrade!: (answers: any[]) => void;
    manager = createChallengeManager({ store: f.store, dataDir: f.dir, imageAvailable: () => true, services: { transcribe: async () => 'apple', grade: async () => new Promise(resolve => { resolveGrade = resolve; }) } });
    const late = fill(f, manager); manager.submit(late.id); await until(() => Boolean(resolveGrade));
    manager.review(late.id, reviewRows(challenge(f.store.read(), late.id), 'incorrect'));
    resolveGrade(late.items.filter(item => item.dimension !== 'look').map(item => ({ id: item.id, verdict: 'matched', reason: '相符' })));
    await until(() => challenge(f.store.read(), late.id).job?.status === 'review');
    assert.ok(challenge(f.store.read(), late.id).items.filter(item => item.dimension !== 'look').every(item => item.result === 'incorrect' && !item.proposal));
    await manager.close();
    f.store.mutate(data => { const job = challenge(data, session.id).job!; job.status = 'grading'; });
    manager = createChallengeManager({ store: f.store, dataDir: f.dir, imageAvailable: () => true, services });
    assert.equal(challenge(f.store.read(), session.id).job!.status, 'interrupted');
  } finally { await manager.close(); f.dispose(); }
});

test('private audio stays out of backups, missing restored audio requests retest, and forged evidence is rejected', async () => {
  const f = fixture(), manager = createChallengeManager({ store: f.store, dataDir: f.dir, imageAvailable: () => true });
  try {
    const session = fill(f, manager); f.store.mutate(data => submitChallenge(data, session.id, f.now(), () => true));
    const backup = f.store.exportBackup(); assert.ok(!backup.files.some(file => file.path.includes('assessment-recordings')));
    assert.doesNotThrow(() => validateBackup(backup));
    const bad = structuredClone(backup); (bad.data.assessments![0].items[0].response!.recording as any).path = 'outside.wav'; assert.throws(() => validateBackup(bad), /挑战证据/);
    const forged = structuredClone(backup); forged.data.assessments![0].items[0].result = 'correct'; assert.throws(() => validateBackup(forged), /挑战证据/);
    f.store.restoreBackup(backup);
    assert.equal(challenge(f.store.read(), session.id).items[0].response!.recording!.status, 'missing');
    assert.throws(() => manager.review(session.id, reviewRows(challenge(f.store.read(), session.id))), /缺少原始回答/);
    manager.review(session.id, reviewRows(challenge(f.store.read(), session.id), 'unconfirmed'));
    assert.doesNotThrow(() => validateBackup(f.store.exportBackup()));
    const partial = f.store.createAssessment({ wordIds: [f.ids[1]], workflow: 'recorded' });
    f.store.mutate(data => { data.words.find(word => word.id === f.ids[1])!.meaning = '新义项'; });
    assert.throws(() => manager.respond(partial.id, { itemId: partial.items[0].id, expectedVersion: 0, action: 'skip' }), /词义或素材已变化/);
    assert.equal(challenge(f.store.read(), partial.id).items[0].response, undefined);
  } finally { await manager.close(); f.dispose(); }
});

test('a failed file deletion keeps the committed review and a persisted cleanup retry', async () => {
  const f = fixture(); let denied = true;
  const manager = createChallengeManager({ store: f.store, dataDir: f.dir, imageAvailable: () => true, removeRecording: file => { if (denied) throw Error('locked'); unlinkSync(file); } });
  try {
    const session = fill(f, manager); f.store.mutate(data => submitChallenge(data, session.id, f.now(), () => true));
    manager.review(session.id, reviewRows(challenge(f.store.read(), session.id)));
    assert.equal(f.store.read().assessmentAttempts!.length, 4);
    assert.equal(challenge(f.store.read(), session.id).items[0].response!.recording!.status, 'purge-pending');
    assert.throws(() => manager.audio(session.id, session.items[0].id), /已清理或缺失/);
    denied = false; manager.cleanup();
    assert.equal(readdirSync(path.join(f.dir, 'assessment-recordings')).length, 0);
    assert.equal(challenge(f.store.read(), session.id).items[0].response!.recording!.status, 'deleted');
    assert.doesNotThrow(() => validateBackup(f.store.exportBackup()));
  } finally { await manager.close(); f.dispose(); }
});

test('Scribe batch preflight fails closed for unknown/paid/exhausted quota and uses unbiased official multipart with its own budget', async () => {
  let quota: any = { tier: 'free', status: 'free', max_credit_limit_extension: 0, character_count: 0, character_limit: 10000 }, before = 0, sends = 0;
  const transcribe = createAssessmentStt({ env: { ELEVENLABS_API_KEY: 'test-only' }, fetch: async (url, init) => {
    if (String(url).endsWith('/subscription')) return Response.json(quota);
    assert.equal(String(url), 'https://api.elevenlabs.io/v1/speech-to-text'); sends++;
    const form = init!.body as FormData; assert.equal(form.get('model_id'), 'scribe_v2'); assert.equal(form.has('keyterms'), false); assert.equal(form.has('transcript_edit'), false); assert.equal(form.get('language_code'), 'en');
    return Response.json({ text: 'apple' });
  } });
  const input = { audio: syntheticWav(), seconds: .3, language: 'en' as const, signal: new AbortController().signal, beforeRequest: (cost: number) => { before++; assert.equal(cost, estimateAssessmentStt(.3)); } };
  for (const invalid of [null, { ...quota, tier: 'starter' }, { ...quota, max_credit_limit_extension: 1 }, { ...quota, character_count: 10000 }, { ...quota, character_limit: undefined }]) { const previous = quota; quota = invalid; await assert.rejects(transcribe(input), /免费额度/); quota = previous; }
  assert.equal(before, 0); assert.equal(sends, 0);
  assert.equal(await transcribe(input), 'apple'); assert.equal(sends, 1); assert.equal(before, 1);
  const auth = createAssessmentStt({ env: { ELEVENLABS_API_KEY: 'test' }, fetch: async url => String(url).endsWith('/subscription') ? Response.json(quota) : new Response('', { status: 401 }) });
  await assert.rejects(auth(input), /认证失败/);
});

test('Codex grader uses an ephemeral locked-down structured turn, requires subscription quota, and rejects tool/protocol errors', async () => {
  const answers: GradingAnswer[] = [{ id: 'apple:read', dimension: 'read', term: 'apple', meaning: '苹果', transcript: 'apple' }];
  let account = 'chatgpt', percent = 10, tool = false, bad = false, closed = 0, turns = 0;
  const factory = ({ args }: { args: string[] }) => {
    assert.ok(args.includes('web_search="disabled"')); assert.ok(args.some(arg => arg.includes('filesystem=') && arg.includes('deny')));
    let listener: (event: any) => void = () => {};
    const transport: DialogueTransport = { notify() {}, close() { closed++; }, listen(callback) { listener = callback; return () => {}; }, async request(method, params) {
      if (method === 'account/read') return { account: { type: account } };
      if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: percent } } };
      if (method === 'permissionProfile/list') return { data: [{ id: 'word_dialogue', allowed: true }] };
      if (method === 'config/read') return { config: { mcp_servers: { test: {} } } };
      if (method === 'thread/start') { assert.equal(params!.ephemeral, true); assert.equal(params!.approvalPolicy, 'never'); assert.deepEqual(params!.dynamicTools, []); return { thread: { id: 'thread' } }; }
      if (method === 'turn/start') {
        turns++; assert.ok(params!.outputSchema); assert.equal(params!.permissions, 'word_dialogue');
        // Deliberately deliver before RPC response to cover fast-notification races.
        listener({ method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { type: tool ? 'commandExecution' : 'agentMessage', text: JSON.stringify({ items: bad ? [] : [{ id: answers[0].id, verdict: 'matched', reason: '内容相符，不代表发音评分' }] }) } } });
        listener({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
        return { turn: { id: 'turn' } };
      }
      return {};
    } }; return transport;
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'word-challenge-grader-'));
  try {
    const grade = createAssessmentGrader({ dataDir: dir, transportFactory: factory });
    assert.equal((await grade(answers, new AbortController().signal))[0].verdict, 'matched');
    account = 'apiKey'; await assert.rejects(grade(answers, new AbortController().signal), /订阅/); account = 'chatgpt';
    percent = 100; await assert.rejects(grade(answers, new AbortController().signal), /剩余额度/); percent = 10;
    tool = true; await assert.rejects(grade(answers, new AbortController().signal), /未完成/); tool = false;
    bad = true; await assert.rejects(grade(answers, new AbortController().signal), /格式不完整/);
    assert.equal(turns, 3); assert.equal(closed, 5);
  } finally { assert.ok(dir.startsWith(path.join(tmpdir(), 'word-challenge-grader-'))); rmSync(dir, { recursive: true, force: true }); }
});
