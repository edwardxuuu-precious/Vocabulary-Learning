import type {LearningSession} from '../shared/contracts.ts';
import {currentActivity} from '../shared/game-plan.ts';
import {studyContinuity,studyTargetCovered} from '../shared/study-continuity.ts';
import {abilityDimension,wordLearningProfile} from '../shared/word-learning.ts';
import type {StoredData} from './store.ts';

/** Add a separate coverage ledger; preserve every original activity, attempt, completion and recording. */
export function reconcileStudySession(data:StoredData,session:LearningSession,now:Date){
  if(!session.activities)return;
  const mapping=studyContinuity(data,now).find(row=>row.sessionId===session.id);if(!mapping)return;
  const current=currentActivity(session),group=current?.groupId;
  const plan=session.studyPlan??={version:1,purpose:session.entrySource?.entry??'today',goalIds:[],covered:[]};
  for(const target of mapping.targets){
    if(target.state!=='covered'||target.activityId===current?.id||group&&session.activities?.find(row=>row.id===target.activityId)?.groupId===group||plan.covered.some(row=>row.activityId===target.activityId))continue;
    const activity=session.activities?.find(row=>row.id===target.activityId),word=data.words.find(row=>row.id===target.wordId);if(!activity||!word)continue;
    const profile=wordLearningProfile(data,word,now);
    const evidenceIds=activity.step==='learn'?[`encounter:${word.id}:${profile.learningVersion}:${profile.firstEncounterAt}`]:Object.values(profile.abilities).filter(row=>row.judgment?.result==='correct').map(row=>row.judgment!.id);
    plan.covered.push({activityId:activity.id,at:now.toISOString(),evidenceIds});
  }
}

export function validStudyMigration(data:StoredData,session:LearningSession){
  const plan=session.studyPlan;if(plan===undefined)return true;
  if(!plan||plan.version!==1||!['today','learn','review'].includes(plan.purpose)||Object.keys(plan).some(key=>!['version','purpose','goalIds','covered'].includes(key))||!Array.isArray(plan.goalIds)||plan.goalIds.length>100000||plan.goalIds.some(id=>typeof id!=='string'||id.length>240)||!Array.isArray(plan.covered)||plan.covered.length>(session.activities?.length??0)||new Set(plan.covered.map(row=>row.activityId)).size!==plan.covered.length)return false;
  return plan.covered.every(row=>{
    if(!row||Object.keys(row).some(key=>!['activityId','at','evidenceIds'].includes(key))||!Number.isFinite(Date.parse(row.at))||Date.parse(row.at)<Date.parse(session.startedAt)||!Array.isArray(row.evidenceIds)||row.evidenceIds.some(id=>typeof id!=='string'||id.length>240))return false;
    const activity=session.activities?.find(activity=>activity.id===row.activityId),word=activity&&data.words.find(word=>word.id===activity.wordId);if(!activity||!word)return false;
    const historical={...word,...activity.word,learningResetAt:undefined};
    const input={...data,words:data.words.map(item=>item.id===word.id?historical:item)};
    const profile=wordLearningProfile(input,historical,new Date(row.at));
    return studyTargetCovered(profile,activity.step)&&row.evidenceIds.every(id=>id===`encounter:${word.id}:${profile.learningVersion}:${profile.firstEncounterAt}`||Object.values(profile.abilities).some(ability=>ability.judgment?.id===id&&ability.judgment.result==='correct'));
  });
}
