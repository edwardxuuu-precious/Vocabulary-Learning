import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store,validateBackup } from '../server/store.ts';
import { newWordFlowCoverage } from '../shared/new-word-flow.ts';
import { arrangeMemoryLoop, validMemoryLoopPolicy } from '../shared/learning-policy.ts';
import { pairedGame } from '../shared/game-boards.ts';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'new-word-flow-'));let store=new Store(dir,()=>new Date('2026-10-25T02:00:00Z'));
  store.mutate(data=>{data.packs=[{id:'family',title:'隔离词书',enabled:true,createdAt:'2026-10-01T00:00:00Z'}];data.words.forEach(word=>word.packId='family');data.settings.sessionMinutes=30;});
  return {get store(){return store;},restart(){store.close();store=new Store(dir,()=>new Date('2026-10-25T02:00:00Z'));},close(){store.close();rmSync(dir,{recursive:true,force:true});}};}
test('L03: new-word lessons keep every target for 1/2/3/5/10 words and genuine intervening tasks for an odd tail',()=>{
  const f=fixture();try{for(const size of [1,2,3,5,10]){
    const ids=f.store.read().words.slice(0,size).map(word=>word.id),session=f.store.startSession('random',{}, {entry:'learn',mode:'relearn',wordIds:ids,strategy:'memory-loop'});
    assert.equal(session.learningPolicy?.teachingSequence,'meaning-recall-v1');assert.ok(validMemoryLoopPolicy(session));
    const before=structuredClone(session),coverage=newWordFlowCoverage(session);assert.equal(coverage.length,size);
    assert.ok(coverage.every(row=>row.ordered&&row.hasIntroduction&&row.hasUnderstanding&&row.hiddenRecall&&row.allGoalsPreserved));
    assert.equal(session.activities!.length,session.tasks!.reduce((sum,task)=>sum+task.steps.length,0));
    assert.ok(session.activities!.every(activity=>ids.includes(activity.wordId)));
    if(size===1)assert.equal(coverage[0].interveningTasks,0,'single-word scope never invents interleaving');
    if(size===3||size===5){assert.ok(coverage.at(-1)!.interveningTasks>=2,'the odd tail recalls after existing other-word goals');
      const tail=ids.at(-1)!,from=session.activities!.findIndex(row=>row.wordId===tail&&row.step==='recognize'),to=session.activities!.findIndex(row=>row.wordId===tail&&row.step==='recall');
      assert.ok(session.activities!.slice(from+1,to).every(row=>!row.choices.some(word=>word.id===tail)&&row.cueWord?.id!==tail&&!row.material?.wordIds.includes(tail)));
    }
    for(const activity of session.activities!.filter(activity=>pairedGame(activity.kind)&&activity.groupId)){
      const indices=session.activities!.flatMap((row,index)=>row.groupId===activity.groupId?[index]:[]);assert.equal(indices[1],indices[0]+1);
    }
    assert.deepEqual(session,before,'coverage is read-only');assert.ok(validateBackup(f.store.exportBackup()));
  }}finally{f.close();}
});
test('L03: an already-started old sequence stays frozen; new sequence survives retry, restart and backup',()=>{
  const f=fixture();try{
    const old=f.store.startSession(false,{}, {strategy:'memory-loop'});assert.equal(old.learningPolicy?.teachingSequence,undefined);
    const modern=f.store.startSession('random',{}, {entry:'learn',strategy:'memory-loop'});assert.equal(modern.learningPolicy?.teachingSequence,'meaning-recall-v1');
    assert.deepEqual(arrangeMemoryLoop(old.tasks!,old.activities!).map(row=>row.id),old.activities!.map(row=>row.id));
    f.restart();assert.equal(f.store.startSession(false,{}, {entry:'learn'}).id,modern.id);assert.deepEqual(f.store.read().sessions.find(row=>row.id===old.id)!.activities,old.activities);
    const backup=f.store.exportBackup();f.store.restoreBackup(backup);assert.deepEqual(f.store.read().sessions.find(row=>row.id===modern.id)!.learningPolicy,modern.learningPolicy);
    assert.deepEqual(f.store.read().sessions.find(row=>row.id===modern.id)!.activities,modern.activities);
    const bad=structuredClone(backup);(bad.data.sessions.find(row=>row.id===modern.id)!.learningPolicy as any).teachingSequence='invented';assert.throws(()=>validateBackup(bad));
  }finally{f.close();}
});
