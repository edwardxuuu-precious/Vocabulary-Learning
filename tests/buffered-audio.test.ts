import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { BufferedAudioEngine, configureFeedback, playFeedbackCue, stopBrowserAudio } from '../src/buffered-audio.ts';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(t:TestContext){
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  let now=0,fetches=0,decodes=0;
  const sources:{buffer:AudioBuffer;offset?:number;onended?:()=>void;stopped?:boolean;start:(at:number,offset:number)=>void;stop:()=>void;connect:()=>void;disconnect:()=>void}[]=[];
  const buffer=(seconds:number)=>({length:Math.ceil(seconds*1000),duration:seconds,numberOfChannels:1,getChannelData:()=>new Float32Array(Math.ceil(seconds*1000))}) as unknown as AudioBuffer;
  let decode=async()=>buffer(.8);
  const context={state:'running',currentTime:0,sampleRate:1000,destination:{},resume:async()=>{context.state='running';},decodeAudioData:async()=>{decodes++;return decode();},createBuffer:(_n:number,length:number,rate:number)=>buffer(length/rate),createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),createBufferSource:()=>{const source={buffer:buffer(0),start(_at:number,offset:number){source.offset=offset;},offset:undefined as number|undefined,onended:undefined as (()=>void)|undefined,stop(){source.stopped=true;},stopped:false,connect(){},disconnect(){}};sources.push(source);return source;}};
  const engine=new BufferedAudioEngine({createContext:()=>context as unknown as AudioContext,fetchBytes:async()=>{fetches++;return new ArrayBuffer(10);},now:()=>now});
  return {engine,sources,context,get fetches(){return fetches;},get decodes(){return decodes;},setDecode:(fn:()=>Promise<AudioBuffer>)=>decode=fn,buffer,setNow:(n:number)=>now=n,end:async()=>{sources.at(-1)!.onended?.();await flush();t.mock.timers.tick(101);await flush();}};
}
test('fully decodes before warmup; first sample and word both start at zero; only word reports start',async t=>{
  const h=setup(t);let release!:(b:AudioBuffer)=>void;h.setDecode(()=>new Promise(resolve=>release=resolve));let starts=0;
  const playing=h.engine.play('/media/word.mp3',{signal:new AbortController().signal,onStart:()=>starts++});await flush();assert.equal(h.sources.length,0);
  release(h.buffer(.8));await flush();assert.equal(h.sources[0].buffer.duration,.4);assert.equal(starts,0);
  await h.end();assert.equal(h.sources.length,2);assert.equal(starts,0);assert.equal(h.sources[1].offset,0);
  await h.end();assert.equal(await playing,true);assert.equal(starts,1);assert.equal(h.engine.lastTrace?.warmupMs,400);
});
test('reuses decoded cache, warms again after idle, resume or microphone output change',async t=>{
  const h=setup(t),ctx={signal:new AbortController().signal,onStart(){}};
  const first=h.engine.play('/media/word.mp3',ctx);await flush();await h.end();await h.end();assert.equal(await first,true);
  const next=h.engine.play('/media/word.mp3',ctx);await flush();assert.equal(h.sources.at(-1)!.buffer.duration,.8);await h.end();await next;assert.equal(h.fetches,1);assert.equal(h.decodes,1);
  h.setNow(6000);const idle=h.engine.play('/media/word.mp3',ctx);await flush();assert.equal(h.sources.at(-1)!.buffer.duration,.4);await h.end();await h.end();await idle;
  h.engine.markCold();const resumed=h.engine.play('/media/word.mp3',ctx);await flush();assert.equal(h.sources.at(-1)!.buffer.duration,.4);h.engine.stop();assert.equal(await resumed,false);
});
test('rapid replay discards stale decode and stop cancels warmup, word and delayed end callback',async t=>{
  const h=setup(t);let release!:(b:AudioBuffer)=>void;h.setDecode(()=>new Promise(resolve=>release=resolve));let stale=0;
  const old=h.engine.play('/media/old.mp3',{signal:new AbortController().signal,onStart:()=>stale++});await flush();h.setDecode(async()=>h.buffer(.7));
  const current=h.engine.play('/media/new.mp3',{signal:new AbortController().signal,onStart(){}});await flush();release(h.buffer(.8));await flush();assert.equal(await old,false);assert.equal(stale,0);
  h.engine.stop();assert.equal(await current,false);assert.ok(h.sources[0].stopped);
  const controller=new AbortController();const tail=h.engine.play('/media/new.mp3',{signal:controller.signal,onStart:()=>stale++});await flush();await h.end();await flush();h.sources.at(-1)!.onended?.();controller.abort();t.mock.timers.tick(200);await flush();assert.equal(await tail,false);assert.equal(stale,1);
});
test('prefetch shares fetch/decode; feedback cannot interrupt speech; private replay is not cached',async t=>{
  const h=setup(t);await Promise.all([h.engine.prefetch('/media/word.mp3'),h.engine.prefetch('/media/word.mp3')]);assert.equal(h.fetches,1);
  const p=h.engine.play('/media/word.mp3',{signal:new AbortController().signal,onStart(){}});await flush();assert.equal(await h.engine.cue('correct'),false);await h.end();await h.end();assert.equal(await p,true);
  for(let i=0;i<2;i++){const p=h.engine.play('blob:private',{signal:new AbortController().signal,onStart(){}});await flush();await h.end();assert.equal(await p,true);}assert.equal(h.fetches,3);
  const cue=h.engine.cue('retry');await flush();assert.equal(h.sources.at(-1)!.buffer.duration,.23);await h.end();assert.equal(await cue,true);
});
test('decode failure and suspended output never report successful playback',async t=>{
  const h=setup(t);h.setDecode(async()=>{throw Error('broken bytes');});assert.equal(await h.engine.play('/media/bad.mp3',{signal:new AbortController().signal,onStart(){throw Error('must not start');}}),false);assert.equal(h.sources.length,0);
  h.context.state='closed';await assert.rejects(h.engine.play('/media/other.mp3',{signal:new AbortController().signal,onStart(){}}),/播放|声音|点击|手势/);
});
test('feedback respects mute, deduplicates responses and stops on pause without fetching any audio',async t=>{
  const h=setup(t),old=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:function(){return h.context;}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'AudioContext',old);else Reflect.deleteProperty(globalThis,'AudioContext');configureFeedback(true);});
  configureFeedback(false);await playFeedbackCue('correct','muted');assert.equal(h.sources.length,0);
  configureFeedback(true);const cue=playFeedbackCue('correct','once');await flush();await h.end();await h.end();await cue;const count=h.sources.length;
  await playFeedbackCue('correct','once');assert.equal(h.sources.length,count);assert.equal(h.fetches,0);
  const retry=playFeedbackCue('retry','new-result');await flush();stopBrowserAudio();await retry;assert.equal(h.sources.at(-1)?.stopped,true);
});
