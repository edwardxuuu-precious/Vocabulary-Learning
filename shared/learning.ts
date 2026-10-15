import type { AppState, LearningAttempt, LearningStep, LearningTask, Skill, Word } from './contracts.ts';
import { SPEECH_INPUT_ENABLED } from './features.ts';

export const learningDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

type LearningData = Pick<AppState, 'words' | 'packs' | 'progress' | 'settings'> & Partial<Pick<AppState, 'attempts'>>;
const DAY = 86_400_000;
// A planning estimate, not a countdown or a promise about an individual child.
export const SECONDS_PER_LEARNING_TASK = 45;

export function newWordSteps(word: Pick<Word, 'term'>, spellingEnabled: boolean): LearningStep[] {
  return ['learn', 'listen', 'sound', 'recall', ...(spellingEnabled && /^[a-z]+$/i.test(word.term) ? ['spell' as const] : [])];
}

function currentAttempt(word: Word | undefined, attempt: LearningAttempt) {
  if (word?.learningVersion !== undefined) return (attempt.learningVersion ?? 0) === word.learningVersion;
  return !(Date.parse(attempt.createdAt) <= Date.parse(word?.learningResetAt ?? ''));
}

function reviewSchedule(data: LearningData) {
  const assessed = new Set<string>(), lastAttempt = new Map<string, number>();
  const words = new Map(data.words.map(word => [word.id, word]));
  for (const attempt of data.attempts ?? []) {
    if (!currentAttempt(words.get(attempt.wordId), attempt)) continue;
    if (!attempt.practiceOnly) assessed.add(`${attempt.wordId}:${attempt.skill}`);
    const time = Date.parse(attempt.createdAt);
    if (Number.isFinite(time)) lastAttempt.set(attempt.wordId, Math.max(lastAttempt.get(attempt.wordId) ?? -Infinity, time));
  }
  const schedule = new Map<string, Map<Skill, { dueAt: number; step: LearningStep }>>();
  const terms = new Map(data.words.map(word => [word.id, word.term]));
  for (const progress of data.progress) {
    if (progress.skill === 'recall' && !SPEECH_INPUT_ENABLED) continue;
    if (progress.skill === 'spell' && (!data.settings.spellingEnabled || !/^[a-z]+$/i.test(terms.get(progress.wordId) ?? ''))) continue;
    // Old practice-only progress rows are preserved as history, but never treated as assessment.
    if (data.attempts && !assessed.has(`${progress.wordId}:${progress.skill}`) && !progress.successes) continue;
    const dueAt = Date.parse(progress.dueAt);
    if (!Number.isFinite(dueAt)) continue;
    const row = schedule.get(progress.wordId) ?? new Map();
    row.set(progress.skill, { dueAt, step: progress.skill === 'listen' ? progress.attempts % 2 ? 'sound' : 'listen' : progress.skill });
    schedule.set(progress.wordId, row);
  }
  // A word that has only been practised can receive a short listening check on a later day.
  // It gains no mastery stage, and an unassessed oral exercise cannot keep dragging the whole word back.
  for (const [wordId, time] of lastAttempt) {
    const row = schedule.get(wordId) ?? new Map();
    if (!row.has('listen')) row.set('listen', { dueAt: time + DAY, step: 'listen' });
    schedule.set(wordId, row);
  }
  return schedule;
}

/** Shared by the home preview and server: only enabled, approved words can be scheduled. */
export function dailyLearningPlan(data: LearningData, now = new Date()) {
  const enabled = new Set(data.packs.filter(pack => pack.enabled).map(pack => pack.id));
  const available = data.words.filter(word => enabled.has(word.packId) && word.assetStatus === 'approved');
  const learned = new Set(data.progress.map(progress => progress.wordId));
  const words = new Map(data.words.map(word => [word.id, word]));
  for (const attempt of data.attempts ?? []) if (currentAttempt(words.get(attempt.wordId), attempt)) learned.add(attempt.wordId);
  const schedule = reviewSchedule(data);
  const dueTimes = new Map<string, number>();
  for (const [wordId, skills] of schedule) {
    for (const { dueAt } of skills.values()) if (dueAt <= now.getTime()) dueTimes.set(wordId, Math.min(dueTimes.get(wordId) ?? Infinity, dueAt));
  }
  const due = available.filter(word => dueTimes.has(word.id))
    .sort((a, b) => dueTimes.get(a.id)! - dueTimes.get(b.id)!);
  const taskLimit = Math.max(1, Math.floor(data.settings.sessionMinutes * 60 / SECONDS_PER_LEARNING_TASK));
  const review: Word[] = [], fresh: Word[] = [], tasks: LearningTask[] = [];
  let taskCount = 0;
  for (const word of due) {
    if (review.length >= data.settings.dailyReviewWords || taskCount >= taskLimit) break;
    const steps = [...schedule.get(word.id)!.values()].filter(item => item.dueAt <= now.getTime()).map(item => item.step).slice(0, taskLimit - taskCount);
    if (steps.length) { review.push(word); tasks.push({ wordId: word.id, mode: 'review', steps }); taskCount += steps.length; }
  }
  const candidates = available.filter(word => !learned.has(word.id));
  const requestedNew = Math.min(data.settings.dailyNewWords, candidates.length);
  const cap = data.settings.dailyReviewWords;
  const backlogAllowance = cap > 0 && due.length > cap
    ? Math.max(0, Math.floor(data.settings.dailyNewWords * Math.max(0, 2 * cap - due.length) / cap))
    : data.settings.dailyNewWords;
  for (const word of candidates) {
    if (fresh.length >= backlogAllowance) break;
    const steps = newWordSteps(word, data.settings.spellingEnabled);
    if (taskCount + steps.length > taskLimit) break;
    fresh.push(word); tasks.push({ wordId: word.id, mode: 'new', steps }); taskCount += steps.length;
  }
  const reductionReason: 'backlog' | 'task-budget' | null = fresh.length >= requestedNew ? null : backlogAllowance < requestedNew ? 'backlog' : 'task-budget';
  return { available, due, review, fresh, tasks, taskCount, taskLimit,
    estimatedMinutes: Math.ceil(taskCount * SECONDS_PER_LEARNING_TASK / 60),
    newWordLimit: fresh.length, deferredReviewCount: due.length - review.length, reductionReason };
}

export const isIndependentAnswer = (attempt: LearningAttempt) => attempt.correct && !attempt.hinted && !attempt.practiceOnly;

export function summarizeSkill(attempts: LearningAttempt[], skill: Skill) {
  const track = attempts.filter(attempt => attempt.skill === skill);
  const independent = track.filter(isIndependentAnswer);
  return {
    attempts: track.length,
    independent: independent.length,
    independentDays: new Set(independent.map(attempt => learningDay(new Date(attempt.createdAt)))).size,
  };
}

/** Derived observations, never an inferred mastery score or an extra stored fact. */
export function wordLearningOverview(state: AppState, now = new Date()) {
  const plan = dailyLearningPlan(state, now);
  const available = new Set(plan.available.map(word => word.id));
  const schedule = reviewSchedule(state);
  const attempts = new Map<string, LearningAttempt[]>();
  for (const attempt of state.attempts) {
    const list = attempts.get(attempt.wordId) ?? [];
    list.push(attempt); attempts.set(attempt.wordId, list);
  }
  return state.words.map(word => {
    const history = attempts.get(word.id) ?? [];
    const records = history.filter(attempt => currentAttempt(word, attempt));
    const scheduled = [...(schedule.get(word.id)?.values() ?? [])];
    const nextDue = scheduled.length ? Math.min(...scheduled.map(progress => progress.dueAt)) : undefined;
    return {
      word, available: available.has(word.id), total: records.length, historicalTotal: history.length - records.length,
      listen: summarizeSkill(records, 'listen'), recall: summarizeSkill(records, 'recall'), spell: summarizeSkill(records, 'spell'),
      hintedCorrect: records.filter(attempt => attempt.correct && attempt.hinted && !attempt.practiceOnly).length,
      practiceOnly: records.filter(attempt => attempt.practiceOnly).length,
      nextDue, due: available.has(word.id) && nextDue !== undefined && nextDue <= now.getTime(),
    };
  });
}

export function sessionLearningSummary(state: AppState) {
  const records = state.attempts.filter(attempt => attempt.sessionId === state.activeSession?.id);
  const distinct = (skill: Skill) => new Set(records.filter(attempt => attempt.skill === skill && isIndependentAnswer(attempt)).map(attempt => attempt.wordId)).size;
  return { listen: distinct('listen'), recall: distinct('recall'), practiced: new Set(records.filter(attempt => attempt.practiceOnly).map(attempt => attempt.wordId)).size };
}
