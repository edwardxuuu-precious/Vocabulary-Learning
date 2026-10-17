import { finishGoalFixture } from './helpers/goal-steps.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import { createApp } from '../server/index.ts';
import { activityDone, buildActivities, currentActivity } from '../shared/game-plan.ts';
import { dailyLearningPlan, wordLearningOverview } from '../shared/learning.ts';
import { restoreLearningPosition } from '../src/learning-session.ts';
import type { ActivityAction, IntegrationStatus, LearningActivity, LearningSession } from '../shared/contracts.ts';
import { SpeechPlaybackController } from '../src/speech-controller.ts';
import { gameDefinition } from '../shared/game-registry.ts';

const statuses: IntegrationStatus = { speech: { configured: false, available: false, status: 'test', detail: '无云服务' }, codex: { configured: false, available: false, status: 'test', detail: '无云服务' } };
function prepare(store: Store) {
  const pack = store.createPack('游戏验收词表', ['apple','banana','cat'].map((term, i) => ({ term, meaning: ['苹果','香蕉','猫'][i], partOfSpeech: 'noun' })));
  store.enablePack(pack.id, true);
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'word-games-')); let time = new Date('2026-10-17T02:00:00Z');
  let store = new Store(dir, () => time); prepare(store);
  return { get store() { return store; }, restart() { store.close(); store = new Store(dir, () => time); }, tomorrow() { time = new Date(time.getTime() + 86_400_000); }, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const session = (store: Store) => store.read().sessions.at(-1)!;
const event = (store: Store, activity: LearningActivity, action: ActivityAction, selectedId?: string) => store.activityEvent({ sessionId: session(store).id, activityId: activity.id, action, ...(selectedId ? { selectedId } : {}) });
function advanceStandard(store: Store) {
  const active = session(store), activity = currentActivity(active)!;
  if(finishGoalFixture(store,active,activity))return;
  assert.equal(activity.kind, 'standard');
  if (activity.step !== 'learn') store.attempt({ sessionId: active.id, wordId: activity.wordId, step: activity.step, skill: activity.step === 'sound' ? 'listen' : activity.step, correct: true, hinted: false, practiceOnly: activity.step === 'recall', source: 'click' });
  store.updateSession({ completedStep: { wordId: activity.wordId, step: activity.step } });
}
function finishGame(store: Store, activity: LearningActivity) {
  if(finishGoalFixture(store,session(store),activity))return;
  if (activity.kind === 'portal') { event(store, activity, 'reveal'); event(store, activity, 'skip'); }
  else { event(store, activity, 'listen'); event(store, activity, 'choose', activity.wordId); }
  event(store, activity, 'next');
}
function finishAll(store: Store) {
  for (let i = 0; i < 100 && currentActivity(session(store)); i++) { const activity = currentActivity(session(store))!; if (activity.kind === 'standard') advanceStandard(store); else finishGame(store, activity); }
  assert.equal(currentActivity(session(store)), undefined); store.updateSession({ complete: true });
}

test('games replace existing steps within the daily budget and expose all learned pictures before mixed play', () => {
  const f = fixture(); try {
    const plan = dailyLearningPlan(f.store.read()); const activities = buildActivities(plan.tasks, plan.available, () => .3);
    assert.equal(activities.length, plan.taskCount); assert.ok(activities.length <= plan.taskLimit);
    assert.deepEqual(activities.map(a => a.kind), ['standard','standard','standard','supply','supply','supply','supply','supply','supply','flip','flip','flip','portal','portal','portal','portal','portal','portal']);
    assert.equal(new Set(activities.map(a => a.id)).size, activities.length);
    const firstPortal = activities.findIndex(a => a.kind === 'portal'); assert.ok(firstPortal - activities.findIndex(a => a.wordId === activities[firstPortal].wordId && a.step === 'learn') >= 3);
    f.store.updateSettings({ sessionMinutes: 3 }); const short = dailyLearningPlan(f.store.read()); assert.equal(short.taskCount, 6); assert.ok(buildActivities(short.tasks, short.available).every(a => a.kind === 'standard'));
  } finally { f.close(); }
});
test('ambiguous or one-word batches never pad games with unrelated or sample words; verbs retain listening', () => {
  const f = fixture(); try {
    const plan = dailyLearningPlan(f.store.read()), words = structuredClone(plan.available);
    words[1].meaning = words[0].meaning; assert.ok(buildActivities(plan.tasks, words).every(a => a.kind === 'standard'));
    const verbs = structuredClone(plan.available); verbs.forEach(word => word.partOfSpeech = 'verb'); const activities = buildActivities(plan.tasks, verbs);
    assert.equal(activities.filter(a => a.kind === 'supply').length, 0); assert.equal(activities.filter(a => a.kind === 'flip').length, 3);
    assert.ok(activities.flatMap(a => a.choices).every(choice => plan.tasks.some(task => task.wordId === choice.id)));
  } finally { f.close(); }
});
test('game order, server-graded answers and a frozen cross-word position survive settings, restart and backup', () => {
  const f = fixture(); try {
    const first = f.store.startSession(true); advanceStandard(f.store);
    assert.equal(restoreLearningPosition(f.store.state(statuses))?.wordId, first.wordIds[1]);
    assert.throws(() => event(f.store, first.activities!.find(a => a.kind === 'flip')!, 'listen'), /当前/);
    advanceStandard(f.store); advanceStandard(f.store); while(['recognize','read'].includes(currentActivity(session(f.store))!.step))advanceStandard(f.store); const supply = currentActivity(session(f.store))!;
    assert.equal(supply.kind, 'supply'); assert.throws(() => event(f.store, supply, 'choose', supply.wordId), /先点/);
    assert.throws(() => f.store.updateSession({ completedStep: { wordId: supply.wordId, step: supply.step } }), /游戏/);
    assert.throws(() => f.store.attempt({ sessionId: first.id, wordId: supply.wordId, step: supply.step, skill: 'listen', correct: true, hinted: false, source: 'click' }), /游戏/);
    event(f.store, supply, 'listen'); const wrong = supply.choices.find(choice => choice.id !== supply.wordId)!.id; event(f.store, supply, 'choose', wrong);
    f.store.updateSettings({ dailyNewWords: 1 }); f.restart();
    assert.equal(currentActivity(f.store.startSession(true))!.id, supply.id); assert.equal(session(f.store).activityStates![supply.id].hinted, true);
    assert.deepEqual(session(f.store).activities, first.activities);
    const backup = f.store.exportBackup(); f.store.restoreBackup(backup); assert.deepEqual(session(f.store).activityStates, backup.data.sessions[0].activityStates);
    event(f.store, supply, 'choose', supply.wordId); const correct = f.store.read().attempts.at(-1)!; assert.equal(correct.hinted, true); assert.equal(correct.correct, true); assert.equal(correct.practiceOnly, false);
    const count = f.store.read().attempts.length; event(f.store, supply, 'choose', supply.wordId); event(f.store, supply, 'next'); event(f.store, supply, 'next'); assert.equal(f.store.read().attempts.length, count);
  } finally { f.close(); }
});
test('every flip pair including the final remaining picture and every portal are participation only; rewards are idempotent', () => {
  const f = fixture(); try {
    f.store.startSession(true); finishAll(f.store);
    const data = f.store.read(), gameAttempts = data.attempts.filter(a => a.activityId);
    assert.equal(gameAttempts.filter(a => a.step === 'sound').length, 3); assert.ok(gameAttempts.filter(a => a.step === 'sound' || a.step === 'recall').every(a => a.practiceOnly));
    assert.equal(data.progress.filter(p => p.skill === 'recall').length, 0);
    assert.ok(data.progress.every(p => p.stage === 1));
    assert.equal(wordLearningOverview(f.store.state(statuses)).filter(row => row.available).reduce((sum, row) => sum + row.listen.independent, 0), 3);
    f.store.updateSession({ complete: true }); assert.equal(f.store.read().stickers.length, 1); assert.equal(f.store.state(statuses).activeSession, null); assert.equal(f.store.state(statuses).lastCompletedSession!.id, session(f.store).id);
    const backup = f.store.exportBackup(); assert.equal(validateBackup(backup).data.sessions[0].activities!.length, 18);
    f.tomorrow(); const next = f.store.startSession(true); assert.ok(next.tasks!.every(task => task.mode === 'review')); assert.ok(next.activities!.filter(a=>a.step==='sound').every(a => a.kind === 'standard')); assert.ok(next.activities!.every(a => ['sound','recognize','read'].includes(a.step)));
  } finally { f.close(); }
});
test('audio failure and skip cannot penalize progress or become independent evidence, and portal reveal persists', () => {
  const f = fixture(); try {
    f.store.startSession(true); while (currentActivity(session(f.store))!.kind === 'standard'||['recognize','read'].includes(currentActivity(session(f.store))!.step)) advanceStandard(f.store);
    const supply = currentActivity(session(f.store))!; event(f.store, supply, 'listen'); event(f.store, supply, 'audio-failed'); event(f.store, supply, 'choose', supply.wordId);
    assert.equal(f.store.read().attempts.at(-1)!.practiceOnly, true); assert.equal(f.store.read().progress.filter(p=>p.skill!=='recognize').length, 0); event(f.store, supply, 'next');
    while (currentActivity(session(f.store))!.kind !== 'portal'||currentActivity(session(f.store))!.step!=='recall') finishGame(f.store, currentActivity(session(f.store))!);
    const portal = currentActivity(session(f.store))!; event(f.store, portal, 'reveal'); f.restart();
    assert.equal(session(f.store).activityStates![portal.id].revealed, true); assert.throws(() => event(f.store, portal, 'next'), /完成/);
    event(f.store, portal, 'skip'); event(f.store, portal, 'next'); assert.equal(f.store.read().attempts.at(-1)!.skill, 'recall'); assert.equal(f.store.read().attempts.at(-1)!.correct, false);
  } finally { f.close(); }
});
test('editing or disabling a participating word removes stale tasks and safely falls back without resetting hints', () => {
  const f = fixture(); try {
    const first = f.store.startSession(true); const firstWord = first.wordIds[0]; advanceStandard(f.store);
    f.store.updateWord(firstWord, { meaning: '苹果果实' }, () => true);
    const active = f.store.startSession(true); assert.ok(!active.wordIds.includes(firstWord)); assert.ok(active.activities!.every(a => a.wordId !== firstWord && a.choices.every(choice => choice.id !== firstWord)));
    assert.ok(active.activities!.filter(a => a.step === 'listen' || a.step === 'sound').every(a => a.kind === 'standard'));
    assert.doesNotThrow(() => validateBackup(f.store.exportBackup()));
    const pack = f.store.read().packs.find(p => p.title === '游戏验收词表')!; f.store.enablePack(pack.id, false); assert.equal(f.store.read().stickers.length, 0);
  } finally { f.close(); }
});
test('backup rejects forged game order, option snapshots, states and completed practice evidence', () => {
  const f = fixture(); try {
    f.store.startSession(true); finishAll(f.store); const backup = f.store.exportBackup();
    const corruptions: ((copy: any) => void)[] = [
      copy => copy.data.sessions[0].activities.pop(),
      copy => copy.data.sessions[0].activities[3].choices[0].imageUrl = 'https://example.com/image.png',
      copy => copy.data.sessions[0].activityStates[copy.data.sessions[0].activities[3].id].selectedId = 'foreign',
      copy => copy.data.attempts = copy.data.attempts.filter((a: any) => a.step !== 'sound'),
      copy => copy.data.sessions[0].activities[3].kind = 'portal',
    ];
    for (const corrupt of corruptions) { const copy = structuredClone(backup); corrupt(copy); assert.throws(() => validateBackup(copy), /备份/); }
  } finally { f.close(); }
});
test('existing in-progress planned and legacy sessions retain their old order when game-enabled API resumes', () => {
  const f = fixture(); try {
    const old = f.store.startSession(); f.store.mutate(d=>{const s=d.sessions[0];delete s.goalVersion;delete s.activities;delete s.activityStates;delete s.gameSeed;}); assert.equal(f.store.startSession(true).activities, undefined);
    assert.deepEqual(f.store.startSession(true).tasks, old.tasks);
    f.store.mutate(data => { const item = data.sessions[0]; delete item.goalVersion; delete item.activities; delete item.activityStates; delete item.gameSeed; delete item.tasks; delete item.completedSteps; delete item.taskLimit; delete item.estimatedMinutes; });
    assert.equal(f.store.startSession(true).activities, undefined); assert.equal(f.store.startSession(true).tasks, undefined);
  } finally { f.close(); }
});
test('HTTP start enables games, ignores forged correctness, and cache-only misses never synthesize or reserve budget', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'word-game-api-')); let synthesis = 0;
  const app = createApp({ dataDir: dir, chatEnabled: false, integrations: { probeIntegrations: async () => statuses, getCachedSpeech: async () => undefined, synthesizeSpeech: async () => { synthesis++; throw Error('unexpected synthesis'); }, streamSpeech: async () => { synthesis++; throw Error('unexpected stream'); } }, dialogue: { status: async () => statuses.codex, turn: async () => { throw Error('unused'); }, cancel() {}, reset: async () => {}, close: async () => {} } });
  prepare(app.store); await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const call = (url: string, body: unknown) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const started = await (await call('/api/session/start', {})).json() as LearningSession; assert.ok(started.gameSeed); assert.ok(started.activities!.every(a => a.kind === 'standard' || gameDefinition(a.kind))); assert.equal(started.activities!.length,18);
    for (const route of ['/api/speech/tts','/api/speech/tts/stream']) { const response = await call(route, { text: 'apple', locale: 'en-US', tone: 'clear', cacheOnly: true }); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'AUDIO_CACHE_MISSING'); }
    while (currentActivity(session(app.store))!.kind === 'standard'||['recognize','read'].includes(currentActivity(session(app.store))!.step)) advanceStandard(app.store);
    const game = currentActivity(session(app.store))!;
    const response = await call('/api/session/activity', { sessionId: started.id, activityId: game.id, action: 'choose', selectedId: game.wordId, correct: true }); assert.equal(response.status, 400);
    assert.equal(synthesis, 0); assert.equal(app.store.read().charges.length, 0);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('cache-only game playback returns a real failure without quietly substituting a browser voice', async () => {
  let localCalls = 0; const updates: Record<string, unknown>[] = [];
  const controller = new SpeechPlaybackController({ isEnabled: () => true, beforeSpeak() {}, requestAudio: async () => { throw Error('cache miss'); }, playAudio: async () => false, playLocal: async () => { localCalls++; return true; }, update: patch => updates.push(patch) });
  assert.equal(await controller.speak({ text: 'apple', locale: 'en-US', cacheOnly: true }), false);
  assert.equal(localCalls, 0); assert.ok(updates.some(patch => String(patch.message).includes('缓存')));
});
test('review listening can use supply while due picture-to-sound assessments retain independent evidence', () => {
  const f = fixture(); try {
    const plan = dailyLearningPlan(f.store.read());
    const review = plan.tasks.map(task => ({ ...task, mode: 'review' as const, steps: ['listen','sound'] as const })).map(task => ({ ...task, steps: [...task.steps] }));
    const activities = buildActivities(review, plan.available);
    assert.equal(activities.filter(a => a.kind === 'supply').length, 3);
    assert.ok(activities.filter(a => a.step === 'sound').every(a => a.kind === 'standard'));
    assert.equal(activities.length, 6); assert.equal(activities.filter(a => a.kind === 'portal').length, 0);
  } finally { f.close(); }
});
