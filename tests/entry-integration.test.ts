import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,validateBackup} from '../server/store.ts';
import {learningReturn,learnedReviewWords} from '../shared/learning-entry.ts';
import type {LearningStartRequest} from '../shared/contracts.ts';
import {packPracticeOptions} from '../shared/pack-practice.ts';
import {createApp} from '../server/index.ts';

const now=new Date('2026-10-25T04:00:00Z');
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'entry-contract-'));let store=new Store(dir,()=>now);
  store.mutate(data=>{
    data.packs=[{id:'family',title:'隔离测试词书',enabled:true,createdAt:'2026-10-01T00:00:00Z'}];
    data.words=data.words.slice(0,4).map(word=>({...word,packId:'family',assetStatus:'approved',learningVersion:0}));
    const ids=data.words.map(word=>word.id);
    data.sessions=[{id:'prior-introductions',wordIds:ids,completedWordIds:ids,startedAt:'2026-10-23T00:00:00Z',completedAt:'2026-10-23T00:00:00Z',rewardGranted:false,
      exposures:ids.map(wordId=>({wordId,learningVersion:0,introducedAt:'2026-10-23T00:00:00Z'}))}];
  });
  return {get store(){return store;},dir,ids:store.read().words.map(word=>word.id),
    restart(){store.close();store=new Store(dir,()=>now);},close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('L01: learning, review and legacy rounds coexist; repeat starts and explicit resumes preserve each frozen plan',()=>{
  const f=fixture();try{
    const scope=f.ids.slice(0,2);
    const legacy=f.store.startSession(false,{}, {mode:'practice',wordIds:scope});
    const learn=f.store.startSession(false,{}, {entry:'learn',mode:'practice',wordIds:scope});
    const review=f.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'family',wordIds:scope});
    assert.equal(new Set([legacy.id,learn.id,review.id]).size,3);
    assert.deepEqual(learn.entrySource,{entry:'learn',kind:'selected'});assert.deepEqual(review.entrySource,{entry:'review',kind:'book'});
    const snapshots=structuredClone([learn,review]);
    assert.equal(f.store.startSession(false,{}, {entry:'learn',mode:'practice',wordIds:scope}).id,learn.id);
    assert.equal(f.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'family',wordIds:scope}).id,review.id);
    assert.throws(()=>f.store.startSession(false,{}, {entry:'review',mode:'resume',sessionId:learn.id}),/另一个入口/);
    assert.throws(()=>f.store.startSession(false,{}, {entry:'learn',mode:'resume',sessionId:legacy.id}),/另一个入口/);
    assert.equal(f.store.startSession(false,{}, {mode:'resume',sessionId:legacy.id}).id,legacy.id);
    for(const snapshot of snapshots){const saved=f.store.read().sessions.find(session=>session.id===snapshot.id)!;assert.deepEqual(saved.activities,snapshot.activities);assert.deepEqual(saved.tasks,snapshot.tasks);}
    assert.equal(learningReturn(learn),'hub');assert.equal(learningReturn(review),'books');
  }finally{f.close();}
});
test('L01: source survives restart, export and restore; malformed sources cannot enter a backup',()=>{
  const f=fixture();try{
    const session=f.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'family',wordIds:f.ids.slice(0,2)});
    f.restart();let saved=f.store.read().sessions.find(row=>row.id===session.id)!;assert.deepEqual(saved.entrySource,session.entrySource);
    const backup=f.store.exportBackup();assert.ok(validateBackup(backup));f.store.restoreBackup(backup);
    saved=f.store.read().sessions.find(row=>row.id===session.id)!;assert.deepEqual(saved.entrySource,session.entrySource);assert.deepEqual(saved.activities,session.activities);
    for(const source of [{entry:'other',kind:'book'},{entry:'review',kind:'game'},{entry:'review',kind:'book',extra:true}]){
      const bad=structuredClone(backup);(bad.data.sessions.find(row=>row.id===session.id)! as any).entrySource=source;
      assert.throws(()=>validateBackup(bad),/轮次来源/);
    }
  }finally{f.close();}
});
test('L01: request id reuse across entries is rejected and current-meaning changes leave the frozen round intact',()=>{
  const f=fixture();try{
    const request:LearningStartRequest={entry:'learn',mode:'practice',wordIds:f.ids.slice(0,2),requestId:'entry-retry-0001'};
    const round=f.store.startSession(false,{},request);
    assert.throws(()=>f.store.startSession(false,{}, {...request,entry:'review'}),/另一个入口/);
    for(const entry of [[],['learn'],'bad',null])assert.throws(()=>f.store.startSession(false,{}, {...request,entry} as any),/入口/);
    f.store.mutate(data=>{data.words[0].learningVersion=1;});
    assert.throws(()=>f.store.startSession(false,{}, {entry:'learn',mode:'resume',sessionId:round.id}),/词义或素材/);
    assert.deepEqual(f.store.read().sessions.find(row=>row.id===round.id)!.activities,round.activities);
  }finally{f.close();}
});
test('R01: selection and progress alone do not make a word learned; introduction unlocks only its current meaning',()=>{
  const f=fixture();try{
    f.store.mutate(data=>{data.sessions=[];data.progress=[{wordId:f.ids[1],skill:'listen',stage:2,successes:2,attempts:2,dueAt:now.toISOString()}];});
    const learn=f.store.startSession(false,{}, {entry:'learn',mode:'practice',wordIds:f.ids.slice(0,2)});
    assert.equal(learnedReviewWords(f.store.read(),now).length,0);
    assert.throws(()=>f.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'family',wordIds:[f.ids[0]]}),/先去学习/);
    f.store.updateSession({sessionId:learn.id,completedStep:{wordId:f.ids[0],step:'learn'}});
    assert.deepEqual(learnedReviewWords(f.store.read(),now).map(word=>word.id),[f.ids[0]]);
    const offline={configured:false,available:false,status:'fixture',detail:'本机测试替身'};
    const book=packPracticeOptions(f.store.state({speech:offline,codex:offline}))[0];
    assert.deepEqual([book.words.length,book.unlearned,book.ready,book.total],[1,3,4,4]);
    assert.deepEqual(book.request.wordIds,[f.ids[0]]);assert.equal(book.request.entry,'review');
    assert.throws(()=>f.store.startSession(false,{}, {...book.request,wordIds:f.ids.slice(0,2)}),/先去学习/);
    const review=f.store.startSession(false,{},book.request);assert.ok(review.tasks!.every(task=>!task.steps.includes('learn')));
    f.store.mutate(data=>{data.words[0].learningVersion=1;});
    assert.equal(learnedReviewWords(f.store.read(),now).length,0);
    assert.deepEqual(f.store.read().sessions.find(session=>session.id===review.id)!.activities,review.activities);
  }finally{f.close();}
});
test('R01: disabled, sample, deleted, reset or unapproved words cannot enter new review pools',()=>{
  const f=fixture();try{
    for(const flaw of ['disabled','sample','deleted','reset','unapproved'] as const){
      const data=f.store.read();
      if(flaw==='disabled')data.packs[0].enabled=false;
      if(flaw==='sample')data.packs[0].isSample=true;
      if(flaw==='deleted')data.words[0].deletedAt=now.toISOString();
      if(flaw==='reset')data.words[0].learningResetAt=now.toISOString();
      if(flaw==='unapproved')data.words[0].assetStatus='review';
      assert.equal(learnedReviewWords(data,now).some(word=>word.id===f.ids[0]),false,flaw);
    }
  }finally{f.close();}
});
test('L01/R01 HTTP: entry guard, learned-only book/game scope and legacy compatibility use real local routes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'entry-http-'));
  const offline={configured:false,available:false,status:'fixture',detail:'隔离测试替身，不调用外部服务'};
  const app=createApp({dataDir:dir,studyExecution:false,integrations:{probeIntegrations:async()=>({speech:offline,codex:offline}),ttsStatus:()=>offline,getCachedSpeech:async()=>undefined,synthesizeSpeech:async()=>{throw Error('No cloud');}}});
  try{
    app.store.mutate(data=>{
      data.settings.voiceEnabled=false;data.packs=[{id:'family',title:'隔离词书',enabled:true,createdAt:now.toISOString()}];
      data.words=data.words.slice(0,3).map(word=>({...word,packId:'family',assetStatus:'approved',learningVersion:0}));
      data.sessions=[{id:'known-one',wordIds:[data.words[0].id],completedWordIds:[data.words[0].id],startedAt:'2026-10-01T00:00:00Z',completedAt:'2026-10-01T00:00:00Z',rewardGranted:false,exposures:[{wordId:data.words[0].id,learningVersion:0,introducedAt:'2026-10-01T00:00:00Z'}]}];
    });
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
    const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`,ids=app.store.read().words.map(word=>word.id);
    const post=(body:unknown)=>fetch(base+'/api/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const response=await post({entry:'review',mode:'practice',packId:'family',wordIds:[ids[0]]});assert.equal(response.status,200);
    const round=await response.json();assert.deepEqual(round.entrySource,{entry:'review',kind:'book'});
    assert.equal((await post({entry:'learn',mode:'resume',sessionId:round.id})).status,409);
    assert.equal((await post({entry:'review',mode:'practice',packId:'family',wordIds:ids})).status,409);
    const catalogue=await (await fetch(base+'/api/pack-games?packId=family&entry=review')).json();assert.equal(catalogue.wordCount,1);
    const legacy=await post({mode:'practice',wordIds:[ids[1]]});assert.equal(legacy.status,200);assert.equal((await legacy.json()).entrySource,undefined);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
