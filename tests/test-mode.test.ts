import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp, type AppOptions } from '../server/index.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { pendingLearningCheckpoint } from '../shared/learning-policy.ts';
import { assessmentCurrent } from '../shared/assessment.ts';
import { createTestMode } from '../server/test-mode.ts';
import type { AssessmentSession, AppState, LearningSession } from '../shared/contracts.ts';

const offline = { configured: false, available: false, status: 'test', detail: '无云调用' };
const options = { chatEnabled: false, learningGames: { allowedKinds: [] }, integrations: { probeIntegrations: async () => ({ speech: offline, codex: offline }), getCachedSpeech: async () => undefined },
  challengeServices: { transcribe: async (): Promise<string> => { throw Error('隔离测试不调用云转写'); }, grade: async (): Promise<never> => { throw Error('隔离测试不调用云批改'); } } };
async function fixture(integrations: AppOptions['integrations'] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'word-test-mode-'));
  const configured = { ...options, integrations: { ...options.integrations, ...integrations } };
  let app = createApp({ ...configured, dataDir: dir }), base = '';
  const listen = async () => { await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`; };
  await listen(); app.store.enablePack('starter', true); // Explicit disposable examples only.
  const call = (route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const unlock = async (prefix = '/api') => {
    const response = await call(prefix + '/parent-gate/unlock', 'POST', { pin: '123456' }, prefix.includes('/test') ? { 'X-Playroom-Test': token } : {});
    assert.equal(response.status, 200); return (await response.json()).assessmentGrant.token as string;
  };
  const initial = await (await call('/api/parent-gate', 'POST', { pin: '123456' })).json();
  let grant = initial.assessmentGrant.token as string;
  let token = '';
  const enter = async () => { const response = await call('/api/test-mode', 'POST', undefined, { Authorization: `Bearer ${grant}` }); assert.equal(response.status, 200); token = (await response.json()).token; return token; };
  const testing = (route: string, method = 'GET', body?: unknown, headers = {}) => call('/api/test' + route, method, body, { 'X-Playroom-Test': token, ...headers });
  const json = async <T,>(route: string, method = 'GET', body?: unknown) => { const response = await testing(route, method, body); const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value as T; };
  const state = () => json<AppState>('/state');
  return { dir, get app() { return app; }, call, testing, json, state, enter, unlock,
    async restart() { await app.close(); app = createApp({ ...configured, dataDir: dir }); await listen(); grant = await unlock(); },
    async close() { await app.close(); assert.ok(dir.startsWith(join(tmpdir(), 'word-test-mode-'))); rmSync(dir, { recursive: true, force: true }); } };
}
async function advance(f: Awaited<ReturnType<typeof fixture>>) {
  const s = (await f.state()).activeSession!, a = currentActivity(s)!, checkpointId = pendingLearningCheckpoint(s);
  if (checkpointId) { await f.json('/session', 'PATCH', { sessionId: s.id, checkpointId }); return; }
  if (a.step === 'recognize' || a.step === 'read' || a.step === 'recall' && a.kind === 'portal') {
    const action = a.step !== 'recognize' ? 'skip' : a.choices.length < 2 ? 'reveal' : 'choose';
    await f.json('/session/activity', 'POST', { sessionId: s.id, activityId: a.id, action, selectedId: a.kind === 'gate' ? (a.cueWord?.id === a.wordId ? 'yes' : 'no') : a.wordId });
    if (action === 'reveal') await f.json('/session/activity', 'POST', { sessionId: s.id, activityId: a.id, action: 'finish' });
    await f.json('/session/activity', 'POST', { sessionId: s.id, activityId: a.id, action: 'next' }); return;
  }
  if (a.kind !== 'standard') { await f.json('/session/activity', 'POST', { sessionId: s.id, activityId: a.id, action: 'skip' }); await f.json('/session/activity', 'POST', { sessionId: s.id, activityId: a.id, action: 'next' }); return; }
  if (a.step !== 'learn') await f.json('/attempts', 'POST', { id: randomUUID(), sessionId: s.id, wordId: a.wordId, step: a.step, skill: a.step === 'sound' ? 'listen' : a.step, correct: true, hinted: false, source: 'click' });
  await f.json('/session', 'PATCH', { sessionId: s.id, completedStep: { wordId: a.wordId, step: a.step } });
}
function wav() {
  const b = Buffer.alloc(44 + 16000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(16000, 40); for (let i = 0; i < 8000; i++) b.writeInt16LE(Math.round(5000 * Math.sin(i * .2)), 44 + i * 2); return b;
}

test('test entry requires a parent grant, expired/absent credentials never fall through, and shared authoring is blocked', async () => {
  const f = await fixture(); try {
    assert.equal((await f.call('/api/test-mode', 'POST')).status, 403);
    assert.equal((await f.call('/api/test/state')).status, 403);
    const token = await f.enter();
    assert.equal((await f.call('/api/state', 'GET', undefined, { 'X-Playroom-Test': token })).status, 403);
    for (const [route, method] of [['/settings', 'PATCH'], ['/packs', 'POST'], ['/profile', 'POST'], ['/restore', 'POST'], ['/backup', 'GET'], ['/parent-gate/pin', 'PATCH'], ['/lesson-plan', 'POST']]) assert.equal((await f.testing(route, method, method === 'GET' ? undefined : {})).status, 403, route);
    assert.equal((await f.testing('/session/start', 'POST', {}, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await f.state()).learningMode, 'test');
    assert.equal((await (await f.call('/api/state')).json()).learningMode, 'child');
    await f.json('/exit', 'POST'); assert.equal((await f.testing('/session/start', 'POST', {})).status, 403);
    assert.equal(f.app.store.read().sessions.length, 0);
  } finally { await f.close(); }
});

test('test learning, progress, completion rewards and assessment facts stay isolated, including concurrent child sessions', async () => {
  const f = await fixture(); try {
    const child = await (await f.call('/api/session/start', 'POST', { mode: 'practice', wordIds: ['starter-cat'], strategy: 'classic' })).json();
    const formalBefore = f.app.store.read(); await f.enter();
    const s = await f.json<LearningSession>('/session/start', 'POST', { mode: 'practice', wordIds: ['starter-apple', 'starter-banana'], strategy: 'classic' });
    assert.notEqual(s.id, child.id); assert.equal((await f.state()).learningHistory?.length, 0);
    for (let i = 0; i < 100 && currentActivity((await f.state()).activeSession!); i++) await advance(f);
    await f.json('/session', 'PATCH', { sessionId: s.id, complete: true });
    const tested = await f.state(); assert.equal(tested.stickers.length, 1); assert.ok(tested.attempts.length); assert.ok(tested.growth!.practicedWords > 0);
    const parentToken = await f.unlock('/api/test');
    const assessment = await (await f.testing('/assessments', 'POST', { workflow: 'parent', wordIds: ['starter-apple'] }, { Authorization: `Bearer ${parentToken}` })).json();
    assert.ok(assessment.id); assert.equal((await f.state()).assessments!.length, 1);
    let measured: AssessmentSession = assessment;
    while (assessmentCurrent(measured)) {
      const item = assessmentCurrent(measured)!;
      const body = item.dimension === 'look' ? { itemId: item.id, action: 'choose', selectedId: item.word.id } : { itemId: item.id, action: 'judge', judgement: 'correct' };
      const response = await f.testing(`/assessments/${assessment.id}/actions`, 'POST', body, { Authorization: `Bearer ${parentToken}` });
      assert.equal(response.status, 200); measured = await response.json();
    }
    const assessed = await f.state(); assert.ok(assessed.assessmentAttempts!.length); assert.ok(assessed.assessmentProgress!.length); assert.ok(assessed.growth!.verifiedWords);

    assert.deepEqual(f.app.store.read(), formalBefore);
    assert.equal((await f.testing('/session', 'PATCH', { sessionId: child.id, complete: true })).status, 400);
    assert.equal((await f.call('/api/session', 'PATCH', { sessionId: s.id, complete: true })).status, 400);
    await f.json('/exit', 'POST'); const after = await (await f.call('/api/state')).json(); assert.equal(after.activeSession.id, child.id); assert.equal(after.stickers.length, 0); assert.equal(after.assessments.length, 0);
  } finally { await f.close(); }
});

test('test progress persists after exit, refresh and server restart; vocabulary updates synchronize without importing child evidence', async () => {
  const f = await fixture(); try {
    await f.enter(); const session = await f.json<LearningSession>('/session/start', 'POST', { mode: 'practice', wordIds: ['starter-apple', 'starter-banana'], strategy: 'memory-loop' }); await advance(f);
    const before = await f.state(); await f.json('/exit', 'POST'); await f.enter(); assert.deepEqual((await f.state()).activeSession, before.activeSession);
    await f.restart(); assert.equal((await f.testing('/state')).status, 403); await f.enter(); assert.deepEqual((await f.state()).activeSession, before.activeSession);
    f.app.store.updateProfile({ nickname: '新的昵称' }); f.app.store.mutate(d => { d.words.find(w => w.id === 'starter-cat')!.meaning = '猫咪'; });
    const current = await f.state(); assert.equal(current.profile.nickname, '新的昵称'); assert.equal(current.words.find(w => w.id === 'starter-cat')!.meaning, '猫咪'); assert.equal(current.activeSession!.id, session.id);
    assert.equal(f.app.store.read().sessions.length, 0); assert.equal(f.app.store.read().attempts.length, 0);
  } finally { await f.close(); }
});

test('test practice audio is private, persists and can never replay through the child profile or public media', async () => {
  const f = await fixture(); try {
    await f.enter(); await f.json('/session/start', 'POST', { mode: 'practice', wordIds: ['starter-apple', 'starter-banana'], strategy: 'memory-loop' });
    for (let i = 0; i < 100 && currentActivity((await f.state()).activeSession!)!.step !== 'recall'; i++) await advance(f);
    const s = (await f.state()).activeSession!, a = currentActivity(s)!, id = randomUUID(), query = new URLSearchParams({ sessionId: s.id, activityId: a.id });
    const response = await f.testing(`/practice-recordings?${query}&takeId=${id}`, 'POST'); // Empty JSON is never a recording.
    assert.equal(response.status, 400);
    const token = await f.enter();
    const base = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
    const uploaded = await fetch(`${base}/api/test/practice-recordings?${query}&takeId=${id}`, { method: 'POST', headers: { 'X-Playroom-Test': token, 'Content-Type': 'audio/wav' }, body: wav() }); assert.equal(uploaded.status, 200);
    const audio = await f.testing(`/practice-recordings/${id}/audio?${query}`); assert.equal(audio.status, 200); assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wav());
    assert.ok(existsSync(join(f.dir, 'test-mode', 'practice-recordings', id + '.wav'))); assert.ok(!existsSync(join(f.dir, 'practice-recordings', id + '.wav')));
    assert.equal((await f.call(`/api/practice-recordings/${id}/audio?${query}`)).status, 409);
    for (const route of [`/media/test-mode/practice-recordings/${id}.wav`, '/media/test-mode/playroom.sqlite']) assert.equal((await f.call(route)).status, 404);
    assert.equal(f.app.store.read().practiceRecordings?.length ?? 0, 0);
    const backup = await (await f.call('/api/backup')).json(); assert.ok(!JSON.stringify(backup).includes(id));
  } finally { await f.close(); }
});

test('test cloud usage shares the actual budget without changing child evidence, and catalog changes invalidate stale test rounds', async () => {
  const f = await fixture(); const mode = createTestMode(f.app.store, () => true);
  try {
    f.app.store.updateSettings({ monthlyBudgetCny: 1 });
    const context = mode.require(mode.enter().token), before = f.app.store.read();
    const charge = context.store.reserve('tts', .75, 10); context.store.settle(charge, .8, 12);
    assert.throws(() => context.store.reserve('stt', .3, 1), /预算/);
    const after = f.app.store.read(); assert.equal(after.charges.at(-1)!.actual, .8);
    for (const key of ['progress', 'attempts', 'sessions', 'stickers', 'badgeAwards', 'assessments', 'assessmentAttempts', 'assessmentProgress'] as const) assert.deepEqual(after[key], before[key]);
    context.store.startSession(false, {}, { mode: 'practice', wordIds: ['starter-apple'], strategy: 'classic' });
    f.app.store.mutate(d => { const word = d.words.find(w => w.id === 'starter-apple')!; word.meaning = '新的义项'; word.learningVersion = 1; });
    context.store.syncCatalogue(); assert.equal(context.store.state({ speech: offline, codex: offline }).activeSession, null);
    assert.ok(context.store.read().sessions[0].suspendedAt); assert.equal(f.app.store.read().sessions.length, 0);
  } finally { await mode.close(); await f.close(); }
});

test('recorded challenges, background failure, private replay and manual review never enter the child assessment profile', async () => {
  const f = await fixture(); try {
    await f.enter(); const s = await f.json<LearningSession>('/session/start', 'POST', { mode: 'practice', wordIds: ['starter-apple', 'starter-banana'], strategy: 'memory-loop' }); await advance(f); await advance(f);
    const formalBefore = f.app.store.read();
    let challenge = await f.json<AssessmentSession>('/assessments', 'POST', { wordIds: ['starter-apple'] });
    const token = await f.enter(), base = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
    while (assessmentCurrent(challenge)) {
      const item = assessmentCurrent(challenge)!;
      if (item.dimension === 'look') challenge = await f.json(`/assessments/${challenge.id}/responses`, 'POST', { itemId: item.id, expectedVersion: 0, action: 'choose', selectedId: item.word.id });
      else {
        const response = await fetch(`${base}/api/test/assessments/${challenge.id}/recordings?itemId=${item.id}&version=0`, { method: 'POST', headers: { 'X-Playroom-Test': token, 'Content-Type': 'audio/wav' }, body: wav() });
        assert.equal(response.status, 200); challenge = await response.json();
      }
    }
    const oral = challenge.items.find(item => item.response?.recording)!;
    assert.ok(existsSync(join(f.dir, 'test-mode', 'assessment-recordings', oral.response!.recording!.id + '.wav')));
    assert.equal((await f.testing(`/assessments/${challenge.id}/audio?itemId=${oral.id}`)).status, 403);
    const parentToken = await f.unlock('/api/test'), auth = { Authorization: `Bearer ${parentToken}` };
    assert.equal((await f.testing(`/assessments/${challenge.id}/audio?itemId=${oral.id}`, 'GET', undefined, auth)).status, 200);
    assert.equal((await f.call(`/api/assessments/${challenge.id}`)).status, 404);
    await f.json(`/assessments/${challenge.id}/submit`, 'POST');
    for (let i = 0; i < 50; i++) { challenge = (await f.state()).assessments!.find(row => row.id === challenge.id)!; if (challenge.job?.status === 'failed') break; await new Promise<void>(r => setImmediate(r)); }
    assert.equal(challenge.job?.status, 'failed');
    const response = await f.testing(`/assessments/${challenge.id}/review`, 'POST', { items: challenge.items.filter(item => item.dimension !== 'look').map(item => ({ itemId: item.id, responseVersion: item.response!.version, proposalVersion: 0, reviewVersion: 0, result: 'correct' })) }, auth);
    assert.equal(response.status, 200); assert.ok((await f.state()).assessmentProgress!.length);
    assert.equal((await f.state()).activeSession!.id, s.id); assert.deepEqual(f.app.store.read(), formalBefore);
  } finally { await f.close(); }
});

test('test file and streaming speech reuse the actual shared cache without copying assets or reserving cloud charges', async () => {
  let cacheDir = '';
  const f = await fixture({ getCachedSpeech: async input => { cacheDir = input.dataDir!; return join(cacheDir, 'speech', 'shared.mp3'); }, synthesizeSpeech: async () => { throw Error('不应触发合成'); }, streamSpeech: async () => { throw Error('不应触发流合成'); } });
  try {
    mkdirSync(join(f.dir, 'speech'), { recursive: true }); const bytes = Buffer.from('isolated-shared-cache'); writeFileSync(join(f.dir, 'speech', 'shared.mp3'), bytes);
    const before = f.app.store.read(); await f.enter();
    const result = await f.json<{ audioUrl: string; cached: boolean }>('/speech/tts', 'POST', { text: 'apple', locale: 'en-US', cacheOnly: true });
    assert.equal(result.cached, true); assert.equal(result.audioUrl, '/media/speech/shared.mp3'); assert.equal(cacheDir, f.dir);
    assert.deepEqual(Buffer.from(await (await f.call(result.audioUrl)).arrayBuffer()), bytes);
    const stream = await f.testing('/speech/tts/stream', 'POST', { text: 'apple', locale: 'en-US', cacheOnly: true });
    assert.equal(stream.status, 200); assert.equal(stream.headers.get('x-tts-cached'), 'true'); assert.deepEqual(Buffer.from(await stream.arrayBuffer()), bytes);
    assert.equal(existsSync(join(f.dir, 'test-mode', 'speech', 'shared.mp3')), false); assert.deepEqual(f.app.store.read(), before);
  } finally { await f.close(); }
});
