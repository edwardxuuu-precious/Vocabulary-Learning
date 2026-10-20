import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveMainlineActivities, adaptiveMainlineKinds } from '../shared/adaptive-mainline.ts';
import { extendedKinds } from '../shared/game-materials.ts';
import { buildActivities } from '../shared/game-plan.ts';
import { arrangeMemoryLoop, freezeMemoryLoop, memoryLoopTasks, validMemoryLoopPolicy } from '../shared/learning-policy.ts';
import { seededRandom, gameDefinition, type GamePlanOptions } from '../shared/game-registry.ts';
import { pairedGame } from '../shared/game-boards.ts';
import { validGameSession } from '../server/game-validation.ts';
import { extendedDemo } from '../scripts/game-material-fixtures.ts';
import type { GameKind, LearningSession, LearningTask, Word } from '../shared/contracts.ts';

const steps=['learn','listen','recognize','recall','sound','read'] as LearningTask['steps'];
function plan(words:Word[],options:GamePlanOptions={},seed='adaptive',tasks:LearningTask[]=words.map(w=>({wordId:w.id,mode:'review' as const,steps:steps.filter(step=>step!=='learn')}))){
  const ordered=memoryLoopTasks(tasks),base=arrangeMemoryLoop(ordered,buildActivities(ordered,words,seededRandom(seed),{allowedKinds:[]})),checkpoints=freezeMemoryLoop(base).checkpoints;
  const activities=adaptiveMainlineActivities(base,words,seed,0,checkpoints,options);
  const session:LearningSession={id:'fixture',wordIds:ordered.map(t=>t.wordId),completedWordIds:[],startedAt:'2026-10-20T00:00:00Z',rewardGranted:false,tasks:ordered,completedSteps:{},activityStates:{},activities,learningPolicy:freezeMemoryLoop(activities,3)};
  assert.ok(validGameSession(session,new Set(words.map(w=>w.id)),()=>true));assert.ok(validMemoryLoopPolicy(session));
  assert.deepEqual(activities.map(a=>[a.id,a.wordId,a.step,a.word]),base.map(a=>[a.id,a.wordId,a.step,a.word]));
  return {activities,session,base,checkpoints};
}
test('reviewed color, position and relation games require matching type, current material and cached narration',()=>{
  for(const kind of ['paint','position','opposites','variants','detective','sort','parts'] as GameKind[]){
    const {words}=extendedDemo(kind),keys=[`${words[0].id}:${kind}`],options={allowedKinds:[kind],readyMaterialKeys:keys};
    const accepted=plan(words,options).activities;assert.ok(accepted.some(a=>a.kind===kind),kind);
    assert.ok(!plan(words,{...options,readyMaterialKeys:[]}).activities.some(a=>a.kind===kind),`missing cache ${kind}`);
    const stale=structuredClone(words);stale[0].learningVersion=1;assert.ok(!plan(stale,options).activities.some(a=>a.kind===kind),`stale material ${kind}`);
    const proposed=structuredClone(words);proposed[0].gameMaterials![kind]!.origin='proposal';assert.ok(!plan(proposed,options).activities.some(a=>a.kind===kind),`unreviewed material ${kind}`);
  }
  const {words}=extendedDemo('paint');words[0].partOfSpeech='verb';assert.ok(!plan(words,{allowedKinds:['paint'],readyMaterialKeys:[`${words[0].id}:paint`]}).activities.some(a=>a.kind==='paint'));
});
test('action imitation is a verb listening practice, keeps recall hidden and retains an objective listening check',()=>{
  const words=extendedDemo('program').words.filter(w=>w.partOfSpeech==='verb');
  const result=plan(words,{allowedKinds:['mimic']});assert.ok(result.activities.some(a=>a.kind==='mimic'&&a.step==='listen'));
  for(const a of result.activities.filter(a=>a.step==='recall'))assert.equal(a.kind,'portal');
  for(const a of result.activities.filter(a=>a.kind==='mimic'))assert.equal(result.activities.find(row=>row.wordId===a.wordId&&row.step==='sound')?.kind,'standard');
  words[0].partOfSpeech='noun';assert.ok(!plan(words,{allowedKinds:['mimic']}).activities.some(a=>a.kind==='mimic'));
});
test('paired semantic games reuse reviewed boards and never cross a saved rest or introduce a future target',()=>{
  const {words}=extendedDemo('program'),tasks:LearningTask[]=[{wordId:words[2].id,mode:'review',steps:['recognize']},...words.slice(0,2).map(w=>({wordId:w.id,mode:'new' as const,steps}))];
  const options:GamePlanOptions={contextEnabled:true,allowedKinds:['program'],readyMaterialKeys:[`${words[0].id}:program`]};
  const result=plan(words,options,'semantic',tasks),pair=result.activities.filter(a=>a.kind==='program');assert.equal(pair.length,2);assert.deepEqual(pair[0].material,pair[1].material);assert.deepEqual(pair[0].targets,pair[1].targets);
  assert.ok(!plan(words,{...options,contextEnabled:false},'semantic',tasks).activities.some(a=>a.kind==='program'));
  const unintroducedTasks=words.map(w=>({wordId:w.id,mode:'new' as const,steps}));assert.ok(!plan(words,options,'semantic',unintroducedTasks).activities.some(a=>a.kind==='program'));
  const boundary=result.base.findIndex(a=>a.wordId===words[0].id&&a.step==='listen');
  const cut=adaptiveMainlineActivities(result.base,words,'semantic',0,[result.base[boundary].id],options);assert.ok(!cut[boundary].targets);
});
test('seeded rotation is frozen, varies short rounds, and never replaces required objectives with participation',()=>{
  const words=extendedDemo('variants').words;
  const kinds=new Set<string>();
  for(let seed=0;seed<16;seed++){
    const a=plan(words,{},String(seed));assert.deepEqual(a.activities,plan(words,{},String(seed)).activities);
    for(const row of a.activities){kinds.add(row.kind);if(row.step==='listen'&&gameDefinition(row.kind)?.practiceOnly)assert.equal(a.activities.find(r=>r.wordId===row.wordId&&r.step==='sound')?.kind,'standard');
      if(pairedGame(row.kind)){const pair=a.activities.filter(r=>r.groupId===row.groupId&&r.kind===row.kind);assert.equal(pair.length,2);assert.ok(!a.checkpoints.includes(pair[0].id));}}
  }
  assert.ok(kinds.size>=7);
  const due=plan(words,{},'due',words.map(w=>({wordId:w.id,mode:'review' as const,steps:['listen']})));assert.ok(due.activities.every(a=>!gameDefinition(a.kind)?.practiceOnly));
});
test('spelling skins reuse only existing spelling goals and freeze valid letter boards',()=>{
  const words=extendedDemo('variants').words,options:GamePlanOptions={allowedKinds:['letter-path','letter-gap','letter-sort','letter-extra','letter-swap','dictation','cover-spell','letter-push']};
  assert.ok(!plan(words,options).activities.some(a=>a.step==='spell'));
  const kinds=new Set<string>();for(let seed=0;seed<8;seed++){
    const tasks:LearningTask[]=words.map(w=>({wordId:w.id,mode:'review',steps:[...steps.filter(s=>s!=='learn'),'spell']}));
    for(const a of plan(words,options,`letters-${seed}`,tasks).activities.filter(a=>a.step==='spell')){assert.ok(a.kind==='standard'||gameDefinition(a.kind)?.step==='spell');kinds.add(a.kind);}
  }
  assert.ok(kinds.size>=4);
});
test('every opted-in material or spelling adapter can build a valid mainline surface',()=>{
  for(const kind of adaptiveMainlineKinds.filter(kind=>extendedKinds.has(kind))){
    const {words}=extendedDemo(kind),definition=gameDefinition(kind)!,withSpell=definition.step==='spell',fullSteps:LearningTask['steps']=[...steps,...(withSpell?['spell' as const]:[])];
    const tasks:LearningTask[]=pairedGame(kind)?[{wordId:words[2].id,mode:'review',steps:['recognize']},...words.slice(0,2).map(w=>({wordId:w.id,mode:'new' as const,steps:fullSteps}))]
      :words.map(w=>({wordId:w.id,mode:'review',steps:fullSteps.filter(step=>step!=='learn')}));
    const result=plan(words,{allowedKinds:[kind],readyMaterialKeys:[`${words[0].id}:${kind}`],contextEnabled:true},`adapter-${kind}`,tasks);
    assert.ok(result.activities.some(a=>a.kind===kind),kind);
  }
});
