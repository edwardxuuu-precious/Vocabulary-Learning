import test from 'node:test';
import assert from 'node:assert/strict';
import { RecallDemonstrationController } from '../src/recall-demonstration';

function deferred<T>() { let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve}; }
async function flush() { for(let i=0;i<8;i++)await Promise.resolve(); }
function harness(demonstrate:()=>Promise<boolean>=async()=>true) {
  const events:string[]=[];
  const controller=new RecallDemonstrationController({
    demonstrate:()=>{events.push('demo');return demonstrate();},stopAudio:()=>events.push('stop'),
    wait:async()=>{events.push('gap');},update:state=>events.push(`${state.phase}:${state.completed}`),
  });
  return {controller,events};
}

test('three sequential successful demonstrations unlock a single separate recording stage',async()=>{
  const h=harness();await h.controller.start();
  assert.deepEqual(h.events.filter(event=>['demo','gap'].includes(event)),['gap','demo','gap','demo','gap','demo']);
  assert.equal(h.controller.state.phase,'ready');assert.equal(h.controller.state.completed,3);
  await h.controller.start();assert.equal(h.events.filter(event=>event==='demo').length,3);
  await h.controller.start(true);assert.equal(h.events.filter(event=>event==='demo').length,6);
});

test('a failed second demonstration never claims three plays or unlocks recording until retry or explicit skip',async()=>{
  let count=0;const h=harness(async()=>++count!==2);await h.controller.start();
  assert.equal(h.controller.state.phase,'error');assert.equal(h.controller.state.completed,1);
  await h.controller.start();assert.equal(h.controller.state.phase,'ready');assert.equal(h.controller.state.completed,3);
  const failed=harness(async()=>false);await failed.controller.start();failed.controller.skip();
  assert.equal(failed.controller.state.phase,'ready');assert.equal(failed.controller.state.completed,0);
});

test('pause during playback cannot start a later round or reopen recording from a stale completion',async()=>{
  const playback=deferred<boolean>();const h=harness(()=>playback.promise);
  const pending=h.controller.start();await flush();await h.controller.start();
  assert.equal(h.events.filter(event=>event==='demo').length,1);
  h.controller.pause();playback.resolve(true);await pending;
  assert.equal(h.controller.state.phase,'idle');assert.equal(h.controller.state.completed,0);
  await h.controller.start();assert.equal(h.controller.state.completed,3);
});

test('pause or skip between rounds aborts the wait and prevents late playback',async()=>{
  for(const action of ['pause','skip'] as const){
    const gap=deferred<void>();let signal:AbortSignal|undefined,plays=0;
    const controller=new RecallDemonstrationController({demonstrate:async()=>{plays++;return true;},stopAudio(){},update(){},wait:async(_,value)=>{signal=value;await gap.promise;}});
    const pending=controller.start();controller[action]();gap.resolve();await pending;
    assert.equal(signal?.aborted,true);assert.equal(plays,0);assert.equal(controller.state.completed,0);
    assert.equal(controller.state.phase,action==='skip'?'ready':'idle');
  }
});
