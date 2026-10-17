import { currentActivity } from '../shared/game-plan.ts';
import { finishGoalFixture } from './helpers/goal-steps.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import { dailyLearningPlan, learningDay, wordLearningOverview } from '../shared/learning.ts';
import { saveChallengeResponse, submitChallenge } from '../server/challenge-state.ts';
import { learningEncounters } from '../shared/learning-history.ts';
import { assessmentCurrent, recommendedAssessmentItems } from '../shared/assessment.ts';
import type { IntegrationStatus, LearningSession, LearningStartRequest } from '../shared/contracts.ts';

const disabled = {configured:false, available:false, status:'offline_test', detail:'测试替身，不调用云服务'};
const status: IntegrationStatus = {speech:disabled, codex:disabled};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'word-hub-')); let time = new Date('2026-10-17T02:00:00Z');
  let store = new Store(dir, () => time);
  store.mutate(data => {
    data.packs = [{id:'a', title:'第一批', enabled:true, createdAt:'2026-10-15T00:00:00Z'}, {id:'b', title:'第二批', enabled:true, createdAt:'2026-10-16T00:00:00Z'}];
    data.words.forEach((word, index) => { word.packId = index < 6 ? 'a' : 'b'; });
  });
  return {get store() {return store;}, at: (iso:string) => {time = new Date(iso);}, now: () => time,
    restart() {store.close(); store = new Store(dir, () => time);},
    close() {store.close(); assert.ok(dir.startsWith(join(tmpdir(),'word-hub-'))); rmSync(dir,{recursive:true,force:true});}};
}
function start(store: Store, request: LearningStartRequest = {}) {return store.startSession(false, {}, request);}
function finish(store: Store, session: LearningSession) {
  for (const task of session.tasks!) for (const step of task.steps) {
    const saved = store.read().sessions.find(row => row.id === session.id)!;
    if (saved.completedSteps?.[task.wordId]?.includes(step)) continue;
    if(step==='recognize'||step==='read'){finishGoalFixture(store,saved,currentActivity(saved)!);continue;}
    if (step !== 'learn') store.attempt({sessionId: session.id, wordId:task.wordId, step, skill:step === 'sound' ? 'listen' : step, correct:true, hinted:false, practiceOnly:step === 'recall', source:'click'});
    store.updateSession({sessionId:session.id, completedStep:{wordId:task.wordId, step}});
  }
  store.updateSession({sessionId:session.id, complete:true});
}

test('completed rounds no longer occupy activeSession; repeated recommended play is supplemental and cannot change review dates', () => {
  const f=fixture(); try {
    const first=start(f.store, {requestId:'request-first'}); finish(f.store,first);
    const before=f.store.read().progress, state=f.store.state(status);
    assert.equal(state.activeSession,null); assert.equal(state.lastCompletedSession!.id,first.id);
    const again=start(f.store,{requestId:'request-second'});
    assert.notEqual(again.id,first.id); assert.equal(again.practiceOnly,true); assert.ok(again.tasks!.every(task=>!task.steps.includes('learn')));
    assert.equal(start(f.store,{requestId:'request-second'}).id,again.id);
    finish(f.store,again); assert.deepEqual(f.store.read().progress,before);
    assert.ok(f.store.read().attempts.filter(row=>row.sessionId===again.id).every(row=>row.practiceOnly));
    assert.equal(f.store.read().stickers.length,2);
    assert.equal(start(f.store,{requestId:'request-first'}).id,first.id); assert.equal(f.store.read().sessions.length,2);
  }finally{f.close();}
});

test('switching selected rounds preserves checkpoints; explicit session completion and restart restore the selected identity', () => {
  const f=fixture(); try {
    const original=start(f.store), id=original.wordIds[0];
    f.store.updateSession({sessionId:original.id,completedStep:{wordId:id,step:'learn'}});
    const custom=start(f.store,{mode:'practice',wordIds:['starter-moon']});
    assert.equal(custom.tasks![0].steps[0],'learn','an unseen word cannot skip its introduction');
    assert.equal(f.store.state(status).resumableSessions!.length,2);
    assert.throws(()=>f.store.updateSession({completedStep:{wordId:id,step:'learn'}}),/明确指定/);
    finish(f.store,custom); assert.equal(f.store.state(status).activeSession,null);
    assert.equal(f.store.state(status).lastCompletedSession!.id,custom.id);
    start(f.store,{mode:'resume',sessionId:original.id});f.restart();
    assert.equal(f.store.state(status).activeSession!.id,original.id);
    assert.deepEqual(f.store.state(status).activeSession!.completedSteps![id],['learn']);
    finish(f.store,original);
    assert.equal(f.store.state(status).lastCompletedSession!.id,original.id,'completion order, not creation order, selects the result');
    f.store.updateSession({sessionId:custom.id,complete:true});
    assert.equal(f.store.state(status).lastCompletedSession!.id,original.id,'retrying an old completion cannot replace the result');
    assert.throws(()=>start(f.store,{mode:'resume',sessionId:original.id}),/已结束/);
  }finally{f.close();}
});

test('daily new-word allowance counts current-version exposure plus unfinished reservations; manual new words may exceed it', () => {
  const f=fixture(); try {
    const first=start(f.store); assert.equal(first.wordIds.length,3);
    assert.equal(dailyLearningPlan(f.store.read(),f.now()).remainingNew,0);
    const extra=start(f.store,{mode:'practice',wordIds:['starter-moon']});finish(f.store,extra);
    assert.equal(dailyLearningPlan(f.store.read(),f.now()).remainingNew,0);
    start(f.store,{mode:'resume',sessionId:first.id});finish(f.store,first);
    assert.equal(dailyLearningPlan(f.store.read(),f.now()).usedNewToday,4);
    assert.equal(dailyLearningPlan(f.store.state(status),f.now()).remainingNew,0,'browser and server use the same history');
    f.at('2026-10-17T16:00:01Z');
    const tomorrow=dailyLearningPlan(f.store.read(),f.now());assert.equal(learningDay(f.now()),'2026-10-18');assert.equal(tomorrow.remainingNew,3);
    assert.ok(tomorrow.fresh.every(word=>word.packId==='a'),'new words finish the earlier batch before starting the next');
  }finally{f.close();}
});

test('relearn includes the full introduction; practice skips known introductions and neither path modifies existing schedules', () => {
  const f=fixture(); try {
    const first=start(f.store);finish(f.store,first);const id=first.wordIds[0], before=f.store.read().progress;
    const relearn=start(f.store,{mode:'relearn',wordIds:[id],requestId:'request-relearn'});
    assert.deepEqual(relearn.tasks![0].steps,['learn','recognize','listen','sound','read','recall']);finish(f.store,relearn);
    const practice=start(f.store,{mode:'practice',wordIds:[id]});assert.deepEqual(practice.tasks![0].steps,['recognize','listen','sound','read','recall']);finish(f.store,practice);
    assert.deepEqual(f.store.read().progress,before);
    const exposure=learningEncounters(f.store.read()).find(row=>row.wordId===id)!;assert.equal(exposure.introducedAt,first.startedAt);
    f.store.updateWord(id,{meaning:'改变后的词义'},()=>true);
    assert.ok(!learningEncounters(f.store.read()).some(row=>row.wordId===id));
  }finally{f.close();}
});

test('selection validation never truncates requests and rejects unavailable words, duplicate ids, excessive budgets and conflicting retry ids', () => {
  const f=fixture(); try {
    f.store.updateSettings({sessionMinutes:3});
    assert.throws(()=>start(f.store,{mode:'relearn',wordIds:['starter-apple','starter-banana']}),/超过本轮/);
    assert.equal(f.store.read().sessions.length,0);
    assert.throws(()=>start(f.store,{mode:'practice',wordIds:['starter-apple','starter-apple']}),/1–5/);
    f.store.enablePack('b',false);assert.throws(()=>start(f.store,{mode:'practice',wordIds:['starter-moon']}),/准备好/);
    start(f.store,{mode:'relearn',wordIds:['starter-apple'],requestId:'request-conflict'});
    assert.throws(()=>start(f.store,{mode:'practice',wordIds:['starter-apple'],requestId:'request-conflict'}),/另一轮/);
    f.store.enablePack('a',false);assert.throws(()=>start(f.store,{mode:'relearn',wordIds:['starter-apple'],requestId:'request-conflict'}),/素材已变化/);
  }finally{f.close();}
});

test('repeating a practice-only word cannot postpone its first derived listening review', () => {
  const f=fixture();try{
    finish(f.store,start(f.store,{mode:'practice',wordIds:['starter-apple']}));
    const original=wordLearningOverview(f.store.state(status),f.now()).find(row=>row.word.id==='starter-apple')!.nextDue;
    f.at('2026-10-17T08:00:00Z');finish(f.store,start(f.store,{mode:'relearn',wordIds:['starter-apple']}));
    assert.equal(wordLearningOverview(f.store.state(status),f.now()).find(row=>row.word.id==='starter-apple')!.nextDue,original);
    assert.deepEqual(f.store.read().progress,[]);
  }finally{f.close();}
});

test('legacy word completion across midnight stays learned and consumes the completion day allowance without inventing a score', () => {
  const f=fixture();try{
    f.at('2026-10-17T15:59:00Z');f.store.updateSettings({dailyNewWords:1});const legacy=start(f.store);
    f.store.mutate(data=>{const row=data.sessions[0];delete row.goalVersion;delete row.activities;delete row.activityStates;delete row.gameSeed;delete row.tasks;delete row.completedSteps;delete row.taskLimit;delete row.estimatedMinutes;});
    f.at('2026-10-17T16:01:00Z');f.store.updateSession({sessionId:legacy.id,completedWordId:legacy.wordIds[0]});f.store.updateSession({sessionId:legacy.id,complete:true});
    const plan=dailyLearningPlan(f.store.read(),f.now());assert.equal(plan.remainingNew,0);assert.equal(plan.usedNewToday,1);
    assert.ok(!plan.fresh.some(word=>word.id===legacy.wordIds[0]));assert.equal(f.store.read().attempts.length,0);assert.equal(f.store.read().progress.length,0);
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('equal-due reviews interleave batches without inserting future reviews; supplemental play avoids the last set when possible', () => {
  const f=fixture(); try {
    f.store.mutate(data=>{for(const word of data.words)data.progress.push({wordId:word.id,skill:'listen',stage:1,dueAt:word.id==='starter-run'?'2026-11-01T00:00:00Z':'2026-10-16T00:00:00Z',successes:1,attempts:2});});
    const plan=dailyLearningPlan(f.store.read(),f.now());assert.equal(plan.review.length,6);
    assert.equal(new Set(plan.review.slice(0,2).map(word=>word.packId)).size,2);assert.ok(!plan.review.some(word=>word.id==='starter-run'));
    const first=start(f.store);finish(f.store,first);
    f.store.mutate(data=>{for(const row of data.progress)row.dueAt='2026-11-01T00:00:00Z';});
    const next=start(f.store);assert.equal(next.practiceOnly,true);assert.ok(next.wordIds.every(id=>!first.wordIds.includes(id)));
  }finally{f.close();}
});

test('first testing starts the next Shanghai day, covers both batches, freezes its plan, and pending review is not recommended again', () => {
  const f=fixture();try{
    for(const id of ['starter-apple','starter-moon'])finish(f.store,start(f.store,{mode:'practice',wordIds:[id]}));
    assert.equal(recommendedAssessmentItems(f.store.read(),f.now()).length,0);
    f.at('2026-10-17T16:00:01Z');
    const items=recommendedAssessmentItems(f.store.read(),f.now());assert.equal(items.length,8);assert.equal(new Set(items.map(row=>f.store.read().words.find(word=>word.id===row.wordId)!.packId)).size,2);
    const challenge=f.store.createAssessment({mode:'recommended',workflow:'recorded'});assert.equal(challenge.items.length,8);assert.equal(challenge.mode,'recommended');
    assert.equal(recommendedAssessmentItems(f.store.read(),f.now()).length,0);
    f.store.mutate(data=>{
      for(const item of challenge.items)saveChallengeResponse(data,challenge.id,{itemId:item.id,expectedVersion:0,action:'skip'},f.now(),()=>true);
      submitChallenge(data,challenge.id,f.now(),()=>true);
    });
    f.at('2026-10-19T02:00:00Z');const pending=recommendedAssessmentItems(f.store.read(),f.now());assert.equal(pending.length,2);assert.ok(pending.every(item=>item.dimension==='look'),'unreviewed oral items stay pending while server-confirmed skipped picture items can become due');
    assert.deepEqual(f.store.read().assessments![0].items.map(item=>[item.id,item.word]),challenge.items.map(item=>[item.id,item.word]));
    assert.doesNotThrow(()=>validateBackup(f.store.exportBackup()));
  }finally{f.close();}
});

test('recommended retests contain only due dimensions, first tests wait behind overdue ones, and backup retains modes and active pointers', () => {
  const f=fixture();try{
    finish(f.store,start(f.store,{mode:'practice',wordIds:['starter-apple','starter-moon']}));
    let test=f.store.createAssessment({wordIds:['starter-apple']});
    while(!test.completedAt){const item=assessmentCurrent(test)!;test=f.store.assessmentAction(test.id,item.dimension==='look'?{itemId:item.id,action:item.choices.length?'choose':'unavailable',selectedId:item.word.id}:{itemId:item.id,action:'judge',judgement:'correct'});}
    const originalProgress=f.store.read().assessmentProgress!;
    f.store.mutate(data=>{for(const row of data.assessmentProgress!)row.dueAt=row.dimension==='read'?'2026-10-18T00:00:00Z':'2026-11-01T00:00:00Z';});
    f.at('2026-10-18T02:00:00Z');
    assert.deepEqual(recommendedAssessmentItems(f.store.read(),f.now()),[{wordId:'starter-apple',dimension:'read'}]);
    f.store.mutate(data=>{data.assessmentProgress=originalProgress;});
    const saved=start(f.store,{mode:'relearn',wordIds:['starter-moon'],requestId:'request-backup'});
    const backup=validateBackup(f.store.exportBackup());assert.equal(backup.data.activeLearningSessionId,saved.id);assert.equal(backup.data.sessions.at(-1)!.mode,'relearn');
    f.store.restoreBackup(f.store.exportBackup());f.restart();assert.equal(f.store.state(status).activeSession!.id,saved.id);
    const forged=f.store.exportBackup();forged.data.sessions.at(-1)!.exposures=[{wordId:'starter-moon',learningVersion:-1,introducedAt:f.now().toISOString()}];assert.throws(()=>validateBackup(forged),/接触记录/);
  }finally{f.close();}
});
