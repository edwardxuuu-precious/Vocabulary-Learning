import {sentenceKey} from '../shared/sentence-study.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Store,validateBackup} from '../server/store.ts';
import {createChallengeManager,type ChallengeServices} from '../server/challenges.ts';
import {submitChallenge} from '../server/challenge-state.ts';
import {assessmentCurrent} from '../shared/assessment.ts';
import {assessmentCue,activeAssessmentCue,repairableAssessmentItem,validAssessmentCue,challengeReviewResult} from '../shared/assessment-cues.ts';
import type {AssessmentSession} from '../shared/contracts.ts';

function wav(seed=1){
  const count=4800,audio=Buffer.alloc(44+count*2);
  audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(count*2,40);
  for(let n=0;n<count;n++)audio.writeInt16LE(Math.round(Math.sin(n*(.05+seed*.001))*3000),44+n*2);
  return audio;
}
function teachFixture(store:Store,ids:string[]){for(const id of ids){const word=store.read().words.find(w=>w.id===id)!;const key=sentenceKey(word);for(const action of [{action:'start'},{action:'demonstrate',source:'adult'},{action:'choose',term:word.term}])store.sentenceStudy({wordId:id,key,...action});}}
const tenWords=[['all','所有的'],['am','是'],['are','是'],['at','在……处'],['ate','吃了'],['be','是'],['black','黑色的'],['brown','棕色的'],['but','但是'],['came','来了']];
function fixture(services?:ChallengeServices,vocabulary=[['am','是'],['are','是'],['be','是'],['cat','猫']]){
  const dir=mkdtempSync(join(tmpdir(),'assessment-cues-'));let now=new Date('2026-11-16T10:00:00Z');
  const store=new Store(dir,()=>now);
  store.mutate(data=>{
    data.packs=[{id:'fixture',title:'工程隔离示例',enabled:true,createdAt:now.toISOString()}];
    data.words=data.words.slice(0,vocabulary.length).map((word,n)=>({...word,id:vocabulary[n][0],term:vocabulary[n][0],meaning:vocabulary[n][1],packId:'fixture',learningVersion:0}));
    const ids=data.words.map(w=>w.id);data.sessions=[{id:'learned',wordIds:ids,completedWordIds:ids,startedAt:now.toISOString(),completedAt:now.toISOString(),rewardGranted:true}];
  });
  const manager=createChallengeManager({store,dataDir:dir,imageAvailable:()=>true,services:services??{transcribe:async()=>{throw Error('本测试不调用转写');},grade:async()=>{throw Error('本测试不调用初判');}}});
  return {store,manager,advance(){now=new Date(now.getTime()+1000);},start(ids=vocabulary.map(word=>word[0]),modern:boolean|2=true){if(modern===2)teachFixture(store,ids);return store.createAssessment({wordIds:ids,workflow:'recorded',...(modern?{cueVersion:modern===2?2:1}:{})});},
    current:()=>store.read().assessments!.at(-1)!,
    submit(round:AssessmentSession){while(assessmentCurrent(round)){const item=assessmentCurrent(round)!;round=manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'skip'});}return store.mutate(data=>submitChallenge(data,round.id,now,()=>true));},
    review(round:AssessmentSession,itemId:string,result:string){const item=round.items.find(i=>i.id===itemId)!;return manager.review(round.id,{items:[{itemId,responseVersion:item.response!.version,proposalVersion:0,reviewVersion:item.reviews?.length??0,result}]});},
    async close(){await manager.close();store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&dir.includes('assessment-cues-'));rmSync(dir,{recursive:true,force:true});}
  };
}
function seek(f:ReturnType<typeof fixture>,round:AssessmentSession,term:string){while(assessmentCurrent(round)?.word.term!==term||assessmentCurrent(round)?.dimension!=='zh-en'){const item=assessmentCurrent(round);assert.ok(item);round=f.manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'skip'});}return round;}

test('Chinese prompts distinguish supported be forms and refuse ambiguous senses without changing the vocabulary',()=>{
  const pool=[{term:'am',meaning:'是'},{term:'are',meaning:'是'},{term:'be',meaning:'是'}];
  assert.equal(assessmentCue(pool[0],pool,1).text,'我是……');assert.equal(assessmentCue(pool[1],pool,1).text,'你是……');assert.equal(assessmentCue({term:'is',meaning:'是'},pool,1).text,'他是……');
  assert.equal(assessmentCue(pool[2],pool,1).kind,'needs-context');assert.equal(assessmentCue({term:'cat',meaning:'猫'},pool).kind,'meaning');
  assert.equal(assessmentCue({term:'big',meaning:'大'},[{term:'big',meaning:'大'},{term:'large',meaning:'大'}]).kind,'needs-context');
  assert.deepEqual(pool,[{term:'am',meaning:'是'},{term:'are',meaning:'是'},{term:'be',meaning:'是'}]);
});

test('all ten confirmed senses have a valid sentence context with exactly one blank and no printed target',async()=>{
  const f=fixture(undefined,tenWords);try{
    const original=structuredClone(f.store.read().words),round=f.start(undefined,2);
    const cues=round.items.filter(item=>item.dimension==='zh-en');assert.equal(cues.length,10);assert.equal(round.items.length,40);
    for(const item of cues){
      assert.equal(item.cue!.version,2);assert.equal(item.cue!.kind,'context');assert.ok(validAssessmentCue(item.cue,item.word));assert.equal(item.cue!.sentence!.split('___').length,2);
      assert.ok(!item.cue!.sentence!.toLowerCase().match(/[a-z]+/g)!.includes(item.word.term));
    }
    assert.equal(cues.find(item=>item.word.term==='be')!.cue!.sentence,'I want to ___ a cook.');
    assert.equal(assessmentCue({term:'be',meaning:'蜜蜂'}).kind,'meaning');
    const forged=f.store.exportBackup();forged.data.assessments![0].items.find(item=>item.word.term==='be'&&item.dimension==='zh-en')!.cue!.sentence='I want to be a cook.';assert.throws(()=>validateBackup(forged));
    assert.deepEqual(f.store.read().words,original);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{await f.close();}
});

test('an already skipped bad question can be re-recorded with its new context without inventing an answer or losing the round',async()=>{
  const f=fixture();try{
    let round=seek(f,f.start(['be','am']),'be');const item=assessmentCurrent(round)!;round=f.manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'unavailable',cueVersion:1});
    const saved=structuredClone(round),oldItem=round.items.find(row=>row.id===item.id)!;assert.equal(repairableAssessmentItem(oldItem),true);assert.equal(activeAssessmentCue(oldItem).sentence,'I want to ___ a cook.');
    teachFixture(f.store,['be']);round=f.manager.respond(round.id,{itemId:item.id,expectedVersion:1,action:'prepare-cue',cueVersion:2});assert.deepEqual(round,saved);assert.ok(validateBackup(f.store.exportBackup()));
    f.advance();round=f.manager.upload(round.id,item.id,1,wav(2),2);const repaired=round.items.find(row=>row.id===item.id)!;
    assert.equal(repaired.cue!.version,2);assert.equal(repaired.response!.version,2);assert.equal(repaired.response!.cueVersion,2);assert.equal(repaired.response!.kind,'recording');assert.equal(repairableAssessmentItem(repaired),false);assert.equal(challengeReviewResult(repaired,'correct'),'correct');
    assert.equal(round.id,saved.id);assert.deepEqual(round.wordIds,saved.wordIds);assert.deepEqual(round.items.filter(row=>row.id!==item.id),saved.items.filter(row=>row.id!==item.id));assert.ok(validateBackup(f.store.exportBackup()));
  }finally{await f.close();}
});

test('all forty items including contextual be can complete and receive versioned parent verification',async()=>{
  const graded:{term:string;sentence?:string}[]=[];
  const f=fixture({transcribe:async()=> '工程转写替身',grade:async answers=>{graded.push(...answers);return answers.map(answer=>({id:answer.id,verdict:'matched',reason:'工程初判替身'}));}},tenWords);
  try{
    let round=f.start(undefined,2);
    while(assessmentCurrent(round)){
      const item=assessmentCurrent(round)!;
      round=item.dimension==='look'?f.manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'choose',selectedId:item.word.id}):f.manager.upload(round.id,item.id,0,wav(),item.dimension==='zh-en'?2:undefined);
    }
    round=f.manager.submit(round.id);
    for(let n=0;n<200&&f.current().job?.status!=='review';n++)await new Promise(done=>setTimeout(done,5));
    round=f.current();assert.equal(round.job!.status,'review');assert.equal(graded.length,30);assert.equal(graded.filter(answer=>answer.sentence).length,10);assert.equal(graded.find(answer=>answer.term==='be'&&answer.sentence)!.sentence,'I want to ___ a cook.');
    round=f.manager.review(round.id,{items:round.items.filter(item=>item.dimension!=='look').map(item=>({itemId:item.id,responseVersion:item.response!.version,proposalVersion:item.proposal!.version,reviewVersion:0,result:'correct'}))});
    assert.ok(round.items.every(item=>item.result==='correct'));assert.equal(f.store.read().assessmentAttempts!.length,40);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{await f.close();}
});

test('frozen cues survive backup and cannot replace the target text or forge a supported context',async()=>{
  const f=fixture();try{
    const round=f.start();assert.equal(round.items.find(i=>i.word.id==='am'&&i.dimension==='zh-en')!.cue?.text,'我是……');
    assert.ok(round.items.filter(i=>i.dimension!=='zh-en').every(i=>!i.cue));assert.ok(validateBackup(f.store.exportBackup()));
    f.store.restoreBackup(f.store.exportBackup());assert.deepEqual(f.current(),round);
    const item=round.items.find(i=>i.word.id==='am'&&i.dimension==='zh-en')!;
    assert.equal(validAssessmentCue({...item.cue,text:'am'},item.word),false);
    const forged=f.store.exportBackup();forged.data.assessments![0].items.find(i=>i.id===item.id)!.cue!.text='你是……';assert.throws(()=>validateBackup(forged));
  }finally{await f.close();}
});

test('an image hint is persistent, idempotent and limits parent confirmation to assisted success',async()=>{
  const f=fixture();try{
    let round=seek(f,f.start(['am']),'am');const item=assessmentCurrent(round)!;
    const hint={itemId:item.id,expectedVersion:0,action:'picture-hint',cueVersion:1};round=f.manager.respond(round.id,hint);const marker=structuredClone(round.items.find(i=>i.id===item.id)!.pictureHint);
    f.advance();round=f.manager.respond(round.id,hint);assert.deepEqual(round.items.find(i=>i.id===item.id)!.pictureHint,marker);assert.equal(assessmentCurrent(round)!.response,undefined);
    round=f.manager.upload(round.id,item.id,0,wav(),1);assert.equal(round.items.find(i=>i.id===item.id)!.response!.pictureHinted,true);assert.ok(validateBackup(f.store.exportBackup()));
    const forged=f.store.exportBackup();delete forged.data.assessments![0].items.find(i=>i.id===item.id)!.response!.pictureHinted;assert.throws(()=>validateBackup(forged));
    round=f.submit(round);round=f.review(round,item.id,'correct');assert.equal(round.items.find(i=>i.id===item.id)!.result,'hinted');
    assert.equal(f.store.read().assessmentProgress!.find(row=>row.dimension==='zh-en')!.stage,0);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{await f.close();}
});

test('opening a picture after a saved answer preserves that version; only the later re-record uses help',async()=>{
  const f=fixture();try{
    let round=seek(f,f.start(['am']),'am');const item=assessmentCurrent(round)!;
    round=f.manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'prepare-cue',cueVersion:1});assert.equal(assessmentCurrent(round)!.response,undefined);
    round=f.manager.upload(round.id,item.id,0,wav(),1);const saved=structuredClone(round.items.find(i=>i.id===item.id)!.response);f.advance();
    round=f.manager.respond(round.id,{itemId:item.id,expectedVersion:1,action:'picture-hint',cueVersion:1});let current=round.items.find(i=>i.id===item.id)!;assert.deepEqual(current.response,saved);assert.equal(challengeReviewResult(current,'correct'),'correct');assert.ok(validateBackup(f.store.exportBackup()));
    f.advance();round=f.manager.upload(round.id,item.id,1,wav(2),1);current=round.items.find(i=>i.id===item.id)!;assert.equal(current.response!.version,2);assert.equal(current.response!.pictureHinted,true);assert.equal(challengeReviewResult(current,'correct'),'hinted');assert.ok(validateBackup(f.store.exportBackup()));
  }finally{await f.close();}
});

test('an unusable prompt is set aside without a wrong answer, fabricated recording or formal advancement',async()=>{
  const f=fixture();try{
    let round=seek(f,f.start(['be']),'be');const item=assessmentCurrent(round)!;
    assert.throws(()=>f.manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'prepare-cue',cueVersion:1}),/缺少明确语境/);
    assert.throws(()=>f.manager.upload(round.id,item.id,0,wav(),1),/缺少明确语境/);
    round=f.manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'unavailable',cueVersion:1});assert.equal(round.items.find(i=>i.id===item.id)!.response!.kind,'unavailable');
    round=f.submit(round);round=f.review(round,item.id,'incorrect');assert.equal(round.items.find(i=>i.id===item.id)!.result,'unavailable');assert.equal(f.store.read().assessmentProgress!.some(row=>row.dimension==='zh-en'),false);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{await f.close();}
});

test('old bare-meaning recordings cannot be newly confirmed right or wrong as if they had distinguishing context',async()=>{
  const f=fixture();try{
    let round=seek(f,f.start(['am'],false),'am');const item=assessmentCurrent(round)!;assert.equal(item.cue,undefined);
    round=f.manager.upload(round.id,item.id,0,wav());round=f.submit(round);round=f.review(round,item.id,'correct');assert.equal(round.items.find(i=>i.id===item.id)!.result,'unconfirmed');
    round=f.review(round,item.id,'incorrect');assert.equal(round.items.find(i=>i.id===item.id)!.result,'unconfirmed');assert.ok(validateBackup(f.store.exportBackup()));
  }finally{await f.close();}
});

test('background grading omits ambiguous legacy audio and passes the frozen context only for a versioned answer',async()=>{
  let transcriptions=0;const seen:{term:string;cue?:string}[]=[];
  const f=fixture({transcribe:async()=>{transcriptions++;return 'are';},grade:async answers=>{seen.push(...answers);return answers.map(answer=>({id:answer.id,verdict:'matched',reason:'隔离初判替身'}));}});
  try{
    let legacy=seek(f,f.start(['am'],false),'am');let item=assessmentCurrent(legacy)!;legacy=f.manager.upload(legacy.id,item.id,0,wav());legacy=f.submit(legacy);
    let modern=seek(f,f.start(['are']),'are');item=assessmentCurrent(modern)!;modern=f.manager.upload(modern.id,item.id,0,wav(2),1);modern=f.submit(modern);f.manager.submit(modern.id);
    for(let n=0;n<200&&f.store.read().assessments!.some(round=>round.job?.status!=='review');n++)await new Promise(done=>setTimeout(done,5));
    assert.ok(f.store.read().assessments!.every(round=>round.job?.status==='review'));assert.equal(transcriptions,1);assert.deepEqual(seen.map(answer=>({term:answer.term,cue:answer.cue})),[{term:'are',cue:'你是……'}]);
    assert.equal(f.store.read().assessments!.find(round=>round.id===legacy.id)!.items.find(i=>i.word.term==='am'&&i.dimension==='zh-en')!.transcript,undefined);
  }finally{await f.close();}
});
