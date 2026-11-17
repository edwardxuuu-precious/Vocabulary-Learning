import type { AppState, LearningSession } from './contracts.ts';
import { assessmentDimensions, assessmentWords, sameAssessmentWord,maxAssessmentWords } from './assessment.ts';
import { currentAssessmentAttempts } from './learning-evidence.ts';

export function completedTestWordIds(state:AppState,session:LearningSession|null|undefined) {
  if(!session?.completedAt||!session.rewardGranted)return [];
  return session.completedWordIds.filter(id=>{
    const word=state.words.find(word=>word.id===id),snapshot=session.activities?.find(activity=>activity.wordId===id)?.word;
    return !!word&&(!snapshot||sameAssessmentWord(word,snapshot));
  });
}

/** A read-only queue: completing practice or submitting audio never counts as passing. */
export function learningVerification(state:AppState,wordIds:string[],now=new Date(state.learningNow??Date.now())) {
  const ids=[...new Set(wordIds)],available=new Map(assessmentWords(state).map(word=>[word.id,word]));
  const scoped=(state.assessments??[]).filter(test=>test.workflow==='recorded'&&test.mode==='full'
    &&test.wordIds.length&&test.wordIds.every(id=>ids.includes(id))
    &&Date.parse(test.startedAt)<=now.getTime()
    &&test.items.every(item=>sameAssessmentWord(available.get(item.word.id),item.word)))
    .toSorted((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const resume=scoped.find(test=>!test.submittedAt);
  const rows=ids.map(id=>{
    const word=available.get(id);
    if(!word)return {wordId:id,status:'unavailable' as const};
    const evidence=currentAssessmentAttempts(state,word,now),latest=new Map(evidence.map(attempt=>[attempt.dimension,attempt]));
    if(assessmentDimensions.every(dimension=>latest.get(dimension)?.result==='correct'))return {wordId:id,status:'passed' as const};
    const pending=(state.assessments??[]).some(test=>test.workflow==='recorded'&&test.submittedAt&&Date.parse(test.submittedAt)<=now.getTime()
      &&test.items.some(item=>item.word.id===id&&sameAssessmentWord(word,item.word)&&item.dimension!=='look'&&!item.reviews?.length
        &&Date.parse(item.response?.answeredAt??'')>=Date.parse(latest.get(item.dimension)?.createdAt??'1970-01-01T00:00:00Z')));
    if(pending)return {wordId:id,status:'pending' as const};
    if(resume?.wordIds.includes(id))return {wordId:id,status:'unfinished' as const};
    return {wordId:id,status:evidence.length?'retry' as const:'untested' as const};
  });
  const nextWordIds=[...rows.filter(row=>row.status==='untested'),...rows.filter(row=>row.status==='retry')].slice(0,maxAssessmentWords).map(row=>row.wordId);
  return {rows,resume,nextWordIds,total:ids.length,passed:rows.filter(row=>row.status==='passed').length,
    pending:rows.filter(row=>row.status==='pending').length,unavailable:rows.filter(row=>row.status==='unavailable').length};
}
