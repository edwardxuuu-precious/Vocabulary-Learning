import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import { createApp } from '../server/index.ts';
import { packPracticeOptions } from '../shared/pack-practice.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { pendingLearningCheckpoint } from '../shared/learning-policy.ts';
import { finishGoalFixture } from './helpers/goal-steps.ts';

const offline={configured:false,available:false,status:'test',detail:'隔离测试，不请求云服务'};
const status={speech:offline,codex:offline};
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'pack-practice-'));
  let store=new Store(dir,()=>new Date('2026-10-18T01:00:00Z'));
  const exampleImages=store.read().words.map(word=>word.imageUrl);
  const book=store.createPack('整本40词',Array.from({length:40},(_,i)=>({term:`book${String.fromCharCode(97+i%26)}${i<26?'a':'b'}`,meaning:`本书${i+1}`})));
  const other=store.createPack('另一本',Array.from({length:6},(_,i)=>({term:`other${String.fromCharCode(97+i)}`,meaning:`其他${i+1}`})));
  store.mutate(data=>{data.settings.sessionMinutes=3;data.settings.dailyNewWords=1;for(const p of data.packs)if(!p.isSample)p.enabled=true;data.words.filter(w=>w.packId===book.id||w.packId===other.id).forEach((w,i)=>{w.assetStatus='approved';w.imageUrl=exampleImages[i%exampleImages.length];});});
  return {get store(){return store;},book,other, option(){return packPracticeOptions(store.state(status)).find(option=>option.pack.id===book.id)!;},
    restart(){store.close();store=new Store(dir,()=>new Date('2026-10-18T01:00:00Z'));},
    close(){store.close();assert.ok(dir.startsWith(join(tmpdir(),'pack-practice-')));rmSync(dir,{recursive:true,force:true});}};
}

test('whole-book options keep all ready words beyond daily limits and report unfinished preparation honestly',()=>{
  const f=fixture();try{
    const first=f.option();assert.equal(first.words.length,40);assert.equal(first.request.wordIds!.length,40);assert.equal(first.request.strategy,'memory-loop');
    f.store.mutate(data=>{data.words.find(w=>w.id===first.words[0].id)!.assetStatus='review';data.packs.find(p=>p.id===f.other.id)!.enabled=false;});
    const books=packPracticeOptions(f.store.state(status));assert.equal(books.length,1);assert.equal(books[0].total,40);assert.equal(books[0].words.length,39);assert.ok(books[0].words.every(w=>w.packId===f.book.id));
    f.store.updateSettings({learningStrategy:'classic'});assert.equal(f.option().request.strategy,'classic');
  }finally{f.close();}
});

test('a 40-word book round freezes the full scope, confines game choices and preserves another recommendation',()=>{
  const f=fixture();try{
    const recommendation=f.store.startSession(false,{}, {mode:'recommended',strategy:'memory-loop'});
    const option=f.option(),round=f.store.startSession('random',{forcedKind:'gate'}, {...option.request,requestId:'whole-book-request'});
    assert.equal(round.wordIds.length,40);assert.equal(round.practicePackId,f.book.id);assert.equal(round.practicePackTitle,f.book.title);assert.equal(round.practiceOnly,true);
    assert.ok(round.learningPolicy!.checkpoints.length>1);assert.ok(round.activities!.every(a=>a.kind==='standard'||a.step==='recall'&&a.kind==='portal'),'whole-book review uses basic tasks instead of game skins');
    const ids=new Set(option.words.map(w=>w.id));
    for(const a of round.activities!){assert.ok(ids.has(a.wordId));assert.ok(a.choices.every(w=>ids.has(w.id)));assert.ok((a.targets??[]).every(w=>ids.has(w.id)));if(a.cueWord)assert.ok(ids.has(a.cueWord.id));}
    assert.ok(f.store.state(status).resumableSessions!.some(s=>s.id===recommendation.id));
    assert.equal(f.option().request.sessionId,round.id);assert.equal(f.option().request.mode,'resume');
    assert.equal(f.option().segment!.total,8);assert.equal(f.option().segment!.completed,0);
    assert.equal(f.store.startSession('random',{}, {...option.request,requestId:'whole-book-request'}).id,round.id);
    assert.equal(f.store.startSession('random',{}, {...option.request,requestId:'another-book-request'}).id,round.id,'concurrent book starts resume the same unfinished round');
    assert.throws(()=>f.store.startSession(false,{}, {...option.request,packId:f.other.id,requestId:'whole-book-request'}),/另一轮/);
    f.restart();assert.equal(f.store.state(status).activeSession!.id,round.id);assert.equal(f.option().resume!.wordIds.length,40);
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
    f.store.restoreBackup(f.store.exportBackup());assert.equal(f.store.state(status).activeSession!.practicePackId,f.book.id);
  }finally{f.close();}
});

test('book requests reject foreign, disabled and sample scopes and malformed backup metadata',()=>{
  const f=fixture();try{
    const option=f.option();
    assert.throws(()=>f.store.startSession(false,{}, {...option.request,wordIds:[f.store.read().words.find(w=>w.packId===f.other.id)!.id]}),/词表或素材/);
    assert.throws(()=>f.store.startSession(false,{}, {...option.request,mode:'recommended'}),/范围无效/);
    assert.throws(()=>f.store.startSession(false,{}, {...option.request,packId:['invalid']} as never),/范围无效/);
    const round=f.store.startSession(false,{},option.request);
    const invalid=f.store.exportBackup();invalid.data.sessions.find(s=>s.id===round.id)!.practicePackId=f.other.id;
    assert.throws(()=>validateBackup(invalid),/词表练习范围/);
    f.store.mutate(data=>{data.packs.find(p=>p.id===f.book.id)!.enabled=false;});
    assert.throws(()=>f.store.startSession(false,{},option.request),/请选择至少|词表或素材/);
    assert.ok(!packPracticeOptions(f.store.state(status)).some(b=>b.pack.isSample));
  }finally{f.close();}
});

test('whole-book completion crosses saved breaks without dropping words or creating formal mastery',()=>{
  const f=fixture();try{
    const option=f.option();f.store.startSession(false,{},option.request);
    let breaks=0,restarted=false;
    const saved=()=>f.store.state(status).activeSession!;
    for(let count=0;count<1000&&currentActivity(saved());count++){
      const s=saved(),checkpoint=pendingLearningCheckpoint(s);
      if(checkpoint){breaks++;if(!restarted){const before=s.completedSteps;f.restart();assert.deepEqual(saved().completedSteps,before);assert.equal(saved().wordIds.length,40);restarted=true;}f.store.updateSession({sessionId:s.id,checkpointId:checkpoint});continue;}
      const a=currentActivity(s)!;
      if(finishGoalFixture(f.store,s,a))continue;
      if(a.step==='recall'){f.store.activityEvent({sessionId:s.id,activityId:a.id,action:'skip'});f.store.activityEvent({sessionId:s.id,activityId:a.id,action:'next'});continue;}
      assert.equal(a.kind,'standard');
      if(a.step!=='learn')f.store.attempt({sessionId:s.id,wordId:a.wordId,step:a.step,skill:a.step==='sound'?'listen':a.step,correct:true,hinted:false,source:'click'});
      f.store.updateSession({sessionId:s.id,completedStep:{wordId:a.wordId,step:a.step}});
    }
    assert.ok(breaks>1);const s=saved();assert.equal(s.completedWordIds.length,40);
    f.store.updateSession({sessionId:s.id,complete:true});assert.equal(f.option().resume,undefined);
    assert.deepEqual(f.store.read().progress,[]);assert.deepEqual(f.store.read().assessmentProgress,[]);
    assert.equal(f.store.read().stickers.length,1);assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
    const replay=f.store.startSession(false,{}, f.option().request);assert.equal(replay.wordIds.length,40);assert.ok(replay.tasks!.every(task=>!task.steps.includes('learn')));
  }finally{f.close();}
});

test('the child HTTP entry starts the entire book without a PIN and keeps its scope on explicit restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pack-practice-api-'));
  const app=createApp({dataDir:dir,integrations:{probeIntegrations:async()=>status,ttsStatus:()=>offline,getCachedSpeech:async()=>undefined,synthesizeSpeech:async()=>{throw Error('No cloud generation in this fixture');}}});
  try{
    const images=app.store.read().words.map(w=>w.imageUrl);
    const pack=app.store.createPack('接口整本练习',Array.from({length:16},(_,i)=>({term:`item${String.fromCharCode(97+i)}`,meaning:`第${i+1}个`})));
    app.store.mutate(data=>{data.settings.voiceEnabled=false;data.settings.dailyNewWords=1;data.packs.find(p=>p.id===pack.id)!.enabled=true;data.words.filter(w=>w.packId===pack.id).forEach((w,i)=>{w.assetStatus='approved';w.imageUrl=images[i%images.length];});});
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
    const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
    const body=packPracticeOptions(app.store.state(status))[0].request;
    const call=(path:string,data:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const response=await call('/api/session/start',body);assert.equal(response.status,200);
    const round=await response.json();assert.equal(round.wordIds.length,16);assert.equal(round.practicePackId,pack.id);assert.equal(round.practiceOnly,true);
    const again=await call('/api/session/end',{sessionId:round.id,action:'restart'});assert.equal(again.status,200);
    const restarted=(await again.json()).state.activeSession;assert.notEqual(restarted.id,round.id);assert.equal(restarted.practicePackId,pack.id);assert.equal(restarted.wordIds.length,16);
    assert.doesNotThrow(()=>validateBackup(app.store.exportBackup()));
    assert.equal((await call('/api/session/start',{...body,mode:'resume',sessionId:restarted.id})).status,400);
  }finally{await app.close();assert.ok(dir.startsWith(join(tmpdir(),'pack-practice-api-')));rmSync(dir,{recursive:true,force:true});}
});
