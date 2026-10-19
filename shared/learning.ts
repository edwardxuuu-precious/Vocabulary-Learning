import type { AppState, LearningAttempt, LearningStep, LearningTask, Skill, Word } from './contracts.ts';
import { SPEECH_INPUT_ENABLED } from './features.ts';
import { wordGamePlan } from './vocabulary.ts';
import { assessmentDay, dueAssessmentProgress, suggestedAssessmentPractice, practiceStep } from './assessment.ts';
import type { AssessmentData } from './contracts.ts';
import { availableLearningWords, interleavePacks, learningEncounters, type LearningHistoryData } from './learning-history.ts';
import { currentWordAttempt, goalStep, learningGoals, goalObservations, recallObservations } from './learning-goals.ts';

export const learningDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export type LearningData = Pick<AppState, 'words' | 'packs' | 'progress' | 'settings'> & LearningHistoryData & AssessmentData;
const DAY = 86_400_000;
// A planning estimate, not a countdown or a promise about an individual child.
export const SECONDS_PER_LEARNING_TASK = 30;

export function newWordSteps(word: Pick<Word, 'term'>, spellingEnabled: boolean): LearningStep[] {
  return wordGamePlan(word, spellingEnabled).map(game => game.step);
}

function currentAttempt(word: Word | undefined, attempt: LearningAttempt) {
  if (word?.learningVersion !== undefined) return (attempt.learningVersion ?? 0) === word.learningVersion;
  return !(Date.parse(attempt.createdAt) <= Date.parse(word?.learningResetAt ?? ''));
}

function reviewSchedule(data: LearningData) {
  const assessed = new Set<string>();
  const words = new Map(data.words.map(word => [word.id, word]));
  for (const attempt of data.attempts ?? []) {
    if (!currentAttempt(words.get(attempt.wordId), attempt)) continue;
    if (!attempt.practiceOnly) assessed.add(`${attempt.wordId}:${attempt.skill}`);
  }
  const schedule = new Map<string, Map<string, { dueAt: number; step: LearningStep }>>();
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
  for (const { wordId, introducedAt } of learningEncounters(data)) {
    const time = Date.parse(introducedAt);
    const row = schedule.get(wordId) ?? new Map();
    if (!row.has('listen')) row.set('listen', { dueAt: time + DAY, step: 'listen' });
    const word=words.get(wordId)!;
    for(const goal of ['recognize','read'] as const){
      if(row.has(goal))continue;
      const attempts=(data.attempts??[]).filter(a=>currentWordAttempt(word,a)&&a.skill===goal&&!a.sessionPracticeOnly).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      const last=attempts.at(-1);
      // An oral take is a practice reminder, never an invented graded stage.
      const verified=(data.assessmentProgress??[]).find(p=>p.wordId===wordId&&p.learningVersion===(word.learningVersion??0)&&p.dimension===(goal==='read'?'read':'look'));
      const practiced=(data.assessmentPractices??[]).filter(p=>p.wordId===wordId&&p.learningVersion===(word.learningVersion??0)&&p.dimension===(goal==='read'?'read':'look')).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
      const dueAt=verified?Math.max(Date.parse(verified.dueAt),last?Date.parse(last.createdAt)+DAY:0,practiced?Date.parse(practiced.createdAt)+DAY:0):Math.max(time,last?Date.parse(last.createdAt):0,practiced?Date.parse(practiced.createdAt):0)+DAY;
      row.set(goal,{dueAt,step:goal});
    }
    if (data.settings.learningStrategy === 'memory-loop') {
      const lastRecall=(data.attempts??[]).filter(a=>currentWordAttempt(word,a)&&a.skill==='recall'&&!a.sessionPracticeOnly).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
      // Participation creates a reminder, never a verified score or a shifted formal due date.
      const oralPractices=(data.assessmentPractices??[]).filter(p=>p.wordId===wordId&&p.learningVersion===(word.learningVersion??0)&&p.dimension==='zh-en');
      const lastDay=learningDay(new Date(Math.max(time,lastRecall?Date.parse(lastRecall.createdAt):0,...oralPractices.map(p=>Date.parse(p.createdAt)))));
      const verified=(data.assessmentProgress??[]).find(p=>p.wordId===wordId&&p.learningVersion===(word.learningVersion??0)&&p.dimension==='zh-en');
      row.set('recall',{dueAt:Math.max(Date.parse(lastDay+'T00:00:00+08:00')+DAY,verified?Date.parse(verified.dueAt):0),step:'recall'});
    }
    schedule.set(wordId, row);
  }
  return schedule;
}

/** Incorrect/skipped work comes before unverified or overdue stable work. */
export function learningWeakness(data:LearningData,word:Word,step?:LearningStep):number{
  if(!step)return Math.min(...learningGoals.map(goal=>learningWeakness(data,word,goal)));
  const goal=step&&goalStep(step);
  const attempts=(data.attempts??[]).filter(a=>currentWordAttempt(word,a)&&(!goal||a.skill===goal)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const last=attempts.at(-1);
  if(last?.oralStatus==='skipped'||last&&last.oralStatus!=='recorded'&&(last.hinted||!last.practiceOnly&&!last.correct))return 0;
  const dimensions=goal==='recognize'?['look']:goal==='read'?['read']:goal==='listen'?[]:['look','read'];
  const assessed=(data.assessmentAttempts??[]).filter(a=>a.wordId===word.id&&a.learningVersion===(word.learningVersion??0)&&dimensions.includes(a.dimension)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
  if(assessed&&['incorrect','skipped','hinted','unconfirmed','unavailable'].includes(assessed.result))return 0;
  if(assessed?.result==='correct'&&(!last||Date.parse(assessed.confirmedAt??assessed.createdAt)>=Date.parse(last.createdAt)))return 3;
  if(last?.practiceOnly)return 1;
  if(!last&&!assessed)return 2;
  return 3;
}

/** Shared by the home preview and server: only enabled, approved words can be scheduled. */
export function dailyLearningPlan(data: LearningData, now = new Date()) {
  const available = availableLearningWords(data);
  const encounters = learningEncounters(data);
  const learned = new Set(data.progress.map(progress => progress.wordId));
  const words = new Map(data.words.map(word => [word.id, word]));
  for (const attempt of data.attempts ?? []) if (currentAttempt(words.get(attempt.wordId), attempt)) learned.add(attempt.wordId);
  for (const entry of encounters) learned.add(entry.wordId);
  const schedule = reviewSchedule(data);
  const weakWords = new Set<string>();
  for (const progress of [...dueAssessmentProgress(data, now), ...suggestedAssessmentPractice(data)]) {
    learned.add(progress.wordId);
    if (data.assessmentPractices?.some(practice => practice.wordId === progress.wordId && practice.learningVersion === progress.learningVersion && practice.dimension === progress.dimension && assessmentDay(new Date(practice.createdAt)) === assessmentDay(now))) continue;
    const row = schedule.get(progress.wordId) ?? new Map();
    row.set(`assessment:${progress.dimension}`, { dueAt: Date.parse(progress.dueAt), step: practiceStep(progress.dimension) });
    schedule.set(progress.wordId, row); weakWords.add(progress.wordId);
  }
  const dueTimes = new Map<string, number>();
  for (const [wordId, skills] of schedule) {
    for (const { dueAt } of skills.values()) if (dueAt <= now.getTime()) dueTimes.set(wordId, Math.min(dueTimes.get(wordId) ?? Infinity, dueAt));
  }
  const priorityGroups = new Map<string, Word[]>();
  for (const word of available.filter(word => dueTimes.has(word.id)).sort((a, b) => dueTimes.get(a.id)! - dueTimes.get(b.id)! || Number(weakWords.has(b.id)) - Number(weakWords.has(a.id)))) {
    const key = `${dueTimes.get(word.id)}:${weakWords.has(word.id)}`;
    if (!priorityGroups.has(key)) priorityGroups.set(key, []);
    priorityGroups.get(key)!.push(word);
  }
  const due = [...priorityGroups.values()].flatMap(group => interleavePacks(group, learningDay(now))).sort((a,b)=>learningWeakness(data,a)-learningWeakness(data,b));
  const taskLimit = Math.max(1, Math.floor(data.settings.sessionMinutes * 60 / SECONDS_PER_LEARNING_TASK));
  const review: Word[] = [], fresh: Word[] = [], tasks: LearningTask[] = [];
  let taskCount = 0;
  for (const word of due) {
    if (review.length >= data.settings.dailyReviewWords || taskCount >= taskLimit) break;
    const dueSteps=[...schedule.get(word.id)!.values()].filter(item=>item.dueAt<=now.getTime());
    // A test-directed practice and a regular goal checkpoint must not duplicate the same goal today.
    const practicedGoals=new Set(dueSteps.filter(item=>item.step.startsWith('practice-')).map(item=>goalStep(item.step)).filter(Boolean));
    const steps = dueSteps.filter(item=>item.step.startsWith('practice-')||!practicedGoals.has(goalStep(item.step))&&!(item.step==='recall'&&dueSteps.some(row=>row.step==='practice-zh-en'))).sort((a,b)=>learningWeakness(data,word,a.step)-learningWeakness(data,word,b.step)||a.dueAt-b.dueAt).map(item=>item.step).slice(0, taskLimit-taskCount);
    if (steps.length) { review.push(word); tasks.push({ wordId: word.id, mode: 'review', steps }); taskCount += steps.length; }
  }
  const pending = (data.sessions ?? data.resumableSessions ?? []).filter(session => !session.completedAt && !session.suspendedAt);
  const reserved = new Set(pending.flatMap(session => session.tasks?.filter(task => task.mode === 'new' && !learned.has(task.wordId)).map(task => task.wordId) ?? session.wordIds.filter(id => !learned.has(id))));
  const sampleIds = new Set(data.packs.filter(pack => pack.isSample && !pack.enabled).map(pack => pack.id));
  const usedToday = new Set(encounters.filter(entry => !sampleIds.has(words.get(entry.wordId)!.packId) && learningDay(new Date(entry.introducedAt)) === learningDay(now)).map(entry => entry.wordId));
  const remainingNew = Math.max(0, data.settings.dailyNewWords - new Set([...usedToday, ...reserved]).size);
  const packOrder = new Map([...data.packs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((pack, index) => [pack.id, index]));
  const candidates = available.filter(word => !learned.has(word.id) && !reserved.has(word.id)).sort((a, b) => packOrder.get(a.packId)! - packOrder.get(b.packId)!);
  const requestedNew = Math.min(remainingNew, candidates.length);
  const cap = data.settings.dailyReviewWords;
  const backlogAllowance = cap > 0 && due.length > cap
    ? Math.max(0, Math.floor(remainingNew * Math.max(0, 2 * cap - due.length) / cap))
    : remainingNew;
  for (const word of candidates) {
    if (fresh.length >= backlogAllowance) break;
    const steps = newWordSteps(word, data.settings.spellingEnabled);
    if (taskCount + steps.length > taskLimit) break;
    fresh.push(word); tasks.push({ wordId: word.id, mode: 'new', steps }); taskCount += steps.length;
  }
  const reductionReason: 'backlog' | 'task-budget' | null = fresh.length >= requestedNew ? null : backlogAllowance < requestedNew ? 'backlog' : 'task-budget';
  return { available, due, review, fresh, tasks, taskCount, taskLimit,
    estimatedMinutes: Math.ceil(taskCount * SECONDS_PER_LEARNING_TASK / 60),
    newWordLimit: fresh.length, remainingNew, usedNewToday: usedToday.size, deferredReviewCount: due.length - review.length, reductionReason };
}

export function selectedLearningTasks(data: LearningData, ids: string[], mode: 'relearn' | 'practice'): LearningTask[] {
  const learned = new Set(learningEncounters(data).map(entry => entry.wordId));
  for (const row of data.progress) learned.add(row.wordId);
  const words = new Map(data.words.map(word => [word.id, word]));
  return ids.map(id => {
    const word = words.get(id)!;
    const steps = newWordSteps(word, data.settings.spellingEnabled).filter(step => step !== 'learn' || mode === 'relearn' || !learned.has(id));
    return { wordId: id, mode: steps.includes('learn') ? 'new' : 'review', steps };
  });
}

/** Supplemental play never changes review dates, even when its answers are correct. */
export function supplementalLearningPlan(data: LearningData, now = new Date()) {
  const base = dailyLearningPlan(data, now), learned = new Set(learningEncounters(data).map(entry => entry.wordId));
  for (const row of data.progress) learned.add(row.wordId);
  const sessions = data.sessions ?? data.resumableSessions ?? [];
  const recent = data.lastCompletedSession ?? sessions.find(session => session.id === data.lastCompletedLearningSessionId) ?? sessions.filter(session => session.completedAt && session.rewardGranted).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))[0];
  const last = new Map<string, number>();
  const words = new Map(data.words.map(word => [word.id, word]));
  for (const attempt of data.attempts ?? []) if (currentAttempt(words.get(attempt.wordId), attempt)) last.set(attempt.wordId, Math.max(last.get(attempt.wordId) ?? 0, Date.parse(attempt.createdAt)));
  const weak = new Set([...dueAssessmentProgress(data, now), ...suggestedAssessmentPractice(data)].map(row => row.wordId));
  const pool = interleavePacks(base.available.filter(word => learned.has(word.id)), recent?.id ?? learningDay(now));
  pool.sort((a, b) => Number(recent?.wordIds.includes(a.id) ?? false) - Number(recent?.wordIds.includes(b.id) ?? false) || Number(weak.has(b.id)) - Number(weak.has(a.id)) || (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0));
  const tasks: LearningTask[] = []; let taskCount = 0;
  for (const word of pool) {
    if (tasks.length >= 5) break;
    const task: LearningTask = {wordId: word.id, mode:'review', steps:newWordSteps(word, data.settings.spellingEnabled).filter(step => step !== 'learn')};
    if (taskCount + task.steps.length > base.taskLimit) continue;
    tasks.push(task); taskCount += task.steps.length;
  }
  return { ...base, tasks, taskCount, estimatedMinutes: Math.ceil(taskCount * SECONDS_PER_LEARNING_TASK / 60) };
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
      recognize:summarizeSkill(records,'recognize'),read:summarizeSkill(records,'read'),goals:goalObservations(state,word),recallEvidence:recallObservations(state,word),listen: summarizeSkill(records, 'listen'), recall: summarizeSkill(records, 'recall'), spell: summarizeSkill(records, 'spell'),
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
