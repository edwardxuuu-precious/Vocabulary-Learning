import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store, validateBackup } from '../server/store.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { pairedGame } from '../shared/game-boards.ts';
import { pendingLearningCheckpoint } from '../shared/learning-policy.ts';
import { continueLearningTask } from '../src/learning-continuation.ts';
import { sessionTaskProgress, restoreLearningPosition } from '../src/learning-session.ts';
import { LearningTopbar } from '../src/learning-topbar.tsx';

const offline = { configured: false, available: false, status: 'fixture', detail: '隔离工程示例' };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'continuous-learning-'));
  const now = () => new Date('2026-11-17T04:00:00Z');
  let store = new Store(dir, now);
  store.mutate(data => {
    data.packs = [{ id: 'family', title: '隔离词书', enabled: true, createdAt: now().toISOString() }];
    data.words = data.words.slice(0, 10).map(word => ({ ...word, packId: 'family' }));
  });
  const ids = store.read().words.map(word => word.id);
  store.startSession('random', {}, { entry: 'learn', mode: 'relearn', wordIds: ids, strategy: 'memory-loop' });
  return {
    get store() { return store; },
    state() { return store.state({ speech: offline, codex: offline }); },
    restart() { store.close(); store = new Store(dir, now); },
    close() { store.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
function advance(store: Store) {
  const session = store.read().sessions.at(-1)!, activity = currentActivity(session)!;
  const target = { sessionId: session.id, planVersion: session.learningPolicy!.version };
  if (activity.step === 'learn') store.updateSession({ ...target, completedStep: { wordId: activity.wordId, step: activity.step } });
  else if (activity.kind !== 'standard' || ['read', 'recognize'].includes(activity.step)) {
    store.activityEvent({ ...target, activityId: activity.id, action: 'skip' });
    store.activityEvent({ ...target, activityId: activity.id, action: 'next' });
  } else {
    store.attempt({ ...target, id: `skip-${activity.id}`, wordId: activity.wordId, step: activity.step, skill: activity.step === 'sound' ? 'listen' : activity.step, correct: false, hinted: false, practiceOnly: true, responseStatus: 'skipped', source: 'click' });
    store.updateSession({ ...target, completedStep: { wordId: activity.wordId, step: activity.step } });
  }
}

test('a ten-word task crosses every group automatically with stable total progress and only one final reward', async () => {
  const f = fixture();
  try {
    const original = f.state().activeSession!, plan = structuredClone(original.activities), total = sessionTaskProgress(original)!.total;
    assert.equal(original.wordIds.length, 10);
    assert.equal(total, 60);
    let boundaries = 0;
    for (let completed = 0; completed < total;) {
      const activity = currentActivity(f.store.read().sessions.at(-1)!)!;
      const completedTogether = pairedGame(activity.kind) ? 2 : 1;
      advance(f.store);
      completed += completedTogether;
      const snapshot = f.state(), before = f.store.read();
      if (pendingLearningCheckpoint(snapshot.activeSession!)) {
        const next = await continueLearningTask(snapshot, async request => { boundaries++; f.store.updateSession(request); return f.state(); });
        assert.equal(pendingLearningCheckpoint(next.activeSession!), undefined);
        for (const key of ['attempts', 'progress', 'assessmentAttempts', 'practiceRecordings', 'stickers'] as const) assert.deepEqual(f.store.read()[key], before[key]);
        assert.deepEqual(next.activeSession!.completedSteps, snapshot.activeSession!.completedSteps);
      }
      const current = f.state().activeSession!;
      assert.deepEqual(current.activities, plan);
      assert.deepEqual(current.wordIds, original.wordIds);
      assert.deepEqual(sessionTaskProgress(current), { total, completed });
      assert.equal(current.completedAt, undefined);
      assert.equal(current.rewardGranted, false);
      assert.ok(validateBackup(f.store.exportBackup()));
    }
    assert.ok(boundaries > 1);
    f.store.updateSession({ sessionId: original.id, planVersion: 3, complete: true });
    f.store.updateSession({ sessionId: original.id, planVersion: 3, complete: true });
    assert.equal(f.store.read().stickers.length, 1);
  } finally { f.close(); }
});

test('a failed boundary request remains retryable; save, restart and resume keep the same next task and original facts', async () => {
  const f = fixture();
  try {
    while (!pendingLearningCheckpoint(f.state().activeSession!)) advance(f.store);
    const snapshot = f.state(), session = snapshot.activeSession!, activity = currentActivity(session)!;
    await assert.rejects(continueLearningTask(snapshot, async () => { throw new Error('fixture network failure'); }), /network failure/);
    assert.deepEqual(f.state().activeSession, session);
    f.store.saveLearningPosition({ sessionId: session.id, planVersion: 3, activityId: activity.id, reason: 'rest' });
    f.restart();
    const saved = f.state(), position = restoreLearningPosition(saved);
    const next = await continueLearningTask(saved, async request => { f.store.updateSession(request); return f.state(); });
    assert.deepEqual(restoreLearningPosition(next), position);
    assert.deepEqual(next.activeSession!.activities, session.activities);
    assert.deepEqual(next.activeSession!.completedSteps, session.completedSteps);
    assert.equal(next.activeSession!.pauseState!.reason, 'rest');
    assert.equal(next.activeSession!.completedAt, undefined);
    assert.equal(f.store.read().stickers.length, 0);
    assert.ok(validateBackup(f.store.exportBackup()));
  } finally { f.close(); }
});

test('viewing a task does not acknowledge a boundary; cancelled, rejected and stale acknowledgements cannot spin or advance it', async () => {
  const f = fixture();
  try {
    while (!pendingLearningCheckpoint(f.state().activeSession!)) advance(f.store);
    const snapshot = f.state();
    let calls = 0;
    await continueLearningTask(snapshot, async () => { calls++; return snapshot; }, () => false);
    assert.equal(calls, 0);
    await assert.rejects(continueLearningTask(snapshot, async () => { calls++; return snapshot; }), /重试/);
    assert.equal(calls, 1);
    const html = renderToStaticMarkup(createElement(LearningTopbar, { session: snapshot.activeSession!, onHome() {}, onPause() {} }));
    assert.match(html, /本次 10 词/);
    assert.match(html, /aria-label="整份任务进度"/);
    assert.match(html, /aria-valuemax="60" aria-valuenow="8"/);
    assert.match(html, /aria-label="保存休息"/);
    assert.doesNotMatch(html, /本小段|这一小段完成/);
  } finally { f.close(); }
});

test('overall progress resolves covered targets once without writing them as newly completed steps', () => {
  const f = fixture();
  try {
    const session = f.state().activeSession!, first = session.activities![0], second = session.activities![1];
    session.completedSteps = { [first.wordId]: [first.step] };
    session.studyPlan = { version: 1, purpose: 'learn', goalIds: [], covered: [first, second].map(activity => ({ activityId: activity.id, at: '2026-11-17T04:00:00Z', evidenceIds: ['prior-evidence'] })) };
    const completed = structuredClone(session.completedSteps);
    assert.deepEqual(sessionTaskProgress(session), { total: 60, completed: 2 });
    assert.deepEqual(session.completedSteps, completed);
    assert.deepEqual(session.completedWordIds, []);
    assert.equal(session.completedAt, undefined);
  } finally { f.close(); }
});
