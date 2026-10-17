import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import { createPracticeRecordings } from '../server/practice-recordings.ts';
import { createApp } from '../server/index.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { oralActivity } from '../shared/oral-practice.ts';
import type { LearningActivity } from '../shared/contracts.ts';

function wav(seed=1,silent=false){const n=8000,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(silent?0:Math.round(Math.sin(i*(.08+seed*.01))*5000),44+i*2);return b;}
function prepare(store:Store,kind:LearningActivity['kind']='portal'){store.enablePack('starter',true);store.startSession('random',kind==='standard'?{allowedKinds:[]}:{forcedKind:kind,allowedKinds:[kind]});for(let i=0;i<30;i++){const s=store.read().sessions.at(-1)!,a=currentActivity(s)!;if(a.kind===kind&&oralActivity(a)){if(kind==='missing')store.activityEvent({sessionId:s.id,activityId:a.id,action:'conceal'});return {sessionId:s.id,activityId:a.id};}if(a.kind!=='standard'){if(a.kind==='associate'&&a.step==='sound'){store.activityEvent({sessionId:s.id,activityId:a.id,action:'pick',selectedId:a.choices.find(w=>w.id!==a.wordId)!.id});store.activityEvent({sessionId:s.id,activityId:a.id,action:'compose'});store.activityEvent({sessionId:s.id,activityId:a.id,action:'finish'});}else store.activityEvent({sessionId:s.id,activityId:a.id,action:'skip'});store.activityEvent({sessionId:s.id,activityId:a.id,action:'next'});continue;}if(a.step!=='learn')store.attempt({sessionId:s.id,wordId:a.wordId,step:a.step,skill:a.step==='sound'?'listen':a.step,correct:false,hinted:true,practiceOnly:true,source:'click'});store.updateSession({completedStep:{wordId:a.wordId,step:a.step}});}throw Error('fixture');}
function fixture(){const dir=mkdtempSync(join(tmpdir(),'word-oral-'));let store=new Store(dir),manager=createPracticeRecordings(store);const target=prepare(store);return{dir,target,get store(){return store;},get manager(){return manager;},restart(){store.close();store=new Store(dir);manager=createPracticeRecordings(store);},close(){store.close();rmSync(dir,{recursive:true,force:true});}};}

test('speech prompts cover games and ordinary/assessment practice without requiring drawing or gestures to speak',()=>{
  for(const [kind,step] of [['portal','recall'],['missing','recall'],['associate','recall'],['think-choice','sound'],['standard','recall'],['standard','practice-zh-en'],['standard','practice-read']])assert.ok(oralActivity({kind,step} as LearningActivity));
  for(const [kind,step] of [['mimic','recall'],['quiz','recall'],['draw','listen'],['associate','sound'],['standard','listen'],['standard','practice-look']])assert.equal(oralActivity({kind,step} as LearningActivity),false);
});
test('saving three distinct takes persists across restart and retries once; never writes scores or completes a step',()=>{
  const f=fixture();try{const before=f.store.read(),ids=Array.from({length:3},()=>randomUUID());for(let i=0;i<3;i++){const rows=f.manager.upload(f.target,ids[i],wav(i));assert.equal(rows.length,i+1);assert.equal(rows.at(-1)!.round,i+1);assert.equal(rows.at(-1)!.mode,'recall');assert.equal(f.manager.upload(f.target,ids[i],wav(i)).length,i+1);}
    const after=f.store.read();for(const key of ['attempts','progress','sessions','charges'] as const)assert.deepEqual(after[key],before[key]);assert.throws(()=>f.manager.upload(f.target,randomUUID(),wav(4)),/三遍/);assert.throws(()=>f.manager.upload(f.target,ids[0],wav(6)),/已使用/);
    f.restart();assert.equal(f.manager.list(f.target).length,3);assert.deepEqual(f.manager.audio(ids[0],f.target),wav(0));
  }finally{f.close();}
});
test('reveal changes the saved provenance; stale targets, silent audio and traversal never become saved records',()=>{
  const f=fixture();try{assert.throws(()=>f.manager.upload({...f.target,activityId:'other'},randomUUID(),wav()),/变化/);assert.throws(()=>f.manager.upload(f.target,'../escape',wav()),/编号/);assert.throws(()=>f.manager.upload(f.target,randomUUID(),wav(1,true)),/没有听到/);assert.equal(f.manager.list(f.target).length,0);
    f.store.activityEvent({...f.target,action:'reveal'});const rows=f.manager.upload(f.target,randomUUID(),wav());assert.equal(rows[0].mode,'follow');f.store.activityEvent({...f.target,action:'skip'});f.store.activityEvent({...f.target,action:'next'});assert.throws(()=>f.manager.list(f.target),/变化/);assert.equal(f.manager.list().length,1);
  }finally{f.close();}
});
test('raw audio stays out of backup; metadata validates, restores missing, and tampered files cannot replay',()=>{
  const f=fixture();try{const id=randomUUID();f.manager.upload(f.target,id,wav());const backup=f.store.exportBackup();assert.equal(backup.files.some(file=>file.path.includes('practice-recordings')),false);assert.equal(validateBackup(backup).data.practiceRecordings?.length,1);
    const bad=structuredClone(backup);bad.data.practiceRecordings![0].sessionId='other';assert.throws(()=>validateBackup(bad),/录音记录/);const extra=structuredClone(backup);(extra.data.practiceRecordings![0] as any).raw='secret';assert.equal((validateBackup(extra).data.practiceRecordings![0] as any).raw,undefined);
    const file=join(f.dir,'practice-recordings',id+'.wav');writeFileSync(file,wav(9));assert.throws(()=>f.manager.audio(id),/已变化/);f.store.restoreBackup(backup);assert.equal(f.manager.list()[0].status,'missing');assert.throws(()=>f.manager.audio(id),/不可用/);const legacy=structuredClone(backup);delete legacy.data.practiceRecordings;f.store.restoreBackup(legacy);assert.equal(f.manager.list().length,0);
  }finally{f.close();}
});
test('HTTP child recording/replay is confined to current activity; history requires a parent grant and public media cannot expose audio',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'word-oral-api-'));const app=createApp({dataDir:dir,chatEnabled:false,integrations:{probeIntegrations:async()=>({speech:{configured:false,available:false,status:'test',detail:'test'},codex:{configured:false,available:false,status:'test',detail:'test'}})}});
  try{const target=prepare(app.store);await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`,query=new URLSearchParams(target).toString(),id=randomUUID();
    const upload=(extra={})=>fetch(`${base}/api/practice-recordings?${query}&takeId=${id}`,{method:'POST',headers:{'Content-Type':'audio/wav',...extra},body:wav()});assert.equal((await upload({Origin:'https://other.example'})).status,403);assert.equal((await upload()).status,200);assert.equal((await upload()).status,200);
    assert.equal((await fetch(base+'/api/practice-recordings')).status,403);const response=await fetch(`${base}/api/practice-recordings/${id}/audio?${query}`);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav());assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await fetch(base+`/media/practice-recordings/${id}.wav`)).status,404);
    const unlocked=await(await fetch(base+'/api/parent-gate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'284619'})})).json();const headers={Authorization:`Bearer ${unlocked.assessmentGrant.token}`};assert.equal((await(await fetch(base+'/api/practice-recordings',{headers})).json()).length,1);
    app.store.activityEvent({...target,action:'skip'});app.store.activityEvent({...target,action:'next'});assert.equal((await fetch(`${base}/api/practice-recordings/${id}/audio?${query}`)).status,409);assert.equal((await fetch(`${base}/api/practice-recordings/${id}/audio`,{headers})).status,200);
    assert.equal(app.store.read().charges.length,0);assert.equal(readFileSync(join(dir,'practice-recordings',id+'.wav')).length,wav().length);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('all speaking game families and ordinary follow-along accept a persistent take with correct snapshot and mode',()=>{
 for(const kind of ['portal','missing','think-choice','associate','standard'] as const){const dir=mkdtempSync(join(tmpdir(),'word-oral-kinds-')),store=new Store(dir);try{const target=prepare(store,kind),manager=createPracticeRecordings(store),row=manager.upload(target,randomUUID(),wav())[0];assert.equal(row.kind,kind);assert.equal(row.mode,kind==='standard'?'follow':'recall');assert.equal(row.word.id,currentActivity(store.read().sessions.at(-1)!)!.wordId);assert.equal(validateBackup(store.exportBackup()).data.practiceRecordings!.length,1);}finally{store.close();rmSync(dir,{recursive:true,force:true});}}
});
