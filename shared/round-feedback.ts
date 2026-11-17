import type {AssessmentPractice,LearningAttempt,LearningSession} from './contracts.ts';
/** Participation feedback, never a mastery score or inferred child preference. */
export function roundFeedback(session:LearningSession,attempts:LearningAttempt[],practices:AssessmentPractice[]=[]){
  const rows=attempts.filter(row=>row.sessionId===session.id),key=(row:LearningAttempt)=>row.activityId??`${row.wordId}:${row.step??row.skill}`;
  const introduced=new Set((session.exposures??[]).map(row=>row.wordId));
  const wasSkipped=(row:LearningAttempt)=>row.oralStatus==='skipped'||row.responseStatus==='skipped'||row.id.endsWith(':goal-skipped');
  const recorded=new Set(rows.filter(row=>row.oralStatus==='recorded').map(key));
  const skipped=new Set(rows.filter(wasSkipped).map(key));
  for(const row of practices.filter(row=>row.sessionId===session.id)) {
    const id=`${row.wordId}:practice-${row.dimension}`;
    if(row.oralStatus==='recorded')recorded.add(id);
    if(row.oralStatus==='skipped')skipped.add(id);
  }
  const helped=new Set([...rows.filter(row=>row.hinted&&row.responseStatus!=='unavailable'&&!wasSkipped(row)).map(key),...Object.keys(session.reviewSupport?.entries??{})]);
  return {introduced:introduced.size,recorded:recorded.size,skipped:skipped.size,helped:helped.size,unavailable:new Set(rows.filter(row=>row.responseStatus==='unavailable').map(key)).size,retried:Object.values(session.reviewSupport?.entries??{}).filter(row=>row.retry?.status==='tried').length};
}
