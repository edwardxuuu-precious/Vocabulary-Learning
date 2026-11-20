import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,validateBackup} from '../server/store.ts';
import {blankGuidance,needsRuleGuide,needsAutomaticRuleGuide,ruleGuide,validGuidance} from '../shared/learning-guidance.ts';
import {adaptiveMainlineKinds} from '../shared/adaptive-mainline.ts';
import {gameRegistry,type GamePlanOptions} from '../shared/game-registry.ts';
import {currentActivity} from '../shared/game-plan.ts';
import type {LearningActivity,LearningSession} from '../shared/contracts.ts';
test('unseen direct tasks remain operable without fabricating rules-seen while complex games retain their gate',()=>{
  const word={id:'word',term:'go',meaning:'去',imageUrl:'/approved.png'},base={id:'word:sound',wordId:'word',word,choices:[word]};
  for(const [kind,step] of [['standard','sound'],['standard','listen'],['standard','recognize'],['standard','spell'],['portal','recall'],['portal','read'],['repair','sound']] as const){
    const activity={...base,kind,step} as LearningActivity;
    const session={learningPolicy:{guidanceVersion:1},activities:[activity]} as LearningSession;
    assert.equal(needsRuleGuide(session,activity),true);
    assert.equal(needsAutomaticRuleGuide(session,activity),false);
    assert.equal(session.guidance,undefined);
  }
  const activity={...base,kind:'gate',step:'listen'} as LearningActivity;
  assert.equal(needsAutomaticRuleGuide({learningPolicy:{guidanceVersion:1}} as LearningSession,activity),true);
});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'learning-guidance-'));let store=new Store(dir,()=>new Date('2026-10-25T03:00:00Z'));
  store.mutate(data=>{data.packs=[{id:'family',title:'工程示例',enabled:true,createdAt:'2026-10-01T00:00:00Z'}];data.words.forEach(word=>word.packId='family');data.settings.sessionMinutes=30;});
  return {get store(){return store;},restart(){store.close();store=new Store(dir,()=>new Date('2026-10-25T03:00:00Z'));},close(){store.close();rmSync(dir,{recursive:true,force:true});}};}
const session=(store:Store)=>store.read().sessions.at(-1)!;
// Guidance event cases use a small explicit fixture pool so their operation stays predictable.
function start(store:Store,modern=true,options:GamePlanOptions={allowedKinds:['listen-first','supply','gate','repair','switch','portal']}){return store.startSession('random',options, {entry:modern?'learn':undefined,mode:'relearn',wordIds:store.read().words.slice(0,5).map(w=>w.id),strategy:'memory-loop'});}
function toFirstTask(store:Store){const s=session(store);for(const a of s.activities!.filter(a=>a.step==='learn')){if(currentActivity(session(store))?.id!==a.id)break;store.updateSession({sessionId:s.id,planVersion:3,completedStep:{wordId:a.wordId,step:'learn'}});}return currentActivity(session(store))!;}
test('L04 operation guidance keeps the adaptive game pool and goals; old frozen plans remain intact',()=>{const f=fixture();try{const old=start(f.store,false),before=structuredClone(old);const modern=start(f.store,true,{});assert.equal(modern.learningPolicy?.guidanceVersion,1);assert.ok(modern.activities!.every(a=>a.kind==='standard'||a.kind==='portal'||adaptiveMainlineKinds.includes(a.kind)));assert.equal(modern.activities!.length,30);assert.equal(modern.tasks!.length,5);assert.deepEqual(f.store.read().sessions.find(s=>s.id===old.id),before);assert.equal(old.learningPolicy?.guidanceVersion,undefined);assert.ok(validateBackup(f.store.exportBackup()));}finally{f.close();}});
test('ten non-noun learning words rotate available games without extra tasks, materials or changes on restart',()=>{
  const f=fixture();try{
    const terms=['all','am','are','at','ate','be','black','brown','but','came'];
    const parts=['determiner','verb','verb','preposition','verb','verb','adjective','adjective','conjunction','verb'] as const;
    f.store.mutate(data=>{data.words=data.words.slice(0,10).map((w,i)=>({...w,term:terms[i],meaning:`工程词义${i}`,partOfSpeech:parts[i],gameMaterials:undefined}));data.settings.spellingEnabled=false;data.settings.contextGamesEnabled=false;data.settings.familyGamesEnabled=false;});
    const before=f.store.read(),ids=before.words.map(w=>w.id);
    const s=f.store.startSession('random',{readyMaterialKeys:[]},{entry:'learn',mode:'relearn',wordIds:ids,strategy:'memory-loop'});
    const rows=s.activities!;
    assert.equal(rows.length,60);assert.equal(new Set(rows.map(a=>a.id)).size,60);
    assert.ok(!rows.some(a=>['spell','practice-translate','practice-explain'].includes(a.step)));
    assert.ok(!rows.some(a=>a.kind!=='standard'&&gameRegistry.find(g=>g.kind===a.kind)?.batch));
    for(const id of ids){assert.deepEqual(rows.filter(a=>a.wordId===id).map(a=>a.step).sort(),['learn','listen','read','recall','recognize','sound'].sort());assert.equal(rows.find(a=>a.wordId===id&&a.step==='recall')?.kind,'portal');}
    for(const a of rows.filter(a=>a.step==='listen'&&gameRegistry.find(g=>g.kind===a.kind)?.practiceOnly))assert.equal(rows.find(row=>row.wordId===a.wordId&&row.step==='sound')?.kind,'standard');
    const after=f.store.read();for(const key of ['words','attempts','progress','assessmentAttempts','charges','stickers'] as const)assert.deepEqual(after[key],before[key]);
    f.restart();assert.deepEqual(session(f.store).activities,rows);assert.ok(validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});
test('L04 rules shown/helped are idempotent operation metadata: no attempt, hint, audio, completion or scheduling',()=>{const f=fixture();try{start(f.store);const a=toFirstTask(f.store),before=f.store.read(),s=session(f.store);assert.ok(needsRuleGuide(s,a));for(const action of ['rules-help','rules-help','rules-seen','rules-seen'])f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action});const after=f.store.read(),updated=session(f.store);assert.equal(updated.guidance?.seen.length,1);assert.deepEqual(updated.guidance?.ruleHelpActivityIds,[a.id]);assert.equal(needsRuleGuide(updated,a),false);assert.deepEqual(updated.activityStates,s.activityStates);assert.deepEqual(updated.completedSteps,s.completedSteps);for(const key of ['attempts','progress','assessmentAttempts','charges','stickers'] as const)assert.deepEqual(after[key],before[key]);assert.throws(()=>f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'rules-help',selectedId:a.wordId}));f.restart();assert.equal(needsRuleGuide(session(f.store),a),false);assert.deepEqual(validateBackup(f.store.exportBackup()).data.sessions.at(-1)!.guidance,updated.guidance);}finally{f.close();}});
test('L04 wrong choices surface finite support, while invalid operations and device errors do not count as vocabulary difficulties',()=>{const f=fixture();try{start(f.store);const a=toFirstTask(f.store),s=session(f.store);if(a.kind==='listen-first'){f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'listen'});f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'show-options'});}else f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'listen'});
  assert.throws(()=>f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'choose',selectedId:'not-a-choice'}));assert.equal(session(f.store).guidance?.struggles[a.id],undefined);
  const wrong=a.kind==='gate'?(a.cueWord?.id===a.wordId?'no':'yes'):a.choices.find(w=>w.id!==a.wordId)!.id;
  for(let i=0;i<3;i++)f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'choose',selectedId:wrong});assert.equal(session(f.store).guidance?.struggles[a.id],2);
  const before=f.store.read().attempts.length;f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'rules-help'});assert.equal(f.store.read().attempts.length,before);assert.equal(session(f.store).activityStates?.[a.id].hinted,true,'wrong-choice help remains hinted');
  f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'audio-failed'});assert.equal(session(f.store).guidance?.struggles[a.id],2);assert.ok(validateBackup(f.store.exportBackup()));
}finally{f.close();}});
test('L04 help cannot bypass current activity, checkpoints, version or content boundaries',()=>{const f=fixture();try{const s=start(f.store),first=s.activities![0],future=s.activities!.find(a=>a.step==='listen')!;for(const body of [{activityId:first.id,planVersion:3},{activityId:future.id,planVersion:3},{activityId:first.id,planVersion:1}])assert.throws(()=>f.store.activityEvent({sessionId:s.id,...body,action:'rules-seen'}));assert.equal(session(f.store).guidance,undefined);assert.equal(f.store.read().attempts.length,0);}finally{f.close();}});
test('L04 guide catalog covers optional mechanisms and protects recall/recognition from answer leakage',()=>{const secret={id:'private-id',term:'secretword',meaning:'私有词义',imageUrl:'/media/images/private.png',learningVersion:0};for(const game of gameRegistry){const a:LearningActivity={id:'a',wordId:secret.id,word:secret,choices:[secret],kind:game.kind,step:game.step};const guide=ruleGuide(a)!;assert.ok(guide,game.kind);assert.equal(guide.steps.length,3);for(const text of [secret.term,secret.meaning,secret.imageUrl])assert.ok(!JSON.stringify(guide).includes(text));}
  const a={id:'a',wordId:secret.id,word:secret,choices:[],kind:'portal',step:'recall'} as LearningActivity;assert.equal(ruleGuide(a)?.demo,'oral');assert.equal(ruleGuide({...a,kind:'gate',step:'recognize'})?.demo,'match');assert.notEqual(ruleGuide({...a,kind:'gate',step:'listen'})?.key,ruleGuide({...a,kind:'gate',step:'recognize'})?.key);assert.equal(ruleGuide({...a,kind:'repair',step:'recognize'})?.demo,'meaning');
});
test('L04 backup rejects injected guidance, preserves older absence and never accepts an inferred grade',()=>{const f=fixture();try{const s=start(f.store);assert.ok(validGuidance(s));for(const guidance of [{...blankGuidance(),seen:['unknown']},{...blankGuidance(),ruleHelpActivityIds:['not-an-activity']},{...blankGuidance(),struggles:{[s.activities![0].id]:3}},{...blankGuidance(),correct:true}]){const backup=structuredClone(f.store.exportBackup());(backup.data.sessions.at(-1) as LearningSession).guidance=guidance;assert.throws(()=>validateBackup(backup));}const bad=structuredClone(f.store.exportBackup());bad.data.sessions.at(-1)!.learningPolicy!.guidanceVersion=2 as 1;assert.throws(()=>validateBackup(bad));}finally{f.close();}});
test('L04 a subsequent learning round reuses only acknowledged operation guides, not difficulties or word help',()=>{const f=fixture();try{const first=start(f.store,true,{allowedKinds:['gate']}),a=toFirstTask(f.store);f.store.activityEvent({sessionId:first.id,activityId:a.id,planVersion:3,action:'rules-help'});f.store.activityEvent({sessionId:first.id,activityId:a.id,planVersion:3,action:'rules-seen'});const prior=structuredClone(session(f.store));const next=f.store.startSession('random',{allowedKinds:['gate']}, {entry:'learn',mode:'relearn',wordIds:f.store.read().words.slice(5,8).map(w=>w.id),strategy:'memory-loop'});assert.notEqual(next.id,first.id);assert.ok(next.guidance?.seen.includes(ruleGuide(a)!.key));assert.deepEqual(next.guidance?.ruleHelpActivityIds,[]);assert.deepEqual(next.guidance?.struggles,{});assert.deepEqual(f.store.read().sessions.find(s=>s.id===first.id),prior);assert.ok(validateBackup(f.store.exportBackup()));}finally{f.close();}});
test('L04 basic listening counts objective difficulties separately from participation, skip and unavailable responses',()=>{const f=fixture();try{const s=start(f.store),a=toFirstTask(f.store);f.store.mutate(data=>{data.sessions.at(-1)!.activities!.find(row=>row.id===a.id)!.kind='standard';});assert.ok(a.choices.length>=2);const body={sessionId:s.id,planVersion:3,wordId:a.wordId,step:a.step,skill:'listen',correct:false,hinted:false,source:'click'};for(const [index,extra] of [{practiceOnly:true},{responseStatus:'skipped'},{responseStatus:'unavailable'}].entries())f.store.attempt({...body,id:`non-answer-${index}`,...extra});assert.equal(session(f.store).guidance?.struggles[a.id],undefined);f.store.activityEvent({sessionId:s.id,activityId:a.id,planVersion:3,action:'rules-seen'});for(let i=0;i<2;i++)f.store.attempt({...body,id:`real-choice-${i}`});assert.equal(session(f.store).guidance?.struggles[a.id],2);assert.ok(validateBackup(f.store.exportBackup()));}finally{f.close();}});


test('task help keeps persisted guide keys compatible while spelling and repair use specific operation demos',()=>{
  const word={id:'w',term:'secretword',meaning:'私有词义',imageUrl:'/private.png'},base={id:'w:spell',wordId:'w',word,choices:[word]};
  const spell={...base,kind:'standard',step:'spell'} as LearningActivity,repair={...base,id:'w:sound',kind:'repair',step:'sound'} as LearningActivity;
  assert.equal(ruleGuide(spell)?.key,'sequence');assert.equal(ruleGuide(spell)?.demo,'letters');
  assert.equal(ruleGuide(repair)?.key,'pictures');assert.equal(ruleGuide(repair)?.demo,'wires');
  const saved={activities:[spell,repair],guidance:{...blankGuidance(),seen:['sequence','pictures']}} as LearningSession;
  assert.equal(validGuidance(saved),true);assert.equal(needsAutomaticRuleGuide(saved,spell),false);
  for(const guide of [ruleGuide(spell),ruleGuide(repair)])for(const value of [word.term,word.meaning,word.imageUrl])assert.ok(!JSON.stringify(guide).includes(value));
});
