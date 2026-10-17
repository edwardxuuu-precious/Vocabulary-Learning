import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store,validateBackup } from '../server/store.ts';
import { extendedDemo } from '../scripts/game-material-fixtures.ts';
import { gameRegistry,eligibleGames,seededRandom } from '../shared/game-registry.ts';
import { automaticSpelling,extendedKinds,validGameMaterial } from '../shared/game-materials.ts';
import { buildActivities,currentActivity } from '../shared/game-plan.ts';
import { gameAudioWords,validActivityState } from '../shared/game-rules.ts';
import { createPracticeRecordings } from '../server/practice-recordings.ts';
import type { ActivityAction,GameKind,LearningActivity } from '../shared/contracts.ts';

const batch=Number(process.env.GAME_BATCH??5),definitions=gameRegistry.filter(g=>g.batch&&g.batch<=batch);
const fixture=(kind:GameKind)=>{const directory=mkdtempSync(join(tmpdir(),'word-extension-'));let store=new Store(directory,()=>new Date('2026-10-17T06:00:00Z'));store.enablePack('starter',true);store.mutate(data=>{data.words=extendedDemo(kind).words;data.settings={...data.settings,spellingEnabled:true,familyGamesEnabled:true,contextGamesEnabled:true,sessionMinutes:30};});return {get store(){return store;},restart(){store.close();store=new Store(directory,()=>new Date('2026-10-17T06:00:00Z'));},close(){store.close();rmSync(directory,{recursive:true,force:true});}};};
const active=(store:Store)=>store.read().sessions.at(-1)!;
function event(store:Store,a:LearningActivity,action:ActivityAction,id?:string) {store.activityEvent({sessionId:active(store).id,activityId:a.id,action,...(id===undefined?{}:{selectedId:id})});assert.doesNotThrow(()=>validateBackup(store.exportBackup()),`${a.kind}/${action}: checkpoint must be restorable`);}
function basic(store:Store,a:LearningActivity){assert.equal(a.kind,'standard');if(a.step!=='learn')store.attempt({sessionId:active(store).id,wordId:a.wordId,skill:a.step==='sound'?'listen':a.step,step:a.step,correct:false,hinted:true,practiceOnly:true,source:'click'});store.updateSession({completedStep:{wordId:a.wordId,step:a.step}});}
function reach(store:Store,kind:GameKind){for(let i=0;i<30&&currentActivity(active(store))?.kind!==kind;i++)basic(store,currentActivity(active(store))!);const a=currentActivity(active(store))!;assert.equal(a.kind,kind);return a;}
function solve(store:Store,a:LearningActivity) {
  const k=a.kind,m=a.material,go=(action:ActivityAction,id?:string)=>event(store,a,action,id);
  if(k==='pantomime'){go('run');go('reveal');go('finish');return;}
  if(k==='clue'||k==='cloze'){go('listen');go('reveal');go('finish');return;}
  if(k==='information'){go('hand-over');go('listen-option',m!.answer[0]);go('pick',m!.answer[0]);go('guess',`${m!.answer[0]}@yes`);go('reveal');go('finish');return;}
  if(k==='intersection'){go('clue');for(const id of m!.tiles.map(t=>t.id).filter(id=>!m!.answer.includes(id)))go('tap',id);go('clue');go('submit');return;}
  go('listen');
  if(['assemble','sort','parts','position','combine','assign'].includes(k)){for(const id of m!.answer){go('pick',id);go('place',m!.placements![id]);}}
  else if(k==='detective'){go('tap',m!.answer[0]);go('tap',m!.placements![m!.answer[0]]);}
  else if(k==='paint'){go('tap',m!.answer[0]);go('place','canvas');}
  else if(k==='quantity'){for(let i=0;i<m!.count!;i++)go('tap',m!.answer[0]);}
  else if(k==='sentence-repair'){go('pick',String(m!.blank));go('tap',m!.answer[0]);}
  else if(k==='letter-gap')go('tap',a.word.term.toLowerCase()[Number(a.spellingBoard![0])]);
  else if(k==='chunks')for(let i=0;i<m!.chunks!.length;i++)go('tap',String(i));
  else if(k==='letter-sort'){const used=new Set<number>();for(const word of a.targets!)for(const c of word.term.toLowerCase()){const index=a.spellingBoard!.findIndex((v,i)=>v===c&&!used.has(i));used.add(index);go('tap',String(index));go('place',word.id);}}
  else if(k==='letter-extra'){const text=a.spellingBoard![0],index=[...text].findIndex((_,i)=>text.slice(0,i)+text.slice(i+1)===a.word.term.toLowerCase());go('tap',String(index));}
  else if(k==='letter-swap'){const wrong=[...a.spellingBoard![0]].flatMap((c,i)=>c===a.word.term.toLowerCase()[i]?[]:[i]);go('tap',String(wrong[0]));go('tap',String(wrong[1]));}
  else if(k==='dictation'||k==='cover-spell'){if(k==='cover-spell')go('conceal');for(const c of a.word.term.toLowerCase())go('letter',c);}
  else if(k==='letter-push'){
    // Move each box through the open right-hand corridor, then fill the target row left to right.
    const positions=a.spellingBoard!.map((_,i)=>18+i),used=new Set<number>();
    for(const [goal,c] of [...a.word.term.toLowerCase()].entries()){
      const box=a.spellingBoard!.findIndex((v,i)=>v===c&&!used.has(i));used.add(box);
      const path=(from:number,to:number)=>{const pending:[[number,number[]]]=[[from,[]]],seen=new Set([from]);while(pending.length){const [at,moves]=pending.shift()!;if(at===to)return moves;for(const next of [at-6,at+6,at%6?at-1:-1,at%6<5?at+1:-1])if(next>=0&&next<36&&!seen.has(next)&&!positions.includes(next)){seen.add(next);pending.push([next,[...moves,next]]);}}throw Error('No box path');};
      go('tap',String(box));for(const cell of path(positions[box],goal)){go('place',String(cell));positions[box]=cell;}
    }
  }
  else if(k==='word-morph'){const source=m!.source!.toLowerCase();for(let i=source.length-1;i>=0;i--){go('tap',String(i));go('letter','delete');}for(const c of a.word.term.toLowerCase()){const text=active(store).activityStates![a.id].gameText??'';go('tap',String(text.length));go('letter',`i:${c}`);}}
  else {for(const id of m!.answer)go('tap',id);if(k==='story'||k==='program')go('run');}
  go('submit');assert.equal(active(store).activityStates![a.id].outcome,'correct');
}

for(const def of definitions)test(`batch ${def.batch}: ${def.title} integrates, checkpoints every action and never grants mastery`,()=>{
  const f=fixture(def.kind);try{const s=f.store.startSession('random',{forcedKind:def.kind,allowedKinds:[def.kind]});assert.equal(s.activities!.length,s.tasks!.flatMap(t=>t.steps).length);const a=reach(f.store,def.kind);assert.throws(()=>f.store.activityEvent({sessionId:s.id,activityId:a.id,action:'next'}),/先完成/);
    const frozen=structuredClone(a);solve(f.store,a);const saved=structuredClone(active(f.store));f.restart();assert.deepEqual(active(f.store).activities,saved.activities);assert.deepEqual(active(f.store).activityStates,saved.activityStates);
    const backup=f.store.exportBackup();f.store.restoreBackup(backup);assert.deepEqual(active(f.store).activities!.find(v=>v.id===a.id),frozen);const count=f.store.read().attempts.length;event(f.store,a,'submit');assert.equal(f.store.read().attempts.length,count);event(f.store,a,'next');event(f.store,a,'next');assert.equal(f.store.read().attempts.length,count);
    while(currentActivity(active(f.store))){const next=currentActivity(active(f.store))!;if(next.kind==='standard')basic(f.store,next);else{solve(f.store,next);event(f.store,next,'next');}}
    f.store.updateSession({complete:true});f.store.updateSession({complete:true});assert.equal(f.store.read().stickers.length,1);assert.ok(f.store.read().attempts.every(v=>v.practiceOnly));assert.equal(f.store.read().progress.length,0);
  }finally{f.close();}
});
test('reviewed material, current versions, contextual and family switches gate each new random template',()=>{
  for(const def of definitions){const f=fixture(def.kind);try{const words=f.store.read().words,options={familyEnabled:true,contextEnabled:true};assert.ok(eligibleGames(def.step,words,options).some(g=>g.kind===def.kind),def.kind);
    if(!automaticSpelling.has(def.kind)){const noMaterial=words.map(w=>({...w,gameMaterials:undefined}));assert.ok(!eligibleGames(def.step,noMaterial,options).some(g=>g.kind===def.kind));const stale=structuredClone(words);stale[0].learningVersion=9;assert.ok(!eligibleGames(def.step,stale,options).some(g=>g.kind===def.kind));}
    if(def.contextOnly)assert.ok(!eligibleGames(def.step,words,{familyEnabled:true}).some(g=>g.kind===def.kind));if(def.familyOnly)assert.ok(!eligibleGames(def.step,words,{contextEnabled:true}).some(g=>g.kind===def.kind));
    const session=f.store.startSession('random',{forcedKind:def.kind,allowedKinds:[def.kind]});assert.ok(new Set(session.activities!.filter(a=>a.kind!=='standard').map(a=>a.kind)).size<=3);
  }finally{f.close();}}
});
test('new recordings use the same private WAV persistence without grades, reveal-first uploads remain follow practice',()=>{
  for(const kind of ['pantomime','clue','cloze','information'] as GameKind[]){if(!definitions.some(d=>d.kind===kind))continue;const f=fixture(kind);try{f.store.startSession('random',{forcedKind:kind,allowedKinds:[kind]});const a=reach(f.store,kind);if(kind==='pantomime')event(f.store,a,'run');else if(kind==='information')event(f.store,a,'hand-over');else event(f.store,a,'listen');
    const audio=Buffer.alloc(32044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);for(let i=0;i<16000;i++)audio.writeInt16LE(Math.round(5000*Math.sin(2*Math.PI*440*i/16000)),44+i*2);
    const recorder=createPracticeRecordings(f.store),target={sessionId:active(f.store).id,activityId:a.id},before=f.store.read().attempts.length;
    const rows=recorder.upload(target,crypto.randomUUID(),audio);assert.equal(rows[0].mode,'recall');assert.equal(rows[0].word.id,a.wordId);assert.equal(f.store.read().attempts.length,before);event(f.store,a,'reveal');assert.equal(recorder.upload(target,crypto.randomUUID(),audio).at(-1)!.mode,'follow');assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}}
});
