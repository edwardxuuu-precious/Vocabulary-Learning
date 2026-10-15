import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import { createElevenLabsProvider } from '../server/integrations/elevenlabs.ts';

const audio=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]);
const env={ELEVENLABS_API_KEY:'http-stream-private-key',ELEVENLABS_VOICE_ID:'voice'};
const configured={provider:'elevenlabs' as const,configured:true,available:false,status:'unverified' as const,detail:'mock configured'};
const codex={provider:'codex' as const,configured:false,available:false,status:'unavailable' as const,detail:'mock unavailable'};
async function fixture(request:(url:string,init:RequestInit)=>Promise<Response>){
  const dataDir=await mkdtemp(join(tmpdir(),'word-http-stream-'));
  const provider=createElevenLabsProvider({env,fetch:request as typeof fetch});
  const app=createApp({dataDir,dialogue:{turn:async()=>{throw new Error('not used');},status:async()=>codex,cancel(){},reset:async()=>{},close:async()=>{}},integrations:{probeIntegrations:async()=>({speech:configured,tts:configured,codex}),getCachedSpeech:provider.getCachedSpeech,streamSpeech:provider.streamSpeech,synthesizeSpeech:provider.synthesizeSpeech,estimateTtsCost:provider.estimateTtsCost}});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const post=(route:string,body:unknown,signal?:AbortSignal)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  return {...app,provider,base,post,cleanup:async()=>{await app.close();if(dataDir.startsWith(join(tmpdir(),'word-http-stream-')))await rm(dataDir,{recursive:true,force:true});}};
}
async function remaining(reader:ReadableStreamDefaultReader<Uint8Array>){const chunks:Buffer[]=[];for(;;){const item=await reader.read();if(item.done)break;chunks.push(Buffer.from(item.value));}return Buffer.concat(chunks);}

test('HTTP emits MP3 before upstream EOF; stream/file waiters share one reservation and cached audio works at zero budget',async()=>{
  let release=()=>{},requests=0,ended=false;
  const app=await fixture(async(_url,init)=>{requests++;assert.equal(new Headers(init.headers).get('xi-api-key'),env.ELEVENLABS_API_KEY);return new Response(new ReadableStream({start(controller){controller.enqueue(audio.subarray(0,32));let done=false;release=()=>{if(done)return;done=true;ended=true;controller.enqueue(audio.subarray(32));controller.close();};}}),{headers:{'content-type':'audio/mpeg'}});});
  const input={text:'小栗马上就说话。',locale:'zh-CN'};
  try{
    const response=await app.post('/api/speech/tts/stream',input);
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(response.headers.get('x-tts-cached'),'false');
    const reader=response.body!.getReader(),first=await reader.read();assert.deepEqual(Buffer.from(first.value!),audio.subarray(0,32));assert.equal(ended,false);
    assert.equal(await app.provider.getCachedSpeech({...input,locale:'zh-CN',dataDir:app.dataDir}),undefined);
    const streamWaiter=app.post('/api/speech/tts/stream',input),fileWaiter=app.post('/api/speech/tts',input);
    release();assert.deepEqual(Buffer.concat([Buffer.from(first.value!),await remaining(reader)]),audio);
    const duplicate=await streamWaiter,file=await (await fileWaiter).json();assert.equal(duplicate.headers.get('x-tts-cached'),'true');assert.deepEqual(Buffer.from(await duplicate.arrayBuffer()),audio);
    assert.equal(file.cached,true);assert.deepEqual(Buffer.from(await (await fetch(app.base+file.audioUrl)).arrayBuffer()),audio);
    assert.equal(requests,1);const charges=app.store.read().charges;assert.equal(charges.length,1);assert.ok(charges[0].actual!>0);assert.ok(charges[0].actual!<=charges[0].reserved);
    app.store.updateSettings({monthlyBudgetCny:0});
    const cached=await app.post('/api/speech/tts/stream',input);assert.equal(cached.status,200);assert.equal(cached.headers.get('x-tts-cached'),'true');assert.deepEqual(Buffer.from(await cached.arrayBuffer()),audio);assert.equal(app.store.read().charges.length,1);assert.equal(requests,1);
  }finally{release();await app.cleanup();}
});

test('HTTP budget refusal and malformed input are JSON errors before audio or cloud requests',async()=>{
  let calls=0;const app=await fixture(async()=>{calls++;return new Response(audio,{headers:{'content-type':'audio/mpeg'}});});
  try{
    app.store.updateSettings({monthlyBudgetCny:0});
    const invalid=await app.post('/api/speech/tts/stream',{text:'a'.repeat(501),locale:'en-US'});assert.equal(invalid.status,400);assert.match(invalid.headers.get('content-type')!,/application\/json/);
    const response=await app.post('/api/speech/tts/stream',{text:'预算用完',locale:'zh-CN'});assert.equal(response.status,402);assert.equal((await response.json()).code,'BUDGET_EXCEEDED');assert.equal(calls,0);assert.equal(app.store.read().charges.length,0);
  }finally{await app.cleanup();}
});

test('HTTP disconnect aborts upstream; unknown paid usage retains its reservation and never exposes a partial cache',async()=>{
  let abortObserved!:()=>void,cancels=0;
  const aborted=new Promise<void>(resolve=>{abortObserved=resolve;});
  const app=await fixture(async(_url,init)=>{init.signal!.addEventListener('abort',abortObserved,{once:true});return new Response(new ReadableStream({start(controller){controller.enqueue(audio.subarray(0,32));},cancel(){cancels++;}}),{headers:{'content-type':'audio/mpeg'}});});
  const controller=new AbortController(),input={text:'这一句读到一半停止。',locale:'zh-CN' as const};
  try{
    const response=await app.post('/api/speech/tts/stream',input,controller.signal);const reader=response.body!.getReader();assert.equal((await reader.read()).value!.byteLength,32);
    controller.abort();await aborted;await assert.rejects(reader.read());
    assert.equal(cancels,1);assert.equal(await app.provider.getCachedSpeech({...input,dataDir:app.dataDir}),undefined);
    const charges=app.store.read().charges;assert.equal(charges.length,1);assert.ok(charges[0].reserved>0);assert.equal(charges[0].actual,undefined);
  }finally{controller.abort();await app.cleanup();}
});

test('HTTP invalid provider MIME is rejected as safe JSON before any MP3 response',async()=>{
  const app=await fixture(async()=>new Response(env.ELEVENLABS_API_KEY,{headers:{'content-type':'application/json'}}));
  try{
    const response=await app.post('/api/speech/tts/stream',{text:'无效上游响应',locale:'zh-CN'});assert.equal(response.status,502);assert.match(response.headers.get('content-type')!,/application\/json/);
    const body=await response.json();assert.equal(body.code,'SPEECH_INVALID_RESPONSE');assert.ok(!JSON.stringify(body).includes(env.ELEVENLABS_API_KEY));assert.equal(app.store.read().charges[0].actual,undefined);
  }finally{await app.cleanup();}
});
