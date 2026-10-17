import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import { AssessmentGrants } from '../server/assessment-grants.ts';
import { createApp } from '../server/index.ts';
import { assessmentCurrent, assessmentDimensions, assessmentWords, dueAssessmentProgress, practiceDimension } from '../shared/assessment.ts';
import { dailyLearningPlan } from '../shared/learning.ts';
import type { AssessmentResult, AssessmentSession, IntegrationStatus } from '../shared/contracts.ts';

const unavailable = { configured: false, available: false, status: 'test_disabled', detail: '隔离测试不上云' };
const statuses: IntegrationStatus = { speech: unavailable, codex: unavailable };
const DAY = 86_400_000;
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'word-assessment-'));
  let now = new Date('2026-10-17T02:00:00.000Z');
  const store = new Store(dir, () => now);
  store.enablePack('starter', true); // Explicit sample opt-in in this isolated fixture.
  const ids = store.read().words.slice(0, 6).map(word => word.id);
  store.mutate(data => {
    data.sessions.push({ id: 'history', wordIds: ids, completedWordIds: ids, startedAt: new Date(now.getTime() - DAY).toISOString(), completedAt: new Date(now.getTime() - DAY).toISOString(), rewardGranted: true });
    data.attempts.push(...ids.map(wordId => ({ id: `history:${wordId}`, sessionId: 'history', wordId, learningVersion: 0, skill: 'recall' as const, correct: false, hinted: false, practiceOnly: true, source: 'click' as const, createdAt: now.toISOString() })));
  });
  return { dir, store, ids, now: () => now, advance: (days = 1) => { now = new Date(now.getTime() + days * DAY); }, close: () => { store.close(); assert.ok(dir.startsWith(path.join(os.tmpdir(), 'word-assessment-'))); rmSync(dir, { recursive: true, force: true }); } };
}
function answer(store: Store, session: AssessmentSession, result: AssessmentResult = 'correct') {
  const item = assessmentCurrent(session)!;
  return store.assessmentAction(session.id, item.dimension === 'look' ? item.choices.length ? { itemId: item.id, action: 'choose', selectedId: result === 'incorrect' ? item.choices.find(choice => choice.id !== item.word.id)!.id : item.word.id } : { itemId: item.id, action: 'unavailable' } : { itemId: item.id, action: 'judge', judgement: result });
}
function finish(store: Store, session: AssessmentSession, result: AssessmentResult = 'correct') {
  while (assessmentCurrent(session)) session = answer(store, session, result);
  return session;
}

test('five-word assessments freeze 20 grouped items, require learned enabled words, and reject excessive or duplicate selections', () => {
  const f = fixture();
  try {
    const original = f.store.read();
    const session = f.store.createAssessment({ wordIds: f.ids.slice(0, 5) });
    assert.equal(session.items.length, 20);
    assert.deepEqual(session.items.map(item => item.dimension), assessmentDimensions.flatMap(dimension => Array(5).fill(dimension)));
    assert.ok(session.items.filter(item => item.dimension === 'look').every(item => item.choices.length >= 2 && item.choices.length <= 3));
    assert.deepEqual(f.store.read().attempts, original.attempts);
    assert.deepEqual(f.store.read().progress, original.progress);
    assert.deepEqual(f.store.read().stickers, original.stickers);
    assert.throws(() => f.store.createAssessment({ wordIds: f.ids }), /1–5/);
    assert.throws(() => f.store.createAssessment({ wordIds: [f.ids[0], f.ids[0]] }), /1–5/);
    assert.throws(() => f.store.createAssessment({ wordIds: ['starter-sun'] }), /已学/);
    f.store.enablePack('starter', false);
    assert.throws(() => f.store.createAssessment({ wordIds: [f.ids[0]] }), /已学/);
  } finally { f.close(); }
});

test('server grades the first image choice, oral judgement cannot spoof look, and retries cannot replace the first answer', () => {
  const f = fixture();
  try {
    let session = f.store.createAssessment({ wordIds: [f.ids[0]] });
    assert.throws(() => f.store.assessmentAction(session.id, { itemId: session.items[1].id, action: 'judge', judgement: 'correct' }), /先完成/);
    for (let i = 0; i < 3; i++) session = answer(f.store, session);
    const item = assessmentCurrent(session)!;
    assert.throws(() => f.store.assessmentAction(session.id, { itemId: item.id, action: 'judge', judgement: 'correct' }), /真实的家长判定/);
    const wrong = item.choices.find(choice => choice.id !== item.word.id)!;
    session = f.store.assessmentAction(session.id, { itemId: item.id, action: 'choose', selectedId: wrong.id });
    assert.equal(session.items.at(-1)!.result, 'incorrect');
    f.store.assessmentAction(session.id, { itemId: item.id, action: 'choose', selectedId: item.word.id });
    const stored = f.store.read();
    assert.equal(stored.assessmentAttempts!.length, 4);
    assert.equal(stored.assessmentAttempts!.at(-1)!.source, 'server');
    assert.equal(stored.assessments![0].items.at(-1)!.selectedId, wrong.id);
    assert.equal(stored.assessmentProgress!.find(row => row.dimension === 'look')!.stage, 0);
  } finally { f.close(); }
});

test('hints, unconfirmed answers and skips never invent independent success or merge with listening records', () => {
  const f = fixture();
  try {
    let session = f.store.createAssessment({ wordIds: [f.ids[0]] });
    session = answer(f.store, session, 'hinted');
    session = answer(f.store, session, 'unconfirmed');
    session = f.store.assessmentAction(session.id, { itemId: assessmentCurrent(session)!.id, action: 'skip' });
    session = answer(f.store, session);
    const data = f.store.read();
    assert.ok(session.completedAt);
    assert.deepEqual(data.assessmentProgress!.map(row => [row.dimension, row.stage]), [['zh-en', 0], ['read', 0], ['en-zh', 0], ['look', 1]]);
    f.advance(); assert.equal(dueAssessmentProgress(f.store.read(), f.now()).length, 4);
    assert.equal(data.progress.length, 0);
    assert.equal(data.assessmentAttempts!.filter(row => row.source === 'parent').length, 3);
    assert.deepEqual(data.charges, []);
    assert.throws(() => f.store.assessmentAction(session.id, { itemId: session.items[0].id, action: 'judge', judgement: 'correct', source: 'server' }), /动作无效/);
  } finally { f.close(); }
});

test('four dimensions independently advance over 1/3/7/14/30 days, same-day retries do not advance, and failure resets to tomorrow', () => {
  const f = fixture();
  try {
    finish(f.store, f.store.createAssessment({ wordIds: [f.ids[0]] }));
    finish(f.store, f.store.createAssessment({ wordIds: [f.ids[0]] }));
    assert.ok(f.store.read().assessmentProgress!.every(row => row.stage === 1 && Date.parse(row.dueAt) === f.now().getTime() + DAY));
    for (const [wait, stage, next] of [[1, 2, 3], [3, 3, 7], [7, 4, 14], [14, 5, 30], [30, 5, 30]]) {
      f.advance(wait); finish(f.store, f.store.createAssessment({ wordIds: [f.ids[0]], mode: 'due' }));
      assert.ok(f.store.read().assessmentProgress!.every(row => row.stage === stage && Date.parse(row.dueAt) === f.now().getTime() + next * DAY));
    }
    let session = f.store.createAssessment({ wordIds: [f.ids[0]] });
    session = answer(f.store, session, 'incorrect');
    assert.equal(f.store.read().assessmentProgress!.find(row => row.dimension === 'zh-en')!.stage, 0);
    assert.equal(Date.parse(f.store.read().assessmentProgress!.find(row => row.dimension === 'zh-en')!.dueAt), f.now().getTime() + DAY);
    const retry = answer(f.store, f.store.createAssessment({ wordIds: [f.ids[0]] }));
    assert.equal(retry.items[0].result, 'hinted');
  } finally { f.close(); }
});

test('due-only tests select only due dimensions and reject a premature retest request', () => {
  const f = fixture();
  try {
    let session = f.store.createAssessment({ wordIds: [f.ids[0]] });
    session = answer(f.store, session, 'incorrect');
    assert.throws(() => f.store.createAssessment({ wordIds: [f.ids[0]], mode: 'due' }), /没有到期/);
    f.advance();
    const due = f.store.createAssessment({ mode: 'due' });
    assert.equal(due.items.length, 1); assert.equal(due.items[0].dimension, 'zh-en');
  } finally { f.close(); }
});

test('single-image inventory is explicitly unavailable; stale meanings and missing assets pause without adding wrong answers', () => {
  const f = fixture();
  try {
    f.store.mutate(data => { data.words = data.words.filter(word => word.id === f.ids[0]); data.sessions[0].wordIds = [f.ids[0]]; data.sessions[0].completedWordIds = [f.ids[0]]; data.attempts = data.attempts.filter(row => row.wordId === f.ids[0]); });
    let session = f.store.createAssessment({ wordIds: [f.ids[0]] });
    for (let i = 0; i < 3; i++) session = answer(f.store, session);
    session = answer(f.store, session);
    assert.equal(session.items.at(-1)!.result, 'unavailable');
    assert.ok(!f.store.read().assessmentProgress!.some(row => row.dimension === 'look'));
    const next = f.store.createAssessment({ wordIds: [f.ids[0]] });
    assert.throws(() => f.store.assessmentAction(next.id, { itemId: next.items[0].id, action: 'judge', judgement: 'correct' }, () => false), /素材已变化/);
    f.store.updateWord(f.ids[0], { meaning: '新的苹果义项' }, () => true);
    assert.throws(() => answer(f.store, next), /词义或素材已变化/);
    assert.equal(dueAssessmentProgress(f.store.read(), new Date(f.now().getTime() + DAY)).length, 0);
    assert.ok(!assessmentWords(f.store.read()).some(word => word.id === f.ids[0]));
  } finally { f.close(); }
});

test('weak practice joins the task budget, freezes old plans, records participation only and cannot be completed through generic grading', () => {
  const f = fixture();
  try {
    const old = f.store.startSession(true);
    finish(f.store, f.store.createAssessment({ wordIds: f.ids.slice(0, 5) }), 'incorrect');
    f.advance();
    assert.deepEqual(f.store.startSession(true), old);
    f.store.mutate(data => { data.sessions = data.sessions.filter(session => session.id !== old.id); });
    f.store.updateSettings({ sessionMinutes: 3, dailyNewWords: 8 });
    const plan = dailyLearningPlan(f.store.read(), f.now());
    assert.ok(plan.tasks.some(task => task.steps.some(step => practiceDimension(step))));
    assert.ok(plan.taskCount <= 4); assert.equal(plan.fresh.length, 0);
    const session = f.store.startSession(true), activity = session.activities![0];
    const dimension = practiceDimension(activity.step)!;
    assert.ok(dimension);
    assert.throws(() => f.store.updateSession({ completedStep: { wordId: activity.wordId, step: activity.step } }), /先完成/);
    assert.throws(() => f.store.attempt({ sessionId: session.id, wordId: activity.wordId, step: activity.step, skill: 'listen', correct: true, hinted: false, source: 'click' }), /不匹配/);
    const before = structuredClone(f.store.read().assessmentProgress);
    const input = { sessionId: session.id, wordId: activity.wordId, dimension, learningVersion: 0 };
    f.store.assessmentPractice(input); f.store.assessmentPractice(input);
    assert.equal(f.store.read().assessmentPractices!.length, 1);
    assert.deepEqual(f.store.read().assessmentProgress, before);
    assert.ok(!dailyLearningPlan(f.store.read(), f.now()).tasks.some(task => task.wordId === activity.wordId && task.steps.includes(activity.step)));
    assert.doesNotThrow(() => validateBackup(f.store.exportBackup()));
    f.advance(); f.store.updateSettings({sessionMinutes:30}); assert.ok(dailyLearningPlan(f.store.read(), f.now()).tasks.some(task => task.wordId === activity.wordId && task.steps.includes(activity.step)));
  } finally { f.close(); }
});

test('backup round-trip retains partial checkpoints and dimensions, rejects forged progress/evidence, and accepts old backups', () => {
  const f = fixture();
  try {
    const session = answer(f.store, f.store.createAssessment({ wordIds: f.ids.slice(0, 5) }));
    const backup = f.store.exportBackup();
    assert.deepEqual(validateBackup(backup).data.assessments, [session]);
    f.store.restoreBackup(backup);
    assert.deepEqual(f.store.read().assessments, [session]);
    const forged = structuredClone(backup); forged.data.assessmentProgress![0].stage = 5;
    assert.throws(() => validateBackup(forged), /测试记录/);
    const missing = structuredClone(backup); missing.data.assessmentAttempts = [];
    assert.throws(() => validateBackup(missing), /测试记录/);
    const source = structuredClone(backup); source.data.assessmentAttempts![0].source = 'server';
    assert.throws(() => validateBackup(source), /测试记录/);
    const nullRows = structuredClone(backup); (nullRows.data as any).assessmentProgress = null;
    assert.throws(() => validateBackup(nullRows), /测试记录/);
    const reordered = structuredClone(backup); reordered.data.assessmentProgress![0] = Object.fromEntries(Object.entries(reordered.data.assessmentProgress![0]).reverse()) as any;
    assert.doesNotThrow(() => validateBackup(reordered));
    const legacy = structuredClone(backup);
    delete legacy.data.assessments; delete legacy.data.assessmentAttempts; delete legacy.data.assessmentProgress; delete legacy.data.assessmentPractices;
    assert.deepEqual(validateBackup(legacy).data.assessments, []);
    const reopened = new Store(f.dir, f.now);
    try { assert.deepEqual(reopened.read().assessments, [session]); } finally { reopened.close(); }
  } finally { f.close(); }
});

test('assessment grants expire at 30 minutes, revoke explicitly, and are not transferable to a new server instance', () => {
  let now = 1000; const grants = new AssessmentGrants(() => now), grant = grants.issue();
  assert.doesNotThrow(() => grants.require(`Bearer ${grant.token}`));
  now += 30 * 60_000 - 1; grants.require(`Bearer ${grant.token}`);
  now++; assert.throws(() => grants.require(`Bearer ${grant.token}`), /家长验证已失效/);
  const second = grants.issue(); grants.revoke(`Bearer ${second.token}`);
  assert.throws(() => grants.require(`Bearer ${second.token}`), /家长验证已失效/);
  assert.throws(() => new AssessmentGrants(() => now).require(`Bearer ${grants.issue().token}`), /家长验证已失效/);
});

test('HTTP assessment writes require real PIN grants, reject spoofed claims and origins, and cache misses never invoke cloud services', async () => {
  const f = fixture(); let cloudCalls = 0;
  const app = createApp({ dataDir: f.dir, clock: f.now, dialogue: { status: async () => unavailable, turn: async () => { throw Error('disabled'); }, cancel() {}, reset: async () => {}, close: async () => {} }, integrations: { probeIntegrations: async () => statuses, ttsStatus: () => unavailable, getCachedSpeech: async () => undefined, streamSpeech: async () => { cloudCalls++; throw Error('forbidden'); }, synthesizeSpeech: async () => { cloudCalls++; throw Error('forbidden'); } } });
  try {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const call = (route: string, method = 'GET', body?: unknown, token?: string, extra = {}) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal((await call('/api/assessments', 'POST', { wordIds: [f.ids[0]], workflow: 'parent' })).status, 403);
    const setup = await (await call('/api/parent-gate', 'POST', { pin: '097531' })).json();
    const token = setup.assessmentGrant.token;
    const session = await (await call('/api/assessments', 'POST', { wordIds: [f.ids[0]], workflow: 'parent' }, token)).json();
    const action = { itemId: session.items[0].id, action: 'judge', judgement: 'correct' };
    assert.equal((await call(`/api/assessments/${session.id}/actions`, 'POST', action)).status, 403);
    assert.equal((await call(`/api/assessments/${session.id}/actions`, 'POST', action, token, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call(`/api/assessments/${session.id}/actions`, 'POST', { ...action, correct: true }, token)).status, 400);
    assert.equal((await call(`/api/assessments/${session.id}/actions`, 'POST', action, token)).status, 200);
    for (const route of ['/api/state', '/api/backup']) assert.ok(!(await (await call(route)).text()).includes(token));
    assert.equal((await call('/api/parent-gate/pin', 'PATCH', { currentPin: '097531', pin: '082642' })).status, 200);
    assert.equal((await call(`/api/assessments/${session.id}`, 'GET', undefined, token)).status, 403);
    const afterPinChange = await (await call('/api/parent-gate/unlock', 'POST', { pin: '082642' })).json();
    const backup = await (await call('/api/backup')).json();
    assert.equal((await call('/api/restore', 'POST', backup)).status, 200);
    assert.equal((await call(`/api/assessments/${session.id}`, 'GET', undefined, afterPinChange.assessmentGrant.token)).status, 403);
    const cached = await call('/api/speech/tts/stream', 'POST', { text: 'apple', locale: 'en-US', tone: 'clear', cacheOnly: true });
    assert.equal(cached.status, 409); assert.equal(cloudCalls, 0);
    f.advance();
    assert.equal((await call(`/api/assessments/${session.id}`, 'GET', undefined, token)).status, 403);
    const unlocked = await (await call('/api/parent-gate/unlock', 'POST', { pin: '082642' })).json();
    assert.equal((await call(`/api/assessments/${session.id}`, 'GET', undefined, unlocked.assessmentGrant.token)).status, 200);
    await call('/api/parent-gate/assessment/revoke', 'POST', undefined, unlocked.assessmentGrant.token);
    assert.equal((await call(`/api/assessments/${session.id}`, 'GET', undefined, unlocked.assessmentGrant.token)).status, 403);
  } finally { await app.close(); f.close(); }
});
