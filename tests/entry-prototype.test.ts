import test from 'node:test';
import assert from 'node:assert/strict';
import { entryPools,entryResume,entryScopeIssue } from '../shared/entry-rules.ts';
import { createEntryPrototype,prototypeContent,prototypeCurrent,prototypeLanding,prototypePools,prototypeSession,prototypeTransition,restoreEntryPrototype,type EntryPrototype,type PrototypeAction } from '../shared/entry-prototype.ts';

const now=new Date('2026-10-25T04:00:00Z');
const dispatch=(state:EntryPrototype,action:PrototypeAction)=>prototypeTransition(state,action);
const activity=(state:EntryPrototype,action:Extract<PrototypeAction,{type:'activity'}>['action'],choice?:string)=>dispatch(state,{type:'activity',sessionId:prototypeSession(state)!.id,itemId:prototypeCurrent(state)!.id,action,choice});
function finishItem(state:EntryPrototype){
  const step=prototypeCurrent(state)!.step;
  if(step==='introduce')state=activity(state,'choose');
  else if(step==='listen'||step==='recognize'){
    if(step==='listen')state=activity(state,'listen');
    state=activity(state,'choose',prototypeCurrent(state)!.word.id);
  }else {state=activity(state,'record');state=activity(state,'finish-recording');}
  return activity(state,'next');
}

test('S05/S06/S07/S08: current learned pool excludes reservations, old meanings and unavailable content',()=>{
  const state=createEntryPrototype(),content=prototypeContent('normal');
  const input={...content,introductions:state.introductions};
  assert.deepEqual(entryPools(input,now).review.map(word=>word.id),['banana','dog']);
  assert.deepEqual(entryPools(input,now).learn.map(word=>word.id),['apple','cat']);
  const changed=structuredClone(input);changed.words.find(word=>word.id==='banana')!.learningVersion=1;
  assert.ok(entryPools(changed,now).learn.some(word=>word.id==='banana'));
  for(const flaw of ['sample','disabled','deleted-pack','deleted-word','unapproved','missing-audio','future','reset'] as const){
    const data=structuredClone(input);
    const target=data.words.find(word=>word.id==='banana')!;
    if(flaw==='sample')data.packs[0].isSample=true;
    if(flaw==='disabled')data.packs[0].enabled=false;
    if(flaw==='deleted-pack')data.packs[0].deletedAt=now.toISOString();
    if(flaw==='deleted-word')target.deletedAt=now.toISOString();
    if(flaw==='unapproved')target.assetStatus='review';
    if(flaw==='missing-audio')data.audioReadyWordIds=data.audioReadyWordIds.filter(id=>id!=='banana');
    if(flaw==='future')data.introductions[0].introducedAt='2026-10-26T00:00:00Z';
    if(flaw==='reset')target.learningResetAt=now.toISOString();
    assert.equal(entryPools(data,now).review.some(word=>word.id==='banana'),false,flaw);
  }
  assert.deepEqual(input,{...content,introductions:state.introductions});
});
test('S01/S02/S03/S16: opening is read-only; simultaneous entry sessions and book sources never take over one another',()=>{
  let state=createEntryPrototype();
  const untouched=structuredClone(state);
  state=dispatch(state,{type:'open',entry:'learn'});assert.equal(state.sessions.length,0);assert.deepEqual(state.introductions,untouched.introductions);
  state=dispatch(state,{type:'start'});const first=prototypeSession(state)!.id,items=structuredClone(prototypeSession(state)!.items);
  state=dispatch(state,{type:'start'});assert.equal(state.sessions.length,1);
  state=finishItem(state);const cursor=prototypeSession(state)!.cursor;
  state=dispatch(state,{type:'pause'});state=dispatch(state,{type:'open',entry:'review'});
  assert.equal(prototypeLanding(state).resume,undefined);
  state=dispatch(state,{type:'start'});const second=prototypeSession(state)!.id;assert.notEqual(first,second);
  state=dispatch(state,{type:'pause'});state=dispatch(state,{type:'open',entry:'review',packId:'garden'});
  assert.equal(prototypeLanding(state).resume,undefined);
  assert.deepEqual(prototypeLanding(state).candidates.map(word=>word.id),['apple','banana']);
  state=dispatch(state,{type:'open',entry:'learn'});state=dispatch(state,{type:'start'});
  assert.equal(prototypeSession(state)!.id,first);assert.equal(prototypeSession(state)!.cursor,cursor);assert.deepEqual(prototypeSession(state)!.items,items);
  assert.equal(entryResume(state.sessions,'review')!.id,second);
});
test('S04/S18: legacy is explicit; changed frozen scopes are blocked without rewriting the old session',()=>{
  let state=createEntryPrototype('legacy');const before=structuredClone(state.sessions[0]);
  for(const entry of ['learn','review'] as const){state=dispatch(state,{type:'open',entry});assert.equal(prototypeLanding(state).resume,undefined);}
  state=dispatch(state,{type:'legacy',id:before.id});assert.equal(state.screen,'play');assert.deepEqual(prototypeSession(state)!.words,before.words);
  state=dispatch(state,{type:'pause'});assert.equal(state.screen,'home');assert.deepEqual(prototypeSession(state)!.words,before.words);
  state=createEntryPrototype('updated');const snapshot=structuredClone(state.sessions[0]);
  state=dispatch(state,{type:'open',entry:'review'});state=dispatch(state,{type:'start'});
  assert.equal(state.screen,'blocked');assert.deepEqual(prototypeSession(state),snapshot);
  assert.equal(entryScopeIssue(snapshot,prototypePools(state).ready),'scope-changed');
});
test('S09/S10/S11: empty entry states do not create rounds; no-due still permits explicit learned-book practice',()=>{
  for(const [scenario,entry] of [['no-new','learn'],['no-due','review'],['no-content','learn'],['no-content','review']] as const){
    let state=dispatch(createEntryPrototype(scenario),{type:'open',entry});
    assert.equal(prototypeLanding(state).candidates.length,0);
    state=dispatch(state,{type:'start'});assert.equal(state.sessions.length,0);
  }
  let state=dispatch(createEntryPrototype('no-due'),{type:'open',entry:'review',packId:'garden'});
  assert.deepEqual(prototypeLanding(state).candidates.map(word=>word.id),['banana']);
  state=dispatch(state,{type:'start'});assert.equal(prototypeSession(state)!.source,'book');
});
test('S12/S13: hints, first errors and device failures remain distinct; oral demonstration never creates formal evidence',()=>{
  let state=dispatch(dispatch(createEntryPrototype('audio-failure'),{type:'open',entry:'review'}),{type:'start'});
  state=activity(state,'listen');let session=prototypeSession(state)!,item=prototypeCurrent(state)!;
  assert.equal(session.states[item.id].device,'audio');assert.equal(session.states[item.id].feedback,undefined);
  state=activity(state,'retry');state=activity(state,'listen');assert.equal(prototypeSession(state)!.states[item.id].hinted,true);
  state=activity(state,'skip');state=activity(state,'next');assert.equal(prototypeCurrent(state)!.step,'listen');
  state=activity(state,'listen');assert.equal(prototypeSession(state)!.states[prototypeCurrent(state)!.id].device,'audio');
  state=activity(state,'retry');state=activity(state,'listen');state=activity(state,'choose','wrong');state=activity(state,'choose',prototypeCurrent(state)!.word.id);
  assert.equal(prototypeSession(state)!.states[prototypeCurrent(state)!.id].feedback,'helped');
  state=dispatch(dispatch(createEntryPrototype('mic-denied'),{type:'open',entry:'review'}),{type:'start'});
  state=activity(state,'record');assert.equal(prototypeSession(state)!.states[prototypeCurrent(state)!.id].device,'mic');
  state=activity(state,'finish-recording');assert.equal(prototypeSession(state)!.states[prototypeCurrent(state)!.id].feedback,undefined);
  state=activity(state,'skip');assert.equal(prototypeSession(state)!.states[prototypeCurrent(state)!.id].feedback,'skipped');
  assert.equal(Object.hasOwn(state,'assessmentAttempts'),false);
});
test('S14/S15/S16/S17/S20: full paths preserve pause/checkpoint/refresh, reject stale advance and return to their own entry',()=>{
  for(const entry of ['learn','review'] as const){
    let state=dispatch(dispatch(createEntryPrototype(),{type:'open',entry}),{type:'start'});
    const id=prototypeSession(state)!.id,first=prototypeCurrent(state)!.id;
    state=finishItem(state);const cursor=prototypeSession(state)!.cursor;
    const after=dispatch(state,{type:'activity',sessionId:id,itemId:first,action:'next'});assert.equal(prototypeSession(after)!.cursor,cursor);
    state=dispatch(state,{type:'pause'});const saved=JSON.parse(JSON.stringify(prototypeSession(state)));
    state=restoreEntryPrototype(JSON.stringify(state))!;assert.ok(state);assert.deepEqual(prototypeSession(state),saved);
    state=dispatch(state,{type:'start'});assert.equal(prototypeSession(state)!.cursor,cursor);
    let breaks=0;
    for(let i=0;i<25&&state.screen==='play';i++){
      if(prototypeSession(state)!.atBreak){breaks++;const index=prototypeSession(state)!.cursor;
        const blocked=finishItem(state);assert.equal(prototypeSession(blocked)!.cursor,index);
        state=dispatch(state,{type:'pause'});state=dispatch(state,{type:'start'});
      }else state=finishItem(state);
    }
    assert.equal(state.screen,'done');assert.equal(prototypeSession(state)!.status,'completed');assert.equal(breaks,1);
    state=dispatch(state,{type:'open',entry});assert.equal(state.screen,'landing');assert.equal(prototypeLanding(state).resume,undefined);
    if(entry==='learn')assert.equal(prototypePools(state).learn.length,0);
    else assert.equal(prototypeLanding(state).candidates.length,0);
  }
});
test('S20: corrupt or unrelated saved objects are rejected, not interpreted as learning facts',()=>{
  for(const raw of [null,'bad','{}',JSON.stringify({...createEntryPrototype(),schema:0}),JSON.stringify({...createEntryPrototype(),sessions:[{}]})])assert.equal(restoreEntryPrototype(raw),null);
  const valid=createEntryPrototype('both-pending');assert.deepEqual(restoreEntryPrototype(JSON.stringify(valid)),JSON.parse(JSON.stringify(valid)));
});
