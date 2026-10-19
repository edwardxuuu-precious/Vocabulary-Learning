import type { AppState, LearningSession, LearningTask, LessonPlan, Word } from './contracts.ts';
import { selectedLearningTasks, SECONDS_PER_LEARNING_TASK } from './learning.ts';

type LessonData = Pick<AppState, 'words' | 'packs' | 'progress' | 'settings'> & Partial<Pick<AppState, 'attempts' | 'learningHistory'>> & { sessions?: LearningSession[]; resumableSessions?: LearningSession[] };
export function lessonSegment(plan: LessonPlan, data: LessonData) {
  const enabled = new Set(data.packs.filter(pack => pack.enabled && !pack.deletedAt && !pack.isSample).map(pack => pack.id));
  const words = new Map(data.words.map(word => [word.id, word]));
  const pending = plan.focusWordIds.filter(id => !plan.completedWordIds.includes(id));
  const unavailable = plan.focusWordIds.filter(id => { const word = words.get(id); return !word || word.deletedAt || !enabled.has(word.packId) || word.assetStatus !== 'approved' || (word.learningVersion ?? 0) !== plan.wordVersions[id]; });
  const tasks: LearningTask[] = [], budget = Math.floor(plan.segmentMinutes * 60 / SECONDS_PER_LEARNING_TASK);
  if (!unavailable.length) {
    for (const id of pending) {
      const task = selectedLearningTasks(data, [id], 'practice')[0];
      const count = tasks.reduce((sum, item) => sum + item.steps.length, 0);
      if (tasks.length && count + task.steps.length > budget) break;
      tasks.push(task);
    }
  }
  return { tasks, words: tasks.map(task => words.get(task.wordId) as Word), unavailable, remaining: pending.length,
    minutes: Math.ceil(tasks.reduce((sum, task) => sum + task.steps.length, 0) * SECONDS_PER_LEARNING_TASK / 60) };
}

export function syncLessonProgress(plan: LessonPlan | undefined, sessions: LearningSession[]) {
  if (!plan) return;
  const done = new Set(plan.completedWordIds);
  for (const session of sessions) if (session.lessonPlanId === plan.id) {
    for (const id of session.completedWordIds) if (plan.wordIds.includes(id) && session.lessonWordVersions?.[id] === plan.wordVersions[id]) done.add(id);
  }
  plan.completedWordIds = plan.wordIds.filter(id => done.has(id));
}

export function validLessonPlan(value: unknown, wordIds: Set<string>): value is LessonPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as LessonPlan;
  if (Object.keys(p).some(key => !['id','title','revision','wordIds','focusWordIds','wordVersions','completedWordIds','segmentMinutes','createdAt','updatedAt'].includes(key))) return false;
  const list = (items: unknown): items is string[] => Array.isArray(items) && items.length <= 500 && new Set(items).size === items.length && items.every(id => typeof id === 'string' && wordIds.has(id));
  return typeof p.id === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(p.id) && typeof p.title === 'string' && !!p.title.trim() && p.title.length <= 80 && !/[\u0000-\u001f]/.test(p.title) &&
    Number.isSafeInteger(p.revision) && p.revision > 0 && Number.isInteger(p.segmentMinutes) && p.segmentMinutes >= 5 && p.segmentMinutes <= 15 &&
    typeof p.createdAt === 'string' && Number.isFinite(Date.parse(p.createdAt)) && typeof p.updatedAt === 'string' && Number.isFinite(Date.parse(p.updatedAt)) &&
    list(p.wordIds) && p.wordIds.length > 0 && list(p.focusWordIds) && list(p.completedWordIds) && p.focusWordIds.every(id => p.wordIds.includes(id)) && p.completedWordIds.every(id => p.wordIds.includes(id)) &&
    !!p.wordVersions && typeof p.wordVersions === 'object' && !Array.isArray(p.wordVersions) && Object.keys(p.wordVersions).length === p.wordIds.length && p.wordIds.every(id => Number.isSafeInteger(p.wordVersions[id]) && p.wordVersions[id] >= 0);
}
