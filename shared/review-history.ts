import type { AssessmentData, LearningAttempt, LearningSession, LearningStep, Word } from './contracts.ts';
import { currentWordAttempt } from './learning-evidence.ts';

export type ReviewGoal = 'recall' | 'read' | 'recognize' | 'listen' | 'en-zh' | 'spell';
export interface ReviewCompletion {
  sessionId: string; wordId: string; learningVersion: number; step: LearningStep; completedAt: string;
  outcome: 'practiced' | 'skipped' | 'unavailable';
}
export const reviewGoal = (step: LearningStep): ReviewGoal | undefined =>
  step === 'recall' || step === 'practice-zh-en' ? 'recall' : step === 'read' || step === 'practice-read' ? 'read'
    : step === 'recognize' || step === 'practice-look' ? 'recognize' : step === 'listen' || step === 'sound' ? 'listen'
      : step === 'practice-en-zh' ? 'en-zh' : step === 'spell' ? 'spell' : undefined;
export const reviewDay = (date: Date) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export const nextReviewDay = (at: string) => Date.parse(reviewDay(new Date(at)) + 'T00:00:00+08:00') + 86_400_000;
export const isRoutineReview = (session: LearningSession) => !session.practiceOnly && (session.mode ?? 'recommended') === 'recommended'
  && (!session.entrySource || session.entrySource.entry === 'review' && session.entrySource.kind === 'recommended');

type ReviewData = AssessmentData & {words: Word[]; attempts?: LearningAttempt[]; sessions?: LearningSession[]; resumableSessions?: LearningSession[]; lastCompletedSession?: LearningSession | null; reviewHistory?: ReviewCompletion[]};
/** Only a completed recommended review target affects a routine reminder. No new scores or formal dates. */
export function routineReviewCompletions(data: ReviewData, now = new Date()): ReviewCompletion[] {
  const words = new Map(data.words.map(word=>[word.id,word])), rows = new Map<string,ReviewCompletion>();
  const add = (row: ReviewCompletion) => {
    const word=words.get(row.wordId),at=Date.parse(row.completedAt);
    if(!word || row.learningVersion !== (word.learningVersion??0) || !reviewGoal(row.step) || !Number.isFinite(at) || at>now.getTime() || at<Date.parse(word.learningResetAt??''))return;
    rows.set(`${row.sessionId}:${row.wordId}:${row.step}`,row);
  };
  // The HTTP projection includes finished rounds that are deliberately absent from resumableSessions.
  for(const row of data.reviewHistory??[])add(row);
  const sessions=new Map([...(data.sessions??data.resumableSessions??[]),...(data.lastCompletedSession?[data.lastCompletedSession]:[])].map(session=>[session.id,session]));
  for(const session of sessions.values()) {
    if(!isRoutineReview(session))continue;
    for(const task of session.tasks??[]) {
      const word=words.get(task.wordId);if(!word||task.mode!=='review')continue;
      for(const step of task.steps) {
        if(!reviewGoal(step)||!session.completedSteps?.[word.id]?.includes(step))continue;
        const snapshot=session.activities?.find(activity=>activity.wordId===word.id&&activity.step===step)?.word;
        if(snapshot&&(snapshot.learningVersion!==(word.learningVersion??0)||snapshot.term!==word.term||snapshot.meaning!==word.meaning))continue;
        const attempt=(data.attempts??[]).filter(row=>row.sessionId===session.id&&row.step===step&&currentWordAttempt(word,row)&&!row.sessionPracticeOnly&&(row.correct||row.practiceOnly)&&Date.parse(row.createdAt)<=now.getTime()).at(-1);
        const practice=(data.assessmentPractices??[]).find(row=>row.sessionId===session.id&&row.wordId===word.id&&row.learningVersion===(word.learningVersion??0)&&`practice-${row.dimension}`===step&&Date.parse(row.createdAt)<=now.getTime());
        const evidence=attempt??practice;if(!evidence)continue;
        const completedAt=session.reviewCompletionTimes?.[`${word.id}:${step}`]??evidence.createdAt;
        if(Date.parse(completedAt)<Date.parse(evidence.createdAt)||Date.parse(completedAt)<Date.parse(session.startedAt))continue;
        const outcome=attempt?.responseStatus??(evidence.oralStatus==='skipped'||attempt?.id.endsWith(':goal-skipped')?'skipped':'practiced');
        add({sessionId:session.id,wordId:word.id,learningVersion:word.learningVersion??0,step,completedAt,outcome});
      }
    }
  }
  return [...rows.values()];
}

/** Optional server-written timestamps preserve the actual continuation day across midnight. */
export function validReviewCompletionTimes(session: LearningSession): boolean {
  const times=session.reviewCompletionTimes;if(times===undefined)return true;
  return !!times&&typeof times==='object'&&!Array.isArray(times)&&isRoutineReview(session)
    && Object.entries(times).every(([id,at])=>typeof at==='string'&&Number.isFinite(Date.parse(at))&&Date.parse(at)>=Date.parse(session.startedAt)
      && (!session.completedAt||Date.parse(at)<=Date.parse(session.completedAt))
      && session.tasks?.some(task=>task.mode==='review'&&task.steps.some(step=>reviewGoal(step)&&id===`${task.wordId}:${step}`&&session.completedSteps?.[task.wordId]?.includes(step))));
}
