import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, validateBackup } from '../server/store.ts';
import { createApp } from '../server/index.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { pendingLearningCheckpoint } from '../shared/learning-policy.ts';
import { dailyLearningPlan } from '../shared/learning.ts';
import { lessonSegment } from '../shared/lesson-plan.ts';
import { finishGoalFixture } from './helpers/goal-steps.ts';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const status={configured:false,available:false,status:'disabled',detail:'测试无云服务'};
const integrationStatus={speech:status,codex:status};
function seed(store:Store) {
  const pack=store.createPack('本课40词',Array.from({length:40},(_,i)=>({term:`word${String.fromCharCode(97+i%26)}${i<26?'a':'b'}`,meaning:`课堂词${i+1}`})));
  store.mutate(data=>{data.packs.find(p=>p.id===pack.id)!.enabled=true;for(const word of data.words.filter(w=>w.packId===pack.id)){word.imageUrl='/assets/words/apple.svg';word.assetStatus='approved';}});
  return store.read().words.filter(w=>w.packId===pack.id).map(w=>w.id);
}
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'lesson-plan-test-'));const store=new Store(dir,()=>new Date('2026-10-18T01:00:00Z'));const ids=seed(store);
  return {store,ids,close(){store.close();assert.ok(dir.startsWith(join(tmpdir(),'lesson-plan-test-')));rmSync(dir,{recursive:true,force:true});}};
}
const active=(store:Store)=>store.read().sessions.at(-1)!;
function finish(store:Store) {
  for(let i=0;i<1000&&currentActivity(active(store));i++) {
    const session=active(store),checkpoint=pendingLearningCheckpoint(session);
    if(checkpoint){store.updateSession({sessionId:session.id,checkpointId:checkpoint});continue;}
    const a=currentActivity(session)!;
    if(finishGoalFixture(store,session,a))continue;
    if(a.step==='recall'){store.activityEvent({sessionId:session.id,activityId:a.id,action:'skip'});store.activityEvent({sessionId:session.id,activityId:a.id,action:'next'});continue;}
    assert.equal(a.kind,'standard');
    if(a.step!=='learn')store.attempt({id:randomUUID(),sessionId:session.id,wordId:a.wordId,step:a.step,skill:a.step==='sound'?'listen':a.step,correct:true,hinted:false,source:'click'});
    store.updateSession({sessionId:session.id,completedStep:{wordId:a.wordId,step:a.step}});
  }
  store.updateSession({sessionId:active(store).id,complete:true});
}
const save=(f:ReturnType<typeof fixture>,focus=f.ids)=>f.store.saveLessonPlan({title:'周一英语课',wordIds:f.ids,focusWordIds:focus,segmentMinutes:8},()=>true);

test('ending a partially started round preserves evidence and releases only unseen reservations',()=>{const f=fixture();try{
  const session=f.store.startSession();f.store.updateSession({sessionId:session.id,completedStep:{wordId:session.wordIds[0],step:'learn'}});
  const before=f.store.read();f.store.manageSession({sessionId:session.id,action:'reselect'});const after=f.store.read();
  assert.equal(after.sessions[0].endReason,'reselect');assert.ok(after.sessions[0].suspendedAt);assert.equal(after.sessions[0].completedAt,undefined);assert.equal(after.sessions[0].rewardGranted,false);
  for(const key of ['attempts','progress','stickers','practiceRecordings'] as const)assert.deepEqual(after[key],before[key]);
  assert.deepEqual(after.sessions[0].exposures,before.sessions[0].exposures);assert.equal(dailyLearningPlan(after,f.store.clock()).fresh.length,2);
  assert.equal(f.store.state(integrationStatus).resumableSessions!.length,0);
  f.store.manageSession({sessionId:session.id,action:'reselect'});assert.equal(f.store.read().sessions.length,1);
  assert.throws(()=>f.store.startSession(false,{}, {mode:'resume',sessionId:session.id}),/结束/);
}finally{f.close();}});

test('restart is atomic, idempotent, starts at the beginning and cannot invent formal progress',()=>{const f=fixture();try{
  const original=f.store.startSession(false,{}, {strategy:'memory-loop'});
  f.store.updateSession({sessionId:original.id,completedStep:{wordId:original.wordIds[0],step:'learn'}});
  const restarted=f.store.manageSession({sessionId:original.id,action:'restart'})!;
  assert.notEqual(restarted.id,original.id);assert.deepEqual(restarted.wordIds,original.wordIds);assert.deepEqual(restarted.completedSteps,{});assert.equal(restarted.practiceOnly,true);
  assert.equal(f.store.manageSession({sessionId:original.id,action:'restart'})!.id,restarted.id);assert.equal(f.store.read().sessions.length,2);
  assert.equal(f.store.read().progress.length,0);assert.equal(f.store.read().sessions[0].replacementSessionId,restarted.id);assert.ok(validateBackup(f.store.exportBackup()));
  assert.throws(()=>f.store.activityEvent({sessionId:original.id,activityId:original.activities![0].id,action:'next'}));
}finally{f.close();}});

test('invalid end actions and unavailable restart targets roll back without ending a round',()=>{const f=fixture();try{
  const session=f.store.startSession();const before=f.store.read();
  assert.throws(()=>f.store.manageSession({sessionId:session.id,action:['reselect']}));assert.deepEqual(f.store.read(),before);
  for(const id of session.wordIds)f.store.updateWord(id,{assetStatus:'draft'},()=>true);const changed=f.store.read();assert.throws(()=>f.store.manageSession({sessionId:session.id,action:'restart'}));assert.deepEqual(f.store.read(),changed);
}finally{f.close();}});

test('a 40-word lesson starts only a budgeted segment and continues beyond the daily new-word recommendation',()=>{const f=fixture();try{
  let plan=save(f);assert.equal(plan.wordIds.length,40);
  const preview=lessonSegment(plan,f.store.read());assert.equal(preview.words.length,2);
  const seen:string[]=[];
  for(let i=0;i<3;i++){
    const segment=f.store.startSession(false,{}, {mode:'lesson',lessonPlanId:plan.id,lessonRevision:plan.revision,strategy:'memory-loop',requestId:`lesson-request-${i}`});
    assert.equal(segment.wordIds.length,2);assert.equal(segment.lessonScopeCount,40);assert.equal(segment.practiceOnly,true);seen.push(...segment.wordIds);finish(f.store);plan=f.store.read().lessonPlan!;
    assert.equal(f.store.startSession(false,{}, {mode:'lesson',lessonPlanId:plan.id,lessonRevision:plan.revision,strategy:'memory-loop',requestId:`lesson-request-${i}`}).id,segment.id);
  }
  assert.equal(new Set(seen).size,6);assert.deepEqual(plan.completedWordIds,seen);assert.equal(f.store.read().settings.dailyNewWords,3);assert.equal(f.store.read().progress.length,0);
  assert.ok(validateBackup(f.store.exportBackup()));
  const invalid=f.store.exportBackup();invalid.data.sessions[0].lessonPlanRevision=-1;assert.throws(()=>validateBackup(invalid),/课堂轮次/);
}finally{f.close();}});

test('editing classroom focus preserves an active segment and changes only the next segment',()=>{const f=fixture();try{
  const plan=save(f,f.ids.slice(0,8));const current=f.store.startSession(false,{}, {mode:'lesson',lessonPlanId:plan.id,lessonRevision:plan.revision,strategy:'memory-loop'});
  const nextFocus=[f.ids[12],f.ids[10],f.ids[11]];
  const updated=f.store.saveLessonPlan({id:plan.id,revision:plan.revision,title:plan.title,wordIds:plan.wordIds,focusWordIds:nextFocus,segmentMinutes:8},()=>true);
  assert.deepEqual(f.store.read().sessions.find(s=>s.id===current.id),current);
  assert.equal(f.store.startSession(false,{}, {mode:'lesson',lessonPlanId:plan.id,lessonRevision:updated.revision}).id,current.id);
  finish(f.store);
  const next=f.store.startSession(false,{}, {mode:'lesson',lessonPlanId:plan.id,lessonRevision:updated.revision,strategy:'memory-loop'});
  assert.deepEqual(next.wordIds,nextFocus.slice(0,2));assert.notEqual(next.id,current.id);
  const backup=f.store.exportBackup();assert.ok(validateBackup(backup));f.store.restoreBackup(backup);
  assert.deepEqual(f.store.read().lessonPlan,backup.data.lessonPlan);assert.deepEqual(f.store.read().sessions.find(s=>s.id===next.id)?.wordIds,next.wordIds);
}finally{f.close();}});

test('stale lesson revisions, changed meanings, and forged backup progress are rejected',()=>{const f=fixture();try{
  const plan=save(f);const body={id:plan.id,revision:plan.revision,title:plan.title,wordIds:plan.wordIds,focusWordIds:plan.focusWordIds,segmentMinutes:8};
  f.store.saveLessonPlan(body,()=>true);assert.throws(()=>f.store.saveLessonPlan(body,()=>true),/变化/);
  assert.throws(()=>f.store.startSession(false,{}, {mode:'lesson',lessonPlanId:plan.id,lessonRevision:plan.revision}),/变化/);
  const latest=f.store.read().lessonPlan!;f.store.updateWord(latest.focusWordIds[0],{meaning:'新的意思'},()=>true);
  assert.ok(lessonSegment(latest,f.store.read()).unavailable.length);assert.throws(()=>f.store.startSession(false,{}, {mode:'lesson',lessonPlanId:latest.id,lessonRevision:latest.revision}),/变化/);
  const backup=f.store.exportBackup();(backup.data.lessonPlan as any).focusWordIds=['not-a-word'];assert.throws(()=>validateBackup(backup),/课堂/);
  const forged=f.store.exportBackup();forged.data.lessonPlan!.completedWordIds=[plan.wordIds[1]];assert.throws(()=>validateBackup(forged),/进度与实际/);
}finally{f.close();}});

test('parent grant is required to save a classroom plan; child segment start and end stay PIN-free',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'lesson-api-test-'));
  const app=createApp({dataDir:dir,integrations:{probeIntegrations:async()=>integrationStatus,ttsStatus:()=>status,getCachedSpeech:async()=>undefined,synthesizeSpeech:async()=>{throw Error('Cloud generation is forbidden in this test');}}});
  const ids=seed(app.store);await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const call=async(route:string,body:unknown,token?:string)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  try{
    const body={title:'本节课',wordIds:ids,focusWordIds:ids.slice(0,8),segmentMinutes:8};assert.equal((await call('/api/lesson-plan',body)).status,403);
    const gate=await (await call('/api/parent-gate',{pin:'123456'})).json();const response=await call('/api/lesson-plan',body,gate.assessmentGrant.token);assert.equal(response.status,200);const state=await response.json();
    const start=await call('/api/session/start',{mode:'lesson',lessonPlanId:state.lessonPlan.id,lessonRevision:state.lessonPlan.revision,strategy:'memory-loop'});assert.equal(start.status,200);const session=await start.json();assert.equal(session.wordIds.length,2);
    const end=await call('/api/session/end',{sessionId:session.id,action:'reselect'});assert.equal(end.status,200);assert.equal((await end.json()).state.resumableSessions.length,0);
  }finally{await app.close();assert.ok(dir.startsWith(join(tmpdir(),'lesson-api-test-')));rmSync(dir,{recursive:true,force:true});}
});

test('hub shows round counts and separate classroom scope; planner exposes focus and order controls',async()=>{const f=fixture(),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{
  save(f,f.ids.slice(0,8));f.store.startSession(false,{}, {strategy:'memory-loop'});const state=f.store.state(integrationStatus);
  const {LearningHub}=await vite.ssrLoadModule('/src/learning-hub.tsx');const {LessonPlanner}=await vite.ssrLoadModule('/src/lesson-planner.tsx');
  const html=renderToStaticMarkup(createElement(LearningHub,{state,busy:false,onStart(){},onHome(){},onTest(){},onSpeak(){},onSelect(){},onManage(){},onLessonSettings(){}}));
  assert.ok(html.includes('本轮 3 个词'));assert.ok(html.includes('更多：调整本次学习'));assert.ok(html.includes('本课 40 词'));assert.ok(html.includes('本次重点 8 词'));assert.ok(html.includes('下一段 2 词'));
  const assigned=renderToStaticMarkup(createElement(LearningHub,{state:{...state,activeSession:null,resumableSessions:[]},busy:false,onStart(){},onHome(){},onTest(){},onSpeak(){},onSelect(){}}));assert.ok(assigned.includes('课堂练习入口'));assert.ok(assigned.includes('课堂词练一小段'));
  const editor=renderToStaticMarkup(createElement(LessonPlanner,{state,grant:{token:'fixture',expiresAt:'2099-01-01'},reload:async()=>state,onBack(){}}));assert.ok(editor.includes('保存安排'));assert.ok(editor.includes('上移'));assert.ok(editor.includes('本课全部设为重点'));
}finally{await vite.close();f.close();}});
