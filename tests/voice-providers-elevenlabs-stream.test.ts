import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElevenLabsProvider, type TtsStreamResult } from '../server/integrations/elevenlabs.ts';

const env={ELEVENLABS_API_KEY:'server-only-stream-secret',ELEVENLABS_VOICE_ID:'voice',ELEVENLABS_TTS_MODEL:'eleven_v4_turbo'};
const audio=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]);
const fetcher=(callback:(url:string,init:RequestInit)=>Promise<Response>)=>callback as typeof fetch;
const collect=async(result:TtsStreamResult)=>{const chunks:Buffer[]=[];for await(const chunk of result.stream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);};
async function directory(){return mkdtemp(join(tmpdir(),'word-tts-stream-'));}

test('validated first MP3 bytes arrive before synthesis finishes; only a complete response becomes cached',async()=>{
  const dataDir=await directory();let release!:()=>void,requests=0,budgetChecks=0;
  const provider=createElevenLabsProvider({env,fetch:fetcher(async(_url,init)=>{
    requests++;assert.equal(new Headers(init.headers).get('xi-api-key'),env.ELEVENLABS_API_KEY);
    assert.equal(JSON.parse(init.body as string).model_id,'eleven_v4_turbo');
    return new Response(new ReadableStream({start(controller){controller.enqueue(audio.subarray(0,2));controller.enqueue(audio.subarray(2,32));let released=false;release=()=>{if(released)return;released=true;controller.enqueue(audio.subarray(32));controller.close();};}}),{headers:{'content-type':'audio/mpeg'}});
  })});
  const input={text:'小栗现在就开始说话。',locale:'zh-CN' as const,dataDir,beforeRequest:()=>{budgetChecks++;}};
  try{
    const result=await provider.streamSpeech(input),iterator=result.stream[Symbol.asyncIterator]();
    const first=await iterator.next();assert.equal(first.done,false);assert.equal(Buffer.from(first.value!).length,2);
    assert.equal(await provider.getCachedSpeech(input),undefined);assert.equal(provider.status().available,false);
    const second=await iterator.next();assert.equal(Buffer.from(second.value!).length,30);release();const rest:Buffer[]=[];
    for(;;){const item=await iterator.next();if(item.done)break;rest.push(Buffer.from(item.value));}
    const done=await result.completed;assert.equal(done.cached,false);assert.ok(done.costCny>0);assert.deepEqual(Buffer.concat([Buffer.from(first.value!),Buffer.from(second.value!),...rest]),audio);
    assert.deepEqual(await readFile(done.filePath!),audio);assert.equal(provider.status().available,true);assert.equal(requests,1);assert.equal(budgetChecks,1);
    const cached=await provider.streamSpeech({...input,beforeRequest:()=>{throw new Error('cache cannot reserve');}});assert.equal(cached.cached,true);assert.deepEqual(await collect(cached),audio);
  }finally{release?.();if(dataDir.startsWith(join(tmpdir(),'word-tts-stream-')))await rm(dataDir,{recursive:true,force:true});}
});

test('stream/nonstream cache dedupe shares one paid operation; cancelling a waiter does not cancel the owner',async()=>{
  const dataDir=await directory();let release!:()=>void,requests=0,reservations=0;
  const provider=createElevenLabsProvider({env,fetch:fetcher(async()=>{requests++;return new Response(new ReadableStream({start(controller){controller.enqueue(audio.subarray(0,32));release=()=>{controller.enqueue(audio.subarray(32));controller.close();};}}),{headers:{'content-type':'audio/mpeg'}});})});
  const input={text:'同一句流式朗读',locale:'zh-CN' as const,dataDir,beforeRequest:()=>{reservations++;}};
  try{
    const owner=await provider.streamSpeech(input),other=provider.streamSpeech(input),regular=provider.synthesizeSpeech(input);
    const controller=new AbortController(),cancelled=provider.streamSpeech({...input,signal:controller.signal});controller.abort();await assert.rejects(cancelled,{code:'CANCELLED'});
    assert.equal(requests,1);assert.equal(reservations,1);release();assert.deepEqual(await collect(owner),audio);await owner.completed;
    const duplicate=await other;assert.equal(duplicate.cached,true);assert.deepEqual(await collect(duplicate),audio);assert.equal((await regular).costCny,0);assert.equal(reservations,1);assert.equal(requests,1);
  }finally{if(dataDir.startsWith(join(tmpdir(),'word-tts-stream-')))await rm(dataDir,{recursive:true,force:true});}
});

test('budget refusal precedes HTTP and leaves no poisoned in-flight entry',async()=>{
  const dataDir=await directory();let calls=0;
  const provider=createElevenLabsProvider({env,fetch:fetcher(async()=>{calls++;return new Response(audio,{headers:{'content-type':'audio/mpeg'}});})});
  const input={text:'预算保护',locale:'zh-CN' as const,dataDir};
  try{
    await assert.rejects(provider.streamSpeech({...input,beforeRequest:()=>{throw Object.assign(new Error('budget'),{code:'BUDGET_EXCEEDED'});}}),{code:'BUDGET_EXCEEDED'});assert.equal(calls,0);
    const good=await provider.streamSpeech(input);assert.deepEqual(await collect(good),audio);await good.completed;assert.equal(calls,1);
  }finally{if(dataDir.startsWith(join(tmpdir(),'word-tts-stream-')))await rm(dataDir,{recursive:true,force:true});}
});

test('header/prefix failures are rejected before a stream is exposed and cannot leak upstream error text',async()=>{
  const dataDir=await directory();
  try{
    for(const response of [new Response(env.ELEVENLABS_API_KEY,{headers:{'content-type':'application/json'}}),new Response(Buffer.alloc(100),{headers:{'content-type':'audio/mpeg'}}),new Response(audio.subarray(0,10),{headers:{'content-type':'audio/mpeg'}})]){
      const provider=createElevenLabsProvider({env,fetch:fetcher(async()=>response)});
      await assert.rejects(provider.streamSpeech({text:'无效响应',locale:'zh-CN',dataDir}),(error:any)=>{assert.equal(error.code,'SPEECH_INVALID_RESPONSE');assert.ok(!error.message.includes(env.ELEVENLABS_API_KEY));return true;});
      assert.equal(provider.status().available,false);assert.deepEqual(await readdir(dataDir),[]);
    }
  }finally{if(dataDir.startsWith(join(tmpdir(),'word-tts-stream-')))await rm(dataDir,{recursive:true,force:true});}
});

test('cancelling a partially consumed stream aborts the reader, releases the iterator and never saves a half MP3',async()=>{
  const dataDir=await directory();let bodyCancelled=0,upstreamSignal:AbortSignal|undefined;
  const provider=createElevenLabsProvider({env,fetch:fetcher(async(_url,init)=>{upstreamSignal=init.signal as AbortSignal;return new Response(new ReadableStream({start(controller){controller.enqueue(audio.subarray(0,32));},cancel(){bodyCancelled++;}}),{headers:{'content-type':'audio/mpeg'}});})});
  const controller=new AbortController(),input={text:'中途停止',locale:'zh-CN' as const,dataDir,signal:controller.signal};
  try{
    const result=await provider.streamSpeech(input),iterator=result.stream[Symbol.asyncIterator]();await iterator.next();const waiting=iterator.next();controller.abort();
    await assert.rejects(waiting,{code:'CANCELLED'});await assert.rejects(result.completed,{code:'CANCELLED'});assert.equal(upstreamSignal?.aborted,true);assert.equal(bodyCancelled,1);assert.equal(await provider.getCachedSpeech(input),undefined);assert.deepEqual(await readdir(dataDir),[]);
  }finally{if(dataDir.startsWith(join(tmpdir(),'word-tts-stream-')))await rm(dataDir,{recursive:true,force:true});}
});

test('early iterator return and a stalled body cannot leave an active operation or partial cache',async()=>{
  const dataDir=await directory();
  try{
    const provider=createElevenLabsProvider({env,timeoutMs:40,fetch:fetcher(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(audio.subarray(0,32));}}),{headers:{'content-type':'audio/mpeg'}}))});
    const returned=await provider.streamSpeech({text:'主动返回迭代器',locale:'zh-CN',dataDir});for await(const _chunk of returned.stream)break;
    await assert.rejects(returned.completed,{code:'CANCELLED'});
    const timeout=await provider.streamSpeech({text:'等待超时',locale:'zh-CN',dataDir});await assert.rejects(collect(timeout),{code:'SPEECH_TIMEOUT'});await assert.rejects(timeout.completed,{code:'SPEECH_TIMEOUT'});assert.deepEqual(await readdir(dataDir),[]);
  }finally{if(dataDir.startsWith(join(tmpdir(),'word-tts-stream-')))await rm(dataDir,{recursive:true,force:true});}
});
