import {formalDimensionEvidence} from './formal-mastery.ts';
import type {AssessmentData,AssessmentDimension,AssessmentResult,LearningAttempt,LearningEntry,LearningSession,LearningStep,PracticeRecording,Skill,SkillProgress,Word} from './contracts.ts';
import {currentAssessmentAttempts,currentWordAttempt} from './learning-evidence.ts';
import {learningEncounters,type LearningHistoryData} from './learning-history.ts';
import {assessmentDay,assessmentDimensions} from './assessment.ts';
import {currentActivity} from './game-plan.ts';
import {sentenceLesson,studiedSentence} from './sentence-study.ts';

/** A replayable read model. It never changes sessions, grades, schedules or media. */
export const WORD_LEARNING_VERSION='word-learning-v1' as const;
export const wordAbilities=['recognize','listen','recall','read','meaning','spell'] as const;
export type WordAbility=typeof wordAbilities[number];
export type WordLearningStatus='unseen'|'learning'|'awaiting-check'|'needs-practice'|'passed'|'stable';
export type AbilityState='unassessed'|'practised'|'independent-practice'|'awaiting-review'|'assisted'|'incorrect'|'passed'|'stable';
export type WordNextAction='learn'|'continue'|'learn-usage'|'check'|'practice'|'review'|'wait-review'|'none'|'prepare-content';
export type WordLearningData=LearningHistoryData&AssessmentData&{
  progress?:SkillProgress[];practiceRecordings?:PracticeRecording[];learningReadyWordIds?:string[];activeSession?:LearningSession|null;activeLearningSessionId?:string|null;
};
export interface EvidenceReference {kind:'learning'|'assessment';id:string;sessionId:string;at:string;result:'correct'|'incorrect'|'hinted'}
export interface AbilityProfile {
  ability:WordAbility;state:AbilityState;judgment?:EvidenceReference;verified:boolean;independentDays:number;
  practiceCount:number;recordedCount:number;pendingReview:boolean;latestObservation?:'recorded'|'skipped'|'unavailable'|'unconfirmed';nextDueAt?:string;
}
export interface SavedWordTarget {sessionId:string;activityId?:string;step?:LearningStep;entry?:LearningEntry;completedSteps:LearningStep[];hasSavedPosition:boolean;hasDraft:boolean;hasReadyRecording:boolean;current:boolean;updatedAt:string}
export interface WordLearningProfile {
  version:typeof WORD_LEARNING_VERSION;wordId:string;learningVersion:number;packId:string;term:string;meaning:string;imageUrl:string;
  status:WordLearningStatus;encountered:boolean;firstEncounterAt?:string;initialLearningComplete:boolean;
  available:boolean;unavailableReason?:'pack-unavailable'|'image-unapproved'|'audio-unready';
  coverage:{meaningSeen:boolean;usage:'not-required'|'needs-teaching'|'taught'};
  abilities:Record<WordAbility,AbilityProfile>;formal:{passed:boolean;stable:boolean;missing:AssessmentDimension[]};
  savedTargets:SavedWordTarget[];next:{action:WordNextAction;abilities:WordAbility[];reason:string};
}
export const wordLearningLabels:Record<WordLearningStatus,string>={unseen:'未学习',learning:'学习中','awaiting-check':'学过待检查','needs-practice':'需要巩固',passed:'已学会',stable:'已熟练'};
export const wordAbilityLabels:Record<WordAbility,string>={recognize:'认意思',listen:'听辨',recall:'主动回忆',read:'朗读',meaning:'英译中',spell:'拼写'};
const dimensionAbility:Record<AssessmentDimension,WordAbility>={look:'recognize',read:'read','en-zh':'meaning','zh-en':'recall'};
export const abilityDimension=(ability:WordAbility)=>assessmentDimensions.find(dimension=>dimensionAbility[dimension]===ability);
const abilitySkill:Partial<Record<WordAbility,Skill>>={recognize:'recognize',listen:'listen',recall:'recall',read:'read',spell:'spell'};
const validAt=(value:string|undefined,now:Date)=>!!value&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now.getTime();
const judged=(result:AssessmentResult)=>['correct','incorrect','hinted'].includes(result);
const sameSnapshot=(word:Word,snapshot:{id:string;term:string;meaning:string;learningVersion:number})=>snapshot.id===word.id&&snapshot.term===word.term&&snapshot.meaning===word.meaning&&snapshot.learningVersion===(word.learningVersion??0);
export function wordLearningSessions(data:WordLearningData):LearningSession[]{
  const sessions=new Map<string,LearningSession>();
  for(const session of [...(data.sessions??data.resumableSessions??[]),...(data.activeSession?[data.activeSession]:[]),...(data.lastCompletedSession?[data.lastCompletedSession]:[])])if(!sessions.has(session.id))sessions.set(session.id,session);
  return [...sessions.values()];
}
export function currentLearningSessionId(data:WordLearningData){
  if(data.activeSession!==undefined)return data.activeSession?.id;
  if(data.activeLearningSessionId!==undefined)return data.activeLearningSessionId??undefined;
  return [...wordLearningSessions(data)].reverse().find(session=>!session.completedAt&&!session.suspendedAt)?.id;
}
export const explicitStudySession=(session:LearningSession)=>!!(session.practiceOnly||session.mode==='relearn'||session.mode==='practice'||session.packGame||session.entrySource?.kind==='selected'||session.entrySource?.kind==='game');

function sessionCovers(session:LearningSession,word:Word,now:Date){
  if(!session.wordIds.includes(word.id)||!validAt(session.startedAt,now))return false;
  const snapshot=session.activities?.find(activity=>activity.wordId===word.id)?.word;
  return snapshot?sameSnapshot(word,snapshot):(word.learningVersion??0)===0;
}
function savedTargets(data:WordLearningData,word:Word,now:Date):SavedWordTarget[]{
  return wordLearningSessions(data).filter(session=>sessionCovers(session,word,now)&&!session.completedAt&&!session.suspendedAt).flatMap(session=>{
    const completedSteps=session.completedSteps?.[word.id]??[],task=session.tasks?.find(task=>task.wordId===word.id),current=currentActivity(session);
    if(session.completedWordIds.includes(word.id)||task?.steps.every(step=>completedSteps.includes(step)))return [];
    if(!completedSteps.length&&current?.wordId!==word.id)return [];
    const active=current?.wordId===word.id?current:undefined,draft=session.pauseState?.activityId===active?.id?session.pauseState?.draft:undefined;
    const hasReadyRecording=!!active&&(data.practiceRecordings??[]).some(take=>take.sessionId===session.id&&take.activityId===active.id&&take.status==='ready'&&sameSnapshot(word,take.word));
    return [{sessionId:session.id,activityId:active?.id,step:active?.step??task?.steps.find(step=>!completedSteps.includes(step)),entry:session.entrySource?.entry,completedSteps:[...completedSteps],hasSavedPosition:!!session.pauseState,hasDraft:!!(draft?.selectedId||draft?.spelling?.length),hasReadyRecording,current:session.id===currentLearningSessionId(data),updatedAt:session.lastResumedAt??session.startedAt}];
  }).sort((a,b)=>Number(b.current)-Number(a.current)||Number(b.hasSavedPosition)-Number(a.hasSavedPosition)||b.updatedAt.localeCompare(a.updatedAt)||a.sessionId.localeCompare(b.sessionId));
}
function objectiveJudgment(attempt:LearningAttempt):EvidenceReference|undefined{
  if(!['recognize','listen','spell'].includes(attempt.skill)||attempt.oralStatus||attempt.responseStatus||attempt.sessionPracticeOnly)return;
  if(attempt.hinted)return {kind:'learning',id:attempt.id,sessionId:attempt.sessionId,at:attempt.createdAt,result:'hinted'};
  if(attempt.practiceOnly)return;
  return {kind:'learning',id:attempt.id,sessionId:attempt.sessionId,at:attempt.createdAt,result:attempt.correct?'correct':'incorrect'};
}
function abilityProfile(data:WordLearningData,word:Word,ability:WordAbility,now:Date):AbilityProfile{
  const dimension=abilityDimension(ability),skill=abilitySkill[ability];
  const learning=(data.attempts??[]).filter(attempt=>attempt.skill===skill&&currentWordAttempt(word,attempt)&&validAt(attempt.createdAt,now)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const formal=dimension?currentAssessmentAttempts(data,word,now).filter(attempt=>attempt.dimension===dimension):[];
  const formalEvidence=dimension?formalDimensionEvidence(data,word,dimension,now):undefined,lastFormal=formalEvidence?.last;
  const practiceJudgments=learning.map(objectiveJudgment).filter((item):item is EvidenceReference=>!!item);
  const references=[...practiceJudgments,...formal.filter(attempt=>judged(attempt.result)).map(attempt=>({kind:'assessment' as const,id:attempt.id,sessionId:attempt.sessionId,at:attempt.createdAt,result:attempt.result as EvidenceReference['result']}))]
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||Number(a.kind==='assessment')-Number(b.kind==='assessment'));
  const judgment=references.at(-1),verified=lastFormal?.result==='correct';
  const judgedHistory=dimension?formal.filter(attempt=>judged(attempt.result)).map(attempt=>({at:attempt.createdAt,result:attempt.result})):practiceJudgments;
  const afterFailure=judgedHistory.slice(judgedHistory.findLastIndex(attempt=>attempt.result==='incorrect'||attempt.result==='hinted')+1);
  const passedDays=new Set(afterFailure.filter(attempt=>attempt.result==='correct').map(attempt=>assessmentDay(new Date(attempt.at))));
  const pendingReview=!!dimension&&(data.assessments??[]).some(session=>session.workflow==='recorded'&&validAt(session.startedAt,now)&&validAt(session.submittedAt,now)&&session.items.some(item=>sameSnapshot(word,item.word)&&item.dimension===dimension&&item.response?.kind==='recording'&&item.response.recording?.status==='ready'&&validAt(item.response.answeredAt,now)&&(!lastFormal||Date.parse(item.response.answeredAt)>=Date.parse(lastFormal.createdAt))&&!item.result));
  const observation=learning.at(-1),unknownFormal=formal.filter(attempt=>!judged(attempt.result)).at(-1);
  const latestObservation=unknownFormal&&(!observation||Date.parse(unknownFormal.createdAt)>=Date.parse(observation.createdAt))?unknownFormal.result as 'skipped'|'unavailable'|'unconfirmed':observation?.responseStatus??observation?.oralStatus;
  const formalProgress=lastFormal&&dimension?(data.assessmentProgress??[]).find(row=>row.wordId===word.id&&row.learningVersion===(word.learningVersion??0)&&row.dimension===dimension):undefined;
  const skillProgress=practiceJudgments.length&&skill?(data.progress??[]).find(row=>row.wordId===word.id&&row.skill===skill):undefined;
  const due=[formalProgress?.dueAt,skillProgress?.dueAt].filter((value):value is string=>!!value&&Number.isFinite(Date.parse(value)));
  let state:AbilityState=learning.length?'practised':pendingReview?'awaiting-review':'unassessed';
  if(judgment)state=judgment.result==='incorrect'?'incorrect':judgment.result==='hinted'?'assisted':judgment.kind==='assessment'?passedDays.size>=2?'stable':'passed':'independent-practice';
  const practices=dimension?(data.assessmentPractices??[]).filter(row=>row.wordId===word.id&&row.learningVersion===(word.learningVersion??0)&&row.dimension===dimension&&validAt(row.createdAt,now)):[];
  return {ability,state,judgment,verified,independentDays:formalEvidence?.independentDays??passedDays.size,practiceCount:learning.length+practices.length,recordedCount:learning.filter(attempt=>attempt.oralStatus==='recorded').length+practices.filter(row=>row.oralStatus==='recorded').length,pendingReview,latestObservation,nextDueAt:due.length?new Date(Math.min(...due.map(Date.parse))).toISOString():undefined};
}

export function wordLearningProfile(data:WordLearningData,word:Word,now=new Date()):WordLearningProfile{
  if(!Number.isFinite(now.getTime()))throw new Error('需要有效的档案计算时间。');
  const encounters=learningEncounters(data).filter(entry=>entry.wordId===word.id&&validAt(entry.introducedAt,now));
  const abilities=Object.fromEntries(wordAbilities.map(ability=>[ability,abilityProfile(data,word,ability,now)])) as Record<WordAbility,AbilityProfile>;
  const required=assessmentDimensions.map(dimension=>abilities[dimensionAbility[dimension]]),missing=assessmentDimensions.filter(dimension=>!abilities[dimensionAbility[dimension]].verified);
  const formal={passed:missing.length===0,stable:missing.length===0&&required.every(item=>item.independentDays>=2),missing};
  const targets=savedTargets(data,word,now),encountered=!!encounters.length||required.some(item=>item.judgment?.kind==='assessment');
  const initialLearningComplete=wordLearningSessions(data).some(session=>sessionCovers(session,word,now)&&session.completedWordIds.includes(word.id)&&(!session.tasks||session.tasks.some(task=>task.wordId===word.id&&task.mode==='new')));
  const weak=wordAbilities.filter(ability=>['incorrect','assisted'].includes(abilities[ability].state));
  const due=wordAbilities.filter(ability=>abilities[ability].nextDueAt&&Date.parse(abilities[ability].nextDueAt!)<=now.getTime());
  const pack=data.packs.find(pack=>pack.id===word.packId);
  const unavailableReason=!pack?.enabled||pack.isSample||pack.deletedAt||word.deletedAt?'pack-unavailable':word.assetStatus!=='approved'||word.imageUrl==='/assets/placeholder.svg'?'image-unapproved':data.learningReadyWordIds&&!data.learningReadyWordIds.includes(word.id)?'audio-unready':undefined;
  const usage=sentenceLesson(word)?validAt(studiedSentence(data,word)?.completedAt,now)?'taught':'needs-teaching':'not-required';
  const requiredTargets=targets.filter(target=>!wordLearningSessions(data).some(session=>session.id===target.sessionId&&explicitStudySession(session))||target.current&&(target.hasDraft||target.hasReadyRecording||!encountered));
  const status:WordLearningStatus=weak.length?'needs-practice':formal.passed?formal.stable?'stable':'passed':!encountered&&!requiredTargets.length?'unseen':requiredTargets.length&&!initialLearningComplete?'learning':'awaiting-check';
  let action:WordNextAction='none',nextAbilities:WordAbility[]=[],reason='当前没有到期目标，保留已有学习记录。';
  if(unavailableReason){action='prepare-content';reason='保留原档案，等待家长补齐或启用原内容。';}
  else if(targets.some(target=>target.current&&(target.hasReadyRecording||target.hasDraft))){action='continue';reason='当前题目仍有已保存的录音或草稿，先原位处理再进入新计划。';}
  else if(status==='learning'&&targets.some(target=>target.current)){action='continue';reason='当前义项已有正在执行的现场，继续未完成目标。';}
  else if(status==='unseen'||!encountered){action='learn';reason='当前义项还没有合法学习记录，先认识词义、原图和发音。';}
  else if(weak.length){
    nextAbilities=weak.filter(ability=>!abilities[ability].pendingReview);
    if(!nextAbilities.length){action='wait-review';reason='薄弱方向的新回答正在等待核验，先保留原回答。';}
    else if(usage==='needs-teaching'&&nextAbilities.includes('recall')){action='learn-usage';reason='薄弱方向涉及尚未学过的情境，先补齐教学覆盖。';}
    else{
      const unpractised=nextAbilities.filter(ability=>{const dimension=abilityDimension(ability),last=abilities[ability].judgment;return !dimension||!last||!(data.assessmentPractices??[]).some(row=>row.wordId===word.id&&row.learningVersion===(word.learningVersion??0)&&row.dimension===dimension&&row.oralStatus!=='skipped'&&validAt(row.createdAt,now)&&Date.parse(row.createdAt)>Date.parse(last.at));});
      action=unpractised.length?'practice':'check';if(unpractised.length)nextAbilities=unpractised;
      reason=action==='practice'?'最新有效回答显示这些能力仍需帮助，只安排相应目标。':'这些薄弱方向已经补练，接下来检查而不推断已经学会。';
    }
  }
  else if(!formal.passed){
    nextAbilities=missing.map(dimension=>dimensionAbility[dimension]).filter(ability=>!abilities[ability].pendingReview);
    if(!nextAbilities.length){action='wait-review';reason='所缺方向已有录音待核验，先保留原回答。';}
    else if(usage==='needs-teaching'&&nextAbilities.includes('recall')){action='learn-usage';reason='相应情境用法尚未学过，先补学再检查。';}
    else{action='check';reason='词义已有学习记录，检查尚缺有效结论的方向。';}
  }else if(due.length){action=usage==='needs-teaching'&&due.includes('recall')?'learn-usage':'review';nextAbilities=due;reason=action==='learn-usage'?'到期目标涉及尚未学过的情境，先补学。':'只复习当前已到期的能力，其他通过记录保留。';}
  return {version:WORD_LEARNING_VERSION,wordId:word.id,learningVersion:word.learningVersion??0,packId:word.packId,term:word.term,meaning:word.meaning,imageUrl:word.imageUrl,status,encountered,firstEncounterAt:encounters[0]?.introducedAt,initialLearningComplete,available:!unavailableReason,unavailableReason,coverage:{meaningSeen:encountered,usage},abilities,formal,savedTargets:targets,next:{action,abilities:nextAbilities,reason}};
}

export function wordLearningProfiles(data:WordLearningData,now=new Date()){
  return data.words.map(word=>wordLearningProfile(data,word,now));
}
