import type { AppState, AssessmentData, AssessmentDimension, AssessmentPracticeStep, AssessmentSession, GameWord, Word } from './contracts.ts';
import { interleavePacks, learningEncounters, type LearningHistoryData } from './learning-history.ts';

export const assessmentDimensions: AssessmentDimension[] = ['zh-en', 'read', 'en-zh', 'look'];
export const assessmentLabels: Record<AssessmentDimension, string> = { look: '看英文认意思', read: '独立朗读', 'en-zh': '英译中', 'zh-en': '中译英' };
export const assessmentResultLabels = { correct: '独立答对', incorrect: '需要练习', hinted: '有提示', unconfirmed: '未确认', skipped: '已跳过', unavailable: '暂无法测试' };
export const assessmentDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const practiceStep = (dimension: AssessmentDimension): AssessmentPracticeStep => `practice-${dimension}`;
export const practiceDimension = (step: string): AssessmentDimension | undefined => assessmentDimensions.find(dimension => step === practiceStep(dimension));
export const assessmentCurrent = (session: AssessmentSession) => session.items.find(item => session.workflow === 'recorded' ? item.response === undefined : item.result === undefined);

/** AI suggestions may request practice, never contribute formal assessment progress. */
export function suggestedAssessmentPractice(data: Pick<AppState, 'words' | 'packs'> & AssessmentData) {
  const enabled = new Set(data.packs.filter(pack => pack.enabled).map(pack => pack.id));
  return (data.assessments ?? []).filter(session => session.submittedAt).flatMap(session => session.items.filter(item => {
    const word = data.words.find(word => word.id === item.word.id);
    return item.proposal?.verdict === 'practice' && !item.reviews?.length && word && enabled.has(word.packId) && word.assetStatus === 'approved' && sameAssessmentWord(word, item.word);
  }).map(item => ({ wordId: item.word.id, learningVersion: item.word.learningVersion, dimension: item.dimension, dueAt: item.response!.answeredAt })));
}
export const sameAssessmentWord = (word: Word | undefined, snapshot: GameWord) => Boolean(word && word.id === snapshot.id && word.term === snapshot.term && word.meaning === snapshot.meaning && word.imageUrl === snapshot.imageUrl && (word.learningVersion ?? 0) === snapshot.learningVersion);

type Data = Pick<AppState, 'words' | 'packs' | 'attempts'> & LearningHistoryData & AssessmentData;
export function assessmentWords(data: Data) {
  const enabled = new Set(data.packs.filter(pack => pack.enabled).map(pack => pack.id));
  const encountered = new Set(learningEncounters(data).map(entry => entry.wordId));
  return data.words.filter(word => enabled.has(word.packId) && word.assetStatus === 'approved' && word.imageUrl !== '/assets/placeholder.svg'
    && (encountered.has(word.id)
      || data.assessmentAttempts?.some(attempt => attempt.wordId === word.id && attempt.learningVersion === (word.learningVersion ?? 0))));
}

/** Suggestions only; no challenge or cloud work starts until the child chooses it. */
export function recommendedAssessmentItems(data: Data, now = new Date()) {
  const available = assessmentWords(data), byId = new Map(available.map(word => [word.id, word]));
  const blocked = new Set<string>();
  for (const session of data.assessments ?? []) for (const item of session.items) {
    const word = byId.get(item.word.id);
    if (!word || !sameAssessmentWord(word, item.word)) continue;
    if (session.workflow === 'recorded' && (!session.submittedAt || item.dimension !== 'look' && !item.reviews?.length) || !session.completedAt && session.workflow !== 'recorded') blocked.add(`${word.id}:${item.dimension}`);
    if (assessmentDay(new Date(item.response?.answeredAt ?? session.startedAt)) === assessmentDay(now)) blocked.add(`${word.id}:${item.dimension}`);
  }
  const due = dueAssessmentProgress(data, now).filter(row => !blocked.has(`${row.wordId}:${row.dimension}`));
  if (due.length) {
    const groups = new Map<string, Word[]>(), seen = new Set<string>();
    for (const row of due) { const word = byId.get(row.wordId); if (word && !seen.has(word.id)) { seen.add(word.id); groups.set(row.dueAt, [...(groups.get(row.dueAt) ?? []), word]); } }
    const ids = [...groups.values()].flatMap(group => interleavePacks(group, assessmentDay(now))).slice(0, 5).map(word => word.id);
    return due.filter(row => ids.includes(row.wordId)).map(row => ({wordId: row.wordId, dimension: row.dimension}));
  }
  const first = new Map(learningEncounters(data).map(entry => [entry.wordId, entry.introducedAt]));
  const candidates = interleavePacks(available.filter(word => first.has(word.id) && assessmentDay(new Date(first.get(word.id)!)) < assessmentDay(now)), assessmentDay(now));
  const assessed = new Set((data.assessmentAttempts ?? []).filter(attempt => byId.get(attempt.wordId) && attempt.learningVersion === (byId.get(attempt.wordId)!.learningVersion ?? 0) && ['correct','incorrect','hinted'].includes(attempt.result)).map(attempt => `${attempt.wordId}:${attempt.dimension}`));
  const result: {wordId: string; dimension: AssessmentDimension}[] = [];
  let words = 0;
  for (const word of candidates) {
    const missing = assessmentDimensions.filter(dimension => !blocked.has(`${word.id}:${dimension}`) && !assessed.has(`${word.id}:${dimension}`));
    if (!missing.length) continue;
    if (words++ >= 5) break;
    result.push(...missing.map(dimension => ({wordId: word.id, dimension})));
  }
  return result;
}
export function assessmentChoices(target: Word, pool: Word[]): Word[] {
  const result = [target];
  for (const word of pool) {
    if (result.length >= 3) break;
    if (!result.some(other => other.id === word.id || other.term.toLowerCase() === word.term.toLowerCase() || other.meaning.trim() === word.meaning.trim() || other.imageUrl === word.imageUrl)) result.push(word);
  }
  return result.length >= 2 ? result : [];
}
export function dueAssessmentProgress(data: Pick<AppState, 'words' | 'packs'> & AssessmentData, now = new Date()) {
  const enabled = new Set(data.packs.filter(pack => pack.enabled).map(pack => pack.id));
  return (data.assessmentProgress ?? []).filter(progress => {
    const word = data.words.find(word => word.id === progress.wordId);
    return word && enabled.has(word.packId) && word.assetStatus === 'approved' && (word.learningVersion ?? 0) === progress.learningVersion && Date.parse(progress.dueAt) <= now.getTime();
  }).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}
