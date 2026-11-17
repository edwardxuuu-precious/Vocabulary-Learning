import test from 'node:test';
import assert from 'node:assert/strict';
import {studyContinuity,validateStudyContinuation,type StudyContinuationRequest} from '../shared/study-continuity.ts';
import {studyReadModel} from '../server/study-read-model.ts';
import {now,before,later,word,snapshot,fixture,encountered,formal,passed,attempt,saved} from './helpers/word-learning.ts';

function request(plan:ReturnType<typeof studyReadModel>):StudyContinuationRequest{return {planId:plan.planId,mode:plan.mode,requestId:'resume-request-001',sessionId:'learning',activityId:'w:read'};}
test('the new continuation contract resumes the saved scene without rewriting its legacy cursor',()=>{
  const d=fixture();encountered(d);const session=saved(d);session.pauseState={version:1,at:later,reason:'leave',activityId:'w:read'};
  const copy=structuredClone(d),model=studyReadModel(d,{now,mode:'child'}),decision=validateStudyContinuation(model,request(model));
  assert.equal(model.readOnly,true);assert.equal(decision.ok,true);assert.equal(model.continuity[0].action,'resume-legacy');assert.equal(model.continuity[0].current,true);assert.deepEqual(d,copy);
});
test('new evidence covers future work as a proposal, without inventing stored completion',()=>{
  const d=fixture();encountered(d);const session=saved(d);passed(d,later);const map=studyContinuity(d,now)[0];
  assert.equal(map.action,'reconcile-at-boundary');assert.equal(map.coveredCount,1);assert.equal(map.targets[0].state,'covered');assert.deepEqual(session.completedSteps!.w,['learn']);assert.equal(session.completedAt,undefined);
});
test('a saved recording and letter draft remain current even after a newer formal pass',()=>{
  const d=fixture();encountered(d);const session=saved(d,'spell');session.pauseState={version:1,at:later,reason:'leave',activityId:'w:spell',draft:{spelling:[0]}};passed(d,later);
  assert.equal(studyContinuity(d,now)[0].targets[0].state,'preserve-current');
  session.pauseState=undefined;session.activities![0]={id:'w:read',wordId:'w',word:snapshot(word),step:'read',kind:'standard',choices:[]};
  d.practiceRecordings.push({id:'private-take',sessionId:'learning',activityId:'w:read',word:snapshot(word),kind:'standard',step:'read',mode:'read',round:1,createdAt:later,seconds:1,bytes:32044,sha256:'a'.repeat(64),status:'ready'});
  const map=studyContinuity(d,now)[0];assert.equal(map.hasReadyRecording,true);assert.equal(map.targets[0].state,'preserve-current');assert.ok(!JSON.stringify(map).includes('private-take'));
});
test('partial coverage cannot split a shared repair board and lose its other word',()=>{
  const other={...word,id:'other',term:'blue',meaning:'蓝色的'},d=fixture([word,other]);encountered(d);encountered(d,other);const s=saved(d);
  s.wordIds.push('other');s.activities=[{id:'w:sound',wordId:'w',word:snapshot(word),step:'sound',kind:'repair',choices:[snapshot(word),snapshot(other)],groupId:'repair-1'},{id:'other:sound',wordId:'other',word:snapshot(other),step:'sound',kind:'repair',choices:[snapshot(word),snapshot(other)],groupId:'repair-1'}];
  attempt(d,{skill:'listen',step:'sound',correct:true});const map=studyContinuity(d,now)[0];
  assert.equal(map.coveredCount,0);assert.equal(map.neededCount,2);assert.equal(map.targets[0].reason,'group-needed');assert.equal(map.action,'resume-legacy');
});
test('explicit relearning and games remain available after the word has passed',()=>{
  for(const mode of ['relearn','practice'] as const){const d=fixture();encountered(d);const s=saved(d);s.mode=mode;passed(d,later);const map=studyContinuity(d,now)[0];assert.equal(map.targets[0].state,'needed');assert.equal(map.targets[0].reason,'explicit-practice');}
});
test('unknown or merely recorded answers do not cover an independent oral target',()=>{
  const d=fixture();encountered(d);saved(d);attempt(d,{skill:'read',step:'read',practiceOnly:true,oralStatus:'recorded'});formal(d,'read','unconfirmed',later);
  assert.equal(studyContinuity(d,now)[0].targets[0].state,'needed');
});
test('changed original content blocks resume and preserves the old snapshot',()=>{
  const d=fixture();const s=saved(d);d.words[0]={...word,learningVersion:1,meaning:'新版义项'};const model=studyReadModel(d,{now,mode:'child'});
  assert.equal(model.continuity[0].action,'prepare-content');assert.deepEqual(validateStudyContinuation(model,request(model)),{ok:false,code:'CONTENT_BLOCKED'});assert.equal(s.activities![0].word.meaning,word.meaning);
});
test('completed and suspended sessions remain immutable history and cannot silently reopen',()=>{
  for(const state of ['completedAt','suspendedAt'] as const){const d=fixture();saved(d)[state]=later;const model=studyReadModel(d,{now,mode:'child'});assert.deepEqual(validateStudyContinuation(model,request(model)),{ok:false,code:'SESSION_CHANGED'});assert.ok(model.continuity[0].action.startsWith('keep-'));}
});
test('a changed source, mode, date or cursor invalidates a stale continuation',()=>{
  const d=fixture();saved(d);const model=studyReadModel(d,{now,mode:'child'}),req=request(model);
  assert.deepEqual(validateStudyContinuation(studyReadModel(d,{now,mode:'test'}),req),{ok:false,code:'MODE_MISMATCH'});
  assert.deepEqual(validateStudyContinuation(studyReadModel(d,{now:new Date('2026-11-17T04:00:00Z'),mode:'child'}),req),{ok:false,code:'STALE_PLAN'});
  formal(d,'read','correct',later);assert.deepEqual(validateStudyContinuation(studyReadModel(d,{now,mode:'child'}),req),{ok:false,code:'STALE_PLAN'});
  assert.deepEqual(validateStudyContinuation(model,{...req,activityId:'other'}),{ok:false,code:'SESSION_CHANGED'});
});
test('busy recording or save operations cannot be replaced by a new plan decision',()=>{
  const d=fixture();saved(d);const model=studyReadModel(d,{now,mode:'child'});assert.deepEqual(validateStudyContinuation(model,request(model),{busy:true}),{ok:false,code:'BUSY'});
});
test('binding is stable for object-key ordering and time that does not change any decision',()=>{
  const d=fixture();saved(d);const one=studyReadModel(d,{now,mode:'child'}),reordered=Object.fromEntries(Object.entries(d).reverse()) as typeof d;
  const two=studyReadModel(reordered,{now:new Date(now.getTime()+1000),mode:'child'});assert.equal(one.planId,two.planId);assert.equal(one.sourceRevision,two.sourceRevision);
});
test('malformed continuation fields fail before producing an execution proposal',()=>{
  const d=fixture();saved(d);const model=studyReadModel(d,{now,mode:'child'});assert.deepEqual(validateStudyContinuation(model,{...request(model),requestId:'x'}),{ok:false,code:'INVALID_REQUEST'});assert.throws(()=>studyReadModel(d,{now,mode:'unknown' as 'child'}));
});
