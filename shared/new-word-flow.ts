import type { LearningActivity, LearningSession, LearningTask } from './contracts.ts';

/** Keep the odd-tail answer out of the intervening tasks, including distractors and approved material references. */
export function protectNewWordRecallGap(tasks:LearningTask[],activities:LearningActivity[],startIndex=0) {
  const fresh=tasks.filter(task=>task.mode==='new');if(fresh.length<3||fresh.length%2===0)return activities;
  const id=fresh.at(-1)!.wordId,start=activities.findIndex(activity=>activity.wordId===id&&activity.step==='recognize'),end=activities.findIndex(activity=>activity.wordId===id&&activity.step==='recall');
  if(start<0||end<=start)return activities;
  const target=activities[end].word,forbidden=(word:{id:string;term:string})=>word.id===id||word.term.toLowerCase()===target.term.toLowerCase();
  const protectedRows=activities.slice(start+1,end),bad=(activity:LearningActivity)=>activity.cueWord&&forbidden(activity.cueWord)||activity.targets?.some(forbidden)||activity.material?.wordIds.includes(id);
  const fallbackGroups=new Set(protectedRows.filter(bad).map(activity=>activity.groupId).filter(Boolean));
  return activities.map((activity,index)=>{
    if(index<startIndex||index<=start||index>=end)return activity;
    const choices=activity.choices.filter(word=>!forbidden(word));
    if(bad(activity)||activity.groupId&&fallbackGroups.has(activity.groupId))return {id:activity.id,wordId:activity.wordId,word:activity.word,step:activity.step,kind:activity.step==='read'?'portal':'standard',choices:activity.step==='read'?[]:choices} as LearningActivity;
    return {...activity,choices};
  });
}

/** Teaching coverage and sequence, never a mastery score or inferred ability. */
export function newWordFlowCoverage(session:LearningSession) {
  const activities=session.activities??[];
  return (session.tasks??[]).filter(task=>task.mode==='new').map(task=>{
    const rows=activities.map((activity,index)=>({activity,index})).filter(row=>row.activity.wordId===task.wordId);
    const intro=rows.find(row=>row.activity.step==='learn'),recall=rows.find(row=>row.activity.step==='recall');
    const understanding=rows.filter(row=>['listen','recognize'].includes(row.activity.step));
    const lastCue=recall?rows.filter(row=>row.index<recall.index).at(-1):undefined;
    const done=session.completedSteps?.[task.wordId]??[];
    const hiddenRecall=!!recall&&recall.activity.kind==='portal'&&!recall.activity.choices.length;
    return {wordId:task.wordId,hasIntroduction:!!intro,hasUnderstanding:understanding.length===2,hasRecall:!!recall,
      ordered:!!intro&&!!recall&&understanding.length===2&&understanding.every(row=>row.index>intro.index&&row.index<recall.index),hiddenRecall,
      interveningTasks:recall&&lastCue?activities.slice(lastCue.index+1,recall.index).filter(activity=>activity.wordId!==task.wordId&&activity.word.term.toLowerCase()!==recall.activity.word.term.toLowerCase()&&!activity.choices.some(word=>word.term.toLowerCase()===recall.activity.word.term.toLowerCase())).length:0,
      allGoalsPreserved:task.steps.every(step=>rows.filter(row=>row.activity.step===step).length===1),
      introduced:done.includes('learn'),understandingCompleted:understanding.length===2&&understanding.every(row=>done.includes(row.activity.step)),
      recallParticipated:done.includes('recall')};
  });
}
