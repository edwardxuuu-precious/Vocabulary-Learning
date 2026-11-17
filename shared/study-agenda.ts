import type {LearningEntry,LearningStep} from './contracts.ts';
import {assessmentDay,practiceStep} from './assessment.ts';
import {todayLearningChoice} from './daily-learning-choice.ts';
import {newWordSteps,SECONDS_PER_LEARNING_TASK,type LearningData} from './learning.ts';
import {routineReviewCompletions,reviewGoal} from './review-history.ts';
import {abilityDimension,wordLearningProfiles,wordLearningSessions,explicitStudySession,type EvidenceReference,type SavedWordTarget,type WordAbility,type WordLearningProfile} from './word-learning.ts';

export const STUDY_AGENDA_VERSION='study-agenda-v1' as const;
export type AgendaPurpose=LearningEntry|'today';
export type StudyGoalKind='introduce'|'continue'|'teach-usage'|'check'|'consolidate'|'review';
export interface StudyAgendaGoal {
  id:string;wordId:string;learningVersion:number;kind:StudyGoalKind;ability?:WordAbility;steps:LearningStep[];
  estimatedUnits:number;reason:string;evidence:EvidenceReference[];savedTarget?:SavedWordTarget;
}
export interface StudyAgenda {
  version:typeof STUDY_AGENDA_VERSION;mode:'shadow'|'execution';day:string;purpose:AgendaPurpose;goals:StudyAgendaGoal[];
  estimatedUnits:number;estimatedMinutes:number;newWordCount:number;reviewWordCount:number;continuationWordCount:number;
  waitingReviewWordIds:string[];unavailableWordIds:string[];deferred:{wordId:string;reason:'new-limit'|'review-limit'|'task-budget'|'scope-changed'|'reviewed-today'}[];
  preservedSessionIds:string[];coveredLegacyTargets:{wordId:string;sessionId:string;reason:string}[];
}
const priority:Record<StudyGoalKind,number>={continue:0,'teach-usage':1,consolidate:2,review:3,check:4,introduce:5};
const goalStep=(ability:WordAbility):LearningStep=>{const dimension=abilityDimension(ability);return dimension?practiceStep(dimension):ability==='spell'?'spell':'listen';};
const refs=(profile:WordLearningProfile,ability?:WordAbility)=>ability?(profile.abilities[ability].judgment?[profile.abilities[ability].judgment!]:[]):[];

function goalsFor(profile:WordLearningProfile,data:LearningData,purpose:AgendaPurpose):StudyAgendaGoal[]{
  const make=(kind:StudyGoalKind,steps:LearningStep[],ability?:WordAbility,estimatedUnits=steps.length):StudyAgendaGoal=>({id:`${profile.wordId}@${profile.learningVersion}:${kind}:${ability??'word'}`,wordId:profile.wordId,learningVersion:profile.learningVersion,kind,ability,steps,estimatedUnits,reason:profile.next.reason,evidence:refs(profile,ability)});
  if(data.learningTaskPolicy===1&&purpose==='learn')return profile.encountered?[]:[make('introduce',newWordSteps(data.words.find(word=>word.id===profile.wordId)!,data.settings.spellingEnabled))];
  switch(profile.next.action){
    case 'learn':return [make('introduce',newWordSteps(data.words.find(word=>word.id===profile.wordId)!,data.settings.spellingEnabled))];
    case 'continue':{
      const target=profile.savedTargets.find(target=>purpose==='today'||target.entry===purpose);
      return target?[{...make('continue',target.step?[target.step]:[],undefined,1),savedTarget:target}]:[];
    }
    case 'learn-usage':return [make('teach-usage',[],undefined,3)];
    case 'check':case 'practice':case 'review':return profile.next.abilities.map(ability=>make(profile.next.action==='check'?'check':profile.next.action==='practice'?'consolidate':'review',[goalStep(ability)],ability));
    default:return [];
  }
}

/** Pure shadow planning: never completes or edits a legacy target and never calls a provider. */
export function buildStudyAgenda(data:LearningData,{now=new Date(),purpose='today',maxUnits}:{now?:Date;purpose?:AgendaPurpose;maxUnits?:number}={},suppliedProfiles?:WordLearningProfile[]):StudyAgenda{
  if(!Number.isFinite(now.getTime()))throw new Error('需要有效的计划时间。');
  if(!['learn','review','today'].includes(purpose))throw new Error('学习目的无效。');
  const budget=maxUnits??Math.max(1,Math.floor(data.settings.sessionMinutes*60/SECONDS_PER_LEARNING_TASK));
  if(!Number.isInteger(budget)||budget<0||budget>10000)throw new Error('任务预算需要是0至10000的整数。');
  const profiles=suppliedProfiles??wordLearningProfiles(data,now),day=assessmentDay(now),choice=todayLearningChoice(data,now);
  // The daily quantity expires; the explicitly chosen scope persists across days, matching the current entry contract.
  const focus=data.learningTaskPolicy===1?undefined:data.dailyLearningChoice?.wordIds??data.lessonPlan?.focusWordIds,versions=data.dailyLearningChoice?.wordIds?data.dailyLearningChoice.wordVersions:data.lessonPlan?.wordVersions;
  const scopeChanged=!!focus&&focus.some(id=>!data.words.some(word=>word.id===id&&(versions?.[id]===undefined||(word.learningVersion??0)===versions[id])));
  const samplePacks=new Set(data.packs.filter(pack=>pack.isSample).map(pack=>pack.id));
  const introducedToday=new Set(profiles.filter(profile=>!samplePacks.has(profile.packId)&&profile.firstEncounterAt&&assessmentDay(new Date(profile.firstEncounterAt))===day).map(profile=>profile.wordId));
  const newLimit=Math.max(0,(choice?.goal??data.settings.dailyNewWords)-introducedToday.size),reviewLimit=data.settings.dailyReviewWords;
  const order=new Map(data.words.map((word,index)=>[word.id,index]));
  const candidates=profiles.filter(profile=>profile.available).flatMap(profile=>{
    const goals=goalsFor(profile,data,purpose);return goals.filter(goal=>{
      const fresh=goal.kind==='introduce';
      if(goal.kind==='continue'&&purpose!=='today'&&goal.savedTarget?.entry!==purpose)return false;
      return !(purpose==='learn'&&!fresh&&goal.kind!=='continue'||purpose==='review'&&fresh)&&(!fresh||!focus||focus.includes(profile.wordId));
    });
  }).sort((a,b)=>priority[a.kind]-priority[b.kind]||Number(!!b.savedTarget?.current)-Number(!!a.savedTarget?.current)
    ||(a.kind==='introduce'&&focus?focus.indexOf(a.wordId)-focus.indexOf(b.wordId):0)
    ||(order.get(a.wordId)??0)-(order.get(b.wordId)??0)||a.id.localeCompare(b.id));
  const completions=routineReviewCompletions(data,now).filter(row=>assessmentDay(new Date(row.completedAt))===day);
  const goals:StudyAgendaGoal[]=[],deferred:StudyAgenda['deferred']=[],seen=new Set<string>(),newWords=new Set<string>(),reviewWords=new Set<string>(),continuedWords=new Set<string>();let used=0;
  for(const goal of candidates){
    const key=`${goal.wordId}:${goal.ability??goal.kind}`;if(seen.has(key))continue;seen.add(key);
    const fresh=goal.kind==='introduce';
    const last=goal.ability?completions.filter(row=>row.wordId===goal.wordId&&reviewGoal(row.step)===reviewGoal(goal.steps[0])).sort((a,b)=>a.completedAt.localeCompare(b.completedAt)).at(-1):undefined;
    if(goal.kind!=='check'&&last&&!goal.evidence.some(row=>Date.parse(row.at)>Date.parse(last.completedAt))){deferred.push({wordId:goal.wordId,reason:'reviewed-today'});continue;}
    if(fresh&&scopeChanged){deferred.push({wordId:goal.wordId,reason:'scope-changed'});continue;}
    if(fresh&&!newWords.has(goal.wordId)&&newWords.size>=newLimit){deferred.push({wordId:goal.wordId,reason:'new-limit'});continue;}
    if(!fresh&&goal.kind!=='continue'&&!reviewWords.has(goal.wordId)&&reviewWords.size>=reviewLimit){deferred.push({wordId:goal.wordId,reason:'review-limit'});continue;}
    if(used+goal.estimatedUnits>budget&&!(data.learningTaskPolicy===1&&fresh&&maxUnits===undefined)){deferred.push({wordId:goal.wordId,reason:'task-budget'});continue;}
    goals.push(goal);used+=goal.estimatedUnits;if(fresh)newWords.add(goal.wordId);else if(goal.kind==='continue')continuedWords.add(goal.wordId);else reviewWords.add(goal.wordId);
  }
  const sessions=wordLearningSessions(data);
  const coveredLegacyTargets=profiles.filter(profile=>profile.formal.passed&&profile.next.action==='none').flatMap(profile=>profile.savedTargets.filter(target=>!sessions.some(session=>session.id===target.sessionId&&explicitStudySession(session))).map(target=>({wordId:profile.wordId,sessionId:target.sessionId,reason:'最新合法证据已覆盖这些未完成旧目标；原现场与完成记录保留，不伪造答对。'})));
  return {version:STUDY_AGENDA_VERSION,mode:'shadow',day,purpose,goals,estimatedUnits:used,estimatedMinutes:Math.ceil(used*SECONDS_PER_LEARNING_TASK/60),newWordCount:newWords.size,reviewWordCount:reviewWords.size,continuationWordCount:continuedWords.size,waitingReviewWordIds:profiles.filter(profile=>profile.available&&Object.values(profile.abilities).some(ability=>ability.pendingReview)).map(profile=>profile.wordId),unavailableWordIds:profiles.filter(profile=>!profile.available).map(profile=>profile.wordId),deferred,preservedSessionIds:sessions.map(session=>session.id),coveredLegacyTargets};
}
