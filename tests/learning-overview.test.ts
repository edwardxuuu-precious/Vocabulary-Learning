import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.ts';
import { dailyLearningPlan, learningDay, sessionLearningSummary, wordLearningOverview } from '../shared/learning.ts';
import type { IntegrationStatus, LearningAttempt } from '../shared/contracts.ts';

const status: IntegrationStatus = {
  speech: { configured: false, available: false, status: 'unconfigured', detail: '测试无云服务' },
  codex: { configured: false, available: false, status: 'unconfigured', detail: '测试无云服务' },
};
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'word-learning-'));
  let time = new Date('2026-10-15T02:00:00Z');
  const store = new Store(directory, () => time);
  return { store, state: () => store.state(status), now: () => time, advance: () => { time = new Date(time.getTime() + 86_400_000); }, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function completeWord(store:Store,wordId:string) {
  const session=store.startSession(),task=session.tasks!.find(task=>task.wordId===wordId)!;
  for(const step of task.steps){
    if((store.read().sessions.find(s=>s.id===session.id)?.completedSteps?.[wordId]??[]).includes(step))continue;
    if(step!=='learn')store.attempt({wordId,sessionId:session.id,step,skill:step==='sound'?'listen':step,correct:true,hinted:false,practiceOnly:step==='recall',source:'click'});
    store.updateSession({completedStep:{wordId,step}});
  }
}

test('home schedule and actual session agree: overdue words first, approved enabled words only, bounded and deduplicated', () => {
  const f = fixture();
  try {
    f.store.updateSettings({ dailyReviewWords: 2, dailyNewWords: 1 });
    f.store.mutate(data => {
      data.words.find(word => word.term === 'dog')!.assetStatus = 'review';
      data.progress = [
        { wordId: 'starter-apple', skill: 'listen', stage: 1, dueAt: '2026-10-15T01:00:00Z', successes: 1, attempts: 1 },
        { wordId: 'starter-apple', skill: 'recall', stage: 0, dueAt: '2026-10-15T00:00:00Z', successes: 0, attempts: 1 },
        { wordId: 'starter-cat', skill: 'listen', stage: 1, dueAt: '2026-10-14T00:00:00Z', successes: 1, attempts: 1 },
        { wordId: 'starter-dog', skill: 'listen', stage: 1, dueAt: '2026-10-13T00:00:00Z', successes: 1, attempts: 1 },
        { wordId: 'starter-fish', skill: 'spell', stage: 1, dueAt: '2026-10-13T00:00:00Z', successes: 1, attempts: 1 },
      ];
    });
    const plan = dailyLearningPlan(f.state(), f.now());
    assert.deepEqual(plan.review.map(word => word.term), ['cat', 'apple']);
    assert.deepEqual(plan.fresh.map(word => word.term), ['banana']);
    assert.deepEqual(f.store.startSession().wordIds, [...plan.review, ...plan.fresh].map(word => word.id));
    f.store.enablePack('starter', false);
    assert.equal(dailyLearningPlan(f.state(), f.now()).available.length, 0);
  } finally { f.close(); }
});

test('first learning and cross-day resume do not require interests or write an interest confirmation', () => {
  const f = fixture();
  try {
    const first = f.store.startSession();
    assert.equal(first.wordIds.length, 3);
    completeWord(f.store,first.wordIds[0]);
    f.advance();
    assert.equal(f.store.startSession().id, first.id);
    for (const wordId of first.wordIds) completeWord(f.store,wordId);
    f.store.updateSession({ complete: true });
    assert.deepEqual(f.state().profile.interests, []);
    assert.equal(f.state().profile.onboardingCompleted, false);
    assert.equal(f.state().stickers.length, 1);
    assert.equal(f.store.startSession().id,first.id,'a cross-day completion is already today’s completed session');
  } finally { f.close(); }
});

test('parent observations separate hints, practice and independent answers by skill and Shanghai calendar day', () => {
  const f = fixture();
  try {
    const session = f.store.startSession();
    const base = { wordId: session.wordIds[0], sessionId: session.id, skill: 'recall', correct: true, hinted: false, source: 'speech' };
    f.store.attempt({ ...base, hinted: true });
    f.store.attempt({ ...base, practiceOnly: true });
    let row = wordLearningOverview(f.state(), f.now())[0];
    assert.equal(row.recall.independent, 0);
    assert.equal(row.hintedCorrect, 1); assert.equal(row.practiceOnly, 1);
    assert.equal(f.state().progress.find(progress => progress.skill === 'recall')!.stage, 0);
    f.store.attempt(base); f.store.attempt(base);
    row = wordLearningOverview(f.state(), f.now())[0];
    assert.equal(row.recall.independent, 2); assert.equal(row.recall.independentDays, 1);
    assert.equal(row.listen.independent, 0);
    f.advance(); f.store.attempt(base);
    row = wordLearningOverview(f.state(), f.now())[0];
    assert.equal(row.recall.independentDays, 2);
    assert.equal(row.recall.independent, 3);
    assert.equal(learningDay(new Date('2026-10-15T16:00:00Z')), '2026-10-16');
    assert.equal(learningDay(new Date('2026-10-15T15:59:59Z')), '2026-10-15');
  } finally { f.close(); }
});

test('results count words once per skill, exclude hinted and practice-only success and stay within the current session', () => {
  const f = fixture();
  try {
    const session = f.store.startSession();
    const base = { wordId: session.wordIds[0], sessionId: session.id, skill: 'listen', correct: true, hinted: false, source: 'click' };
    f.store.attempt(base); f.store.attempt(base);
    f.store.attempt({ ...base, skill: 'recall', hinted: true, source: 'speech' });
    f.store.attempt({ ...base, skill: 'recall', correct: false, practiceOnly: true });
    f.store.mutate(data => { data.attempts.push({ ...base, id: 'historical-recall', sessionId: 'another-session', skill: 'recall', createdAt: '2026-10-14T00:00:00Z' } as LearningAttempt); });
    assert.deepEqual(sessionLearningSummary(f.state()), { listen: 1, recall: 0, practiced: 1 });
  } finally { f.close(); }
});

test('next-day review and future review are distinct; disabling a pack does not erase its observations', () => {
  const f = fixture();
  try {
    const session = f.store.startSession(), wordId = session.wordIds[0];
    f.store.attempt({ sessionId: session.id, wordId, skill: 'listen', correct: true, hinted: false, source: 'click' });
    assert.equal(wordLearningOverview(f.state(), f.now())[0].due, false);
    f.advance();
    assert.equal(wordLearningOverview(f.state(), f.now())[0].due, true);
    f.store.enablePack('starter', false);
    const row = wordLearningOverview(f.state(), f.now())[0];
    assert.equal(row.due, false); assert.equal(row.listen.independent, 1);
  } finally { f.close(); }
});
