import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {Store,validateBackup} from '../server/store.ts';
import {studyRuntimeState} from '../server/study-execution.ts';
import {learningChoiceSummary} from '../shared/daily-learning-choice.ts';
import {currentActivity} from '../shared/game-plan.ts';
import {wordLearningProfiles} from '../shared/word-learning.ts';
import {createTestMode} from '../server/test-mode.ts';
import {createApp} from '../server/index.ts';

const off={configured:false,available:false,status:'fixture',detail:'隔离工程，不调用云'},status={speech:off,codex:off};
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'single-learning-task-'));let time=new Date('2026-11-17T02:00:00Z');const store=new Store(dir,()=>time);
  store.mutate(data=>{data.packs=[{id:'family',title:'工程隔离词书',enabled:true,createdAt:'2026-11-01T02:00:00Z'}];data.words=data.words.slice(0,10).map(word=>({...word,packId:'family',learningVersion:0}));data.activeLearningSessionId=null;});
  const ready=()=>store.read().words.map(word=>word.id);
  const request=()=>{const view=studyRuntimeState(store.read(),ready(),time,'child');return {version:1,mode:'child',purpose:'learn',action:'new',planId:view.plans.learn.planId,requestId:crypto.randomUUID()};};
  return {dir,store,ready,request,now:()=>time,nextDay(){time=new Date(time.getTime()+86400000);},close(){store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}};
}

function verifyWord(store:Store,wordId:string){
  const test=store.createAssessment({mode:'full',wordIds:[wordId]});
  for(const item of test.items){
    const body=item.dimension==='look'?{action:'choose',selectedId:wordId}:{action:'judge',judgement:'correct'};
    store.assessmentAction(test.id,{itemId:item.id,...body});
  }
}

test('single task migration keeps current position and word facts, retiring only old pending tasks',()=>{
  const f=fixture();try{
    f.store.mutate(data=>{data.settings.dailyNewWords=3;});const ids=f.ready();
    const older=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:ids.slice(0,2)});
    f.store.mutate(data=>{data.sessions.find(row=>row.id===older.id)!.exposures=[{wordId:ids[0],learningVersion:0,introducedAt:'2026-11-16T02:00:00Z'}];});
    const current=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:ids.slice(2,4)}),before=f.store.read();
    const profiles=wordLearningProfiles(before,f.now()).map(row=>[row.wordId,row.encountered,row.abilities]);
    f.store.enableSingleLearningTask();const after=f.store.read();
    assert.equal(after.settings.dailyNewWords,5);assert.equal(after.learningTaskPolicy,1);assert.equal(after.activeLearningSessionId,current.id);
    assert.deepEqual(after.sessions.find(row=>row.id===current.id),before.sessions.find(row=>row.id===current.id));
    const {suspendedAt,endReason,replacementSessionId,...retired}=after.sessions.find(row=>row.id===older.id)!;
    assert.ok(suspendedAt);assert.equal(endReason,'replaced');assert.equal(replacementSessionId,current.id);assert.deepEqual(retired,before.sessions.find(row=>row.id===older.id));
    assert.deepEqual(after.words,before.words);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.progress,before.progress);assert.deepEqual(after.practiceRecordings,before.practiceRecordings);
    assert.deepEqual(wordLearningProfiles(after,f.now()).map(row=>[row.wordId,row.encountered,row.abilities]),profiles);
    assert.equal(f.store.state(status).resumableSessions?.length,1);assert.ok(validateBackup(f.store.exportBackup()));
    const once=f.store.exportBackup();f.store.enableSingleLearningTask();assert.deepEqual(f.store.exportBackup(),once);
  }finally{f.close();}
});

test('automatic new learning schedules five unseen words without old reservations or the legacy three-word time slice',()=>{
  const f=fixture();try{
    const ids=f.ready();f.store.mutate(data=>{data.sessions.push({id:'previous-word',wordIds:[ids[0]],completedWordIds:[ids[0]],startedAt:'2026-11-16T02:00:00Z',completedAt:'2026-11-16T02:00:00Z',rewardGranted:false,exposures:[{wordId:ids[0],learningVersion:0,introducedAt:'2026-11-16T02:00:00Z'}]});});
    f.store.enableSingleLearningTask();verifyWord(f.store,ids[0]);
    const view=studyRuntimeState(f.store.read(),ids,f.now(),'child');assert.equal(view.plans.learn.agenda.newWordCount,5);assert.ok(view.plans.learn.agenda.goals.every(goal=>goal.kind==='introduce'&&goal.wordId!==ids[0]));
    const body=f.request(),target=f.store.startStudy(body,ids,'child');assert.equal(target.kind,'learning');
    const current=f.store.state(status).activeSession!;assert.equal(current.wordIds.length,5);assert.ok(!current.wordIds.includes(ids[0]));assert.ok(current.tasks!.every(task=>task.mode==='new'));
    assert.deepEqual(f.store.startStudy(body,ids,'child'),target);assert.equal(f.store.state(status).resumableSessions?.length,1);
  }finally{f.close();}
});

test('a new task replaces the current task atomically; old resume, save and late activity cannot revive it',()=>{
  const f=fixture();try{
    f.store.enableSingleLearningTask();const body=f.request();f.store.startStudy(body,f.ready(),'child');const first=f.store.state(status).activeSession!,snapshot=structuredClone(first),activity=currentActivity(first)!;
    const view=studyRuntimeState(f.store.read(),f.ready(),f.now(),'child'),emptyBefore=f.store.exportBackup();
    assert.throws(()=>f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:['missing']}));assert.deepEqual(f.store.exportBackup(),emptyBefore);
    const next=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:[f.ready()[0]]});assert.notEqual(next.id,first.id);assert.equal(f.store.state(status).resumableSessions?.length,1);
    const {suspendedAt,endReason,replacementSessionId,...original}=f.store.read().sessions.find(row=>row.id===first.id)!;assert.ok(suspendedAt);assert.equal(endReason,'replaced');assert.equal(replacementSessionId,next.id);assert.deepEqual(original,snapshot);
    assert.throws(()=>f.store.startStudy(body,f.ready(),'child'),/另一份进度/);
    assert.throws(()=>f.store.startSession(false,{}, {entry:'learn',mode:'resume',sessionId:first.id}));
    assert.throws(()=>f.store.startStudy({version:1,mode:'child',purpose:'learn',action:'resume',planId:view.plans.learn.planId,requestId:crypto.randomUUID(),sessionId:first.id,activityId:activity.id},f.ready(),'child'));
    assert.throws(()=>f.store.saveLearningPosition({sessionId:first.id,activityId:activity.id,planVersion:first.learningPolicy?.version??1,reason:'leave'}),error=>(error as {code?:string}).code==='SESSION_SAVE_INVALID');
    assert.throws(()=>f.store.activityEvent({sessionId:first.id,activityId:activity.id,action:'rules-seen'}));
    const backup=f.store.exportBackup();assert.ok(validateBackup(backup));f.store.restoreBackup(backup);assert.equal(f.store.state(status).activeSession?.id,next.id);assert.equal(f.store.state(status).resumableSessions?.length,1);
  }finally{f.close();}
});

test('temporary quantity changes only today; choosing a learned word manually remains allowed',()=>{
  const f=fixture();try{
    f.store.enableSingleLearningTask();const summary=learningChoiceSummary(f.store.read(),f.now());
    f.store.saveDailyLearningChoice({day:summary.day,revision:summary.revision,goal:8},f.ready());assert.equal(studyRuntimeState(f.store.read(),f.ready(),f.now(),'child').plans.learn.agenda.newWordCount,8);assert.equal(f.store.read().settings.dailyNewWords,5);
    f.nextDay();assert.equal(learningChoiceSummary(f.store.read(),f.now()).goal,5);
    const id=f.ready()[0];f.store.mutate(data=>{data.sessions.push({id:'seen',wordIds:[id],completedWordIds:[id],startedAt:'2026-11-16T02:00:00Z',completedAt:'2026-11-16T02:00:00Z',rewardGranted:false});});
    const manual=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:[id]});assert.deepEqual(manual.wordIds,[id]);assert.equal(manual.mode,'relearn');assert.equal(f.store.state(status).activeSession?.id,manual.id);
    const locked=studyRuntimeState(f.store.read(),f.ready(),f.now(),'child').plans.learn.agenda;
    assert.equal(locked.newWordCount,0);assert.ok(locked.goals.every(goal=>goal.wordId===id&&goal.kind==='check'));
    verifyWord(f.store,id);
    const bookOne=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',packId:'family',wordIds:[f.ready()[1]]});const bookTwo=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',packId:'family',wordIds:[f.ready()[2]]});assert.notEqual(bookTwo.id,bookOne.id);assert.deepEqual(bookTwo.wordIds,[f.ready()[2]]);assert.equal(f.store.state(status).resumableSessions?.length,1);
  }finally{f.close();}
});

test('test mode has its own one task and temporary quantity; it cannot replace the child task',async()=>{
  const f=fixture();f.store.enableSingleLearningTask();f.store.startStudy(f.request(),f.ready(),'child');const before=f.store.exportBackup(),manager=createTestMode(f.store,()=>true);
  try{const ctx=manager.require(manager.enter().token),ids=ctx.store.read().words.map(word=>word.id);ctx.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:ids.slice(0,2)});const second=ctx.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:ids.slice(2,4)});assert.equal(ctx.store.state(status).resumableSessions?.length,1);assert.equal(ctx.store.state(status).activeSession?.id,second.id);assert.deepEqual(f.store.exportBackup(),before);}finally{await manager.close();f.close();}
});

test('actual entry and quantity picker show a prominent adjustment, five original pictures and no historical task queue',async()=>{
  const f=fixture(),vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});try{
    f.store.enableSingleLearningTask();const state={...f.store.state(status),study:studyRuntimeState(f.store.read(),f.ready(),f.now(),'child')};
    const {StudyHub}=await vite.ssrLoadModule('/src/study-hub.tsx'),{LearningChoice}=await vite.ssrLoadModule('/src/learning-choice.tsx');
    const html=renderToStaticMarkup(createElement(StudyHub,{state,busy:false,onStudyStart(){},onHome(){},onSelect(){},onTest(){},onChoose(){}}));assert.match(html,/调整词量/);assert.match(html,/认识 5 个新词/);assert.doesNotMatch(html,/继续已保存|其他保存的进度|调整学习安排/);assert.equal((html.match(/未学习/g)??[]).length,5);
    const goal=renderToStaticMarkup(createElement(LearningChoice,{state,mode:'goal',onSaved(){},onBack(){}}));assert.match(goal,/调整今日词量/);assert.match(goal,/明天恢复每天 5 个新词/);assert.match(goal,/设为 5 个新词/);assert.doesNotMatch(goal,/未完成已安排|原来的学习进度|下一轮/);
    assert.equal(f.store.read().sessions.length,0);assert.equal(f.store.read().dailyLearningChoice,undefined);
  }finally{await vite.close();f.close();}
});

test('formal HTTP defaults to five, previews without writes and replaces the task only after explicit start',async()=>{
  const f=fixture(),folder=join(f.dir,'speech'),audio=join(folder,'engineering-cache.wav');mkdirSync(folder,{recursive:true});
  const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);writeFileSync(audio,wav);
  const app=createApp({dataDir:f.dir,clock:f.now,integrations:{probeIntegrations:async()=>status,ttsStatus:()=>off,getCachedSpeech:async()=>audio,synthesizeSpeech:async()=>{throw Error('No cloud generation');}}});
  try{
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
    const send=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),before=app.store.exportBackup();
    const state=await(await fetch(base+'/api/state')).json();assert.equal(state.settings.dailyNewWords,5);assert.equal(state.learningTaskPolicy,1);assert.equal(state.study.plans.learn.agenda.newWordCount,5);assert.deepEqual(app.store.exportBackup(),before);
    const body={version:1,mode:'child',purpose:'learn',action:'new',requestId:crypto.randomUUID(),planId:state.study.plans.learn.planId};
    const start=await send('/api/study/start',body);assert.equal(start.status,200);const one=app.store.state(status).activeSession!;assert.equal(one.wordIds.length,5);
    const choice=learningChoiceSummary(app.store.read(),f.now());assert.equal((await send('/api/session/daily-choice',{day:choice.day,revision:choice.revision,goal:8})).status,200);assert.equal(app.store.state(status).activeSession?.id,one.id);
    const next=await(await fetch(base+'/api/state')).json();assert.equal(next.study.plans.learn.agenda.newWordCount,8);assert.equal((await send('/api/study/start',{...body,requestId:crypto.randomUUID(),planId:next.study.plans.learn.planId})).status,200);
    assert.equal(app.store.state(status).resumableSessions?.length,1);assert.equal(app.store.state(status).activeSession?.wordIds.length,8);assert.equal(app.store.read().sessions.find(row=>row.id===one.id)?.endReason,'replaced');assert.equal(app.store.read().charges.length,0);
  }finally{await app.close();f.close();}
});
