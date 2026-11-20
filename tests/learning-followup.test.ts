import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {Store,validateBackup} from '../server/store.ts';
import {createChallengeManager} from '../server/challenges.ts';
import {assessmentCurrent} from '../shared/assessment.ts';
import {completedTestWordIds,learningVerification} from '../shared/learning-verification.ts';
import {entryRecommendation,recommendedEntrySession} from '../shared/entry-recommendation.ts';
import {studyRuntimeState} from '../server/study-execution.ts';

const off={configured:false,available:false,status:'fixture',detail:'隔离工程，不调用云'},status={speech:off,codex:off};
function fixture(){const dir=mkdtempSync(join(tmpdir(),'learning-followup-'));let now=new Date('2026-11-16T04:00:00Z');const store=new Store(dir,()=>now);store.mutate(data=>{data.packs=[{id:'family',title:'工程隔离词书',enabled:true,createdAt:now.toISOString()}];data.words=data.words.slice(0,10).map(word=>({...word,packId:'family',learningVersion:0}));data.settings={...data.settings,learningStrategy:'memory-loop',voiceEnabled:false,dailyNewWords:10};const ids=data.words.map(word=>word.id);data.sessions=[{id:'completed-ten',entrySource:{entry:'learn',kind:'selected'},wordIds:ids,completedWordIds:ids,startedAt:now.toISOString(),completedAt:now.toISOString(),rewardGranted:true,exposures:ids.map(wordId=>({wordId,learningVersion:0,introducedAt:now.toISOString()}))}];});return {dir,store,advance(){now=new Date(now.getTime()+1000);},state:()=>store.state(status),close(){store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));assert.ok(dir.includes('learning-followup-'));rmSync(dir,{recursive:true,force:true});}};}

test('ten completed words start one frozen forty-item test and survive backup, pause and submission without inventing passes',async()=>{
  const f=fixture(),manager=createChallengeManager({store:f.store,dataDir:f.dir,imageAvailable:()=>true});try{
    const state=f.state(),ids=completedTestWordIds(state,state.lastCompletedSession),before=f.store.exportBackup();assert.equal(ids.length,10);const plan=learningVerification(state,ids);assert.deepEqual(plan.nextWordIds,ids);assert.equal(plan.passed,0);assert.deepEqual(f.store.exportBackup(),before);
    let round=f.store.createAssessment({mode:'full',workflow:'recorded',wordIds:plan.nextWordIds});assert.equal(round.wordIds.length,10);assert.equal(round.items.length,40);assert.equal(learningVerification(f.state(),ids).resume?.id,round.id);
    for(let n=0;n<3;n++){const item=assessmentCurrent(round)!;round=manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'skip'});}
    const snapshot=structuredClone(round),backup=f.store.exportBackup();assert.ok(validateBackup(backup));f.store.restoreBackup(backup);assert.deepEqual(f.store.read().assessments!.find(test=>test.id===round.id),snapshot);
    while(assessmentCurrent(round)){const item=assessmentCurrent(round)!;round=manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'skip'});}manager.submit(round.id);
    const next=learningVerification(f.state(),ids);assert.equal(next.pending,10);assert.equal(next.passed,0);assert.deepEqual(next.nextWordIds,[]);assert.equal(f.state().companionUnlocks?.newWords,0);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{await manager.close();f.close();}
});

test('an existing five-word test retains its frozen questions and can still continue the remaining words',async()=>{
  const f=fixture(),manager=createChallengeManager({store:f.store,dataDir:f.dir,imageAvailable:()=>true});try{
    const ids=f.store.read().words.map(word=>word.id);let old=f.store.createAssessment({mode:'full',workflow:'recorded',wordIds:ids.slice(0,5)});const snapshot=structuredClone(old);assert.equal(learningVerification(f.state(),ids).resume?.id,old.id);assert.equal(old.items.length,20);assert.deepEqual(f.store.read().assessments![0],snapshot);
    while(assessmentCurrent(old)){const item=assessmentCurrent(old)!;old=manager.respond(old.id,{itemId:item.id,expectedVersion:0,action:'skip'});}manager.submit(old.id);assert.deepEqual(learningVerification(f.state(),ids).nextWordIds,ids.slice(5));
  }finally{await manager.close();f.close();}
});

test('the learning primary card follows newest selected/relearned round and explicit resume, while review and legacy rounds stay separate',()=>{
  const f=fixture();try{const ids=f.store.read().words.map(word=>word.id);f.advance();const older=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:ids.slice(0,2)});f.advance();const newer=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:ids.slice(2,5)});assert.equal(entryRecommendation(f.state(),'learn').resume?.id,newer.id);assert.equal(recommendedEntrySession(f.state(),'learn'),undefined);f.advance();f.store.startSession(false,{}, {entry:'learn',mode:'resume',sessionId:older.id});assert.equal(entryRecommendation(f.state(),'learn').resume?.id,older.id);f.advance();f.store.startSession(false,{}, {entry:'review',mode:'practice',wordIds:ids.slice(0,2)});assert.equal(entryRecommendation(f.state(),'learn').resume?.id,older.id);assert.equal(entryRecommendation(f.state(),'review').resume,undefined);}finally{f.close();}
});

test('completion, child test and word selection visibly preserve all ten targets and distinguish learned from verified without writes',async()=>{
  const f=fixture(),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{const state=f.state(),before=f.store.exportBackup(),{LearningReward}=await vite.ssrLoadModule('/src/child-growth.tsx'),{WordPicker,LearningHub}=await vite.ssrLoadModule('/src/learning-hub.tsx'),{ChildChallenge}=await vite.ssrLoadModule('/src/child-challenge.tsx');
    const reward=renderToStaticMarkup(createElement(LearningReward,{state,session:state.lastCompletedSession,growth:state.growth,onGrowth(){},onTest(){},onHome(){}}));assert.match(reward,/开始测试/);assert.match(reward,/<strong>10<\/strong><span>个词，本次练习结束/);assert.match(reward,/>回学习<\/button>/);assert.doesNotMatch(reward,/reward-verification|明天从|看看这轮记录|今天已打卡|看看成长|其他玩法/);
    const challenge=renderToStaticMarkup(createElement(ChildChallenge,{state,initialWordIds:state.lastCompletedSession!.wordIds,reload:async()=>state,onExit(){}}));assert.match(challenge,/本轮独立测试/);assert.match(challenge,/本次测试 10 词 · 40 项/);
    const picker=renderToStaticMarkup(createElement(WordPicker,{state,busy:false,onStart(){},onHome(){},onTest(){},onSpeak(){}}));for(const word of state.words)assert.ok(picker.includes(`选择${word.term}，${word.meaning}，已学过`));assert.ok(!picker.includes('已掌握'));
    f.advance();const selected=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:state.words.slice(0,3).map(word=>word.id)});const hub=renderToStaticMarkup(createElement(LearningHub,{state:f.state(),busy:false,onStart(){},onHome(){},onTest(){},onSpeak(){},onSelect(){}}));assert.ok(hub.includes(`data-session-id="${selected.id}"`));assert.match(hub,/继续学习/);
    assert.deepEqual(before.data.assessmentAttempts,f.store.exportBackup().data.assessmentAttempts);
  }finally{await vite.close();f.close();}
});

test('the unified hub keeps the completed ten-word test above another current task, with resume and pending states',async()=>{
  const f=fixture(),manager=createChallengeManager({store:f.store,dataDir:f.dir,imageAvailable:()=>true}),vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
  try{
    const {LearningReward}=await vite.ssrLoadModule('/src/child-growth.tsx'),{LearningHub}=await vite.ssrLoadModule('/src/learning-hub.tsx');
    const ids=f.store.read().words.map(word=>word.id);
    f.advance();const active=f.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:ids.slice(0,7)});
    const view=()=>{const state=f.state();return {...state,study:studyRuntimeState(f.store.read(),ids,new Date(state.learningNow!), 'child')};};
    const renderHub=(entry:'learn'|'review'='learn')=>renderToStaticMarkup(createElement(LearningHub,{state:view(),entry,busy:false,onStudyStart(){},onStart(){},onHome(){},onTest(){},onSpeak(){},onSelect(){},onCompleted(){},onParentReview(){}}));
    const before=f.store.exportBackup(),html=renderHub();
    assert.match(html,/本轮测试/);assert.match(html,/本轮 10 个词已学完/);assert.match(html,/开始测试/);
    assert.ok(html.indexOf('aria-label="本轮测试"')<html.indexOf(`data-session-id="${active.id}"`));
    assert.doesNotMatch(renderHub('review'),/aria-label="本轮测试"/);
    const state=view(),reward=renderToStaticMarkup(createElement(LearningReward,{state,session:state.lastCompletedSession,onGrowth(){},onHome(){},onTest(){}}));
    assert.match(reward,/开始测试/);assert.deepEqual(completedTestWordIds(state,state.lastCompletedSession),ids);assert.deepEqual(f.store.exportBackup(),before);
    let round=f.store.createAssessment({mode:'full',workflow:'recorded',wordIds:ids});
    assert.match(renderHub(),/继续测试/);assert.match(renderHub(),/已答 0 \/ 40 项/);assert.equal(f.store.read().assessments!.length,1);
    while(assessmentCurrent(round)){const item=assessmentCurrent(round)!;round=manager.respond(round.id,{itemId:item.id,expectedVersion:0,action:'skip'});}manager.submit(round.id);
    const pending=renderHub();assert.match(pending,/待家长核验 10 个词/);assert.doesNotMatch(pending,/开始测试|继续测试/);assert.equal(f.store.read().assessments!.length,1);
  }finally{await vite.close();await manager.close();f.close();}
});
