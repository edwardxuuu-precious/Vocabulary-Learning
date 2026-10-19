import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store,validateBackup } from '../server/store.ts';
import { createApp } from '../server/index.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { fixedPackGame,packGameCatalogue } from '../shared/pack-games.ts';
import { packPracticeOptions, packReplayRequest } from '../shared/pack-practice.ts';
import { gameRegistry } from '../shared/game-registry.ts';
import type { LearningSession } from '../shared/contracts.ts';

const offline={configured:false,available:false,status:'test_offline',detail:'隔离测试，无云调用'};
const status={speech:offline,codex:offline};
function seed(store:Store){
  const images=store.read().words.map(word=>word.imageUrl);
  const book=store.createPack('玩法词表',Array.from({length:13},(_,i)=>({term:`word${String.fromCharCode(97+i)}`,meaning:`词义${i}`})));
  store.mutate(data=>{data.settings.voiceEnabled=false;data.settings.dailyNewWords=1;data.packs.find(p=>p.id===book.id)!.enabled=true;data.words.filter(w=>w.packId===book.id).forEach((w,i)=>{w.assetStatus='approved';w.partOfSpeech='noun';w.imageUrl=images[i%images.length];});});
  return {book,ids:store.read().words.filter(w=>w.packId===book.id).map(w=>w.id)};
}
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'pack-games-'));let store=new Store(dir,()=>new Date('2026-10-18T01:00:00Z'));const {book,ids}=seed(store);
  return {get store(){return store;},book,ids,request(game?:string){return {mode:'practice',packId:book.id,wordIds:ids,strategy:game?'classic':'memory-loop',...(game?{game}:{})} as Parameters<Store['startSession']>[2];},
    restart(){store.close();store=new Store(dir,()=>new Date('2026-10-18T01:00:00Z'));},close(){store.close();assert.ok(dir.startsWith(join(tmpdir(),'pack-games-')));rmSync(dir,{recursive:true,force:true});}};
}
const active=(store:Store)=>store.state(status).activeSession!;

test('review, random play and each fixed game have independent saved sessions and retry identities',()=>{
  const f=fixture();try{
    const review=f.store.startSession('random',{},f.request());
    const flip=f.store.startSession('random',{}, {...f.request('flip'),requestId:'fixed-flip-request'});
    assert.equal(flip.wordIds.length,13);assert.ok(flip.activities!.every(a=>a.kind==='flip'&&a.step==='sound'));assert.ok(!flip.learningPolicy);assert.equal(flip.practiceOnly,true);
    const random=f.store.startSession('random',{},f.request('random'));
    const gate=f.store.startSession('random',{},f.request('gate'));
    assert.equal(new Set([review.id,flip.id,random.id,gate.id]).size,4);
    assert.equal(packPracticeOptions(f.store.state(status))[0].resume!.id,review.id);
    assert.equal(packReplayRequest(f.store.state(status),flip)!.game,'flip');
    assert.equal(packReplayRequest(f.store.state(status),review)!.game,undefined);
    assert.equal(f.store.startSession('random',{},f.request('flip')).id,flip.id);
    assert.equal(f.store.startSession('random',{}, {...f.request('flip'),requestId:'fixed-flip-request'}).id,flip.id);
    assert.throws(()=>f.store.startSession('random',{}, {...f.request('random'),requestId:'fixed-flip-request'}),/另一轮/);
    assert.ok(review.activities!.every(a=>a.kind==='standard'||a.step==='recall'&&a.kind==='portal'));
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('fixed-game partial board and random playlist survive process restart and backup restore unchanged',()=>{
  const f=fixture();try{
    const round=f.store.startSession('random',{},f.request('flip')),a=currentActivity(round)!;
    f.store.activityEvent({sessionId:round.id,activityId:a.id,action:'listen'});
    f.store.activityEvent({sessionId:round.id,activityId:a.id,action:'choose',selectedId:a.wordId});
    const before=active(f.store);assert.equal(before.activityStates![a.id].outcome,'correct');
    f.restart();assert.deepEqual(active(f.store).activityStates,before.activityStates);assert.deepEqual(active(f.store).activities,before.activities);
    f.store.restoreBackup(f.store.exportBackup());assert.deepEqual(active(f.store).packGame,before.packGame);assert.equal(currentActivity(active(f.store))!.id,a.id);
    f.store.activityEvent({sessionId:round.id,activityId:a.id,action:'next'});assert.notEqual(currentActivity(active(f.store))!.id,a.id);
    const random=f.store.startSession('random',{},f.request('random'));const playlist=random.activities!;
    f.restart();assert.deepEqual(active(f.store).activities,playlist);assert.equal(f.store.startSession('random',{},f.request('random')).id,random.id);
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('fixed games never introduce other games; unavailable requirements remain unavailable',()=>{
  const f=fixture();try{
    const words=f.store.read().words.filter(w=>w.packId===f.book.id),catalogue=packGameCatalogue(words,{allowedKinds:gameRegistry.filter(g=>g.step!=='spell').map(g=>g.kind)});
    for(const game of catalogue.games.filter(game=>game.wordCount)){
      const round=f.store.startSession('random',{},f.request(game.kind));
      assert.ok(round.activities!.every(a=>a.kind===game.kind));assert.ok(new Set(round.wordIds).size===round.wordIds.length);
      assert.ok(round.activities!.every(a=>a.choices.every(w=>f.ids.includes(w.id))));
      assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()),game.kind);
    }
    const last=f.store.read().sessions.length;
    for(const kind of ['mimic','quiz','letter-gap'])assert.throws(()=>f.store.startSession('random',{},f.request(kind)),/没有合适/);
    assert.equal(f.store.read().sessions.length,last);
    assert.throws(()=>f.store.startSession('random',{}, {...f.request(),game:['flip']} as never),/请选择/);
    assert.throws(()=>f.store.startSession('random',{}, {...f.request('flip'),packId:undefined}),/请选择/);
    const single=fixedPackGame(words.slice(0,1),'flip');assert.deepEqual(single,[],'never add examples to make a game playable');
  }finally{f.close();}
});

test('random and grouped games finish with real practice evidence; no formal mastery is created',()=>{
  const f=fixture();try{
    for(const kind of ['random','queue','collect','route','portal']){
      const round=f.store.startSession('random',{},f.request(kind));
      for(let i=0;i<100&&currentActivity(active(f.store));i++){
        const a=currentActivity(active(f.store))!;
        f.store.activityEvent({sessionId:round.id,activityId:a.id,action:'skip'});
        assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()),kind);
        f.store.activityEvent({sessionId:round.id,activityId:a.id,action:'next'});
      }
      assert.equal(active(f.store).completedWordIds.length,round.wordIds.length);
      f.store.updateSession({sessionId:round.id,complete:true});
    }
    assert.deepEqual(f.store.read().progress,[]);assert.deepEqual(f.store.read().assessmentProgress,[]);
    assert.ok(f.store.read().attempts.every(attempt=>attempt.practiceOnly&&attempt.sessionPracticeOnly));
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('game scope metadata is validated and explicit restart preserves the selected game without touching review',()=>{
  const f=fixture();try{
    const review=f.store.startSession('random',{},f.request());const game=f.store.startSession('random',{},f.request('flip'));
    const replacement=f.store.manageSession({sessionId:game.id,action:'restart'})!;
    assert.notEqual(replacement.id,game.id);assert.equal(replacement.packGame!.selection,'flip');assert.ok(replacement.activities!.every(a=>a.kind==='flip'));
    assert.equal(packPracticeOptions(f.store.state(status))[0].resume!.id,review.id);
    const bad=f.store.exportBackup();bad.data.sessions.find(s=>s.id===replacement.id)!.packGame!.selection='gate';assert.throws(()=>validateBackup(bad),/词表游戏/);
    const wrongScope=f.store.exportBackup(),foreign=wrongScope.data.words.find(word=>!f.ids.includes(word.id))!;
    const activity=wrongScope.data.sessions.find(s=>s.id===replacement.id)!.activities![0];
    activity.choices[activity.choices.findIndex(word=>word.id!==activity.wordId)]={...activity.word,id:foreign.id};
    assert.throws(()=>validateBackup(wrongScope),/词表游戏/);
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('the child game catalogue and chosen-game HTTP start need no PIN and never generate missing assets',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pack-games-api-'));let generated=0;
  const app=createApp({dataDir:dir,integrations:{probeIntegrations:async()=>status,ttsStatus:()=>offline,getCachedSpeech:async()=>undefined,synthesizeSpeech:async()=>{generated++;throw Error('Forbidden');}}});
  try{
    const {book,ids}=seed(app.store);await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
    const response=await fetch(`${base}/api/pack-games?packId=${book.id}`);assert.equal(response.status,200);const catalogue=await response.json();assert.equal(catalogue.games.find((g:{kind:string})=>g.kind==='flip').wordCount,13);
    assert.ok(catalogue.games.filter((g:{step:string})=>g.step==='spell').every((g:{wordCount:number})=>g.wordCount===0));
    const start=await fetch(base+'/api/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'practice',packId:book.id,wordIds:ids,game:'flip',strategy:'classic'})});assert.equal(start.status,200);
    const round=await start.json() as LearningSession;assert.ok(round.activities!.every(a=>a.kind==='flip'));
    assert.equal((await fetch(`${base}/api/pack-games?packId=missing`)).status,409);assert.equal(generated,0);
  }finally{await app.close();assert.ok(dir.startsWith(join(tmpdir(),'pack-games-api-')));rmSync(dir,{recursive:true,force:true});}
});
