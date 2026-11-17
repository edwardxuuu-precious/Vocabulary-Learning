import type { GameWord, LearningEntry } from './contracts.ts';
import type { LearningData } from './learning.ts';
import { learningDay } from './learning.ts';
import { currentAssessmentAttempts } from './learning-evidence.ts';
import { summarizeK1, summarizeK2, summarizeK3, type OpportunityFact, type ParentEffortFact, type ProbeDirection, type ProbeFact } from './business-metrics.ts';

export const observationVersion='business-observations-v1';
export type ObservationAudience='child'|'test'|'engineering';
export interface ObservationStamp {id:string;revision:number;createdAt:string;updatedAt:string;audience:ObservationAudience}
export interface OpportunityObservation extends ObservationStamp,OpportunityFact {
  entry:LearningEntry;stopAt:'unknown'|'entry'|'meaning'|'understanding'|'recall'|'continue'|'audio'|'recording';helpCount:number|null;sessionId?:string;
}
export interface EffortObservation extends ObservationStamp,ParentEffortFact {
  packId:string;words:{id:string;learningVersion:number}[];deliveredWordIds:string[];repairCount:number|null;reviewItems:number|null;
}
export interface ProbeObservation extends ObservationStamp {
  direction:ProbeDirection;interval:ProbeFact['interval'];externalContact:'unknown'|'none'|'reported';
  targets:{word:GameWord;introducedAt:string}[];
}
export type ObservationPhase='foreground'|'system-wait'|'paused'|'background';
export type ObservationIssue='audio'|'microphone'|'recording-save'|'request';
export interface BusinessEvent {
  id:string;clientId:string;audience:ObservationAudience;sessionId:string;activityId?:string;at:string;receivedAt:string;
  kind:'interval'|'opened'|'issue';phase?:ObservationPhase;durationMs?:number;issue?:ObservationIssue;
}
export const observationDayGap=(from:string,to:string)=>Math.round((Date.parse(learningDay(new Date(to))) - Date.parse(learningDay(new Date(from))))/86400000);
const same=(a:GameWord,b:GameWord)=>a.id===b.id&&a.learningVersion===b.learningVersion&&a.term===b.term&&a.meaning===b.meaning&&a.imageUrl===b.imageUrl;

/** Frozen first probes. Later retries, re-recordings and late reviews cannot replace a first response. */
export function probeObservationFacts(plan:ProbeObservation,data:LearningData,now=new Date()) {
  const sessions=data.sessions??data.resumableSessions??[];
  return plan.targets.map(target=>{
    const word=data.words.find(word=>word.id===target.word.id),delay=plan.interval==='next-day'?1:7;
    const base:ProbeFact={id:`${plan.id}:${target.word.id}`,wordId:target.word.id,learningVersion:target.word.learningVersion,direction:plan.direction,interval:plan.interval,outcome:'missing',authority:'practice'};
    const eligible=(at:string)=>Number.isFinite(Date.parse(at))&&Date.parse(at)>=Date.parse(plan.createdAt)&&Date.parse(at)<=now.getTime()&&observationDayGap(target.introducedAt,at)>=delay;
    let at:string|undefined,reason='尚未观察',fact=base;
    if(!word||word.deletedAt||(word.learningVersion??0)!==target.word.learningVersion||word.term!==target.word.term||word.meaning!==target.word.meaning||Date.parse(word.learningResetAt??'')>Date.parse(target.introducedAt)){
      return {fact:{...base,outcome:'unavailable' as const},actualDays:null,reason:'词义已变化，保留原计划缺项',extraPractice:0,externalContact:plan.externalContact};
    }
    if(plan.direction==='listen'){
      const attempt=(data.attempts??[]).filter(attempt=>attempt.wordId===word.id&&(attempt.learningVersion??0)===target.word.learningVersion&&attempt.skill==='listen'&&eligible(attempt.createdAt)
        &&sessions.some(session=>session.id===attempt.sessionId&&session.activities?.some(activity=>activity.id===(attempt.activityId??`${word.id}:${attempt.step}`)&&['listen','sound'].includes(activity.step)&&same(activity.word,target.word))))
        .sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
      if(attempt){at=attempt.createdAt;fact={...base,evidenceId:attempt.id,authority:'objective',outcome:attempt.responseStatus==='unavailable'?'unavailable':attempt.responseStatus==='skipped'||attempt.oralStatus==='skipped'?'skipped':attempt.hinted&&attempt.correct?'helped':attempt.practiceOnly||attempt.sessionPracticeOnly?'unconfirmed':attempt.correct?'correct':'incorrect'};reason='首次听音作答';}
    }else{
      const dimension=plan.direction==='recognize'?'look':plan.direction==='read'?'read':'zh-en';
      const candidate=(data.assessments??[]).flatMap(session=>session.items.filter(item=>item.dimension===dimension&&same(item.word,target.word)&&eligible(session.startedAt))
        .map(item=>({session,item,at:item.response?.answeredAt??session.startedAt}))).sort((a,b)=>a.session.startedAt.localeCompare(b.session.startedAt))[0];
      if(candidate){
        const answerTimeValid=Number.isFinite(Date.parse(candidate.at))&&Date.parse(candidate.at)<=now.getTime();
        at=answerTimeValid?candidate.at:candidate.session.startedAt;const {session,item}=candidate,response=item.response;
        const evidence=currentAssessmentAttempts(data,word,now).filter(attempt=>attempt.sessionId===session.id&&attempt.itemId===item.id).at(-1);
        const outcome=!answerTimeValid?'unconfirmed':!response?'missing':response.kind==='skipped'?'skipped':response.kind==='unavailable'?'unavailable'
          :session.workflow!=='recorded'||response.version!==1?'unconfirmed':evidence?.result==='correct'?'correct':evidence?.result==='incorrect'?'incorrect':evidence?.result==='hinted'?'helped':'unconfirmed';
        fact={...base,outcome,authority:evidence?.source==='parent'?'parent':evidence?.source==='server'?'objective':'practice',...(evidence?{evidenceId:evidence.id}:{})};
        reason=response&&response.version!==1?'首次回答已被重录，不能用最终结果替代首次':outcome==='unconfirmed'?'首次口头结果尚未合法核验':outcome==='missing'?'首次挑战尚无已保存回答':'首次挑战回答';
      }
    }
    const actualDays=at?observationDayGap(target.introducedAt,at):null;
    if(actualDays!==null&&actualDays!==delay){fact={...fact,outcome:'unavailable'};reason='实际间隔超出计划条件，不并入原间隔正确率';}
    const extraPractice=(data.attempts??[]).filter(attempt=>attempt.wordId===word?.id&&Date.parse(attempt.createdAt)>=Date.parse(plan.createdAt)&&Date.parse(attempt.createdAt)<Date.parse(at??now.toISOString())).length;
    return {fact,actualDays,reason,extraPractice,externalContact:plan.externalContact};
  });
}

/** Union reported intervals per phase. Different phases may overlap across tabs; they are never summed as learning/parent effort. */
export function observationIntervals(events:BusinessEvent[]) {
  return Object.fromEntries((['foreground','system-wait','paused','background'] as const).map(phase=>{
    const spans=events.filter(event=>event.kind==='interval'&&event.phase===phase).map(event=>[Date.parse(event.at)-(event.durationMs??0),Date.parse(event.at)]).sort((a,b)=>a[0]-b[0]);
    let total=0,start=0,end=0;for(const span of spans){if(span[0]>end){total+=end-start;[start,end]=span;}else end=Math.max(end,span[1]);}total+=end-start;
    return [phase,total];
  })) as Record<ObservationPhase,number>;
}
export function observationSummary(opportunities:OpportunityObservation[],efforts:EffortObservation[],probes:ProbeObservation[],events:BusinessEvent[],data:LearningData,now=new Date()) {
  return {version:observationVersion,k1:{learn:summarizeK1(opportunities.filter(row=>row.entry==='learn')),review:summarizeK1(opportunities.filter(row=>row.entry==='review'))},
    k2:probes.map(plan=>{const observations=probeObservationFacts(plan,data,now);return {plan,observations,metrics:summarizeK2(observations.map(row=>row.fact))};}),
    k3:efforts.map(fact=>({fact,metrics:summarizeK3(fact)})),timing:observationIntervals(events),issues:events.filter(event=>event.kind==='issue').map(event=>({issue:event.issue,sessionId:event.sessionId,at:event.at})),
    timingLimitation:'只统计收到的客户端区间；可能缺失或跨标签页重叠，不代表注意力、真实学习剂量或家长主动投入。'};
}
export type BusinessObservationView=ReturnType<typeof observationSummary>&{audience:ObservationAudience;opportunities:OpportunityObservation[];efforts:EffortObservation[];probes:ProbeObservation[];eventCount:number};
