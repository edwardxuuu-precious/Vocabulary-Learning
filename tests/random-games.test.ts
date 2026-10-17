import { finishGoalFixture } from './helpers/goal-steps.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import type { ActivityAction, GameKind, LearningActivity, LearningTask } from '../shared/contracts.ts';
import { activityDone, buildActivities, currentActivity } from '../shared/game-plan.ts';
import { eligibleGames, gameDefinition, gameRegistry, seededRandom } from '../shared/game-registry.ts';
import { answerIsCorrect, gameAccepted, transitionGame } from '../shared/game-rules.ts';
import { dailyLearningPlan } from '../shared/learning.ts';
import { batchTwoKinds } from '../shared/game-boards.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(),'word-random-games-'));
  let store = new Store(directory, () => new Date('2026-10-17T03:00:00Z'));
  const pack = store.createPack('随机游戏验收', ['apple','banana','cat'].map((term, i) => ({ term, meaning:['苹果','香蕉','猫'][i], partOfSpeech:'noun' })));
  store.enablePack(pack.id,true);
  return { get store() { return store; }, restart() { store.close(); store = new Store(directory, () => new Date('2026-10-17T03:00:00Z')); }, close() { store.close(); rmSync(directory,{recursive:true,force:true}); } };
}
const active = (store: Store) => store.read().sessions.at(-1)!;
function event(store: Store, activity: LearningActivity, action: ActivityAction, selectedId?: string) { return store.activityEvent({sessionId:active(store).id,activityId:activity.id,action,...(selectedId?{selectedId}:{})}); }
function finish(store: Store, activity: LearningActivity) {
  const session = active(store);
  if(finishGoalFixture(store,session,activity))return;
  if (activity.kind === 'standard') {
    if (activity.step !== 'learn') store.attempt({sessionId:session.id,wordId:activity.wordId,skill:activity.step==='sound'?'listen':activity.step,step:activity.step,correct:true,hinted:false,practiceOnly:activity.step==='recall',source:'click'});
    store.updateSession({completedStep:{wordId:activity.wordId,step:activity.step}}); return;
  }
  if (['portal','missing'].includes(activity.kind)) {
    if(activity.kind==='missing')event(store,activity,'conceal');
    event(store,activity,'reveal');event(store,activity,'skip');
  } else if(activity.kind==='think-choice') {
    event(store,activity,'show-options');event(store,activity,'listen-option',activity.wordId);event(store,activity,'choose',activity.wordId);
  } else {
    if(activity.kind==='treasure')event(store,activity,'conceal');
    event(store,activity,'listen');
    if(activity.kind==='listen-first')event(store,activity,'show-options');
    event(store,activity,'choose',activity.kind==='gate'?(activity.cueWord!.id===activity.wordId?'yes':'no'):activity.wordId);
  }
  event(store,activity,'next');
}

for (const definition of gameRegistry.filter(game=>!game.batch&&!batchTwoKinds.has(game.kind))) test(`${definition.title}: real rule flow, checkpoint restore, evidence and round completion`, () => {
  const f=fixture();try{
    f.store.startSession('random',{forcedKind:definition.kind});let tested=false;
    for(let count=0;count<30&&currentActivity(active(f.store));count++){
      const item=currentActivity(active(f.store))!;
      if(item.kind===definition.kind&&item.step===definition.step&&!tested){
        tested=true;
        assert.throws(()=>event(f.store,item,'next'),/先完成/);
        const before=f.store.read().attempts.length;
        if(!['portal','missing'].includes(item.kind)) assert.throws(()=>event(f.store,item,'choose',item.kind==='gate'?'yes':item.wordId),/先|准备|选择/);
        assert.equal(f.store.read().attempts.length,before);
        if(item.kind==='treasure'||item.kind==='missing')event(f.store,item,'conceal');
        else if(item.kind==='think-choice')event(f.store,item,'show-options');
        else if(item.kind!=='portal')event(f.store,item,'listen');
        const backup=f.store.exportBackup(),state=structuredClone(active(f.store));f.restart();f.store.restoreBackup(backup);
        assert.deepEqual(active(f.store),state);assert.equal(currentActivity(active(f.store))!.id,item.id);
      }
      finish(f.store,item);
      assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
    }
    assert.ok(tested,`${definition.kind} never appeared`);assert.equal(currentActivity(active(f.store)),undefined);
    f.store.updateSession({complete:true});f.store.updateSession({complete:true});assert.equal(f.store.read().stickers.length,1);
    const records=f.store.read().attempts.filter(attempt=>attempt.activityId&&active(f.store).activities!.find(a=>a.id===attempt.activityId)?.kind===definition.kind&&attempt.step===definition.step);
    assert.ok(records.length>=2);assert.ok(records.every(attempt=>attempt.practiceOnly===definition.practiceOnly));
    if(definition.practiceOnly){assert.ok(f.store.read().progress.every(row=>row.skill!=='recall'));}
  }finally{f.close();}
});

test('seeded random selection covers every implemented game, caps unfamiliar rules and retains objective checks and budget',()=>{
  const f=fixture();try{
    const plan=dailyLearningPlan(f.store.read()),seen=new Set<string>();
    for(let index=0;index<180;index++){
      const options={randomize:true},seed=`sample-${index}`;
      const activities=buildActivities(plan.tasks,plan.available,seededRandom(seed),options);
      assert.deepEqual(activities,buildActivities(plan.tasks,plan.available,seededRandom(seed),options));
      assert.equal(activities.length,plan.taskCount);assert.ok(activities.length<=plan.taskLimit);
      const kinds=new Set(activities.filter(a=>a.kind!=='standard').map(a=>a.kind));kinds.forEach(kind=>seen.add(kind));
      assert.ok([...kinds].filter(kind=>!['flip','supply','portal'].includes(kind)).length<=1);
      for(const task of plan.tasks) assert.ok(activities.some(a=>a.wordId===task.wordId&&((a.kind==='standard'&&['listen','sound'].includes(a.step))||gameDefinition(a.kind)?.practiceOnly===false)));
    }
    assert.deepEqual([...seen].sort(),gameRegistry.filter(game=>(!game.batch||['assemble','clue'].includes(game.kind))&&!game.verbOnly&&!game.familyOnly&&game.step!=='spell').map(game=>game.kind).sort());
  }finally{f.close();}
});
test('eligibility excludes unseen assets, synonyms and noun-only games for verbs; single words allow only the safe puzzle',()=>{
  const f=fixture();try{
    const words=dailyLearningPlan(f.store.read()).available;
    assert.deepEqual(eligibleGames('listen',words.slice(0,1)).map(g=>g.kind),['assemble']);
    assert.ok(!eligibleGames('listen',words.slice(0,2)).some(game=>game.kind==='bingo'));
    assert.deepEqual(eligibleGames('listen',words.map((word,index)=>({...word,assetStatus:index?'approved':'review'}))),[]);
    assert.deepEqual(eligibleGames('listen',words.map(word=>({...word,meaning:'同义'}))),[]);
    assert.ok(!eligibleGames('listen',words.map(word=>({...word,partOfSpeech:'verb'}))).some(game=>game.kind==='supply'));
  }finally{f.close();}
});

test('gate mixes matching and mismatching cues, and unfamiliar assessment steps retain their order',()=>{
  const f=fixture();try{
    const plan=dailyLearningPlan(f.store.read()),firstAnswers=new Set<boolean>();
    for(let index=0;index<30;index++){
      const gates=buildActivities(plan.tasks,plan.available,seededRandom(`gate-${index}`),{forcedKind:'gate'}).filter(item=>item.kind==='gate');
      const matches=gates.map(item=>item.cueWord!.id===item.wordId);
      assert.ok(matches.includes(true)&&matches.includes(false));firstAnswers.add(matches[0]);
    }
    assert.equal(firstAnswers.size,2);
    const tasks=plan.tasks.map(task=>({...task,steps:['learn','practice-look','practice-en-zh'] as LearningTask['steps']}));
    const activities=buildActivities(tasks,plan.available,seededRandom('assessment'),{randomize:true});
    assert.equal(activities.length,9);
    for(const task of tasks)assert.deepEqual(activities.filter(item=>item.wordId===task.wordId).map(item=>item.step),task.steps);
  }finally{f.close();}
});
test('wrong gate verdict survives restart, reveal cannot create recall success, and fake answer fields are rejected',()=>{
  const f=fixture();try{
    f.store.startSession('random',{forcedKind:'gate'});
    while(currentActivity(active(f.store))!.kind==='standard'||['recognize','read'].includes(currentActivity(active(f.store))!.step))finish(f.store,currentActivity(active(f.store))!);
    const item=currentActivity(active(f.store))!;event(f.store,item,'listen');
    const right=item.cueWord!.id===item.wordId?'yes':'no',wrong=right==='yes'?'no':'yes';event(f.store,item,'choose',wrong);f.restart();
    assert.equal(active(f.store).activityStates![item.id].outcome,'try');event(f.store,item,'choose',right);
    assert.equal(f.store.read().attempts.at(-1)!.hinted,true);assert.equal(f.store.read().progress.find(p=>p.wordId===item.wordId&&p.skill==='listen')!.stage,0);
    const count=f.store.read().attempts.length;event(f.store,item,'choose',right);event(f.store,item,'next');event(f.store,item,'next');assert.equal(f.store.read().attempts.length,count);
    assert.throws(()=>f.store.activityEvent({sessionId:active(f.store).id,activityId:currentActivity(active(f.store))!.id,action:'choose',correct:true}),/无效/);
  }finally{f.close();}
});
test('state machine prevents hidden-grid, missing-picture and sound-option bypasses and keeps service failures practice-only',()=>{
  const f=fixture();try{
    const plan=dailyLearningPlan(f.store.read());
    for(const kind of ['treasure','missing','listen-first','think-choice'] as GameKind[]){
      const item=buildActivities(plan.tasks,plan.available,()=>.2,{forcedKind:kind}).find(a=>a.kind===kind)!;
      if(kind==='treasure')assert.throws(()=>transitionGame(item,{},'listen'),/先看/);
      if(kind==='missing')assert.throws(()=>transitionGame(item,{},'reveal'),/藏/);
      if(kind==='listen-first')assert.throws(()=>transitionGame(item,{heard:true},'choose',item.wordId),/准备/);
      if(kind==='think-choice')assert.throws(()=>transitionGame(item,{optionsVisible:true},'choose',item.wordId),/声音/);
    }
    const gate=buildActivities(plan.tasks,plan.available,()=>.2,{forcedKind:'gate'}).find(a=>a.kind==='gate'&&a.step==='listen')!;
    const after=transitionGame(gate,transitionGame(gate,{},'listen').state,'audio-failed').state;
    const result=transitionGame(gate,after,'choose',answerIsCorrect(gate,'yes')?'yes':'no');assert.equal(result.attempt!.practiceOnly,true);
  }finally{f.close();}
});
test('random seed, options and progress remain frozen across resume and invalid backup states fail closed',()=>{
  const f=fixture();try{
    const first=f.store.startSession('random',{forcedKind:'think-choice'});assert.ok(first.gameSeed);
    assert.deepEqual(f.store.startSession('random',{forcedKind:'treasure'}),first);
    while(currentActivity(active(f.store))!.kind!=='think-choice'||currentActivity(active(f.store))!.step!=='sound')finish(f.store,currentActivity(active(f.store))!);
    const item=currentActivity(active(f.store))!;event(f.store,item,'show-options');event(f.store,item,'listen-option',item.wordId);
    const backup=f.store.exportBackup();assert.doesNotThrow(()=>validateBackup(backup));
    for(const corrupt of [(copy:any)=>copy.data.sessions[0].gameSeed=1,(copy:any)=>copy.data.sessions[0].activityStates[item.id].heardOptionIds=['foreign'],(copy:any)=>copy.data.sessions[0].activityStates[item.id].optionsVisible=false]){const copy=structuredClone(backup);corrupt(copy);assert.throws(()=>validateBackup(copy),/备份/);}
    f.restart();assert.deepEqual(active(f.store).activities,first.activities);assert.equal(active(f.store).gameSeed,first.gameSeed);
  }finally{f.close();}
});
