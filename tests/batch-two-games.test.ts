import { finishGoalFixture } from './helpers/goal-steps.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import type { ActivityAction, GameKind, LearningActivity } from '../shared/contracts.ts';
import { activityDone, buildActivities, currentActivity } from '../shared/game-plan.ts';
import { batchTwoKinds, findLetterPath, pairedGame } from '../shared/game-boards.ts';
import { gameRegistry, seededRandom } from '../shared/game-registry.ts';
import { gameAudioWords, transitionGame } from '../shared/game-rules.ts';
import { dailyLearningPlan } from '../shared/learning.ts';

function fixture(kind?:GameKind) {
  const directory=mkdtempSync(join(tmpdir(),'word-batch-two-')),clock=()=>new Date('2026-10-17T04:00:00Z');
  let store=new Store(directory,clock);
  const terms=kind==='mimic'?['run','jump']:['apple','banana','cat'];
  const pack=store.createPack('第二批测试',terms.map((term,index)=>({term,meaning:kind==='mimic'?['跑步','跳跃'][index]:['苹果','香蕉','猫'][index],partOfSpeech:kind==='mimic'?'verb':'noun'})));
  store.enablePack(pack.id,true);store.updateSettings({spellingEnabled:kind==='letter-path',familyGamesEnabled:kind==='quiz',sessionMinutes:15});
  return {get store(){return store;},restart(){store.close();store=new Store(directory,clock);},close(){store.close();rmSync(directory,{recursive:true,force:true});}};
}
const active=(store:Store)=>store.read().sessions.at(-1)!;
const event=(store:Store,a:LearningActivity,action:ActivityAction,selectedId?:string)=>store.activityEvent({sessionId:active(store).id,activityId:a.id,action,...(selectedId===undefined?{}:{selectedId})});
function finish(store:Store,a:LearningActivity) {
  const session=active(store),state=session.activityStates?.[a.id]??{},kind=a.kind;
  if(finishGoalFixture(store,session,a))return;
  if(kind==='standard') {
    if(a.step!=='learn')store.attempt({sessionId:session.id,wordId:a.wordId,skill:a.step==='sound'?'listen':a.step,step:a.step,correct:true,hinted:false,practiceOnly:a.step==='recall',source:'click'});
    store.updateSession({completedStep:{wordId:a.wordId,step:a.step}});return;
  }
  if(pairedGame(kind)){event(store,a,'listen');for(const word of a.targets!)event(store,a,'pick',word.id);event(store,a,'submit');}
  else if(kind==='switch'||kind==='peek'||kind==='think-choice') {
    if(kind==='peek')event(store,a,'uncover','0');
    if(kind==='think-choice')event(store,a,'show-options');
    event(store,a,kind==='switch'&&a.direction==='hear-picture'?'listen':'listen-option',a.wordId);event(store,a,'choose',a.wordId);
  }else if(kind==='draw'){event(store,a,'listen');event(store,a,'draw','1'+'0'.repeat(95));event(store,a,'compare');event(store,a,'finish');}
  else if(kind==='mimic'){event(store,a,'listen');event(store,a,'reveal');event(store,a,'finish');}
  else if(kind==='associate') {
    if(a.step==='sound'){event(store,a,'pick',a.choices.find(word=>word.id!==a.wordId)!.id);event(store,a,'compose');}
    else event(store,a,'reveal');event(store,a,'finish');
  }else if(kind==='quiz'){if(!state.handedOver)event(store,a,'hand-over','gesture');event(store,a,'guess',a.choices.find(word=>word.id!==a.wordId)!.id);event(store,a,'reveal');event(store,a,'finish');}
  else if(kind==='letter-path'){event(store,a,'listen');for(const cell of findLetterPath(a.letterGrid!,a.word.term)!)event(store,a,'letter',String(cell));event(store,a,'submit');}
  else if(kind==='portal'||kind==='missing'){if(kind==='missing')event(store,a,'conceal');event(store,a,'reveal');event(store,a,'skip');}
  else {if(kind==='treasure')event(store,a,'conceal');event(store,a,'listen');if(kind==='listen-first')event(store,a,'show-options');event(store,a,'choose',kind==='gate'?(a.cueWord!.id===a.wordId?'yes':'no'):a.wordId);}
  event(store,a,'next');
}
function reach(store:Store,kind:GameKind) {for(let i=0;i<40&&currentActivity(active(store))?.kind!==kind;i++)finish(store,currentActivity(active(store))!);return currentActivity(active(store))!;}

for(const definition of gameRegistry.filter(game=>batchTwoKinds.has(game.kind)))test(`${definition.title}: integrates the whole lesson, restarts partial rules and never invents mastery`,()=>{
  const f=fixture(definition.kind);try {
    const first=f.store.startSession('random',{forcedKind:definition.kind});
    assert.equal(first.activities!.length,first.tasks!.flatMap(task=>task.steps).length);
    const item=reach(f.store,definition.kind);assert.equal(item.kind,definition.kind);
    assert.throws(()=>event(f.store,item,'next'),/先完成/);
    if(definition.kind==='peek')event(f.store,item,'uncover','0');
    else if(definition.kind==='associate')event(f.store,item,'pick',item.choices.find(word=>word.id!==item.wordId)!.id);
    else if(definition.kind==='quiz')event(f.store,item,'hand-over','gesture');
    else if(definition.kind==='switch'&&item.direction==='picture-hear')event(f.store,item,'listen-option',item.wordId);
    else event(f.store,item,'listen');
    const backup=f.store.exportBackup(),checkpoint=structuredClone(active(f.store));assert.doesNotThrow(()=>validateBackup(backup));f.restart();f.store.restoreBackup(backup);assert.deepEqual(active(f.store),checkpoint);
    for(let i=0;i<40&&currentActivity(active(f.store));i++){finish(f.store,currentActivity(active(f.store))!);assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));}
    assert.equal(currentActivity(active(f.store)),undefined);f.store.updateSession({complete:true});f.store.updateSession({complete:true});assert.equal(f.store.read().stickers.length,1);
    const records=f.store.read().attempts.filter(attempt=>active(f.store).activities!.find(a=>a.id===attempt.activityId)?.kind===definition.kind);
    assert.ok(records.length>=2);assert.ok(records.every(row=>row.practiceOnly));assert.ok(f.store.read().progress.every(row=>['recognize','listen'].includes(row.skill)&&row.stage<=1));
    assert.equal(active(f.store).completedWordIds.length,first.wordIds.length);
  }finally{f.close();}
});

test('ordered and unordered pairs each cost two planned targets, persist both checkpoints and reject a forged half-completion',()=>{
  for(const kind of ['queue','collect'] as GameKind[]){const f=fixture(kind);try{
    f.store.startSession('random',{forcedKind:kind});const a=reach(f.store,kind),other=active(f.store).activities!.find(item=>item.groupId===a.groupId&&item.id!==a.id)!;
    const words=gameAudioWords(a,'listen');assert.deepEqual(words.map(word=>word.id),a.targets!.map(word=>word.id));
    event(f.store,a,'listen');for(const word of [...a.targets!].reverse())event(f.store,a,'pick',word.id);event(f.store,a,'submit');
    assert.equal(active(f.store).activityStates![a.id].outcome,kind==='queue'?'try':'correct');
    if(kind==='queue'){event(f.store,a,'undo');event(f.store,a,'undo');for(const word of a.targets!)event(f.store,a,'pick',word.id);event(f.store,a,'submit');}
    const backup=f.store.exportBackup();assert.doesNotThrow(()=>validateBackup(backup));
    const forged=structuredClone(backup);forged.data.sessions.at(-1)!.completedSteps![a.wordId].push('listen');assert.throws(()=>validateBackup(forged),/备份/);
    event(f.store,a,'next');assert.ok(activityDone(active(f.store),a)&&activityDone(active(f.store),other));
    const count=f.store.read().attempts.length;event(f.store,a,'next');event(f.store,other,'next');assert.equal(f.store.read().attempts.length,count);
    assert.ok(f.store.read().attempts.filter(row=>row.activityId===a.id||row.activityId===other.id).every(row=>row.practiceOnly));
  }finally{f.close();}}
});

test('family opt-in, verb eligibility, spelling opt-in and the three-mechanism cap apply before sampling',()=>{
  const f=fixture();try{
    const plan=dailyLearningPlan(f.store.read());
    for(let index=0;index<180;index++){
      const activities=buildActivities(plan.tasks,plan.available,seededRandom(`off-${index}`),{randomize:true});
      assert.ok(activities.every(a=>!['mimic','quiz','letter-path'].includes(a.kind)));
    }
    f.store.updateSettings({spellingEnabled:true,familyGamesEnabled:true});const spelling=dailyLearningPlan(f.store.read());
    const seen=new Set<string>();
    for(let index=0;index<300;index++){
      const activities=buildActivities(spelling.tasks,spelling.available,seededRandom(`on-${index}`),{randomize:true,familyEnabled:true});activities.forEach(a=>seen.add(a.kind));
      assert.equal(activities.length,spelling.taskCount);assert.ok(new Set(activities.filter(a=>a.kind!=='standard').map(a=>a.kind)).size<=3);
      for(const task of spelling.tasks)assert.ok(activities.some(a=>a.wordId===task.wordId&&a.kind==='standard'&&['sound','listen'].includes(a.step)||a.wordId===task.wordId&&gameRegistry.find(g=>g.kind===a.kind)?.practiceOnly===false));
    }
    assert.ok(seen.has('quiz')&&seen.has('letter-path')&&seen.has('associate'));
    const backup=f.store.exportBackup();assert.equal(validateBackup(backup).data.settings.familyGamesEnabled,true);delete (backup.data.settings as any).familyGamesEnabled;assert.doesNotThrow(()=>validateBackup(backup));
    assert.throws(()=>f.store.updateSettings({familyGamesEnabled:'yes'}),/布尔/);
  }finally{f.close();}
});

test('drawing, partial pictures, letter adjacency and family guessing reject forged evidence and restore exact drafts',()=>{
  for(const kind of ['draw','peek','letter-path','quiz'] as GameKind[]){const f=fixture(kind);try{
    f.store.startSession('random',{forcedKind:kind});const a=reach(f.store,kind);
    if(kind==='draw'){assert.throws(()=>event(f.store,a,'compare'),/先画/);event(f.store,a,'listen');event(f.store,a,'draw','1'.repeat(96));}
    if(kind==='peek'){assert.throws(()=>event(f.store,a,'listen-option',a.wordId),/先揭/);event(f.store,a,'uncover','2');}
    if(kind==='letter-path'){event(f.store,a,'listen');event(f.store,a,'letter','0');assert.throws(()=>event(f.store,a,'letter','24'),/相邻/);assert.equal(f.store.read().attempts.filter(row=>row.step==='spell').length,0);}
    if(kind==='quiz'){assert.throws(()=>event(f.store,a,'guess',a.wordId),/家长/);event(f.store,a,'hand-over','gesture');const before=f.store.read().attempts.length;event(f.store,a,'guess',a.wordId);assert.equal(f.store.read().attempts.length,before);}
    const backup=f.store.exportBackup(),state=structuredClone(active(f.store).activityStates);f.restart();f.store.restoreBackup(backup);assert.deepEqual(active(f.store).activityStates,state);
    const malformed=structuredClone(backup),saved=malformed.data.sessions.at(-1)!.activityStates![a.id];
    if(kind==='draw')saved.drawing='<script>';
    if(kind==='peek')saved.uncoveredTiles=[9];
    if(kind==='letter-path')saved.letterPath=[0,24];
    if(kind==='quiz')saved.guessId='foreign';
    assert.throws(()=>validateBackup(malformed),/备份/);
  }finally{f.close();}}
});

test('association scenes are composed before intervening tasks and recalled from the same saved personal pair',()=>{
  const f=fixture('associate');try{
    f.store.startSession('random',{forcedKind:'associate'});const a=reach(f.store,'associate'),partner=a.choices.find(word=>word.id!==a.wordId)!;
    event(f.store,a,'pick',partner.id);event(f.store,a,'compose');event(f.store,a,'finish');event(f.store,a,'next');
    const recall=active(f.store).activities!.find(item=>item.wordId===a.wordId&&item.step==='recall')!;
    assert.equal(recall.kind,'associate');const activities=active(f.store).activities!;assert.ok(activities.findIndex(item=>item.id===recall.id)-activities.findIndex(item=>item.id===a.id)>=2);
    while(currentActivity(active(f.store))!.id!==recall.id)finish(f.store,currentActivity(active(f.store))!);
    event(f.store,recall,'reveal');const state=active(f.store).activityStates![recall.id];
    assert.deepEqual(state.selectedIds,[a.wordId,partner.id]);assert.deepEqual(gameAudioWords(recall,'reveal',undefined,state).map(word=>word.id),[a.wordId]);
    assert.ok(f.store.read().attempts.filter(row=>row.activityId===a.id).every(row=>row.practiceOnly));assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('paired fallback retains taught distractors and invalidated assets cannot leave a dangling pair or scene',()=>{
  for(const kind of ['queue','associate'] as GameKind[]){const f=fixture(kind);try{
    const first=f.store.startSession('random',{forcedKind:kind}),a=reach(f.store,kind);
    if(kind==='queue') {
      const fallback=first.activities!.find(item=>item.step==='listen'&&item.kind==='standard')!;
      assert.deepEqual(new Set(fallback.choices.map(word=>word.id)),new Set(first.wordIds));
      event(f.store,a,'listen');event(f.store,a,'pick',a.targets![0].id);
    }else{event(f.store,a,'pick',a.choices.find(word=>word.id!==a.wordId)!.id);event(f.store,a,'compose');}
    const changed=a.choices.find(word=>word.id!==a.wordId)!;f.store.updateWord(changed.id,{assetStatus:'draft'},()=>true);
    f.store.state({speech:{configured:false,available:false,status:'test',detail:'测试'},codex:{configured:false,available:false,status:'test',detail:'测试'}});
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
    assert.ok(active(f.store).activities!.every(item=>item.kind==='standard'||item.choices.every(word=>word.id!==changed.id)));
  }finally{f.close();}}
});
