import type { AppState, AssessmentData, LearningGoal, LearningStep, Word } from './contracts.ts';
import { currentWordAttempt, isIndependentAnswer, latestAssessmentEvidence } from './learning-evidence.ts';
export { currentWordAttempt } from './learning-evidence.ts';

export const learningGoals: LearningGoal[] = ['recognize', 'listen', 'read'];
export const goalLabels: Record<LearningGoal, string> = { recognize: '认', listen: '听', read: '读' };
export const goalStep = (step: LearningStep): LearningGoal | undefined => step === 'recognize' || step === 'practice-look' ? 'recognize' : step === 'listen' || step === 'sound' ? 'listen' : step === 'read' || step === 'practice-read' ? 'read' : undefined;
export const isGoalCheckpoint = (step: LearningStep) => step === 'recognize' || step === 'read';

/** Three observations of saved evidence. Recording a reading never creates an assessed success. */
export function goalObservations(data: Pick<AppState,'attempts'> & AssessmentData, word: Word, now?: Date) {
  return Object.fromEntries(learningGoals.map(goal => {
    const attempts = data.attempts.filter(a => currentWordAttempt(word,a) && a.skill === goal);
    const independent = attempts.filter(isIndependentAnswer);
    const assessed = goal === 'listen' ? undefined : latestAssessmentEvidence(data, word, goal === 'read' ? 'read' : 'look', now);
    const verified=!!assessed&&assessed.result==='correct'&&(goal!=='read'||assessed.source==='parent');
    const latest = attempts.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
    const practices=(data.assessmentPractices??[]).filter(p=>p.wordId===word.id&&p.learningVersion===(word.learningVersion??0)&&p.dimension===(goal==='recognize'?'look':goal==='read'?'read':''));
    return [goal, { attempts: attempts.length+practices.length, independent: independent.length, independentDays: new Set(independent.map(a=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(a.createdAt)))).size, recorded: attempts.filter(a=>a.oralStatus==='recorded').length+practices.filter(p=>p.oralStatus==='recorded').length, skipped: attempts.filter(a=>a.oralStatus==='skipped').length+practices.filter(p=>p.oralStatus==='skipped').length, verified:Number(verified), needsPractice:!!latest && (!latest.correct || latest.hinted || latest.practiceOnly), latestAt:latest?.createdAt }];
  })) as Record<LearningGoal,{attempts:number;independent:number;independentDays:number;recorded:number;skipped:number;verified:number;needsPractice:boolean;latestAt?:string}>;
}

/** Picture-to-English participation and formally verified recall remain separate. */
export function recallObservations(data: Pick<AppState,'attempts'> & AssessmentData,word:Word,now?:Date) {
  const attempts=data.attempts.filter(a=>currentWordAttempt(word,a)&&a.skill==='recall');
  const verified=latestAssessmentEvidence(data,word,'zh-en',now);
  return {recorded:attempts.filter(a=>a.oralStatus==='recorded').length,skipped:attempts.filter(a=>a.oralStatus==='skipped').length,helped:attempts.filter(a=>a.hinted&&a.oralStatus==='recorded').length,unprompted:attempts.filter(a=>!a.hinted&&a.oralStatus==='recorded').length,verified:verified?.result==='correct'&&verified.source==='parent'};
}
