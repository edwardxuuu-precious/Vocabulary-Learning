import type {AppState,AssessmentSession} from './contracts.ts';
import {sameAssessmentWord} from './assessment.ts';
import {latestAssessmentEvidence} from './learning-evidence.ts';
/** Operational summary from current evidence; no score, write, transcription, or inferred intent. */
export function parentReviewSummary(state:AppState,now=new Date(state.learningNow??Date.now())){
  const rounds=(state.assessments??[]).filter(s=>s.workflow==='recorded'&&s.submittedAt);
  const stale=(s:AssessmentSession)=>s.items.some(item=>!sameAssessmentWord(state.words.find(w=>w.id===item.word.id&&!w.deletedAt),item.word));
  const pending=(s:AssessmentSession)=>s.items.filter(i=>i.dimension!=='look'&&!i.reviews?.length).length;
  const missing=rounds.flatMap(s=>s.items).filter(i=>i.dimension!=='look'&&!i.reviews?.length&&i.response?.recording?.status==='missing').length;
  const suggestions:string[]=[];
  const waiting=rounds.reduce((n,s)=>n+pending(s),0);
  if(waiting)suggestions.push(`还有 ${waiting} 项口头回答待核验；先处理缺音/词义变化，再集中核对本次所见版本。`);
  let weak=0,unconfirmed=0;
  for(const word of state.words.filter(w=>!w.deletedAt))for(const direction of ['look','read','en-zh','zh-en'] as const){
    const evidence=latestAssessmentEvidence(state,word,direction,now);if(!evidence)continue;
    if(['incorrect','hinted'].includes(evidence.result))weak++;
    if(['unconfirmed','unavailable','skipped'].includes(evidence.result))unconfirmed++;
  }
  if(weak)suggestions.push(`${weak} 个方向的最新正式结果需练习；从复习入口按目标补练，不把重复录音当成已掌握。`);
  else if(unconfirmed)suggestions.push(`${unconfirmed} 个方向尚无可确认结论；条件合适时显式再挑战，不按未确认判错。`);
  if(!suggestions.length)suggestions.push('目前没有待核验回答；是否记牢仍看后续真实探测，普通录音只记参与。');
  return {rounds,pending,stale,waiting,missing,changed:rounds.filter(stale).length,failed:rounds.filter(s=>['failed','interrupted'].includes(s.job?.status??'')).length,suggestions:suggestions.slice(0,2)};
}
