import type { AppState, LearningAttempt, LearningSession, LearningStep } from '../shared/contracts';
import { newWordSteps } from '../shared/learning';

export interface LearningPosition {
  wordId: string;
  step: LearningStep;
  hinted: boolean;
  feedback: 'correct' | 'try' | null;
  practiceOnly: boolean;
}
interface LocalResume { wordId?: unknown; step?: unknown; hinted?: unknown; learningVersion?: unknown }
export const learningHintKey = (sessionId: string, wordId: string, step: LearningStep, learningVersion = 0) => `word-play-hint-${sessionId}-${wordId}-${step}-v${learningVersion}`;
export function sessionTaskProgress(session: LearningSession) {
  if (!session.tasks) return null;
  const total = session.tasks.reduce((sum, task) => sum + task.steps.length, 0);
  const completed = session.tasks.reduce((sum, task) => sum + task.steps.filter(step => session.completedSteps?.[task.wordId]?.includes(step)).length, 0);
  return { total, completed };
}

/** New sessions follow the frozen server plan. A saved browser step can only choose a legacy session's position. */
export function restoreLearningPosition(state: AppState, stored?: unknown): LearningPosition | null {
  const session = state.activeSession;
  if (!session || session.completedAt) return null;
  const wordId = session.wordIds.find(id => !session.completedWordIds.includes(id));
  const word = state.words.find(item => item.id === wordId);
  if (!word || !wordId) return null;
  const local = stored && typeof stored === 'object' ? stored as LocalResume : {};
  const matchingLocal = local.wordId === wordId && (local.learningVersion ?? 0) === (word.learningVersion ?? 0);
  const planned = session.tasks?.find(task => task.wordId === wordId);
  const steps = session.tasks ? planned?.steps : newWordSteps(word, state.settings.spellingEnabled);
  if (!steps?.length) return null;
  const serverStep = steps.find(step => !session.completedSteps?.[wordId]?.includes(step));
  const step = session.tasks ? serverStep : matchingLocal && steps.includes(local.step as LearningStep) ? local.step as LearningStep : steps[0];
  if (!step) return null;
  const skill = step === 'sound' ? 'listen' : step;
  const records = state.attempts.filter(attempt => attempt.sessionId === session.id && attempt.wordId === wordId
    && (attempt.learningVersion ?? 0) === (word.learningVersion ?? 0)
    && (attempt.step ? attempt.step === step : !session.tasks && attempt.skill === skill));
  const latest = records.reduce<LearningAttempt | undefined>((current, attempt) => !current || attempt.createdAt >= current.createdAt ? attempt : current, undefined);
  const accepted = records.filter(attempt => attempt.correct || attempt.practiceOnly)
    .reduce<LearningAttempt | undefined>((current, attempt) => !current || attempt.createdAt >= current.createdAt ? attempt : current, undefined);
  return {
    wordId, step,
    hinted: Boolean(matchingLocal && local.step === step && local.hinted) || records.some(attempt => attempt.hinted || (!attempt.correct && !attempt.practiceOnly)),
    feedback: accepted ? 'correct' : latest ? 'try' : null,
    practiceOnly: Boolean(accepted?.practiceOnly),
  };
}

export function sessionStepIsLast(session: LearningSession, wordId: string, step: LearningStep, legacySteps: LearningStep[]) {
  const steps = session.tasks?.find(task => task.wordId === wordId)?.steps ?? legacySteps;
  return steps.at(-1) === step;
}
