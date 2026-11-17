import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {Store,validateBackup} from '../server/store.ts';
import {createApp} from '../server/index.ts';
import {saveChallengeResponse} from '../server/challenge-state.ts';
import {sentenceKey,sentenceLesson,studiedSentence,pendingSentenceWords} from '../shared/sentence-study.ts';

const off={configured:false,available:false,status:'fixture',detail:'隔离示例，无云调用'},services={speech:off,codex:off};
function seed(store:Store){store.mutate(data=>{const now=store.clock().toISOString();data.settings.voiceEnabled=false;data.packs=[{id:'fixture',title:'工程隔离词书',enabled:true,createdAt:now}];data.words=data.words.slice(0,3).map((word,n)=>({...word,id:['be','am','are'][n],term:['be','am','are'][n],meaning:'是',learningVersion:0,packId:'fixture'}));const ids=data.words.map(w=>w.id);data.sessions=[{id:'learned',entrySource:{entry:'learn',kind:'selected'},wordIds:ids,completedWordIds:ids,startedAt:now,completedAt:now,rewardGranted:true}];});}
function fixture(){const dir=mkdtempSync(join(tmpdir(),'sentence-study-'));let now=new Date('2026-11-16T12:00:00Z');const store=new Store(dir,()=>now);seed(store);return {dir,store,advance(ms=1000){now=new Date(now.getTime()+ms);},word:(id='be')=>store.read().words.find(w=>w.id===id)!,act(id:string,action:string,extra={}){return store.sentenceStudy({wordId:id,key:sentenceKey(store.read().words.find(w=>w.id===id)!),action,...extra});},close(){store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&dir.includes('sentence-study-'));rmSync(dir,{recursive:true,force:true});}};}
function teach(f:ReturnType<typeof fixture>,id:string){f.act(id,'start');f.act(id,'demonstrate',{source:'adult'});f.act(id,'choose',{term:id});}

test('unlearned sentence tests are gated; demonstration and guided practice persist without creating formal success',()=>{
  const f=fixture();try{
    const before=f.store.read();assert.throws(()=>f.store.createAssessment({wordIds:['be'],workflow:'recorded',cueVersion:2}),/先学这句/);assert.equal(f.store.read().assessments!.length,0);
    f.act('be','start');assert.throws(()=>f.act('be','choose',{term:'be'}),/先听一遍/);assert.throws(()=>f.act('be','demonstrate',{source:'text'}),/先听示范/);
    f.act('be','demonstrate',{source:'adult'});f.act('be','choose',{term:'am'});assert.equal(studiedSentence(f.store.read(),f.word()),undefined);
    f.advance();f.act('be','choose',{term:'be'});assert.ok(studiedSentence(f.store.read(),f.word()));const saved=structuredClone(f.store.read().sentenceStudies);
    f.advance();f.act('be','choose',{term:'be'});assert.deepEqual(f.store.read().sentenceStudies,saved);
    const round=f.store.createAssessment({wordIds:['be'],workflow:'recorded',cueVersion:2});assert.equal(round.items[0].cue!.sentence,sentenceLesson(f.word())!.cue.sentence);
    assert.deepEqual(f.store.read().assessmentAttempts,before.assessmentAttempts);assert.deepEqual(f.store.read().assessmentProgress,before.assessmentProgress);assert.deepEqual(f.store.read().attempts,before.attempts);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('an existing challenge keeps all answers; its repaired question cannot start before learning the sentence',()=>{
  const f=fixture();try{
    let round=f.store.createAssessment({wordIds:['be'],workflow:'recorded',cueVersion:1});const item=round.items[0];round=f.store.mutate(data=>saveChallengeResponse(data,round.id,{itemId:item.id,expectedVersion:0,action:'unavailable',cueVersion:1},f.store.clock(),()=>true));const original=structuredClone(round);
    assert.throws(()=>f.store.mutate(data=>saveChallengeResponse(data,round.id,{itemId:item.id,expectedVersion:1,action:'prepare-cue',cueVersion:2},f.store.clock(),()=>true)),/先学这句/);
    teach(f,'be');const prepared=f.store.mutate(data=>saveChallengeResponse(data,round.id,{itemId:item.id,expectedVersion:1,action:'prepare-cue',cueVersion:2},f.store.clock(),()=>true));assert.deepEqual(prepared,original);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('partial sentence learning survives backup; forged completion and stale senses cannot unlock tests',()=>{
  const f=fixture();try{
    f.act('be','start');f.act('be','demonstrate',{source:'adult'});f.act('be','choose',{term:'are'});const partial=f.store.exportBackup();assert.ok(validateBackup(partial));f.store.restoreBackup(partial);assert.equal(pendingSentenceWords(f.store.read(),[f.word()]).length,1);
    const forged=structuredClone(partial);forged.data.sentenceStudies![0].completedAt=f.store.clock().toISOString();assert.throws(()=>validateBackup(forged));
    const badCue=structuredClone(partial);badCue.data.sentenceStudies![0].cue.sentence='I want to ___ happy.';assert.throws(()=>validateBackup(badCue));
    f.act('be','choose',{term:'be'});assert.ok(studiedSentence(f.store.read(),f.word()));f.store.mutate(data=>{data.words[0].learningVersion=1;});assert.equal(studiedSentence(f.store.read(),f.word()),undefined);assert.ok(validateBackup(f.store.exportBackup()));
    const legacy=f.store.exportBackup();delete legacy.data.sentenceStudies;assert.ok(validateBackup(legacy));
  }finally{f.close();}
});

test('child HTTP rejects missing audio, records adult demonstration honestly and enforces screen rest',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sentence-study-http-'));let now=new Date('2026-11-16T12:00:00Z');let cloud=0;
  const app=createApp({dataDir:dir,clock:()=>now,integrations:{probeIntegrations:async()=>services,getCachedSpeech:async()=>undefined,synthesizeSpeech:async()=>{cloud++;throw Error('不得调用云');}}});seed(app.store);
  try{
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`,word=app.store.read().words[0],key=sentenceKey(word);
    const call=(action:string,extra={})=>fetch(base+'/api/sentence-study',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wordId:word.id,key,action,...extra})});
    assert.equal((await call('start')).status,200);assert.equal((await call('demonstrate',{source:'audio'})).status,409);assert.equal(app.store.read().sentenceStudies![0].demonstratedAt,undefined);assert.equal(cloud,0);
    assert.equal((await call('demonstrate',{source:'adult'})).status,200);assert.equal(app.store.read().sentenceStudies![0].model,'adult');assert.equal((await call('choose',{term:'be'})).status,200);
    app.store.screenTime.heartbeat('sentence-visible-tab',true);for(let n=0;n<181;n++){now=new Date(now.getTime()+5000);app.store.screenTime.heartbeat('sentence-visible-tab',true);}assert.ok(app.store.screenTime.view().breakUntil);assert.equal((await call('start')).status,423);assert.equal(app.store.read().assessmentAttempts!.length,0);
  }finally{await app.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&dir.includes('sentence-study-http-'));rmSync(dir,{recursive:true,force:true});}
});

test('the child entry teaches before showing the cloze test and the completion primary action leads to usage learning',async()=>{
  const f=fixture(),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{
    const {ChildChallenge}=await vite.ssrLoadModule('/src/child-challenge.tsx'),{LearningReward}=await vite.ssrLoadModule('/src/child-growth.tsx');let state=f.store.state(services);const props={state,initialWordIds:state.words.map(w=>w.id),reload:async()=>state,onExit(){}};
    const study=renderToStaticMarkup(createElement(ChildChallenge,props));assert.match(study,/先学会怎么用，再来测试/);assert.doesNotMatch(study,/开始录音|补一句，说英文/);
    const reward=renderToStaticMarkup(createElement(LearningReward,{state,session:state.lastCompletedSession,onTest(){},onHome(){},onGrowth(){}}));assert.match(reward,/学会怎么用/);assert.doesNotMatch(reward,/开始3词测试/);
    for(const word of state.words)teach(f,word.id);state=f.store.state(services);const ready=renderToStaticMarkup(createElement(ChildChallenge,{...props,state}));assert.doesNotMatch(ready,/先学会怎么用，再来测试/);assert.match(ready,/开始挑战/);
  }finally{await vite.close();f.close();}
});
