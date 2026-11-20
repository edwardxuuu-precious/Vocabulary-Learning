import type {LearningEntry,LearningStep} from './contracts.ts';
import {assessmentChoices,assessmentDay,assessmentPicturePool,assessmentWords,maxAssessmentWords,practiceStep} from './assessment.ts';
import {assessmentCue} from './assessment-cues.ts';
import {todayLearningChoice} from './daily-learning-choice.ts';
import {newWordSteps,SECONDS_PER_LEARNING_TASK,type LearningData} from './learning.ts';
import {latestNewWordGroup,type NewWordGroup} from './learning-progression.ts';
import {routineReviewCompletions,reviewGoal,type ReviewCompletion} from './review-history.ts';
import {abilityDimension,wordAbilities,wordLearningProfiles,wordLearningSessions,explicitStudySession,type EvidenceReference,type SavedWordTarget,type WordAbility,type WordLearningProfile} from './word-learning.ts';

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
  learningGroup?:NewWordGroup;
  waitingReviewWordIds:string[];unavailableWordIds:string[];deferred:{wordId:string;reason:'new-limit'|'review-limit'|'task-budget'|'scope-changed'|'reviewed-today'|'mastery-required'}[];
  preservedSessionIds:string[];coveredLegacyTargets:{wordId:string;sessionId:string;reason:string}[];
}
const priority:Record<StudyGoalKind,number>={continue:0,'teach-usage':1,consolidate:2,review:3,check:4,introduce:5};
const goalStep=(ability:WordAbility):LearningStep=>{const dimension=abilityDimension(ability);return dimension?practiceStep(dimension):ability==='spell'?'spell':'listen';};
function studyGoal(profile:WordLearningProfile,kind:StudyGoalKind,steps:LearningStep[],ability?:WordAbility,estimatedUnits=steps.length,reason=profile.next.reason):StudyAgendaGoal{
  const judgment=ability&&profile.abilities[ability].judgment;
  return {id:`${profile.wordId}@${profile.learningVersion}:${kind}:${ability??'word'}`,wordId:profile.wordId,learningVersion:profile.learningVersion,kind,ability,steps,estimatedUnits,reason,evidence:judgment?[judgment]:[]};
}

function goalsFor(profile:WordLearningProfile,data:LearningData,purpose:AgendaPurpose):StudyAgendaGoal[]{
  const make=(kind:StudyGoalKind,steps:LearningStep[],ability?:WordAbility,estimatedUnits=steps.length)=>studyGoal(profile,kind,steps,ability,estimatedUnits);
  if(data.learningTaskPolicy===1&&purpose==='learn')return !profile.encountered?[make('introduce',newWordSteps(data.words.find(word=>word.id===profile.wordId)!,data.settings.spellingEnabled))]:profile.next.action==='learn-usage'?[make('teach-usage',[],undefined,3)]:[];
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

function reviewedToday(goal:StudyAgendaGoal,completions:ReviewCompletion[]){
  if(goal.kind==='check'||!goal.ability)return false;
  return completions.some(row=>row.wordId===goal.wordId&&reviewGoal(row.step)===reviewGoal(goal.steps[0])
    &&!goal.evidence.some(evidence=>Date.parse(evidence.at)>Date.parse(row.completedAt)));
}

function groupGoals(data:LearningData,group:NewWordGroup,profiles:WordLearningProfile[],completions:ReviewCompletion[]):StudyAgendaGoal[]{
  const byId=new Map(profiles.map(profile=>[profile.wordId,profile]));
  const remaining=group.wordIds.flatMap(id=>{const profile=byId.get(id);return profile&&!profile.formal.passed?[profile]:[];});
  const eligible=remaining.filter(profile=>profile.available);
  const teaching=eligible.filter(profile=>profile.formal.missing.includes('zh-en')&&profile.coverage.usage==='needs-teaching'&&!profile.abilities.recall.pendingReview);
  if(teaching.length)return teaching.map(profile=>studyGoal(profile,'teach-usage',[],undefined,3,'先学会本组短句的用法。'));
  if(group.resumeAssessmentId)return [];

  const pictures=assessmentPicturePool(data),testWords=assessmentWords(data);
  const tests:StudyAgendaGoal[]=[];
  const practice:StudyAgendaGoal[]=[];
  if(eligible.length!==remaining.length)group.blockedReason='materials';
  for(const profile of eligible){
    const word=testWords.find(word=>word.id===profile.wordId);
    if(!word)continue;
    for(const ability of wordAbilities){
      const dimension=abilityDimension(ability);
      if(!dimension||!profile.formal.missing.includes(dimension)||profile.abilities[ability].pendingReview)continue;
      if(dimension==='look'&&!assessmentChoices(word,pictures).length){group.blockedReason??='pictures';continue;}
      if(dimension==='zh-en'&&assessmentCue(word,testWords).kind==='needs-context'){group.blockedReason??='context';continue;}
      tests.push(studyGoal(profile,'check',[goalStep(ability)],ability,1,'检查本组尚未独立通过的方向。'));
    }
    if(profile.next.action==='practice'){
      const weak=profile.next.abilities.filter(ability=>ability!=='spell'||data.settings.spellingEnabled)
        .map(ability=>studyGoal(profile,'consolidate',[goalStep(ability)],ability))
        .find(goal=>!reviewedToday(goal,completions)&&(!abilityDimension(goal.ability!)||tests.some(test=>test.wordId===goal.wordId&&test.ability===goal.ability)));
      if(weak)practice.push(weak);
    }
  }
  if(practice.length)return practice.slice(0,Math.min(4,Math.max(1,data.settings.dailyReviewWords)));
  const ids=new Set([...new Set(tests.map(goal=>goal.wordId))].slice(0,maxAssessmentWords));
  return tests.filter(goal=>ids.has(goal.wordId));
}

function interleavedGoals(data:LearningData,profiles:WordLearningProfile[],history:ReviewCompletion[],completions:ReviewCompletion[],now:Date,limit:number):StudyAgendaGoal[]{
  const lastReview=new Map<string,number>();
  for(const row of history)lastReview.set(row.wordId,Math.max(lastReview.get(row.wordId)??0,Date.parse(row.completedAt)));
  const candidates=profiles.filter(profile=>profile.available&&profile.encountered).flatMap(profile=>{
    const targets=wordAbilities.flatMap(ability=>{
      const row=profile.abilities[ability];
      if(row.pendingReview||ability==='spell'&&!data.settings.spellingEnabled||ability==='recall'&&profile.coverage.usage==='needs-teaching')return [];
      const weak=profile.next.action==='practice'&&profile.next.abilities.includes(ability);
      const due=Date.parse(row.nextDueAt??'');
      if(!weak&&!(due<=now.getTime()))return [];
      const goal=studyGoal(profile,'consolidate',[goalStep(ability)],ability,1,weak?'穿插复习仍需巩固的方向。':'穿插复习已到期的方向。');
      return reviewedToday(goal,completions)?[]:[{goal,weak,date:weak?Date.parse(row.judgment!.at):due}];
    });
    return targets;
  }).sort((a,b)=>Number(b.weak)-Number(a.weak)
    ||(lastReview.get(a.goal.wordId)??0)-(lastReview.get(b.goal.wordId)??0)||a.date-b.date||a.goal.id.localeCompare(b.goal.id));
  const selected=new Map<string,StudyAgendaGoal>();
  for(const {goal} of candidates){
    if(selected.size>=limit)break;
    if(!selected.has(goal.wordId))selected.set(goal.wordId,goal);
  }
  return [...selected.values()];
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
  const learningGroup=data.learningTaskPolicy===1&&purpose!=='review'?latestNewWordGroup(data,now,profiles):undefined;
  const locked=!!learningGroup&&learningGroup.mastered<learningGroup.wordIds.length;
  const groupPlan=locked&&purpose==='learn';
  const reviewHistory=routineReviewCompletions(data,now);
  const completions=reviewHistory.filter(row=>assessmentDay(new Date(row.completedAt))===day);
  const candidates=groupPlan?groupGoals(data,learningGroup,profiles,completions):profiles.filter(profile=>profile.available).flatMap(profile=>{
    const goals=goalsFor(profile,data,purpose);return goals.filter(goal=>{
      const fresh=goal.kind==='introduce';
      if(goal.kind==='continue'&&purpose!=='today'&&goal.savedTarget?.entry!==purpose)return false;
      return !(purpose==='learn'&&!fresh&&!['continue','teach-usage'].includes(goal.kind)||purpose==='review'&&fresh)&&(!fresh||!focus||focus.includes(profile.wordId));
    });
  }).sort((a,b)=>priority[a.kind]-priority[b.kind]||Number(!!b.savedTarget?.current)-Number(!!a.savedTarget?.current)
    ||(a.kind==='introduce'&&focus?focus.indexOf(a.wordId)-focus.indexOf(b.wordId):0)
    ||(order.get(a.wordId)??0)-(order.get(b.wordId)??0)||a.id.localeCompare(b.id));
  const goals:StudyAgendaGoal[]=[],deferred:StudyAgenda['deferred']=[],seen=new Set<string>(),newWords=new Set<string>(),reviewWords=new Set<string>(),continuedWords=new Set<string>();let used=0;
  for(const goal of candidates){
    const key=`${goal.wordId}:${goal.ability??goal.kind}`;if(seen.has(key))continue;seen.add(key);
    const fresh=goal.kind==='introduce';
    if(reviewedToday(goal,completions)){deferred.push({wordId:goal.wordId,reason:'reviewed-today'});continue;}
    if(fresh&&locked){deferred.push({wordId:goal.wordId,reason:'mastery-required'});continue;}
    if(fresh&&scopeChanged){deferred.push({wordId:goal.wordId,reason:'scope-changed'});continue;}
    if(fresh&&!newWords.has(goal.wordId)&&newWords.size>=newLimit){deferred.push({wordId:goal.wordId,reason:'new-limit'});continue;}
    if(!groupPlan&&!fresh&&goal.kind!=='continue'&&!reviewWords.has(goal.wordId)&&reviewWords.size>=reviewLimit){deferred.push({wordId:goal.wordId,reason:'review-limit'});continue;}
    const fullGroup=maxUnits===undefined&&data.learningTaskPolicy===1&&(fresh||groupPlan&&goal.kind==='check');
    if(used+goal.estimatedUnits>budget&&!fullGroup){deferred.push({wordId:goal.wordId,reason:'task-budget'});continue;}
    goals.push(goal);used+=goal.estimatedUnits;if(fresh)newWords.add(goal.wordId);else if(goal.kind==='continue')continuedWords.add(goal.wordId);else reviewWords.add(goal.wordId);
  }
  if(data.learningTaskPolicy===1&&purpose==='learn'&&newWords.size){
    const limit=Math.min(2,Math.ceil(newWords.size/2),Math.max(0,reviewLimit-reviewWords.size),maxUnits===undefined?Infinity:Math.max(0,budget-used));
    if(limit>0)for(const goal of interleavedGoals(data,profiles,reviewHistory,completions,now,limit)){
      goals.push(goal);reviewWords.add(goal.wordId);used+=goal.estimatedUnits;
    }
  }
  const sessions=wordLearningSessions(data);
  const coveredLegacyTargets=profiles.filter(profile=>profile.formal.passed&&profile.next.action==='none').flatMap(profile=>profile.savedTargets.filter(target=>!sessions.some(session=>session.id===target.sessionId&&explicitStudySession(session))).map(target=>({wordId:profile.wordId,sessionId:target.sessionId,reason:'最新合法证据已覆盖这些未完成旧目标；原现场与完成记录保留，不伪造答对。'})));
  return {version:STUDY_AGENDA_VERSION,mode:'shadow',day,purpose,goals,estimatedUnits:used,estimatedMinutes:Math.ceil(used*SECONDS_PER_LEARNING_TASK/60),newWordCount:newWords.size,reviewWordCount:reviewWords.size,continuationWordCount:continuedWords.size,learningGroup,waitingReviewWordIds:profiles.filter(profile=>profile.available&&Object.values(profile.abilities).some(ability=>ability.pendingReview)).map(profile=>profile.wordId),unavailableWordIds:profiles.filter(profile=>!profile.available).map(profile=>profile.wordId),deferred,preservedSessionIds:sessions.map(session=>session.id),coveredLegacyTargets};
}
