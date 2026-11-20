import test from 'node:test';
import assert from 'node:assert/strict';
import {SentenceDemonstrationController} from '../src/sentence-demonstration.ts';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}

test('two complete sentence plays precede one saved demonstration; duplicate start never overlaps',async()=>{
  const saving=deferred<boolean>(),events:string[]=[];
  const player=new SentenceDemonstrationController({play:async()=>{events.push('play');return true;},confirm:()=>{events.push('save');return saving.promise;},stop(){},update(){},wait:async()=>{events.push('gap');}});
  const run=player.start();await flush();await player.start();
  assert.deepEqual(events,['play','gap','play','save']);assert.equal(player.state.completed,2);assert.equal(player.state.phase,'saving');
  saving.resolve(true);await run;assert.equal(player.state.phase,'ready');await player.start();assert.equal(events.length,4);
});

test('a failed first or second play cannot save a demonstration and retry actually plays twice',async()=>{
  for(const failAt of [1,2]){
    let plays=0,saves=0;
    const player=new SentenceDemonstrationController({play:async()=>++plays!==failAt,confirm:async()=>{saves++;return true;},stop(){},update(){},wait:async()=>{}});
    await player.start();assert.equal(saves,0);assert.equal(player.state.phase,'audio-error');assert.equal(player.state.completed,failAt-1);
    await player.start();assert.equal(saves,1);assert.equal(plays,failAt+2);assert.equal(player.state.phase,'ready');
  }
});

test('pause, leaving a page or changing the word during a play rejects late completion',async()=>{
  const playing=deferred<boolean>();let plays=0,saves=0,stops=0;
  const player=new SentenceDemonstrationController({play:()=>{plays++;return playing.promise;},confirm:async()=>{saves++;return true;},stop(){stops++;},update(){}});
  const run=player.start();player.cancel();playing.resolve(true);await run;
  assert.equal(plays,1);assert.equal(saves,0);assert.equal(stops,1);assert.equal(player.state.completed,0);
});

test('cancelling between plays aborts the pause and never starts the second sentence',async()=>{
  const gap=deferred<void>();let plays=0,saves=0,signal:AbortSignal|undefined;
  const player=new SentenceDemonstrationController({play:async()=>{plays++;return true;},confirm:async()=>{saves++;return true;},stop(){},update(){},wait:async(_,value)=>{signal=value;await gap.promise;}});
  const run=player.start();await flush();assert.equal(player.state.completed,1);player.cancel();gap.resolve();await run;
  assert.equal(signal?.aborted,true);assert.equal(plays,1);assert.equal(saves,0);
});

test('a failed save retains real play count and retries only the save',async()=>{
  let plays=0,saves=0;
  const player=new SentenceDemonstrationController({play:async()=>{plays++;return true;},confirm:async()=>++saves>1,stop(){},update(){},wait:async()=>{}});
  await player.start();assert.equal(player.state.phase,'save-error');assert.equal(player.state.completed,2);
  await player.start();assert.equal(player.state.phase,'ready');assert.equal(plays,2);assert.equal(saves,2);
});

test('leaving during a real demonstration save never unlocks the next page from its late response',async()=>{
  const saving=deferred<boolean>();let ready=0;
  const player=new SentenceDemonstrationController({play:async()=>true,confirm:()=>saving.promise,stop(){},update:state=>{if(state.phase==='ready')ready++;},wait:async()=>{}});
  const run=player.start();await flush();player.cancel();saving.resolve(true);await run;assert.equal(ready,0);
});

test('thrown playback failure is recoverable without fabricated demonstration facts',async()=>{
  let saves=0;
  const player=new SentenceDemonstrationController({play:async()=>{throw Error('设备失败');},confirm:async()=>{saves++;return true;},stop(){},update(){}});
  await player.start();assert.equal(player.state.phase,'audio-error');assert.equal(player.state.completed,0);assert.equal(saves,0);
});
