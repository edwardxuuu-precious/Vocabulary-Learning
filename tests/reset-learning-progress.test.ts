import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.ts';
import { learningEncounters } from '../shared/learning-history.ts';
import { dailyLearningPlan } from '../shared/learning.ts';
import { resetLearningProgress, withoutLearningProgress } from '../scripts/reset-learning-progress.ts';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'word-reset-'));
  const store=new Store(dir);store.enablePack('starter',true);
  const session=store.startSession(false),wordId=session.wordIds[0];
  store.updateSession({sessionId:session.id,completedStep:{wordId,step:'learn'}});
  store.attempt({sessionId:session.id,wordId,step:'listen',skill:'listen',correct:true,hinted:false,source:'click'});
  store.close();
  mkdirSync(join(dir,'practice-recordings'));writeFileSync(join(dir,'practice-recordings','keep.wav'),'private test original');
  writeFileSync(join(dir,'parent-pin.json'),'test-only pin placeholder');
  const read=()=>{const db=new DatabaseSync(join(dir,'playroom.sqlite'),{readOnly:true});try{return JSON.parse(db.prepare('SELECT body FROM documents WHERE id=1').get()!.body as string);}finally{db.close();}};
  return {dir,read,close:()=>{assert.ok(dir.startsWith(join(tmpdir(),'word-reset-')));rmSync(dir,{recursive:true,force:true});}};
}

test('reset preview never writes the database or creates a snapshot',async()=>{
  const f=fixture();try{
    const before=readFileSync(join(f.dir,'playroom.sqlite'));
    const result=await resetLearningProgress(f.dir);
    assert.equal(result.applied,false);assert.equal(result.before.sessions,1);
    assert.deepEqual(readFileSync(join(f.dir,'playroom.sqlite')),before);
    assert.equal(existsSync(join(f.dir,'maintenance')),false);
  }finally{f.close();}
});

test('apply keeps a verified recoverable snapshot and preserves preparation, PIN, originals and usage',async()=>{
  const f=fixture();try{
    const before=f.read(),result=await resetLearningProgress(f.dir,true);
    assert.equal(result.applied,true);assert.ok('snapshot' in result);
    const saved=new DatabaseSync(result.snapshot as string,{readOnly:true});
    try{assert.deepEqual(JSON.parse(saved.prepare('SELECT body FROM documents WHERE id=1').get()!.body as string),before);}finally{saved.close();}
    const after=f.read();
    for(const key of ['packs','words','profile','settings','jobs','charges'])assert.deepEqual(after[key],before[key]);
    assert.equal(readFileSync(join(f.dir,'practice-recordings','keep.wav'),'utf8'),'private test original');
    assert.equal(readFileSync(join(f.dir,'parent-pin.json'),'utf8'),'test-only pin placeholder');
    const store=new Store(f.dir);
    try{
      const data=store.read();assert.equal(learningEncounters(data).length,0);
      assert.equal(data.activeLearningSessionId,null);assert.equal(data.lastCompletedLearningSessionId,undefined);
      assert.ok(Object.values(result.after).every(count=>count===0));
      const next=dailyLearningPlan(data);assert.equal(next.usedNewToday,0);assert.equal(next.fresh.length,3);
      assert.ok(next.tasks.every(task=>task.steps.includes('learn')));
      const state=store.state({speech:{configured:false,available:false,status:'test',detail:'offline'},codex:{configured:false,available:false,status:'test',detail:'offline'}});
      assert.equal(state.resumableSessions!.length,0);assert.equal(state.growth!.practicedWords,0);assert.equal(state.growth!.totalDays,0);assert.ok(state.growth!.badges.every(b=>!b.unlocked));
    }finally{store.close();}
  }finally{f.close();}
});

test('reset clears classroom completion while preserving its scope, sequence and settings',()=>{
  const f=fixture();try{
    const before=f.read();before.lessonPlan={id:'lesson-test',title:'保留课堂',revision:2,wordIds:['starter-apple'],focusWordIds:['starter-apple'],wordVersions:{'starter-apple':0},completedWordIds:['starter-apple'],segmentMinutes:5,createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T00:00:00Z'};
    const after=withoutLearningProgress(before);
    assert.deepEqual(after.lessonPlan,{...before.lessonPlan,completedWordIds:[]});assert.deepEqual(before.lessonPlan.completedWordIds,['starter-apple']);
  }finally{f.close();}
});

test('active material preparation blocks a reset without modifying the database',async()=>{
  const f=fixture();try{
    const db=new DatabaseSync(join(f.dir,'playroom.sqlite')),data=f.read();data.jobs=[{id:'test-job',wordId:'starter-apple',status:'running'}];
    db.prepare('UPDATE documents SET body=? WHERE id=1').run(JSON.stringify(data));db.close();
    await assert.rejects(resetLearningProgress(f.dir,true),/结束素材准备/);assert.deepEqual(f.read(),data);assert.equal(existsSync(join(f.dir,'maintenance')),false);
  }finally{f.close();}
});
