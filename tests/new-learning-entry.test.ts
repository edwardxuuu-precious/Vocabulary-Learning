import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,validateBackup} from '../server/store.ts';
import {createApp} from '../server/index.ts';
import {entryRecommendation} from '../shared/entry-recommendation.ts';
import {learningChoiceSummary} from '../shared/daily-learning-choice.ts';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const now=new Date('2026-11-15T12:00:00Z');
const off={configured:false,available:false,status:'fixture',detail:'隔离工程替身，无云服务'};
function seed(store:Store){store.mutate(data=>{
  data.packs=[{id:'new-entry-book',title:'隔离词书',enabled:true,createdAt:'2026-11-01T00:00:00Z'}];
  data.words=data.words.slice(0,10).map(word=>({...word,packId:'new-entry-book',assetStatus:'approved',learningVersion:0}));
  data.settings={...data.settings,learningStrategy:'memory-loop',dailyNewWords:3,sessionMinutes:10,voiceEnabled:false};
});}
function fixture(){const dir=mkdtempSync(join(tmpdir(),'new-learning-entry-'));let store=new Store(dir,()=>now);seed(store);
  return {dir,get store(){return store;},restart(){store.close();store=new Store(dir,()=>now);},close(){store.close();rmSync(dir,{recursive:true,force:true});}};}

test('new learning preserves a half-finished round, excludes its words, and survives retry, restart, resume and backup',()=>{
  const f=fixture();try{
    const first=f.store.startSession(false,{}, {entry:'learn'});
    f.store.updateSession({sessionId:first.id,completedStep:{wordId:first.wordIds[0],step:'learn'},planVersion:first.learningPolicy!.version});
    const choice=learningChoiceSummary(f.store.read(),now);
    f.store.saveDailyLearningChoice({day:choice.day,revision:choice.revision,goal:6},f.store.read().words.map(word=>word.id));
    const before=f.store.read(),snapshot=before.sessions.find(row=>row.id===first.id)!;
    const preview=entryRecommendation(before,'learn',now);
    assert.equal(preview.resume?.id,first.id);assert.equal(preview.fresh.length,3);
    const request={entry:'learn' as const,mode:'recommended' as const,startNew:true as const,requestId:'new-learning-preserve-0001'};
    const second=f.store.startSession(false,{},request);
    assert.notEqual(second.id,first.id);assert.deepEqual(second.wordIds,preview.fresh.map(word=>word.id));
    assert.ok(second.wordIds.every(id=>!first.wordIds.includes(id)));assert.equal(second.practiceOnly,false);
    assert.deepEqual(f.store.read().sessions.find(row=>row.id===first.id),snapshot);
    assert.equal(f.store.startSession(false,{},request).id,second.id,'network retry creates only one new round');
    assert.equal(f.store.read().sessions.length,2);assert.equal(f.store.read().assessmentAttempts?.length??0,0);
    f.restart();const backup=f.store.exportBackup();assert.ok(validateBackup(backup));f.store.restoreBackup(backup);
    for(const round of [first,second]){
      const resumed=f.store.startSession(false,{}, {entry:'learn',mode:'resume',sessionId:round.id});
      assert.equal(resumed.id,round.id);assert.deepEqual(resumed.activities,round.activities);
      assert.equal(resumed.suspendedAt,undefined);assert.equal(resumed.completedAt,undefined);
    }
    const restored=f.store.read().sessions.find(row=>row.id===first.id)!;
    assert.deepEqual(restored.completedSteps,snapshot.completedSteps);assert.deepEqual(restored.exposures,snapshot.exposures);
    assert.deepEqual(f.store.read().progress,before.progress);assert.deepEqual(f.store.read().stickers,before.stickers);
  }finally{f.close();}
});

test('new start with no remaining allowance is an atomic empty result, while ordinary recommended start still continues',()=>{
  const f=fixture();try{
    const first=f.store.startSession(false,{}, {entry:'learn'}),before=f.store.exportBackup();
    assert.equal(entryRecommendation(f.store.read(),'learn',now).remainingNew,0);
    assert.throws(()=>f.store.startSession(false,{}, {entry:'learn',startNew:true,requestId:'new-learning-no-quota'}),/今日词量|新词/);
    assert.deepEqual(f.store.exportBackup(),before);assert.equal(f.store.startSession(false,{}, {entry:'learn'}).id,first.id);
    f.store.mutate(data=>{data.words=data.words.filter(word=>first.wordIds.includes(word.id));});
    assert.equal(entryRecommendation(f.store.read(),'learn',now).reason,'already-arranged');
  }finally{f.close();}
});

test('new-start HTTP validates intent, uses real readiness and preserves facts while replacing the old task',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'new-entry-http-')),audio=join(dir,'speech','explicit-fixture.wav');
  mkdirSync(join(dir,'speech'));writeFileSync(audio,Buffer.alloc(64));let cached=true,cloud=0;
  const app=createApp({dataDir:dir,integrations:{probeIntegrations:async()=>({speech:off,codex:off}),ttsStatus:()=>off,getCachedSpeech:async()=>cached?audio:undefined,synthesizeSpeech:async()=>{cloud++;throw Error('No cloud');}}});
  app.store.clock=()=>now;seed(app.store);
  try{
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
    const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
    const send=(body:unknown)=>fetch(base+'/api/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const first=await(await send({entry:'learn'})).json();
    app.store.mutate(data=>{data.settings.dailyNewWords=6;});
    const before=app.store.read().sessions;
    for(const bad of [{entry:'review',startNew:true},{entry:'learn',startNew:false},{entry:'learn',startNew:true},{entry:'learn',mode:'resume',sessionId:first.id,startNew:true}]){
      const response=await send({...bad,...(!('mode'in bad)&&'entry'in bad&&bad.entry==='review'?{requestId:'invalid-new-review'}:{})});
      assert.equal(response.status,400);assert.deepEqual(app.store.read().sessions,before);
    }
    const input={entry:'learn',mode:'recommended',startNew:true,requestId:'new-learning-http-0001'};
    cached=false;assert.equal((await send(input)).status,409);assert.deepEqual(app.store.read().sessions,before);
    cached=true;const response=await send(input);assert.equal(response.status,200);const second=await response.json();
    assert.notEqual(second.id,first.id);assert.ok(second.wordIds.every((id:string)=>!first.wordIds.includes(id)));
    assert.equal((await(await send(input)).json()).id,second.id);const {suspendedAt,endReason,replacementSessionId,...original}=app.store.read().sessions[0];assert.ok(suspendedAt);assert.equal(endReason,'replaced');assert.equal(replacementSessionId,second.id);assert.deepEqual(original,before[0]);assert.equal(app.store.state({speech:off,codex:off}).resumableSessions?.length,1);
    assert.equal(cloud,0);assert.equal(app.store.read().charges.length,0);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('new-word page has a fresh preview or saved main card, and retains new-start and adjustment entries with original images',async()=>{
  const f=fixture(),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
  try{
    const {LearningHub}=await vite.ssrLoadModule('/src/learning-hub.tsx');
    const render=()=>renderToStaticMarkup(createElement(LearningHub,{state:f.store.state({speech:off,codex:off}),busy:false,onStart(){},onHome(){},onTest(){},onSpeak(){},onSelect(){},onChoose(){}}));
    const fresh=render();assert.ok(fresh.includes('新学习预览'));assert.ok(fresh.includes('开始学习'));assert.ok(!fresh.includes('继续上次'));
    const first=f.store.startSession(false,{}, {entry:'learn'}),saved=render();
    assert.ok(saved.includes('继续上次'));assert.ok(saved.includes('继续学习'));assert.ok(saved.includes('开始新的学习'));
    assert.ok(saved.includes('调整安排'));assert.ok(saved.includes('未完成已安排 3 词'));
    assert.ok(!saved.includes('hub-current choice-summary'),'no oversized settings card before the main action');
    for(const id of first.wordIds)assert.ok(saved.includes(f.store.read().words.find(word=>word.id===id)!.imageUrl));
  }finally{await vite.close();f.close();}
});
