import { currentActivity } from '../shared/game-plan.ts';
import { finishGoalFixture } from './helpers/goal-steps.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import { dailyLearningPlan, wordLearningOverview } from '../shared/learning.ts';
import type { IntegrationStatus, LearningSession, LearningStep } from '../shared/contracts.ts';

const services:IntegrationStatus={speech:{configured:false,available:false,status:'unconfigured',detail:'test'},codex:{configured:false,available:false,status:'unconfigured',detail:'test'}};
function fixture(initial='2026-10-15T02:00:00Z'){
  const directory=mkdtempSync(join(tmpdir(),'word-adaptive-'));let clock=new Date(initial);
  const store=new Store(directory,()=>clock);
  store.enablePack('starter',true); // Explicit sample opt-in for scheduling fixtures.
  return{store,directory,at:(time:string)=>{clock=new Date(time);},now:()=>clock,close:()=>{store.close();if(directory.startsWith(join(tmpdir(),'word-adaptive-')))rmSync(directory,{recursive:true,force:true});}};
}
const finishStep=(store:Store,wordId:string,step:LearningStep)=>{const saved=store.read().sessions.at(-1)!;if(saved.completedSteps?.[wordId]?.includes(step))return store.updateSession({completedStep:{wordId,step}});for(let a=currentActivity(saved);a&&a.wordId===wordId&&['recognize','read'].includes(a.step)&&a.step!==step;a=currentActivity(store.read().sessions.at(-1)!))finishGoalFixture(store,store.read().sessions.at(-1)!,a);return store.updateSession({completedStep:{wordId,step}});};
function evidence(store:Store,session:LearningSession,wordId:string,step:Exclude<LearningStep,'learn'>,extra={}){
  return store.attempt({sessionId:session.id,wordId,skill:step==='sound'?'listen':step,step,correct:true,hinted:false,source:'click',...extra});
}
function finishWord(store:Store,session:LearningSession,wordId:string){
  for(const step of session.tasks!.find(task=>task.wordId===wordId)!.steps){
    if((store.read().sessions.find(s=>s.id===session.id)?.completedSteps?.[wordId]??[]).includes(step))continue;
    if(step==='recognize'||step==='read'){const saved=store.read().sessions.find(s=>s.id===session.id)!;finishGoalFixture(store,saved,currentActivity(saved)!);continue;}
    if(step!=='learn')evidence(store,session,wordId,step,step==='recall'?{practiceOnly:true,correct:false}:{});
    finishStep(store,wordId,step);
  }
}

test('a new session freezes its plan and resumes the same exact next step across settings changes and process restart',()=>{
  const f=fixture();
  try{
    const plan=dailyLearningPlan(f.store.read(),f.now()),session=f.store.startSession(),wordId=session.wordIds[0];
    assert.deepEqual(session.tasks,plan.tasks);assert.deepEqual(session.wordIds,plan.tasks.map(task=>task.wordId));assert.equal(session.taskLimit,plan.taskLimit);assert.equal(session.estimatedMinutes,plan.estimatedMinutes);
    finishStep(f.store,wordId,'learn');evidence(f.store,session,wordId,'listen');finishStep(f.store,wordId,'listen');
    f.store.updateSettings({sessionMinutes:3,spellingEnabled:true,dailyNewWords:20});
    assert.deepEqual(f.store.startSession().tasks,session.tasks);
    const reopened=new Store(f.directory,()=>f.now());
    try{const resumed=reopened.startSession();assert.equal(resumed.id,session.id);assert.deepEqual(resumed.tasks,session.tasks);assert.deepEqual(resumed.completedSteps?.[wordId],['learn','recognize','listen']);assert.equal(resumed.taskLimit,session.taskLimit);assert.equal(resumed.estimatedMinutes,session.estimatedMinutes);}
    finally{reopened.close();}
  }finally{f.close();}
});

test('only the current planned word and next step can complete; sound needs distinct evidence and hinted/practice successes may finish without advancing',()=>{
  const f=fixture();
  try{
    const session=f.store.startSession(),[wordId,nextWord]=session.wordIds;
    assert.throws(()=>finishStep(f.store,nextWord,'learn'),/前一步/);
    assert.throws(()=>finishStep(f.store,wordId,'sound'),/前一步/);
    assert.throws(()=>f.store.updateSession({completedWordId:wordId}),/步骤/);
    finishStep(f.store,wordId,'learn');finishStep(f.store,wordId,'learn');
    assert.deepEqual(f.store.read().sessions[0].completedSteps?.[wordId],['learn']);
    evidence(f.store,session,wordId,'listen',{correct:false});assert.throws(()=>finishStep(f.store,wordId,'listen'),/完成这一题/);
    evidence(f.store,session,nextWord,'listen');assert.throws(()=>finishStep(f.store,wordId,'listen'),/完成这一题/);
    evidence(f.store,session,wordId,'listen',{hinted:true});finishStep(f.store,wordId,'listen');
    assert.equal(f.store.read().progress.find(p=>p.wordId===wordId&&p.skill==='listen')!.stage,0);
    assert.throws(()=>finishStep(f.store,wordId,'sound'),/完成这一题/);
    assert.throws(()=>evidence(f.store,session,wordId,'sound',{skill:'recall'}),/技能不匹配/);
    const progress=structuredClone(f.store.read().progress);
    evidence(f.store,session,wordId,'sound',{correct:false,practiceOnly:true});finishStep(f.store,wordId,'sound');
    evidence(f.store,session,wordId,'recall',{correct:false,practiceOnly:true});finishStep(f.store,wordId,'recall');
    assert.deepEqual(f.store.read().progress,progress);assert.deepEqual(f.store.read().sessions[0].completedWordIds,[wordId]);
    finishStep(f.store,wordId,'recall');assert.deepEqual(f.store.read().sessions[0].completedWordIds,[wordId]);
    assert.doesNotThrow(()=>finishStep(f.store,nextWord,'learn'));
    assert.throws(()=>f.store.updateSession({complete:true}),/完成今天/);
  }finally{f.close();}
});

test('practice-only attempts never create or alter scheduling rows and old practice history remains intact',()=>{
  const f=fixture();
  try{
    const session=f.store.startSession(),[first,second]=session.wordIds;
    f.store.mutate(data=>{data.progress.push({wordId:first,skill:'recall',stage:0,dueAt:'2026-10-15T00:00:00Z',successes:0,attempts:7});});
    const before=structuredClone(f.store.read().progress);
    evidence(f.store,session,first,'recall',{practiceOnly:true});evidence(f.store,session,second,'recall',{practiceOnly:true,correct:false});
    assert.deepEqual(f.store.read().progress,before);assert.equal(f.store.read().attempts.length,2);
    assert.ok(!dailyLearningPlan(f.store.read(),f.now()).fresh.some(word=>word.id===second),'participation is historical learning, not a new untouched word');
    f.at('2026-10-16T02:00:00Z');const plan=dailyLearningPlan(f.store.read(),f.now());
    assert.ok(plan.tasks.some(task=>task.wordId===second&&task.mode==='review'&&task.steps.includes('listen')));assert.deepEqual(f.store.read().progress,before);
  }finally{f.close();}
});

test('reconciliation removes unavailable tasks and step state together without replanning, erasing attempts, or awarding an empty session',()=>{
  const f=fixture();
  try{
    const session=f.store.startSession(),[first,second]=session.wordIds;
    finishWord(f.store,session,first);const recorded=f.store.read().attempts.length;
    f.store.updateWord(first,{assetStatus:'review'},()=>true);
    let current=f.store.startSession();assert.deepEqual(current.tasks,session.tasks!.slice(1));assert.deepEqual(current.wordIds,session.wordIds.slice(1));assert.ok(!Object.hasOwn(current.completedSteps!,first));assert.deepEqual(current.completedWordIds,[]);assert.equal(f.store.read().attempts.length,recorded);
    finishStep(f.store,second,'learn');f.store.enablePack('starter',false);current=f.store.read().sessions[0];
    assert.deepEqual(current.tasks,[]);assert.deepEqual(current.completedSteps,{});assert.deepEqual(current.wordIds,[]);assert.ok(current.completedAt);assert.equal(current.rewardGranted,false);assert.deepEqual(f.store.read().stickers,[]);
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('legacy sessions retain their word-completion contract and never receive a new plan on resume or restore',()=>{
  const f=fixture();
  try{
    const session=f.store.startSession();
    f.store.mutate(data=>{const old=data.sessions[0];delete old.goalVersion;delete old.activities;delete old.activityStates;delete old.gameSeed;delete old.tasks;delete old.completedSteps;delete old.taskLimit;delete old.estimatedMinutes;});
    f.store.updateSettings({sessionMinutes:3,spellingEnabled:true});assert.equal(f.store.startSession().tasks,undefined);
    f.store.updateSession({completedWordId:session.wordIds[0]});const backup=f.store.exportBackup();
    f.store.restoreBackup(backup);assert.equal(f.store.startSession().tasks,undefined);
    for(const wordId of session.wordIds)f.store.updateSession({completedWordId:wordId});
    f.store.updateSession({complete:true});f.store.updateSession({complete:true});assert.equal(f.store.read().stickers.length,1);
    assert.equal(f.store.read().sessions[0].tasks,undefined);
  }finally{f.close();}
});

test('editing a meaning preserves raw history but reopens the approved word as a full new task, even in the same millisecond',()=>{
  const f=fixture();
  try{
    f.store.updateSettings({dailyNewWords:1});const oldSession=f.store.startSession(),wordId=oldSession.wordIds[0];
    const old=evidence(f.store,oldSession,wordId,'listen');assert.equal(old.learningVersion,0);
    f.store.updateWord(wordId,{meaning:'青苹果'},()=>true);
    const changed=f.store.read().words.find(word=>word.id===wordId)!;
    assert.equal(changed.learningResetAt,f.now().toISOString());assert.equal(changed.learningVersion,1);assert.equal(changed.assetStatus,'draft');assert.equal(f.store.read().progress.length,0);assert.equal(f.store.read().attempts.length,1);
    f.store.updateWord(wordId,{assetStatus:'approved'},()=>true);
    const plan=dailyLearningPlan(f.store.read(),f.now());assert.equal(plan.tasks[0].wordId,wordId);assert.equal(plan.tasks[0].mode,'new');assert.deepEqual(plan.tasks[0].steps,['learn','recognize','listen','sound','read','recall']);
    const newSession=f.store.startSession();assert.notEqual(newSession.id,oldSession.id);
    const current=evidence(f.store,newSession,wordId,'listen');assert.equal(current.learningVersion,1);assert.equal(current.createdAt,old.createdAt);assert.equal(f.store.read().progress[0].stage,1,'a previous meaning cannot consume the new meaning’s one advancement today');
    assert.equal(wordLearningOverview(f.store.state(services),f.now()).find(row=>row.word.id===wordId)!.listen.independent,1);
    assert.equal(f.store.read().attempts.length,2);
    const backup=f.store.exportBackup();f.store.restoreBackup(backup);assert.equal(f.store.read().words.find(word=>word.id===wordId)!.learningVersion,1);assert.equal(f.store.read().attempts[1].learningVersion,1);assert.equal(f.store.read().attempts.length,2);
    for(const mutate of [(copy:any)=>{copy.data.words[0].learningResetAt='invalid';},(copy:any)=>{copy.data.words[0].learningVersion=-1;},(copy:any)=>{copy.data.attempts[0].learningVersion=1.5;}]){const copy=structuredClone(backup);mutate(copy);assert.throws(()=>validateBackup(copy),/备份/);}
  }finally{f.close();}
});

test('completion after Shanghai midnight counts as the new day for both planned and legacy sessions',()=>{
  for(const legacy of [false,true]){
    const f=fixture('2026-10-15T15:59:30Z');
    try{
      f.store.updateSettings({dailyNewWords:1});const session=f.store.startSession();
      if(legacy)f.store.mutate(data=>{const old=data.sessions[0];delete old.goalVersion;delete old.activities;delete old.activityStates;delete old.gameSeed;delete old.tasks;delete old.completedSteps;delete old.taskLimit;delete old.estimatedMinutes;});
      f.at('2026-10-15T16:00:30Z');
      if(legacy)f.store.updateSession({completedWordId:session.wordIds[0]});else finishWord(f.store,session,session.wordIds[0]);
      f.store.updateSession({complete:true});
      assert.equal(f.store.state(services).activeSession,null);assert.equal(f.store.state(services).lastCompletedSession!.id,session.id);assert.equal(f.store.read().stickers.length,1);
      f.at('2026-10-16T16:00:30Z');assert.notEqual(f.store.startSession().id,session.id);
    }finally{f.close();}
  }
});

test('backup round-trip preserves plan and partial completion, rejects malformed order or missing evidence, and strips unknown nested fields',()=>{
  const f=fixture();
  try{
    const session=f.store.startSession(),wordId=session.wordIds[0];finishStep(f.store,wordId,'learn');evidence(f.store,session,wordId,'listen');finishStep(f.store,wordId,'listen');
    const backup=f.store.exportBackup();f.store.restoreBackup(backup);
    assert.deepEqual(f.store.startSession(),backup.data.sessions[0]);assert.equal(f.store.read().attempts[0].step,'listen');
    const mutations:Array<(copy:any)=>void>=[
      copy=>{copy.data.sessions[0].tasks[1].wordId=wordId;},
      copy=>{copy.data.sessions[0].tasks[0].steps=['learn','learn'];},
      copy=>{copy.data.sessions[0].tasks[0].mode='invented';},
      copy=>{copy.data.sessions[0].completedSteps[wordId]=['listen'];},
      copy=>{copy.data.sessions[0].completedSteps[session.wordIds[1]]=['learn'];},
      copy=>{copy.data.sessions[0].completedWordIds=[wordId];},
      copy=>{copy.data.sessions[0].completedSteps['foreign-word']=['learn'];},
      copy=>{copy.data.sessions[0].taskLimit=1;},
      copy=>{copy.data.sessions[0].estimatedMinutes=-1;},
      copy=>{delete copy.data.attempts[0].step;},
      copy=>{copy.data.attempts[0].step='recall';},
    ];
    for(const mutate of mutations){const copy=structuredClone(backup);mutate(copy);assert.throws(()=>validateBackup(copy),/备份/);}
    const extra=structuredClone(backup) as any;extra.data.sessions[0].tasks[0].secret='not-restorable';
    assert.ok(!JSON.stringify(validateBackup(extra)).includes('not-restorable'));
  }finally{f.close();}
});
