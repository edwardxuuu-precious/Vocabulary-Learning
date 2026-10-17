import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyLearningPlan, newWordSteps, wordLearningOverview } from '../shared/learning.ts';
import type { AppState, LearningAttempt, Skill, Word } from '../shared/contracts.ts';

const now = new Date('2026-10-15T02:00:00Z');
function fixture(count = 24): AppState {
  const unavailable = { configured: false, available: false, status: 'unconfigured', detail: 'no service' };
  return {
    words: Array.from({ length: count }, (_, index) => ({ id: `w${index}`, packId: 'pack', term: `word${String.fromCharCode(97 + index % 26)}`, meaning: `词${index}`, imageUrl: '/assets/words/apple.svg', imageSource: 'builtin', assetStatus: 'approved' })),
    packs: [{ id: 'pack', title: '指定词表', createdAt: now.toISOString(), enabled: true }],
    settings: { dailyNewWords: 3, dailyReviewWords: 6, sessionMinutes: 10, voiceEnabled: true, spellingEnabled: false, monthlyBudgetCny: 30 },
    profile: { nickname: '孩子', interests: [], interestVersion: 1, onboardingCompleted: false },
    progress: [], attempts: [], activeSession: null, stickers: [],
    usage: { month: '2026-10', estimatedCny: 0, budgetCny: 30, ttsCharacters: 0, sttSeconds: 0, imageJobs: 0 },
    integrations: { speech: unavailable, codex: unavailable },
  };
}
function due(state: AppState, index: number, skill: Skill = 'listen', attempts = 2, time = '2026-10-14T02:00:00Z') {
  state.progress.push({ wordId: `w${index}`, skill, stage: 1, dueAt: time, successes: 1, attempts });
}
function practice(wordId: string, skill: Skill, createdAt: string): LearningAttempt {
  return { id: `practice-${wordId}`, sessionId: 'historical', wordId, skill, source: 'click', correct: false, hinted: true, practiceOnly: true, createdAt };
}

test('fresh words retain the full lesson and fit the task estimate, including optional spelling', () => {
  const state = fixture();
  const plan = dailyLearningPlan(state, now);
  assert.equal(plan.fresh.length, 3); assert.equal(plan.taskLimit, 13); assert.equal(plan.taskCount, 12);
  assert.equal(plan.reductionReason, null);
  assert.ok(plan.tasks.every(task => task.mode === 'new' && task.steps.join(',') === 'learn,listen,sound,recall'));
  state.settings.spellingEnabled = true;
  const spelling = dailyLearningPlan(state, now);
  assert.equal(spelling.fresh.length, 2); assert.equal(spelling.taskCount, 10); assert.equal(spelling.reductionReason, 'task-budget');
  assert.deepEqual(newWordSteps({ term: 'ice cream' }, true), ['learn', 'listen', 'sound', 'recall']);
});

test('old words start directly at due skills and listening questions vary without exposing a learn page', () => {
  const state = fixture(); due(state, 0, 'listen', 2); due(state, 1, 'listen', 3);
  const plan = dailyLearningPlan(state, now);
  assert.deepEqual([...plan.tasks.slice(0, 2)].sort((a,b)=>a.wordId.localeCompare(b.wordId)).map(task => [task.mode, task.steps]), [['review', ['listen']], ['review', ['sound']]]);
  assert.equal(plan.fresh.length, 2); assert.equal(plan.taskCount, 10);
  assert.ok(plan.taskCount <= plan.taskLimit);
});

test('new words decrease with backlog and pause when due words reach twice the review cap', () => {
  const counts: number[] = [];
  for (const backlog of [6, 7, 9, 12]) {
    const state = fixture(); state.settings.sessionMinutes = 30;
    for (let index = 0; index < backlog; index++) due(state, index);
    const plan = dailyLearningPlan(state, now);
    counts.push(plan.fresh.length);
    assert.equal(plan.review.length, 6); assert.equal(plan.deferredReviewCount, backlog - 6);
    if (backlog > 6) assert.equal(plan.reductionReason, 'backlog');
  }
  assert.deepEqual(counts, [3, 2, 1, 0]);
});

test('short daily budgets prioritize review and never cut a new lesson into unfinished fragments', () => {
  const state = fixture(); state.settings.sessionMinutes = 3;
  assert.equal(dailyLearningPlan(state, now).fresh.length, 1);
  due(state, 0);
  const plan = dailyLearningPlan(state, now);
  assert.equal(plan.taskLimit, 4); assert.equal(plan.review.length, 1); assert.equal(plan.fresh.length, 0);
  assert.equal(plan.taskCount, 1); assert.equal(plan.reductionReason, 'task-budget');
});

test('review is ordered by active due skill, excludes disabled assets and never duplicates a word', () => {
  const state = fixture(); state.settings.spellingEnabled = true; state.settings.dailyReviewWords = 3;
  due(state, 0, 'listen', 2, '2026-10-13T00:00:00Z'); due(state, 0, 'spell', 2, '2026-10-12T00:00:00Z');
  due(state, 1, 'listen', 2, '2026-10-11T00:00:00Z'); due(state, 2, 'listen', 2, '2026-10-10T00:00:00Z');
  state.words[2].assetStatus = 'review';
  const plan = dailyLearningPlan(state, now);
  assert.deepEqual(plan.review.map(word => word.id), ['w1', 'w0']);
  assert.deepEqual(plan.tasks[1].steps, ['listen', 'spell']);
  assert.equal(new Set(plan.tasks.map(task => task.wordId)).size, plan.tasks.length);
  state.packs[0].enabled = false;
  assert.equal(dailyLearningPlan(state, now).taskCount, 0);
});

test('unassessed oral history cannot drag a future listening review back into today', () => {
  const state = fixture();
  due(state, 0, 'listen', 4, '2026-10-30T02:00:00Z');
  state.progress.push({ wordId: 'w0', skill: 'recall', stage: 0, dueAt: '2026-10-01T00:00:00Z', successes: 0, attempts: 12 });
  state.attempts.push(practice('w0', 'recall', '2026-10-14T00:00:00Z'));
  assert.ok(!dailyLearningPlan(state, now).due.some(word => word.id === 'w0'));
  const row = wordLearningOverview(state, now)[0];
  assert.equal(row.due, false); assert.equal(row.nextDue, Date.parse('2026-10-30T02:00:00Z'));
  assert.equal(row.recall.independent, 0); assert.equal(row.practiceOnly, 1);
});

test('only-practised words get a later short listening check without inventing progress or becoming fresh again', () => {
  const state = fixture(); state.attempts.push(practice('w0', 'recall', '2026-10-14T02:00:00Z'));
  const original = structuredClone(state);
  const plan = dailyLearningPlan(state, now);
  assert.equal(plan.tasks[0].wordId, 'w0'); assert.equal(plan.tasks[0].mode, 'review');
  assert.deepEqual(plan.tasks[0].steps, ['listen']); assert.ok(!plan.fresh.some(word => word.id === 'w0'));
  assert.deepEqual(state, original);
  assert.equal(wordLearningOverview(state, now)[0].recall.independent, 0);
  state.attempts[0].createdAt = now.toISOString();
  assert.ok(!dailyLearningPlan(state, now).due.some(word => word.id === 'w0'));
});

test('parent disabling reviews explicitly retains the configured new-word allowance', () => {
  const state = fixture(); state.settings.dailyReviewWords = 0;
  for (let index = 0; index < 12; index++) due(state, index);
  const plan = dailyLearningPlan(state, now);
  assert.equal(plan.review.length, 0); assert.equal(plan.fresh.length, 3); assert.equal(plan.deferredReviewCount, 12);
});

test('a thousand-word list stays bounded and keeps one task per selected old skill', () => {
  const state = fixture(1000); for (let index = 0; index < 500; index++) due(state, index);
  const plan = dailyLearningPlan(state, now);
  assert.equal(plan.due.length, 500); assert.equal(plan.review.length, 6); assert.equal(plan.fresh.length, 0);
  assert.equal(plan.taskCount, 6); assert.equal(plan.deferredReviewCount, 494);
  assert.ok(plan.tasks.every(task => task.mode === 'review' && task.steps.length === 1));
});

test('editing a meaning makes it fresh while preserving old records; same-millisecond new-version practice still counts', () => {
  const state = fixture();
  state.words[0].learningResetAt = now.toISOString(); state.words[0].learningVersion = 1;
  state.attempts.push(practice('w0', 'recall', now.toISOString()));
  let plan = dailyLearningPlan(state, now);
  assert.equal(plan.fresh[0].id, 'w0');
  assert.equal(wordLearningOverview(state, now)[0].historicalTotal, 1);
  assert.equal(wordLearningOverview(state, now)[0].practiceOnly, 0);
  state.attempts.push({ ...practice('w0', 'recall', now.toISOString()), id: 'new-version', learningVersion: 1 });
  plan = dailyLearningPlan(state, now);
  assert.ok(!plan.fresh.some(word => word.id === 'w0'));
  assert.equal(wordLearningOverview(state, now)[0].practiceOnly, 1);
  assert.equal(state.attempts.length, 2);
});
