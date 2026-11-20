import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { Store } from '../server/store.ts';
import { createApp } from '../server/index.ts';
import { dailyLearningPlan, learningDay } from '../shared/learning.ts';
import { entryRecommendation, recommendedEntrySession } from '../shared/entry-recommendation.ts';
import { learningReturn } from '../shared/learning-entry.ts';

const now=new Date('2026-10-25T04:00:00Z');
const offline={configured:false,available:false,status:'fixture',detail:'隔离工程替身，不调用云'};
function seed(store:Store){
  store.mutate(data=>{
    data.settings={...data.settings,learningStrategy:'memory-loop',dailyNewWords:3,dailyReviewWords:2,sessionMinutes:10,voiceEnabled:false};
    data.packs=[{id:'a',title:'隔离甲',enabled:true,createdAt:'2026-10-01T00:00:00Z'},{id:'b',title:'隔离乙',enabled:true,createdAt:'2026-10-02T00:00:00Z'}];
    data.words=data.words.slice(0,10).map((word,index)=>({...word,packId:index%2?'b':'a',learningVersion:0,assetStatus:'approved'}));
    const ids=data.words.slice(0,4).map(word=>word.id);
    data.sessions=[{id:'introduced',wordIds:ids,completedWordIds:ids,startedAt:'2026-10-23T01:00:00Z',completedAt:'2026-10-23T01:00:00Z',rewardGranted:false,
      exposures:ids.map(wordId=>({wordId,learningVersion:0,introducedAt:'2026-10-23T01:00:00Z'}))}];
  });
  return store.read().words.map(word=>word.id);
}
function fixture(){const dir=mkdtempSync(join(tmpdir(),'entry-recommend-'));let store=new Store(dir,()=>now);const ids=seed(store);
  return {ids,get store(){return store;},restart(){store.close();store=new Store(dir,()=>now);},close(){store.close();rmSync(dir,{recursive:true,force:true});}};}

test('L02/R02: previews and starts share separate purposes, quotas and cross-book due scopes without writes',()=>{
  const f=fixture();try{
    const before=f.store.exportBackup(),data=f.store.read();
    const learn=entryRecommendation(data,'learn',now),review=entryRecommendation(data,'review',now);
    assert.equal(learn.fresh.length,3,'due backlog does not consume the new-word recommendation');
    assert.ok(learn.tasks.every(task=>task.mode==='new'&&task.steps.includes('learn')));
    assert.ok(learn.fresh.every(word=>!f.ids.slice(0,4).includes(word.id)));assert.equal(learn.review.length,0);
    assert.equal(review.review.length,2);assert.equal(new Set(review.review.map(word=>word.packId)).size,2);
    assert.ok(review.tasks.every(task=>task.mode==='review'&&!task.steps.includes('learn')));assert.equal(review.fresh.length,0);
    assert.deepEqual(f.store.exportBackup(),before,'preview cannot reserve, start or grade');
    const first=f.store.startSession(false,{}, {entry:'learn'}),second=f.store.startSession(false,{}, {entry:'review'});
    assert.deepEqual(first.wordIds,learn.fresh.map(word=>word.id));assert.deepEqual(second.wordIds,review.review.map(word=>word.id));
    assert.deepEqual(second.tasks!.map(task=>new Set(task.steps)),review.tasks.map(task=>new Set(task.steps)));
    assert.equal(first.practiceOnly,false);assert.equal(second.practiceOnly,false);
  }finally{f.close();}
});
test('L02/R02: independent recommendations resume frozen plans across switch, restart and backup; other sources remain explicit',()=>{
  const f=fixture();try{
    const first=f.store.startSession(false,{}, {entry:'learn'}),second=f.store.startSession(false,{}, {entry:'review'});
    f.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'a',wordIds:[f.ids[0],f.ids[2]]});
    f.restart();assert.equal(f.store.startSession(false,{}, {entry:'learn'}).id,first.id);assert.equal(f.store.startSession(false,{}, {entry:'review'}).id,second.id);
    const backup=f.store.exportBackup();f.store.restoreBackup(backup);
    const state=f.store.state({speech:offline,codex:offline});
    assert.equal(recommendedEntrySession(state,'learn')!.id,first.id);assert.equal(recommendedEntrySession(state,'review')!.id,second.id);
    assert.deepEqual(f.store.read().sessions.find(row=>row.id===first.id)!.activities,first.activities);
    assert.equal(learningReturn(first),'hub');assert.equal(learningReturn(second),'review');
  }finally{f.close();}
});
test('R02: no-due and completed recommendations never fall back to new or supplemental words',()=>{
  const f=fixture();try{
    f.store.mutate(data=>{data.settings.dailyNewWords=6;for(const session of data.sessions){session.startedAt=now.toISOString();session.exposures?.forEach(fact=>fact.introducedAt=now.toISOString());}});
    assert.equal(entryRecommendation(f.store.read(),'review',now).reason,'no-due');
    const before=f.store.exportBackup();assert.throws(()=>f.store.startSession(false,{}, {entry:'review'}),/到期|复习时/);
    assert.deepEqual(f.store.exportBackup(),before);assert.ok(entryRecommendation(f.store.read(),'learn',now).fresh.length);
    f.store.mutate(data=>{data.words=data.words.slice(0,4);});
    assert.equal(entryRecommendation(f.store.read(),'learn',now).reason,'no-new');
    assert.throws(()=>f.store.startSession(false,{}, {entry:'learn'}),/去复习/);
  }finally{f.close();}
});
test('L02: reservation and progress alone are not learning, and Shanghai midnight restores the daily allowance',()=>{
  const f=fixture();try{
    f.store.mutate(data=>{data.progress=[{wordId:f.ids[4],skill:'listen',stage:3,successes:3,attempts:3,dueAt:'2026-10-01T00:00:00Z'}];});
    assert.ok(entryRecommendation(f.store.read(),'learn',now).fresh.some(word=>word.id===f.ids[4]));
    assert.ok(!entryRecommendation(f.store.read(),'review',now).due.some(word=>word.id===f.ids[4]));
    const round=f.store.startSession(false,{}, {entry:'learn'});
    assert.equal(entryRecommendation(f.store.read(),'learn',now).remainingNew,0);
    f.store.updateSession({sessionId:round.id,completedStep:{wordId:round.wordIds[0],step:'learn'},planVersion:round.learningPolicy?.version??1});
    const state=f.store.read(),next=new Date('2026-10-25T16:00:01Z');
    assert.equal(learningDay(next),'2026-10-26');
    assert.equal(entryRecommendation(state,'learn',next).remainingNew,1,'two still-unseen reserved words remain reserved across midnight');
    assert.equal(entryRecommendation(state,'learn',now).usedNewToday,1);
  }finally{f.close();}
});
test('L02: parent focus is ordered, finite and versioned; no silent spill into another book',()=>{
  const f=fixture();try{
    const focus=[f.ids[7],f.ids[4]];
    f.store.saveLessonPlan({title:'隔离重点',wordIds:focus,focusWordIds:focus,segmentMinutes:8},()=>true);
    assert.deepEqual(entryRecommendation(f.store.read(),'learn',now).fresh.map(word=>word.id),focus);
    f.store.mutate(data=>{data.sessions[0].exposures!.push(...focus.map(wordId=>({wordId,learningVersion:0,introducedAt:'2026-10-23T00:00:00Z'})));});
    assert.equal(entryRecommendation(f.store.read(),'learn',now).reason,'scope-complete');
    f.store.mutate(data=>{data.words.find(word=>word.id===focus[0])!.learningVersion=1;});
    assert.equal(entryRecommendation(f.store.read(),'learn',now).reason,'scope-changed');assert.throws(()=>f.store.startSession(false,{}, {entry:'learn'}),/家长检查/);
  }finally{f.close();}
});
test('L02: a large legacy or manual round stays frozen without reserving the entire new recommendation allowance',()=>{
  const f=fixture();try{
    const legacy=f.store.startSession(false,{}, {mode:'practice',wordIds:f.ids});
    const manual=f.store.startSession(false,{}, {entry:'learn',mode:'practice',wordIds:f.ids.slice(4)});
    assert.equal(dailyLearningPlan(f.store.read(),now).remainingNew,0,'legacy callers retain the old reservation contract');
    const preview=entryRecommendation(f.store.read(),'learn',now);assert.equal(preview.remainingNew,3);assert.equal(preview.fresh.length,3);
    const recommended=f.store.startSession(false,{}, {entry:'learn'});assert.deepEqual(recommended.wordIds,preview.fresh.map(word=>word.id));
    assert.deepEqual(f.store.read().sessions.find(row=>row.id===legacy.id)!.activities,legacy.activities);
    assert.deepEqual(f.store.read().sessions.find(row=>row.id===manual.id)!.activities,manual.activities);
  }finally{f.close();}
});
test('L02/R02: missing cache, unapproved material, sample/disabled/deleted and future/reset meanings cannot leak into a recommendation',()=>{
  const f=fixture();try{
    const data={...f.store.read(),learningReadyWordIds:undefined as string[]|undefined};data.learningReadyWordIds=[];
    assert.equal(entryRecommendation(data,'learn',now).reason,'not-ready');assert.equal(entryRecommendation(data,'review',now).reason,'not-ready');
    delete data.learningReadyWordIds;data.words[4].assetStatus='review';data.words[5].deletedAt=now.toISOString();data.packs[1].isSample=true;
    data.words[0].learningVersion=1;data.words[2].learningResetAt=now.toISOString();
    data.sessions[0].exposures!.forEach(fact=>fact.introducedAt='2099-01-01T00:00:00Z');
    assert.equal(entryRecommendation(data,'review',now).review.length,0);
    assert.ok(entryRecommendation(data,'learn',now).fresh.every(word=>word.packId==='a'&&word.id!==f.ids[4]&&word.id!==f.ids[5]));
    assert.ok(dailyLearningPlan(data,now).tasks.length,'legacy mixed API contract remains separate');
  }finally{f.close();}
});
test('L02/R02: mixed and supplemental old recommendations are kept outside the primary resume; stale primary scope is blocked',()=>{
  const f=fixture();try{
    const mixed=f.store.startSession(false,{},{});
    f.store.mutate(data=>{data.sessions.find(row=>row.id===mixed.id)!.entrySource={entry:'learn',kind:'recommended'};});
    assert.equal(recommendedEntrySession(f.store.read(),'learn'),undefined);
    const round=f.store.startSession(false,{}, {entry:'learn'});
    f.store.mutate(data=>{data.words.find(word=>word.id===round.wordIds[0])!.learningVersion=1;});
    assert.equal(entryRecommendation(f.store.read(),'learn',now).stale,true);assert.throws(()=>f.store.startSession(false,{}, {entry:'learn'}),/词义或素材/);
    assert.deepEqual(f.store.read().sessions.find(row=>row.id===mixed.id)!.activities,mixed.activities);
  }finally{f.close();}
});
test('R02: unavailable due words cannot be reported as no-due while other known words are ready',()=>{
  const f=fixture();try{
    const data={...f.store.read(),learningReadyWordIds:[f.ids[2],f.ids[3]]};
    data.sessions[0].exposures!.filter(fact=>data.learningReadyWordIds.includes(fact.wordId)).forEach(fact=>fact.introducedAt=now.toISOString());
    const plan=entryRecommendation(data,'review',now);assert.equal(plan.reason,'not-ready');assert.equal(plan.unreadyDueCount,2);assert.equal(plan.tasks.length,0);
    data.words[0].assetStatus='review';assert.equal(entryRecommendation(data,'review',now).unreadyDueCount,2);
  }finally{f.close();}
});
test('L02/R02 HTTP: local readiness and preview match actual starts, refresh creates no rounds, empty start is rejected',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'entry-rec-http-')),cache=join(dir,'speech','explicit-audio-fixture.wav');mkdirSync(join(dir,'speech'));writeFileSync(cache,Buffer.alloc(64));
  let cached=true,forbidden=0;
  const app=createApp({dataDir:dir,studyExecution:false,integrations:{probeIntegrations:async()=>({speech:offline,codex:offline}),ttsStatus:()=>offline,getCachedSpeech:async()=>cached?cache:undefined,
    synthesizeSpeech:async()=>{forbidden++;throw Error('No cloud');}}});app.store.clock=()=>now;seed(app.store);
  try{
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
    const post=async(body:unknown)=>fetch(base+'/api/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const state=await(await fetch(base+'/api/state')).json();assert.equal(state.learningReadyWordIds.length,10);assert.equal(app.store.read().sessions.length,1);
    for(const entry of ['learn','review'] as const){const preview=entryRecommendation(state,entry,now),response=await post({entry});assert.equal(response.status,200);const session=await response.json();assert.deepEqual(session.wordIds,preview.tasks.map(task=>task.wordId));}
    cached=false;const response=await post({entry:'review'});assert.equal(response.status,409);assert.equal((await response.json()).code,'RECOMMENDATION_NOT_READY');
    const unavailable=await(await fetch(base+'/api/state')).json();assert.deepEqual(unavailable.learningReadyWordIds,[]);assert.equal(entryRecommendation(unavailable,'review',now).stale,true);
    assert.equal(forbidden,0);assert.equal(app.store.read().charges.length,0);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('L02/R02 actual components: primary purpose/empty state, explicit extra rounds and original uploaded image URLs',async()=>{
  const f=fixture(),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{
    const {LearningHub}=await vite.ssrLoadModule('/src/learning-hub.tsx');const state=f.store.state({speech:offline,codex:offline});
    const render=(entry:'learn'|'review',next=state)=>renderToStaticMarkup(createElement(LearningHub,{state:next,entry,busy:false,onStart(){},onHome(){},onTest(){},onSpeak(){},onSelect(){},onSwitch(){},onBooks(){},onGames(){}}));
    const learn=render('learn'),review=render('review');assert.ok(learn.includes('认识 3 个新词'));assert.ok(learn.includes('开始学习'));assert.ok(!learn.includes('复习 2 个已学到期词'));
    assert.ok(review.includes('复习 2 个已学到期词'));assert.ok(review.includes('开始复习'));assert.ok(review.includes('按书加练'));assert.ok(state.words.slice(0,4).some(word=>review.includes(word.imageUrl)));
    const future={...state,learningNow:'2026-10-23T02:00:00Z'};assert.ok(render('review',future).includes('今天没有到期复习'));
    f.store.startSession(false,{}, {entry:'learn'});const resumed=render('learn',f.store.state({speech:offline,codex:offline}));assert.ok(resumed.includes('整份任务进度'));assert.ok(resumed.includes('aria-valuemax="18"'));
    const noAudio={...state,learningReadyWordIds:[]};assert.ok(render('learn',noAudio).includes('词语还需准备'));assert.ok(render('review',noAudio).includes('词语还需准备'));
  }finally{await vite.close();f.close();}
});
