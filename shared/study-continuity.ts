import type {LearningActivity,LearningSession,LearningStep} from './contracts.ts';
import {activityDone,currentActivity} from './game-plan.ts';
import {wordLearningProfiles,wordLearningSessions,currentLearningSessionId,explicitStudySession,type WordAbility,type WordLearningData,type WordLearningProfile} from './word-learning.ts';

export const STUDY_CONTINUITY_VERSION='study-continuity-v1' as const;
export type StudyMode='child'|'test';
export interface LegacyTargetMapping {
  activityId:string;wordId:string;step:LearningStep;
  state:'completed'|'preserve-current'|'needed'|'covered'|'blocked';
  reason:'recorded-completion'|'saved-scene'|'target-needed'|'evidence-covered'|'explicit-practice'|'group-needed'|'stale-content'|'content-unavailable';
}
export interface LegacySessionMapping {
  sessionId:string;status:'completed'|'suspended'|'unfinished';current:boolean;
  action:'keep-history'|'keep-suspended'|'resume-legacy'|'reconcile-at-boundary'|'prepare-content'|'legacy-unmapped';
  legacyActivityId?:string;nextTargetActivityId?:string;hasSavedPosition:boolean;hasDraft:boolean;hasReadyRecording:boolean;
  neededCount:number;coveredCount:number;targets:LegacyTargetMapping[];
}
const abilityOf=(step:LearningStep):WordAbility|undefined=>step==='practice-look'?'recognize':step==='practice-en-zh'?'meaning':step==='practice-zh-en'?'recall':step==='practice-read'?'read':step==='sound'?'listen':step==='learn'?undefined:step;
const snapshotCurrent=(data:WordLearningData,activity:LearningActivity)=>[activity.word,...activity.choices,...(activity.targets??[]),...(activity.cueWord?[activity.cueWord]:[])].every(snapshot=>data.words.some(word=>word.id===snapshot.id&&(word.learningVersion??0)===snapshot.learningVersion&&word.term===snapshot.term&&word.meaning===snapshot.meaning&&word.imageUrl===snapshot.imageUrl));
export function studyTargetCovered(profile:WordLearningProfile,step:LearningStep){
  if(step==='learn')return profile.encountered;
  const ability=abilityOf(step),judgment=ability&&profile.abilities[ability].judgment;
  return judgment?.result==='correct'&&(judgment.kind==='assessment'||['recognize','listen','spell'].includes(ability!));
}

/** Only proposes mappings. It never changes the legacy cursor, completedSteps or private recordings. */
export function studyContinuity(data:WordLearningData,now=new Date(),suppliedProfiles?:WordLearningProfile[]):LegacySessionMapping[]{
  const profiles=new Map((suppliedProfiles??wordLearningProfiles(data,now)).map(profile=>[profile.wordId,profile]));
  return wordLearningSessions(data).map(session=>{
    const activity=currentActivity(session),draft=session.pauseState?.draft;
    const hasDraft=session.pauseState?.activityId===activity?.id&&!!(draft?.selectedId||draft?.spelling?.length);
    const hasReadyRecording=!!activity&&(data.practiceRecordings??[]).some(take=>take.sessionId===session.id&&take.activityId===activity.id&&take.word.learningVersion===activity.word.learningVersion&&take.word.term===activity.word.term&&take.word.meaning===activity.word.meaning&&take.status==='ready');
    const explicit=explicitStudySession(session);
    const protectedIds=new Set(activity&&(hasDraft||hasReadyRecording||session.pauseState?.checkpointId)?(activity.groupId?session.activities!.filter(item=>item.groupId===activity.groupId).map(item=>item.id):[activity.id]):[]);
    const targets:LegacyTargetMapping[]=(session.activities??[]).map(item=>{
      const base={activityId:item.id,wordId:item.wordId,step:item.step};
      if(activityDone(session,item))return {...base,state:'completed',reason:'recorded-completion'};
      const profile=profiles.get(item.wordId);
      if(!profile||!snapshotCurrent(data,item))return {...base,state:'blocked',reason:'stale-content'};
      if(!profile.available||[...item.choices,...(item.targets??[]),...(item.cueWord?[item.cueWord]:[])].some(snapshot=>!profiles.get(snapshot.id)?.available))return {...base,state:'blocked',reason:'content-unavailable'};
      if(protectedIds.has(item.id))return {...base,state:'preserve-current',reason:'saved-scene'};
      const plannedPractice=session.studyPlan?.purpose==='learn'&&session.tasks?.some(task=>task.wordId===item.wordId&&task.mode==='review');
      if(explicit||plannedPractice)return {...base,state:'needed',reason:'explicit-practice'};
      return studyTargetCovered(profile,item.step)?{...base,state:'covered',reason:'evidence-covered'}:{...base,state:'needed',reason:'target-needed'};
    });
    // Shared boards and paired repair tasks must remain coherent until their whole group is covered.
    for(const item of session.activities??[]){
      if(!item.groupId)continue;
      const ids=new Set(session.activities!.filter(peer=>peer.groupId===item.groupId).map(peer=>peer.id));
      const group=targets.filter(target=>ids.has(target.activityId));
      if(group.some(target=>['needed','preserve-current','blocked'].includes(target.state)))for(const target of group)if(target.state==='covered'){target.state='needed';target.reason='group-needed';}
    }
    const status=session.completedAt?'completed':session.suspendedAt?'suspended':'unfinished';
    const next=targets.find(target=>target.state==='needed'||target.state==='preserve-current');
    const action:LegacySessionMapping['action']=status==='completed'?'keep-history':status==='suspended'?'keep-suspended':!targets.length?'legacy-unmapped':targets.some(target=>target.state==='blocked')?'prepare-content':targets.some(target=>target.state==='covered')?'reconcile-at-boundary':'resume-legacy';
    return {sessionId:session.id,status,current:session.id===currentLearningSessionId(data),action,legacyActivityId:activity?.id,nextTargetActivityId:next?.activityId,hasSavedPosition:!!session.pauseState,hasDraft,hasReadyRecording,neededCount:targets.filter(target=>target.state==='needed'||target.state==='preserve-current').length,coveredCount:targets.filter(target=>target.state==='covered').length,targets};
  });
}

export interface StudyContinuationRequest {
  planId:string;mode:StudyMode;requestId:string;sessionId:string;activityId?:string;
}
export type StudyContinuationDecision={ok:true;action:LegacySessionMapping['action'];mapping:LegacySessionMapping}|{ok:false;code:'INVALID_REQUEST'|'STALE_PLAN'|'MODE_MISMATCH'|'SESSION_CHANGED'|'BUSY'|'CONTENT_BLOCKED'};
export interface StudyPlanBinding {planId:string;mode:StudyMode;day:string;continuity:LegacySessionMapping[]}

/** A concurrency contract, not authorization or execution. The API must still enforce grants, rest and media checks. */
export function validateStudyContinuation(current:StudyPlanBinding,request:StudyContinuationRequest,{busy=false}:{busy?:boolean}={}):StudyContinuationDecision{
  if(!request||typeof request!=='object'||Object.keys(request).some(key=>!['planId','mode','requestId','sessionId','activityId'].includes(key))||typeof request.requestId!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(request.requestId)||typeof request.sessionId!=='string'||request.activityId!==undefined&&typeof request.activityId!=='string')return {ok:false,code:'INVALID_REQUEST'};
  if(request.mode!==current.mode)return {ok:false,code:'MODE_MISMATCH'};
  if(request.planId!==current.planId)return {ok:false,code:'STALE_PLAN'};
  if(busy)return {ok:false,code:'BUSY'};
  const mapping=current.continuity.find(item=>item.sessionId===request.sessionId);
  if(!mapping||mapping.status!=='unfinished'||request.activityId!==mapping.legacyActivityId)return {ok:false,code:'SESSION_CHANGED'};
  if(mapping.action==='prepare-content')return {ok:false,code:'CONTENT_BLOCKED'};
  return {ok:true,action:mapping.action,mapping};
}
