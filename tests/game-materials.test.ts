import { finishGoalFixture } from './helpers/goal-steps.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extendedDemo } from '../scripts/game-material-fixtures.ts';
import { automaticSpelling,extendedKinds,validGameMaterial } from '../shared/game-materials.ts';
import { gameRegistry,eligibleGames,seededRandom } from '../shared/game-registry.ts';
import { buildActivities,currentActivity } from '../shared/game-plan.ts';
import { gameAccepted,gameAudioWords,transitionGame,validActivityState } from '../shared/game-rules.ts';
import { readyGameMaterialKeys } from '../server/game-material-readiness.ts';
import { createApp } from '../server/index.ts';
import { Store,validateBackup } from '../server/store.ts';
import type { ActivityAction,GameKind,LearningActivity,LearningTask } from '../shared/contracts.ts';

const activities=(kind:GameKind)=>{const {words}=extendedDemo(kind),tasks=words.map(w=>({wordId:w.id,mode:'new',steps:['learn','listen','sound','recall','spell']} as LearningTask));return buildActivities(tasks,words,seededRandom(kind),{forcedKind:kind,allowedKinds:[kind],contextEnabled:true,familyEnabled:true});};
test('all 50 registered mechanisms are distinct, every extra material is bounded and unsafe media or unknown fields are refused',()=>{
  assert.equal(gameRegistry.length,50);assert.equal(new Set(gameRegistry.map(g=>g.number)).size,50);
  for(const kind of extendedKinds){const {material}=extendedDemo(kind as GameKind);if(automaticSpelling.has(kind))continue;assert.ok(validGameMaterial(kind,material),kind);
    for(const corrupt of [(m:any)=>m.tiles[0].imageUrl='https://external.test/private.png',(m:any)=>m.tiles[0].imageUrl='/media/images/../secrets.png',(m:any)=>m.tiles[0].unknown='script',(m:any)=>m.answer=['foreign'],(m:any)=>m.wordVersions={foreign:0}]){const m=structuredClone(material);corrupt(m);assert.equal(validGameMaterial(kind,m),false,kind);}
  }
});
test('cache and approved image readiness gate random selection without generation and duplicate cue checks are shared',async()=>{
  const {words}=extendedDemo('cloze'),seen:string[]=[];
  const ready=await readyGameMaterialKeys(words,words,()=>true,async cue=>{seen.push(cue.text);return true;});assert.ok(ready.includes(`${words[0].id}:cloze`));assert.equal(ready.length,7);assert.ok(seen.includes('I see a cat'));
  const missing=await readyGameMaterialKeys(words,words,()=>true,async cue=>cue.text!=='I see a cat');assert.ok(!missing.includes(`${words[0].id}:cloze`));assert.equal(missing.length,6);
  assert.ok(!eligibleGames('recall',words,{contextEnabled:true,readyMaterialKeys:[]}).some(g=>g.kind==='cloze'));
  const variants=extendedDemo('variants');assert.deepEqual(await readyGameMaterialKeys(variants.words,variants.words,()=>false,async()=>{throw Error('must not read audio for missing image');}),[]);
});
test('composite activities consume two atomic steps, freeze one board, and cannot restore half a pair',()=>{
  for(const kind of ['story','program','combine','quantity','letter-sort'] as GameKind[]){const plan=activities(kind),pair=plan.filter(a=>a.kind===kind);assert.equal(pair.length,2,kind);assert.deepEqual(pair[0].targets!.map(w=>w.id),pair.map(a=>a.wordId));assert.deepEqual(pair[0].material,pair[1].material);assert.deepEqual(pair[0].spellingBoard,pair[1].spellingBoard);}
});
test('wrong attempts retain hints through reset; detective, letter swaps and letter boxes support real undo',()=>{
  const a=activities('variants').find(a=>a.kind==='variants')!;let state={};const go=(action:ActivityAction,id?:string)=>state=transitionGame(a,state,action,id).state;
  go('listen');go('tap',a.material!.answer[0]);go('submit');assert.equal((state as any).outcome,'try');go('reset');assert.equal((state as any).hinted,true);for(const id of a.material!.answer)go('tap',id);go('submit');assert.equal((state as any).outcome,'correct');assert.equal((state as any).hinted,true);
  const detective=activities('detective').find(a=>a.kind==='detective')!;let d=transitionGame(detective,{},'listen').state;d=transitionGame(detective,d,'tap',detective.material!.answer[0]).state;d=transitionGame(detective,d,'reset').state;assert.equal(d.gameStage,0);assert.doesNotThrow(()=>transitionGame(detective,d,'tap',detective.material!.answer[0]));
  const swap=activities('letter-swap').find(a=>a.kind==='letter-swap')!;let s=transitionGame(swap,{},'listen').state;s=transitionGame(swap,s,'tap','0').state;s=transitionGame(swap,s,'tap','1').state;s=transitionGame(swap,s,'undo').state;assert.equal(s.gameText,swap.spellingBoard![0]);assert.ok(validActivityState(swap,s));
  const box=activities('letter-push').find(a=>a.kind==='letter-push')!;let b=transitionGame(box,{},'listen').state;b=transitionGame(box,b,'tap','0').state;assert.throws(()=>transitionGame(box,b,'place','0'),/旁边/);b=transitionGame(box,b,'place','12').state;b=transitionGame(box,b,'undo').state;assert.equal(b.gamePositions![0],18);
});
test('extended checkpoints refuse unrelated fields, fabricated positions and pre-audio correct states',()=>{
  for(const kind of extendedKinds){const a=activities(kind as GameKind).find(a=>a.kind===kind)!;assert.ok(a,kind);assert.equal(validActivityState(a,{drawing:'1'.repeat(96)}),false,kind);assert.equal(validActivityState(a,{gameFocus:'foreign'}),false,kind);assert.equal(validActivityState(a,{gamePositions:[-1]}),false,kind);assert.throws(()=>transitionGame(a,{},'choose','foreign'),/不适用/);}
});
test('random plans retain all word objectives and the three-mechanism cap across the expanded library',()=>{
  const seen=new Set<string>();for(const kind of extendedKinds){const {words}=extendedDemo(kind as GameKind),tasks=words.map(w=>({wordId:w.id,mode:'new',steps:['learn','listen','sound','recall','spell']} as LearningTask));for(let i=0;i<400;i++){const plan=buildActivities(tasks,words,seededRandom(`${kind}-${i}`),{randomize:true,familyEnabled:true,contextEnabled:true,recentKinds:gameRegistry.map(g=>g.kind)});assert.equal(plan.length,15);assert.ok(new Set(plan.filter(a=>a.kind!=='standard').map(a=>a.kind)).size<=3);for(const word of words)assert.ok(plan.some(a=>a.wordId===word.id&&(a.kind==='standard'&&['listen','sound'].includes(a.step)||gameRegistry.find(g=>g.kind===a.kind)?.practiceOnly===false)));plan.forEach(a=>seen.add(a.kind));}}
  for(const kind of extendedKinds)assert.ok(seen.has(kind),kind);
});
test('material approval requires parent grant, cached cues and current word versions; it never synthesizes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'game-material-http-')),status={configured:false,available:false,status:'test',detail:'unit fixture'},calls:string[]=[];let cached=false;
  const app=createApp({dataDir:dir,dialogue:{status:async()=>status,turn:async()=>{throw Error('unused');},cancel(){},reset:async()=>{},close:async()=>{}},integrations:{probeIntegrations:async()=>({speech:status,codex:status}),getCachedSpeech:async cue=>{calls.push(cue.text);return cached?'fixture-cache.wav':undefined;},synthesizeSpeech:async()=>{throw Error('generation forbidden');}}});
  try{app.store.enablePack('starter',true);app.store.mutate(d=>{d.words=extendedDemo('clue').words;delete d.words[0].gameMaterials;});await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(app.server.address() as any).port}`,m=extendedDemo('clue').material,path='/api/words/demo-cat/game-materials/clue';const call=(path:string,body:unknown,token?:string)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
    assert.equal((await call(path,{approve:true,material:m})).status,403);const grant=await (await call('/api/parent-gate',{pin:'682419'})).json();const token=grant.assessmentGrant.token;assert.equal((await call(path+'/prepare',{approve:true,material:m},token)).status,503);assert.equal((await call(path,{approve:true,material:m},token)).status,409);assert.equal(app.store.read().words[0].gameMaterials,undefined);cached=true;assert.equal((await call(path,{approve:true,material:m},token)).status,200);assert.ok(app.store.read().words[0].gameMaterials?.clue);assert.equal(app.store.read().charges.length,0);assert.ok(calls.length>0);
    const stale=structuredClone(m);stale.wordVersion=99;assert.equal((await call(path,{approve:true,material:stale},token)).status,400);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('server stores a wrong check and a later correct check once each without progression or duplicate retries',()=>{
  const dir=mkdtempSync(join(tmpdir(),'game-material-retry-')),store=new Store(dir);
  try{store.enablePack('starter',true);store.mutate(d=>{d.words=extendedDemo('variants').words;});const session=store.startSession('random',{forcedKind:'variants',allowedKinds:['variants']});
    while(currentActivity(store.read().sessions.at(-1)!)!.kind!=='variants'){const a=currentActivity(store.read().sessions.at(-1)!)!;if(finishGoalFixture(store,store.read().sessions.at(-1)!,a))continue;if(a.step!=='learn')store.attempt({sessionId:session.id,wordId:a.wordId,step:a.step,skill:a.step==='sound'?'listen':a.step,correct:false,hinted:true,practiceOnly:true,source:'click'});store.updateSession({completedStep:{wordId:a.wordId,step:a.step}});}
    const a=currentActivity(store.read().sessions.at(-1)!)!,event=(action:ActivityAction,id?:string)=>store.activityEvent({sessionId:session.id,activityId:a.id,action,...(id?{selectedId:id}:{})});event('listen');event('tap',a.material!.answer[0]);event('submit');event('submit');event('reset');for(const id of a.material!.answer)event('tap',id);event('submit');event('submit');
    const attempts=store.read().attempts.filter(row=>row.activityId===a.id);assert.equal(attempts.length,2);assert.equal(attempts[0].correct,false);assert.equal(attempts[1].correct,true);assert.ok(attempts.every(row=>row.practiceOnly));assert.equal(attempts[1].hinted,true);assert.equal(store.read().progress.filter(p=>p.skill!=='recognize').length,0);assert.doesNotThrow(()=>validateBackup(store.exportBackup()));
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('story replays the actual event order rather than the lesson target order, and quantity preserves its approved phrase',()=>{
  const story=activities('story').find(a=>a.kind==='story')!;
  assert.ok(story.material!.prompt!.text.includes('after'));
  assert.equal(gameAudioWords(story,'listen').length,1);
  assert.deepEqual(gameAudioWords(story,'submit',undefined,{outcome:'correct'}).map(w=>w.term),['run','jump']);
  const quantity=activities('quantity').find(a=>a.kind==='quantity')!;
  assert.deepEqual(gameAudioWords(quantity,'submit',undefined,{outcome:'correct'}).map(w=>w.term),['two apples']);
});
