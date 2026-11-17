import type {AssessmentAttempt,AssessmentData,AssessmentDimension,Word} from './contracts.ts';
import {currentAssessmentAttempts} from './learning-evidence.ts';
import {assessmentDay} from './assessment.ts';
export const conclusiveAssessment=(attempt:AssessmentAttempt)=>['correct','incorrect','hinted'].includes(attempt.result);
/** Unknown observations retain the last conclusive judgment; a lapse resets only its stability window. */
export function formalDimensionEvidence(data:AssessmentData,word:Word,dimension:AssessmentDimension,now=new Date()){
  const all=currentAssessmentAttempts(data,word,now).filter(row=>row.dimension===dimension),conclusive=all.filter(conclusiveAssessment),last=conclusive.at(-1);
  const window=conclusive.slice(conclusive.findLastIndex(row=>row.result!=='correct')+1);
  const independentDays=new Set(window.filter(row=>row.result==='correct').map(row=>assessmentDay(new Date(row.createdAt)))).size;
  return {last,latestObservation:all.at(-1),passed:last?.result==='correct',stable:last?.result==='correct'&&independentDays>=2,independentDays};
}
