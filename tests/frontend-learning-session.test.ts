import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState, LearningAttempt, LearningSession } from '../shared/contracts';
import { restoreLearningPosition, sessionStepIsLast, sessionTaskProgress } from '../src/learning-session';

const word = { id: 'a', packId: 'p', term: 'apple', meaning: '苹果', imageUrl: '/apple.svg', assetStatus: 'approved' as const, imageSource: 'builtin' as const };
function state(session: Partial<LearningSession> = {}, attempts: LearningAttempt[] = []): AppState {
  return { words: [word, { ...word, id: 'b', term: 'ball' }], packs: [{ id: 'p', title: '词书', enabled: true, createdAt: '' }], attempts, progress: [], stickers: [],
    profile: { nickname: '孩子', interests: [], interestVersion: 0, onboardingCompleted: false },
    settings: { dailyNewWords: 3, dailyReviewWords: 10, spellingEnabled: false, voiceEnabled: true, sessionMinutes: 5, monthlyBudgetCny: 10 },
    integrations: { speech: { configured: false, available: false, status: '', detail: '' }, codex: { configured: false, available: false, status: '', detail: '' } },
    usage: { month: '', estimatedCny: 0, budgetCny: 10, ttsCharacters: 0, sttSeconds: 0, imageJobs: 0 },
    activeSession: { id: 's', wordIds: ['a', 'b'], completedWordIds: [], startedAt: '', rewardGranted: false, ...session },
  };
}
function attempt(overrides: Partial<LearningAttempt> = {}): LearningAttempt { return { id: 'at', sessionId: 's', wordId: 'a', step: 'sound', skill: 'listen', hinted: false, correct: false, source: 'click', createdAt: '2026-10-15T00:00:00Z', ...overrides }; }

test('a review starts directly at its frozen target even if local storage requests learn or settings change', () => {
  const s = state({ tasks: [{ wordId: 'a', mode: 'review', steps: ['sound'] }], completedSteps: {} });
  assert.equal(restoreLearningPosition(s, { wordId: 'a', step: 'learn', hinted: false })?.step, 'sound');
  s.settings.spellingEnabled = true; assert.equal(restoreLearningPosition(s)?.step, 'sound');
});

test('refresh advances only past server-completed steps and does not replay an already seen answer screen', () => {
  const s = state({ tasks: [{ wordId: 'a', mode: 'new', steps: ['learn', 'listen', 'sound', 'recall'] }], completedSteps: { a: ['learn', 'listen'] } });
  assert.equal(restoreLearningPosition(s, { wordId: 'a', step: 'recall' })?.step, 'sound');
});

test('a wrong answer or explicit hint on this exact task survives refresh without contaminating another listen-style task', () => {
  const s = state({ tasks: [{ wordId: 'a', mode: 'review', steps: ['sound'] }], completedSteps: {} }, [attempt(), attempt({ id: 'else', step: 'listen', correct: true })]);
  const restored = restoreLearningPosition(s)!; assert.equal(restored.hinted, true); assert.equal(restored.feedback, 'try');
  assert.equal(restoreLearningPosition(s, { wordId: 'a', step: 'sound', hinted: true })?.hinted, true);
});

test('previous sessions, other words and untagged legacy attempts do not unlock a newly scheduled task', () => {
  const s = state({ tasks: [{ wordId: 'a', mode: 'review', steps: ['sound'] }], completedSteps: {} }, [attempt({ sessionId: 'old', correct: true }), attempt({ wordId: 'b', correct: true }), attempt({ step: undefined, correct: true })]);
  assert.equal(restoreLearningPosition(s)?.feedback, null); assert.equal(restoreLearningPosition(s)?.hinted, false);
});

test('an accepted practice-only attempt restores continuation as practice without inventing independent correctness', () => {
  const s = state({ tasks: [{ wordId: 'a', mode: 'new', steps: ['recall'] }], completedSteps: {} }, [attempt({ step: 'recall', skill: 'recall', correct: false, practiceOnly: true })]);
  assert.deepEqual(restoreLearningPosition(s), { wordId: 'a', step: 'recall', hinted: false, feedback: 'correct', practiceOnly: true });
});

test('legacy sessions keep their saved local position and conservatively retain old untagged hint evidence', () => {
  const s = state({}, [attempt({ step: undefined, hinted: true })]);
  const p = restoreLearningPosition(s, { wordId: 'a', step: 'sound', hinted: false }); assert.equal(p?.step, 'sound'); assert.equal(p?.hinted, true);
  assert.equal(restoreLearningPosition(s, { wordId: 'b', step: 'spell' })?.step, 'learn');
});

test('missing or exhausted frozen tasks never fall back to revealing the learn screen', () => {
  assert.equal(restoreLearningPosition(state({ tasks: [], completedSteps: {} })), null);
  assert.equal(restoreLearningPosition(state({ tasks: [{ wordId: 'a', mode: 'review', steps: ['listen'] }], completedSteps: { a: ['listen'] } })), null);
});

test('task progress counts only frozen planned steps, not unrelated completion labels or later spelling settings', () => {
  const s = state({ tasks: [{ wordId: 'a', mode: 'new', steps: ['learn', 'listen'] }, { wordId: 'b', mode: 'review', steps: ['spell'] }], completedSteps: { a: ['learn', 'spell'], b: ['spell'] } });
  assert.deepEqual(sessionTaskProgress(s.activeSession!), { total: 3, completed: 2 });
  assert.equal(sessionStepIsLast(s.activeSession!, 'a', 'listen', ['learn', 'listen', 'sound']), true);
  assert.equal(sessionTaskProgress(state().activeSession!), null);
});

test('edited meanings cannot inherit prior-version attempts or browser hints; current-version evidence still restores', () => {
  const s = state({ tasks: [{ wordId: 'a', mode: 'review', steps: ['sound'] }], completedSteps: {} }, [attempt({ correct: true, hinted: true })]);
  s.words[0].learningVersion = 1;
  const p = restoreLearningPosition(s, { wordId: 'a', step: 'sound', hinted: true, learningVersion: 0 });
  assert.equal(p?.hinted, false); assert.equal(p?.feedback, null);
  s.attempts.push(attempt({ id: 'new-meaning', learningVersion: 1, correct: false }));
  assert.equal(restoreLearningPosition(s)?.hinted, true); assert.equal(restoreLearningPosition(s)?.feedback, 'try');
});

test('finishing a new word opens the next review target without inserting learn or removing its frozen spelling task', () => {
  const s = state({ tasks: [{ wordId: 'a', mode: 'new', steps: ['learn', 'listen', 'sound', 'recall'] }, { wordId: 'b', mode: 'review', steps: ['spell'] }], completedWordIds: ['a'], completedSteps: { a: ['learn', 'listen', 'sound', 'recall'] } });
  assert.equal(s.settings.spellingEnabled, false);
  assert.deepEqual(restoreLearningPosition(s, { wordId: 'b', step: 'learn' }), { wordId: 'b', step: 'spell', hinted: false, feedback: null, practiceOnly: false });
});
