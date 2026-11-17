import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,validateBackup} from '../server/store.ts';
import {createApp} from '../server/index.ts';
import {createPracticeRecordings} from '../server/practice-recordings.ts';
import {currentActivity,gameWord} from '../shared/game-plan.ts';
import {pendingLearningCheckpoint} from '../shared/learning-policy.ts';
import {entryRecommendation} from '../shared/entry-recommendation.ts';
import {dailyLearningPlan,wordLearningOverview} from '../shared/learning.ts';
import {routineReviewCompletions,reviewGoal,nextReviewDay,validReviewCompletionTimes} from '../shared/review-history.ts';
import {roundFeedback} from '../shared/round-feedback.ts';
import type {AssessmentDimension,AssessmentResult,LearningSession,LearningStep} from '../shared/contracts.ts';
const offline={configured:false,available:false,status:'fixture',detail:'工程隔离，不调用云'};
const status={speech:offline,codex:offline};
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'review-continuity-'));let now=new Date('2026-10-25T04:00:00Z'),store=new Store(dir,()=>now);
  store.mutate(data=>{
    data.packs=[{id:'a',title:'隔离词书',enabled:true,createdAt:'2026-10-01T00:00:00Z'}];
    data.words=data.words.slice(0,3).map(word=>({...word,packId:'a'}));
    data.settings={...data.settings,learningStrategy:'memory-loop',dailyReviewWords:2,dailyNewWords:1,sessionMinutes:20,voiceEnabled:false};
    const ids=data.words.slice(0,2).map(word=>word.id);
    data.sessions=[{id:'prior',wordIds:ids,completedWordIds:ids,startedAt:'2026-10-20T00:00:00Z',completedAt:'2026-10-20T00:00:00Z',rewardGranted:false,exposures:ids.map(wordId=>({wordId,learningVersion:0,introducedAt:'2026-10-20T00:00:00Z'}))}];
  });
  return {dir,get store(){return store;},now:()=>now,at:(at:string)=>{now=new Date(at);},restart(){store.close();store=new Store(dir,()=>now);},close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
const saved=(store:Store,id:string)=>store.read().sessions.find(session=>session.id===id)!;
const start=(store:Store)=>store.startSession('random',{}, {entry:'review',strategy:'memory-loop'});
function skip(store:Store,id:string,unavailable=false){
  const session=saved(store,id),activity=currentActivity(session)!,planVersion=session.learningPolicy?.version??1;
  const checkpoint=pendingLearningCheckpoint(session);if(checkpoint){store.updateSession({sessionId:id,planVersion,checkpointId:checkpoint});return;}
  if(activity.step.startsWith('practice-')){store.assessmentPractice({sessionId:id,planVersion,wordId:activity.wordId,learningVersion:0,dimension:activity.step.slice(9),oralStatus:'skipped'});return;}
  if(activity.kind!=='standard'||['read','recognize'].includes(activity.step)){
    store.activityEvent({sessionId:id,planVersion,activityId:activity.id,action:'skip'});store.activityEvent({sessionId:id,planVersion,activityId:activity.id,action:'next'});return;
  }
  store.attempt({id:`${id}-${activity.id}`,sessionId:id,planVersion,wordId:activity.wordId,skill:activity.step==='sound'?'listen':activity.step,step:activity.step,source:'click',correct:false,hinted:false,practiceOnly:true,...(['listen','sound','spell'].includes(activity.step)?{responseStatus:unavailable?'unavailable':'skipped'}:{})});
  store.updateSession({sessionId:id,planVersion,completedStep:{wordId:activity.wordId,step:activity.step}});
}
function finish(store:Store,id:string){for(let guard=0;currentActivity(saved(store,id));guard++){assert.ok(guard<60);skip(store,id);}store.updateSession({sessionId:id,planVersion:saved(store,id).learningPolicy?.version??1,complete:true});}
function formal(store:Store,wordId:string,dimension:AssessmentDimension,result:AssessmentResult,createdAt:string,dueAt:string,id='formal'){
  store.mutate(data=>{const word=data.words.find(word=>word.id===wordId)!;
    data.assessments!.push({id,mode:'full',wordIds:[wordId],startedAt:createdAt,completedAt:createdAt,items:[{id,dimension,word:gameWord(word),choices:[],result}]});
    data.assessmentAttempts!.push({id,sessionId:id,itemId:id,wordId,learningVersion:0,dimension,result,source:dimension==='look'?'server':'parent',createdAt,confirmedAt:store.clock().toISOString()});
    data.assessmentProgress=data.assessmentProgress!.filter(row=>row.wordId!==wordId||row.dimension!==dimension);
    data.assessmentProgress.push({wordId,learningVersion:0,dimension,stage:result==='correct'?2:0,dueAt});
  });
}
const goals=(store:Store,now:Date)=>entryRecommendation(store.read(),'review',now).tasks.map(task=>({wordId:task.wordId,goals:task.steps.map(step=>reviewGoal(step))}));

test('R05 completed recommended goals stop routine same-day reminders, remain future practice, and never grant mastery',()=>{
  const f=fixture();try{const s=start(f.store),before=f.store.read();finish(f.store,s.id);
    const done=f.store.read(),plan=entryRecommendation(done,'review',f.now());assert.equal(plan.reason,'reviewed-today');assert.equal(plan.tasks.length,0);
    assert.equal(routineReviewCompletions(done,f.now()).length,8);assert.ok(routineReviewCompletions(done,f.now()).every(row=>row.outcome==='skipped'));
    assert.deepEqual(done.progress,before.progress);assert.deepEqual(done.assessmentProgress,before.assessmentProgress);
    assert.throws(()=>start(f.store),/下次|今天|目标/);assert.equal(f.store.read().sessions.length,2);
    const summary=wordLearningOverview(f.store.state(status),f.now()).filter(row=>s.wordIds.includes(row.word.id));assert.ok(summary.every(row=>!row.due&&row.nextDue!>f.now().getTime()));
    f.at('2026-10-25T16:00:01Z');assert.ok(entryRecommendation(f.store.read(),'review',f.now()).tasks.length);assert.equal(f.store.read().stickers.length,1);
  }finally{f.close();}
});
test('R05 ordinary recall and a late weak translation suggestion share a goal; untouched directions remain due',()=>{
  const f=fixture();try{const s=start(f.store),first=currentActivity(s)!;skip(f.store,s.id);
    formal(f.store,first.wordId,'zh-en','incorrect','2026-10-24T02:00:00Z','2026-10-24T02:00:00Z');
    const task=entryRecommendation(f.store.read(),'review',f.now()).tasks.find(task=>task.wordId===first.wordId)!;
    assert.ok(task.steps.length);assert.ok(!task.steps.some(step=>reviewGoal(step)==='recall'));assert.ok(task.steps.includes('read'));
    assert.equal(entryRecommendation(f.store.read(),'review',f.now()).resume?.id,s.id,'frozen current round is not rewritten');
    const target=f.store.state(status);assert.deepEqual(dailyLearningPlan(target,f.now(),'review').tasks,dailyLearningPlan(f.store.read(),f.now(),'review').tasks);
  }finally{f.close();}
});
test('R05 extra selected, book and game practice preserve all routine and formal dates, while each scope resumes independently',()=>{
  const f=fixture();try{const s=start(f.store);skip(f.store,s.id);const original=saved(f.store,s.id),ids=s.wordIds,before=goals(f.store,f.now());
    const selected=f.store.startSession(false,{}, {entry:'review',mode:'practice',wordIds:ids,strategy:'memory-loop'});
    const book=f.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'a',wordIds:ids,strategy:'memory-loop'});
    const game=f.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'a',wordIds:ids,game:'flip'});
    const progress=structuredClone(f.store.read().progress),formalProgress=structuredClone(f.store.read().assessmentProgress);
    finish(f.store,selected.id);finish(f.store,book.id);skip(f.store,game.id);
    assert.deepEqual(goals(f.store,f.now()),before);assert.deepEqual(f.store.read().progress,progress);assert.deepEqual(f.store.read().assessmentProgress,formalProgress);
    assert.equal(saved(f.store,selected.id).reviewCompletionTimes,undefined);assert.equal(saved(f.store,book.id).reviewCompletionTimes,undefined);
    f.store.startSession(false,{}, {entry:'review',mode:'resume',sessionId:s.id});assert.deepEqual(saved(f.store,s.id).activities,original.activities);assert.deepEqual(saved(f.store,s.id).completedSteps,original.completedSteps);
    f.restart();assert.equal(f.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'a',wordIds:ids,game:'flip'}).id,game.id);
    assert.deepEqual(goals(f.store,f.now()),before);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});
test('R05 completion stamps use the actual continuation day across Shanghai midnight, not first attempt or round end',()=>{
  const f=fixture();try{f.at('2026-10-25T15:59:59Z');const s=start(f.store),first=currentActivity(s)!;
    f.store.activityEvent({sessionId:s.id,planVersion:3,activityId:first.id,action:'skip'});assert.equal(routineReviewCompletions(f.store.read(),f.now()).length,0);
    f.at('2026-10-25T16:00:01Z');f.store.activityEvent({sessionId:s.id,planVersion:3,activityId:first.id,action:'next'});
    const fact=routineReviewCompletions(f.store.read(),f.now())[0];assert.equal(fact.completedAt,f.now().toISOString());assert.equal(nextReviewDay(fact.completedAt),Date.parse('2026-10-26T16:00:00Z'));
    f.store.activityEvent({sessionId:s.id,planVersion:3,activityId:first.id,action:'next'});assert.equal(routineReviewCompletions(f.store.read(),f.now()).length,1);
    const backup=f.store.exportBackup();f.store.restoreBackup(backup);f.restart();assert.equal(routineReviewCompletions(f.store.read(),f.now())[0].completedAt,fact.completedAt);
  }finally{f.close();}
});
test('R05 completed-round projection agrees with server after extra rounds hide the original from lastCompletedSession',()=>{
  const f=fixture();try{const s=start(f.store);finish(f.store,s.id);const ids=s.wordIds;
    const extra=f.store.startSession(false,{}, {entry:'review',mode:'practice',wordIds:ids,strategy:'memory-loop'});finish(f.store,extra.id);
    f.restart();const state=f.store.state(status);assert.equal(state.lastCompletedSession?.id,extra.id);assert.equal(state.reviewHistory?.length,8);
    assert.deepEqual(entryRecommendation(state,'review',f.now()).tasks,entryRecommendation(f.store.read(),'review',f.now()).tasks);assert.equal(entryRecommendation(state,'review',f.now()).reason,'reviewed-today');
    const backup=f.store.exportBackup();f.store.restoreBackup(backup);assert.deepEqual(f.store.state(status).reviewHistory,state.reviewHistory);
  }finally{f.close();}
});
test('R05 malformed completion stamps cannot enter backups or forge unseen/extra targets',()=>{
  const f=fixture();try{const s=start(f.store);skip(f.store,s.id);const good=f.store.exportBackup();assert.ok(validateBackup(good));
    for(const times of [{madeup:f.now().toISOString()},{[`${s.wordIds[0]}:recall`]:'not-a-date'},{[`${s.wordIds[0]}:read`]:f.now().toISOString()},{[`${s.wordIds[0]}:recall`]:'2020-01-01T00:00:00Z'}]){
      const backup=structuredClone(good) as any;backup.data.sessions.find((row:LearningSession)=>row.id===s.id).reviewCompletionTimes=times;assert.throws(()=>validateBackup(backup),/复习完成/);
    }
  }finally{f.close();}
});
test('R05 future/stale/reset/orphan/incomplete work cannot hide a current goal; legacy backups remain readable',()=>{
  const f=fixture();try{const s=start(f.store);skip(f.store,s.id);const data=f.store.read(),first=routineReviewCompletions(data,f.now())[0];
    for(const flaw of ['future','version','reset','orphan','unfinished'] as const){const changed=structuredClone(data);
      if(flaw==='future')changed.sessions.find(row=>row.id===s.id)!.reviewCompletionTimes![`${first.wordId}:${first.step}`]='2026-10-27T00:00:00Z';
      if(flaw==='version')changed.words.find(row=>row.id===first.wordId)!.learningVersion=1;
      if(flaw==='reset')changed.words.find(row=>row.id===first.wordId)!.learningResetAt='2026-10-25T05:00:00Z';
      if(flaw==='orphan')changed.attempts=[];
      if(flaw==='unfinished')changed.sessions.find(row=>row.id===s.id)!.completedSteps={};
      assert.equal(routineReviewCompletions(changed,f.now()).length,0,flaw);
    }
    const legacy=f.store.exportBackup();delete legacy.data.sessions.find(row=>row.id===s.id)!.reviewCompletionTimes;assert.ok(validateBackup(legacy));f.store.restoreBackup(legacy);assert.equal(routineReviewCompletions(f.store.read(),f.now()).length,1);
  }finally{f.close();}
});
test('R05 legacy scope reconciliation removes completion references only with the removed target and keeps original attempts',()=>{
  const f=fixture();try{const s=start(f.store);skip(f.store,s.id);const original=f.store.read().attempts;
    f.store.mutate(data=>{delete data.sessions.find(row=>row.id===s.id)!.entrySource;data.words.find(word=>word.id===s.wordIds[0])!.assetStatus='draft';});
    const after=saved(f.store,s.id);assert.ok(!Object.keys(after.reviewCompletionTimes??{}).some(id=>id.startsWith(s.wordIds[0]+':')));assert.ok(validReviewCompletionTimes(after));assert.deepEqual(f.store.read().attempts,original);
  }finally{f.close();}
});
test('R05 canonical targets merge ordinary / weak aliases but keep listening, reading and both translation directions distinct',()=>{
  const f=fixture();try{const id=f.store.read().words[0].id;
    for(const dimension of ['look','read','zh-en','en-zh'] as const)formal(f.store,id,dimension,'incorrect','2026-10-24T02:00:00Z','2026-10-24T02:00:00Z',dimension);
    const task=entryRecommendation(f.store.read(),'review',f.now()).tasks.find(row=>row.wordId===id)!;
    assert.equal(task.steps.length,5);assert.equal(new Set(task.steps.map(step=>reviewGoal(step))).size,5);assert.ok(task.steps.includes('listen'));assert.ok(task.steps.includes('practice-en-zh'));assert.ok(task.steps.includes('practice-zh-en'));
  }finally{f.close();}
});
test('R05 newer confirmed success postpones matching ordinary reminders; late review of an older answer does not displace a newer failure',()=>{
  const f=fixture();try{const id=f.store.read().words[0].id;
    formal(f.store,id,'look','correct','2026-10-24T02:00:00Z','2026-10-28T02:00:00Z','older');
    assert.ok(!entryRecommendation(f.store.read(),'review',f.now()).tasks.find(row=>row.wordId===id)!.steps.some(step=>reviewGoal(step)==='recognize'));
    formal(f.store,id,'look','incorrect','2026-10-25T02:00:00Z','2026-10-25T02:00:00Z','newer');
    f.store.mutate(data=>{data.assessmentAttempts!.find(row=>row.id==='older')!.confirmedAt=f.now().toISOString();});
    assert.ok(entryRecommendation(f.store.read(),'review',f.now()).tasks.find(row=>row.wordId===id)!.steps.includes('practice-look'));
  }finally{f.close();}
});
test('R05 reward includes actual weak oral participation/skips without inventing correct scores',()=>{
  const f=fixture();try{const s=start(f.store),wordId=s.wordIds[0],feedback=roundFeedback(s,[],[
    {id:'one',sessionId:s.id,wordId,learningVersion:0,dimension:'zh-en',createdAt:f.now().toISOString(),oralStatus:'recorded'},
    {id:'two',sessionId:s.id,wordId,learningVersion:0,dimension:'read',createdAt:f.now().toISOString(),oralStatus:'skipped'},
    {id:'other',sessionId:'other',wordId,learningVersion:0,dimension:'read',createdAt:f.now().toISOString(),oralStatus:'recorded'},
  ]);assert.equal(feedback.recorded,1);assert.equal(feedback.skipped,1);assert.ok(!('correct' in feedback));
  }finally{f.close();}
});
test('R05 saved audio alone does not settle a target; restored missing audio preserves actual completion without inventing a grade',()=>{
  const f=fixture();try{const s=start(f.store),first=currentActivity(s)!,target={sessionId:s.id,planVersion:3 as const,activityId:first.id};
    const audio=Buffer.alloc(16044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(16000,40);for(let i=0;i<8000;i++)audio.writeInt16LE(Math.round(Math.sin(i*.1)*5000),44+i*2);
    createPracticeRecordings(f.store).upload(target,'12345678-1234-4234-8234-123456789abc',audio);
    assert.equal(routineReviewCompletions(f.store.read(),f.now()).length,0);f.store.activityEvent({...target,action:'finish'});assert.equal(routineReviewCompletions(f.store.read(),f.now()).length,0);
    f.store.activityEvent({...target,action:'next'});const history=routineReviewCompletions(f.store.read(),f.now());assert.equal(history[0].outcome,'practiced');
    f.store.restoreBackup(f.store.exportBackup());f.restart();assert.equal(f.store.read().practiceRecordings?.[0].status,'missing');assert.deepEqual(routineReviewCompletions(f.store.read(),f.now()),history);
    assert.equal(f.store.read().assessmentAttempts?.length,0);assert.deepEqual(f.store.read().progress,[]);assert.ok(!entryRecommendation(f.store.read(),'review',f.now()).tasks.find(task=>task.wordId===first.wordId)?.steps.some(step=>reviewGoal(step)==='recall'));
  }finally{f.close();}
});
test('R05 local HTTP round completion and read-only preview agree after reload; no empty replacement or duplicate award',async()=>{
  const f=fixture(),app=createApp({dataDir:f.dir,observationAudience:'engineering',integrations:{probeIntegrations:async()=>status,getCachedSpeech:async()=>undefined}});
  try{app.store.clock=f.now;const s=start(app.store);finish(app.store,s.id);await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
    const base=`http://127.0.0.1:${(app.server.address() as any).port}`,state=await fetch(base+'/api/state').then(response=>response.json()),before=app.store.exportBackup();
    assert.equal(entryRecommendation(state,'review',f.now()).reason,'reviewed-today');
    const response=await fetch(base+'/api/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entry:'review',strategy:'memory-loop'})});assert.equal(response.status,409);
    assert.deepEqual(app.store.exportBackup(),before);app.store.updateSession({sessionId:s.id,planVersion:3,complete:true});assert.equal(app.store.read().stickers.length,1);
  }finally{await app.close();f.close();}
});
