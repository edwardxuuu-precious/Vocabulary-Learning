import type { AssessmentAttempt, AssessmentData, AssessmentDimension, LearningAttempt, Word } from './contracts.ts';

/** Read-only eligibility rules shared by recommendations, parent observations and growth. */
export const currentWordAttempt = (word: Word, attempt: LearningAttempt) =>
  attempt.wordId === word.id && (attempt.learningVersion ?? 0) === (word.learningVersion ?? 0)
  && Number.isFinite(Date.parse(attempt.createdAt))
  && !(Date.parse(attempt.createdAt) < Date.parse(word.learningResetAt ?? ''));

export const isIndependentAnswer = (attempt: LearningAttempt) =>
  attempt.correct && !attempt.hinted && !attempt.practiceOnly && !attempt.sessionPracticeOnly;

/** A later review of an older response must not displace a newer response. */
export function evidenceOrder(a: AssessmentAttempt, b: AssessmentAttempt) {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt)
    || (a.reviewVersion ?? 0) - (b.reviewVersion ?? 0)
    || Date.parse(a.confirmedAt ?? a.createdAt) - Date.parse(b.confirmedAt ?? b.createdAt)
    || a.id.localeCompare(b.id);
}

export function currentAssessmentAttempts(data: AssessmentData, word: Word, now = new Date()): AssessmentAttempt[] {
  const validTime = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime();
  const sessions = new Map((data.assessments ?? []).filter(session =>
    session.completedAt && validTime(session.completedAt) && session.items.length
    && (session.workflow === 'recorded'
      ? session.submittedAt && validTime(session.submittedAt) && session.items.every(item => item.response)
      : session.items.every(item => item.result !== undefined)),
  ).map(session => [session.id, session]));
  return (data.assessmentAttempts ?? []).filter(attempt => {
    if (attempt.wordId !== word.id || attempt.learningVersion !== (word.learningVersion ?? 0)
      || !validTime(attempt.createdAt) || attempt.confirmedAt && !validTime(attempt.confirmedAt)
      || Date.parse(attempt.createdAt) < Date.parse(word.learningResetAt ?? '')) return false;
    const session = sessions.get(attempt.sessionId), item = session?.items.find(item => item.id === attempt.itemId);
    return !!item && item.word.id === word.id && item.word.learningVersion === (word.learningVersion ?? 0)
      && item.word.term === word.term && item.word.meaning === word.meaning
      && item.dimension === attempt.dimension && item.result === attempt.result
      && attempt.source === (attempt.dimension === 'look' ? 'server' : 'parent');
  }).sort(evidenceOrder);
}

export function latestAssessmentEvidence(data: AssessmentData, word: Word, dimension: AssessmentDimension, now?: Date) {
  return currentAssessmentAttempts(data, word, now).filter(attempt => attempt.dimension === dimension).at(-1);
}
