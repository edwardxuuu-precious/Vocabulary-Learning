import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { Store } from '../server/store.ts';
import { BusinessObservations } from '../server/business-observations.ts';
import { createApp } from '../server/index.ts';
import { observationSummary } from '../shared/business-observations.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { finishGoalFixture } from './helpers/goal-steps.ts';

const offline={configured:false,available:false,status:'fixture',detail:'工程替身，无云调用'};
function seed(store:Store){store.mutate(data=>{data.packs=[{id:'family',title:'隔离词书',enabled:true,createdAt:'2026-10-01T00:00:00Z'}];data.words=data.words.slice(0,3).map(word=>({...word,packId:'family',learningVersion:0}));
  const ids=data.words.map(word=>word.id);data.sessions=[{id:'introduced-fixture',wordIds:ids,completedWordIds:ids,rewardGranted:false,startedAt:'2026-10-25T00:00:00Z',completedAt:'2026-10-25T00:00:00Z',exposures:ids.map(wordId=>({wordId,learningVersion:0,introducedAt:'2026-10-25T00:00:00Z'}))}];});return store.read().words.map(word=>word.id);}
function fixture(){const dir=mkdtempSync(join(tmpdir(),'business-observation-'));let now=new Date('2026-10-25T02:00:00Z'),store=new Store(dir,()=>now),business=new BusinessObservations(store,'engineering');const ids=seed(store);
  return {ids,get store(){return store;},get business(){return business;},at(value:string){now=new Date(value);},restart(){store.close();store=new Store(dir,()=>now);business=new BusinessObservations(store,'engineering');},close(){store.close();rmSync(dir,{recursive:true,force:true});}};}
const opportunity=(id:string,fields={})=>({id,expectedRevision:0,entry:'learn',eligibility:'eligible',voluntary:null,stepByStepHelp:null,completed:null,end:'unknown',stopAt:'unknown',helpCount:null,...fields});
const probe=(id:string,wordIds:string[],fields={})=>({id,expectedRevision:0,wordIds,direction:'listen',interval:'next-day',externalContact:'unknown',...fields});

test('O02 K1: parent observations preserve refusal, unknowns and revisions; app events cannot imply willingness',()=>{
  const f=fixture();try{
    const before=f.store.read();assert.equal(f.business.view().k1.learn.rate,null);
    const row=opportunity('opportunity-one',{voluntary:true,stepByStepHelp:false,completed:true,end:'completed',helpCount:0});
    f.business.opportunity(row);f.business.opportunity(JSON.parse(JSON.stringify(row,Object.keys(row).reverse())));
    f.business.opportunity(opportunity('opportunity-two',{voluntary:false,stepByStepHelp:null,completed:false,end:'refused'}));
    assert.equal(f.business.view().k1.learn.denominator,2);assert.equal(f.business.view().k1.learn.numerator,1);assert.equal(f.business.view().k1.learn.refused,1);
    f.business.opportunity(opportunity('opportunity-two',{expectedRevision:1,voluntary:false,stepByStepHelp:false,completed:false,end:'refused',helpCount:0}));
    assert.equal(f.business.view().opportunities.length,2);assert.equal(f.business.export().records.opportunities.length,3);
    assert.throws(()=>f.business.opportunity({...row,end:'rest'}),/不一致|更新/);assert.throws(()=>f.business.opportunity({...row,id:'coerced-entry',entry:['learn']}),/实际观察/);
    assert.deepEqual(f.store.read(),before,'business records do not write learning scores or history');
    const child=new BusinessObservations(f.store,'child');assert.equal(child.view().opportunities.length,0);assert.equal(child.view().k1.learn.rate,null);
    f.restart();assert.equal(f.business.view().opportunities.length,2);
  }finally{f.close();}
});
test('O02 K3: fixed scopes, partial delivery, blank active categories and waiting remain distinct',()=>{
  const f=fixture();try{
    const row={id:'effort-cohort-one',expectedRevision:0,packId:'family',completeCycle:false,activeMinutes:{preparation:3,repair:null,guidance:2,review:4},waitingMinutes:20,repairCount:null,reviewItems:null};
    f.business.effort(row,[f.ids[0],f.ids[1]]);let result=f.business.view().k3[0].metrics;
    assert.equal(result.deliveredWords,2);assert.equal(result.activeMinutes,null);assert.equal(result.minutesPerTen,null);assert.equal(result.waitingMinutes,20);
    f.store.mutate(data=>data.words.push({...data.words[0],id:'new-later-word'}));
    f.business.effort({...row,expectedRevision:1,completeCycle:true,activeMinutes:{preparation:3,repair:1,guidance:2,review:4}},[f.ids[0],f.ids[1]]);
    result=f.business.view().k3[0].metrics;assert.equal(result.plannedWords,3);assert.equal(result.deliveredWords,2);assert.equal(result.activeMinutes,10);assert.equal(result.minutesPerTen,50);
    assert.throws(()=>f.business.effort({...row,expectedRevision:1},[]),/更新/);
  }finally{f.close();}
});
test('O02 K1: self-start then fatigue, and completing without volunteering, remain recordable failures instead of being forced into nicer data',()=>{
  const f=fixture();try{
    f.business.opportunity(opportunity('self-start-fatigue',{voluntary:true,completed:false,end:'refused',stepByStepHelp:false,helpCount:0}));
    f.business.opportunity(opportunity('not-voluntary-done',{voluntary:false,completed:true,end:'completed',stepByStepHelp:true,helpCount:2}));
    const result=f.business.view().k1.learn;assert.equal(result.denominator,2);assert.equal(result.numerator,0);assert.equal(result.refused,1);assert.equal(result.started,1);
  }finally{f.close();}
});
test('O02 K2: a frozen first incorrect listening attempt cannot be replaced by a later success',()=>{
  const f=fixture();try{
    const plan=f.business.probe(probe('probe-listen-first',[f.ids[0]]));assert.equal(f.business.view().k2[0].metrics[0].rate,null);
    f.at('2026-10-26T03:00:00Z');const session=f.store.startSession(false,{}, {entry:'review',mode:'practice',wordIds:f.ids.slice(0,2),strategy:'classic'});
    f.store.mutate(data=>data.attempts.push(...[false,true].map((correct,index)=>({id:`listening-attempt-${index}`,sessionId:session.id,activityId:`${f.ids[0]}:listen`,wordId:f.ids[0],learningVersion:0,step:'listen' as const,skill:'listen' as const,correct,hinted:index===1,practiceOnly:false,source:'click' as const,createdAt:`2026-10-26T03:00:0${index}Z`}))));
    f.at('2026-10-26T04:00:00Z');const row=f.business.view().k2[0];assert.equal(row.observations[0].fact.outcome,'incorrect');assert.equal(row.metrics[0].rate,0);assert.equal(row.metrics[0].denominator,1);
    const before=f.store.read();f.business.view();assert.deepEqual(f.store.read(),before);
    assert.throws(()=>f.business.probe({...probe(plan.id,[f.ids[1]]),expectedRevision:1}),/冻结/);
    assert.throws(()=>f.business.probe(probe('retroactive-plan',[f.ids[0]])),/事后/);
  }finally{f.close();}
});
test('O02 K2: unreviewed oral response, re-recording, late windows and changed meaning never gain false correctness',()=>{
  const f=fixture();try{
    f.business.probe(probe('probe-recall-first',[f.ids[0]],{direction:'recall'}));
    f.at('2026-10-26T04:00:00Z');
    f.store.mutate(data=>{const word=data.words[0];data.assessments=[{id:'recorded-challenge',mode:'full',workflow:'recorded',wordIds:[word.id],startedAt:'2026-10-26T02:00:00Z',submittedAt:'2026-10-26T03:00:00Z',completedAt:'2026-10-26T03:00:00Z',items:[{id:'oral-first',dimension:'zh-en',word:{id:word.id,term:word.term,meaning:word.meaning,imageUrl:word.imageUrl,learningVersion:0},choices:[],response:{version:1,kind:'recording',answeredAt:'2026-10-26T02:05:00Z'}}]}];});
    assert.equal(f.business.view().k2[0].observations[0].fact.outcome,'unconfirmed');
    f.store.mutate(data=>{const item=data.assessments![0].items[0];item.result='correct';data.assessmentAttempts=[{id:'parent-reviewed-first',sessionId:'recorded-challenge',itemId:item.id,wordId:item.word.id,learningVersion:0,dimension:'zh-en',result:'correct',source:'parent',createdAt:item.response!.answeredAt,confirmedAt:'2026-10-26T03:00:00Z',reviewVersion:1}];});
    assert.equal(f.business.view().k2[0].metrics[0].rate,1);
    f.store.mutate(data=>{data.assessments![0].items[0].response!.version=2;});assert.equal(f.business.view().k2[0].observations[0].fact.outcome,'unconfirmed');
    f.store.mutate(data=>{data.assessments![0].startedAt='2026-10-27T02:00:00Z';data.assessments![0].items[0].response!.answeredAt='2026-10-27T02:05:00Z';});f.at('2026-10-27T04:00:00Z');
    assert.equal(f.business.view().k2[0].observations[0].actualDays,2);assert.equal(f.business.view().k2[0].observations[0].fact.outcome,'unavailable');
    f.store.mutate(data=>{data.words[0].learningVersion=1;});assert.equal(f.business.view().k2[0].metrics[0].unavailable,1);
  }finally{f.close();}
});
test('O02 events: idempotency, private mode scopes and interval unions do not modify metrics or accept arbitrary payloads',()=>{
  const f=fixture();try{
    const session=f.store.startSession(false,{}, {entry:'review',mode:'practice',wordIds:f.ids.slice(0,2)}),before=f.store.read();
    const event={id:'interval-first',clientId:'client-fixture-one',sessionId:session.id,at:'2026-10-25T02:00:00Z',kind:'interval',phase:'foreground',durationMs:10000};
    f.business.events({events:[event,event]});f.business.events({events:[{...event,id:'interval-second',durationMs:5000}]});
    assert.equal(f.business.view().eventCount,2);assert.equal(f.business.view().timing.foreground,10000);assert.equal(f.business.view().k1.learn.denominator,0);
    assert.throws(()=>f.business.events({events:[{...event,durationMs:3000}]}),/冲突/);
    assert.throws(()=>f.business.events({events:[{...event,id:'raw-audio-denied',recording:'secret'}]}),/字段/);
    assert.throws(()=>f.business.events({events:[{...event,id:'forced-audience',audience:'child'}]}),/字段/);
    assert.throws(()=>f.business.events({events:[{...event,id:'coerced-phase',phase:['foreground']}]}),/片段内容/);
    assert.throws(()=>f.business.events({events:[{...event,id:'wrong-profile',sessionId:'missing-session'}]}),/来源/);
    assert.deepEqual(f.store.read(),before);assert.equal(new BusinessObservations(f.store,'test').view().eventCount,0);
    assert.equal(JSON.stringify(f.store.exportBackup()).includes('interval-first'),false);
  }finally{f.close();}
});
test('L03/O02: explicitly skipping a basic listening task or unavailable sound records no correctness, no due-date change and a distinct first-probe status',()=>{
  const f=fixture();try{
    f.business.probe(probe('listen-unavailable-probe',[f.ids[0]]));f.at('2026-10-26T04:00:00Z');
    const session=f.store.startSession(false,{}, {entry:'review',mode:'practice',wordIds:f.ids.slice(0,2),strategy:'classic'});
    const first=currentActivity(session)!;finishGoalFixture(f.store,session,first);
    const current=f.store.read().sessions.find(row=>row.id===session.id)!,activity=currentActivity(current)!;assert.equal(activity.step,'listen');
    const before=f.store.read().progress;
    const attempt=f.store.attempt({id:'unavailable-first-answer',sessionId:session.id,wordId:activity.wordId,step:'listen',skill:'listen',source:'click',correct:true,hinted:false,responseStatus:'unavailable'});
    assert.equal(attempt.correct,false);assert.equal(attempt.practiceOnly,true);assert.equal(attempt.responseStatus,'unavailable');assert.deepEqual(f.store.read().progress,before);
    f.store.updateSession({sessionId:session.id,completedStep:{wordId:activity.wordId,step:'listen'}});
    const restored=f.store.exportBackup();f.store.restoreBackup(restored);assert.equal(f.store.read().attempts.find(row=>row.id===attempt.id)!.responseStatus,'unavailable');
    assert.equal(f.business.view().k2[0].observations[0].fact.outcome,'unavailable');assert.equal(f.business.view().k2[0].metrics[0].rate,null);
    const bad=f.store.exportBackup();bad.data.attempts.find(row=>row.id===attempt.id)!.correct=true;assert.throws(()=>f.store.restoreBackup(bad),/跳过或设备状态/);
  }finally{f.close();}
});
test('O02 HTTP: parent records need a grant, stay out of public state/backup and survive a normal learning restore',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'business-observation-http-')),cache=join(dir,'speech','fixture.wav');mkdirSync(join(dir,'speech'));writeFileSync(cache,Buffer.alloc(64));
  const app=createApp({dataDir:dir,observationAudience:'engineering',integrations:{probeIntegrations:async()=>({speech:offline,codex:offline}),getCachedSpeech:async()=>cache}});seed(app.store);
  try{
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
    const call=(route:string,method='GET',body?:unknown,grant?:string)=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...(grant?{Authorization:`Bearer ${grant}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal((await call('/api/business')).status,403);assert.equal((await call('/api/business/opportunities','POST',opportunity('private-parent-record'))).status,403);
    const gate=await(await call('/api/parent-gate','POST',{pin:'123456'})).json(),grant=gate.assessmentGrant.token;
    assert.equal((await call('/api/business/opportunities','POST',opportunity('private-parent-record',{voluntary:false,completed:false,end:'refused'}),grant)).status,200);
    assert.equal((await(await call('/api/business','GET',undefined,grant)).json()).audience,'engineering');
    assert.equal((await(await call('/api/business/export','GET',undefined,grant)).json()).records.opportunities.length,1);
    for(const route of ['/api/state','/api/backup'])assert.equal((await(await call(route)).text()).includes('private-parent-record'),false);
    const backup=await(await call('/api/backup')).json();assert.equal((await call('/api/restore','POST',backup)).status,200);
    assert.equal((await call('/api/business','GET',undefined,grant)).status,403,'restore revokes old grants');
    const newGate=await(await call('/api/parent-gate/unlock','POST',{pin:'123456'})).json();assert.equal((await(await call('/api/business','GET',undefined,newGate.assessmentGrant.token)).json()).opportunities.length,1);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('O02 actual parent surface shows unknowns and authorization, without raw audio or inferred scores',async()=>{
  const f=fixture(),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{
    const {BusinessObservationPanel}=await vite.ssrLoadModule('/src/business-observations.tsx');
    const html=renderToStaticMarkup(createElement(BusinessObservationPanel,{state:f.store.state({speech:offline,codex:offline}),onGrant(){}}));
    assert.ok(html.includes('家长解锁后查看与补记'));assert.ok(html.includes('普通录音不算答对'));assert.ok(!html.includes('0%'));
    const summary=observationSummary([],[],[],[],f.store.read());assert.equal(summary.k1.learn.rate,null);assert.deepEqual(summary.k2,[]);assert.deepEqual(summary.k3,[]);
  }finally{await vite.close();f.close();}
});
test('O02 HTTP: child and parent-test observations require their own grants and never share an aggregate',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'business-observation-modes-')),app=createApp({dataDir:dir,integrations:{probeIntegrations:async()=>({speech:offline,codex:offline}),getCachedSpeech:async()=>undefined}});seed(app.store);
  try{
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
    const call=(route:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const setup=await(await call('/api/parent-gate','POST',{pin:'123456'})).json(),auth={Authorization:`Bearer ${setup.assessmentGrant.token}`};
    assert.equal((await call('/api/business/opportunities','POST',opportunity('child-private-opportunity'),auth)).status,200);
    const lease=await(await call('/api/test-mode','POST',undefined,auth)).json(),mode={'X-Playroom-Test':lease.token};
    assert.equal((await call('/api/test/business','GET',undefined,mode)).status,403);
    const gate=await(await call('/api/test/parent-gate/unlock','POST',{pin:'123456'},mode)).json(),testAuth={...mode,Authorization:`Bearer ${gate.assessmentGrant.token}`};
    assert.equal((await call('/api/test/business/opportunities','POST',opportunity('test-private-opportunity'),testAuth)).status,200);
    const child=await(await call('/api/business','GET',undefined,auth)).json(),testing=await(await call('/api/test/business','GET',undefined,testAuth)).json();
    assert.equal(child.audience,'child');assert.deepEqual(child.opportunities.map((row:any)=>row.id),['child-private-opportunity']);
    assert.equal(testing.audience,'test');assert.deepEqual(testing.opportunities.map((row:any)=>row.id),['test-private-opportunity']);
    assert.equal((await call('/api/business','GET',undefined,testAuth)).status,403,'a test token cannot access the child route');
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
