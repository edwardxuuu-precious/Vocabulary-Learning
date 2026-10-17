import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Store } from '../server/store.ts';
import { createElevenLabsProvider } from '../server/integrations/elevenlabs.ts';
import { createPackAudioManager } from '../server/pack-audio.ts';
import type { PackAudioStatus } from '../shared/contracts.ts';

const mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]);
const settings={ELEVENLABS_API_KEY:'pack-audio-synthetic-key',ELEVENLABS_VOICE_ID:'mock_voice'};
const requestInput=(dataDir:string,text:string)=>({dataDir,text,locale:'en-US' as const,tone:'clear' as const});
function deferred<T=void>(){let resolve!:(value:T|PromiseLike<T>)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
async function fixture(fetcher:typeof fetch=async()=>new Response(mp3,{headers:{'content-type':'audio/mpeg'}}),env:NodeJS.ProcessEnv={...settings}){
  const dataDir=await mkdtemp(join(tmpdir(),'pack-audio-'));
  const store=new Store(dataDir,()=>new Date('2026-10-16T02:00:00Z'));
  const provider=createElevenLabsProvider({env,fetch:fetcher,timeoutMs:2000});
  const integration={ttsStatus:provider.status,getCachedSpeech:provider.getCachedSpeech,synthesizeSpeech:provider.synthesizeSpeech,estimateTtsCost:provider.estimateTtsCost};
  const toMediaUrl=(filePath:string)=>{const path=resolve(filePath),name=relative(dataDir,path);if(name.startsWith('..')||isAbsolute(name)||!existsSync(path)||!realpathSync(path).startsWith(realpathSync(dataDir)+sep))throw new Error('invalid media boundary');return'/media/'+name.split(sep).join('/');};
  const manager=createPackAudioManager({store,integration,dataDir,toMediaUrl});
  const pack=(terms=['book','tree'])=>store.createPack('合成测试词表',terms.map(term=>({term,meaning:'测试释义'})));
  const cleanup=async()=>{await manager.close();store.close();assert.ok(dataDir.startsWith(join(tmpdir(),'pack-audio-')));await rm(dataDir,{recursive:true,force:true});};
  return{dataDir,store,provider,integration,toMediaUrl,manager,pack,cleanup};
}
async function completed(manager:ReturnType<typeof createPackAudioManager>,packId:string):Promise<PackAudioStatus>{
  const deadline=performance.now()+4000;
  while(manager.busy()){if(performance.now()>deadline)throw new Error('manager did not finish');await new Promise(done=>setImmediate(done));}
  return manager.getStatus(packId);
}

test('cache scans are read-only, generation is sequential en-US clear, ready is rebuilt from current files',async()=>{
  let requests=0,inFlight=0,maximum=0;
  const f=await fixture(async(_url,init)=>{requests++;inFlight++;maximum=Math.max(maximum,inFlight);const payload=JSON.parse(String(init?.body));assert.equal(payload.language_code,'en');assert.equal(payload.inputs[0].text,requests===1?'book':'tree');await new Promise(done=>setImmediate(done));inFlight--;return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
  try{
    const pack=f.pack(),before=f.store.read();assert.equal((await f.manager.getStatus(pack.id)).status,'idle');assert.deepEqual(f.store.read(),before);assert.equal(requests,0);
    assert.equal((await f.manager.start(pack.id)).status,'running');
    const status=await completed(f.manager,pack.id);assert.equal(status.status,'ready');assert.equal(status.total,2);assert.equal(status.cached,2);assert.equal(maximum,1);assert.equal(requests,2);
    assert.ok(f.store.read().charges.every(charge=>charge.actual!>0&&charge.actual!<=charge.reserved));assert.equal(f.store.read().charges.length,2);
    for(const key of ['profile','packs','words','progress','attempts','sessions','stickers'] as const)assert.deepEqual(f.store.read()[key],before[key]);
    const path=await f.provider.getCachedSpeech(requestInput(f.dataDir,'tree'));await unlink(path!);
    const rescanned=await f.manager.getStatus(pack.id);assert.equal(rescanned.status,'idle');assert.equal(rescanned.cached,1);assert.equal(requests,2,'status never regenerates missing files');
  }finally{await f.cleanup();}
});

test('same exact terms are queried/generated once per scan, while case changes remain distinct cache inputs',async()=>{
  const inputs:string[]=[];const f=await fixture(async(_url,init)=>{inputs.push(JSON.parse(String(init?.body)).inputs[0].text);return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
  try{
    const pack=f.pack(['book','tree']);f.store.mutate(data=>{const word=data.words.find(word=>word.packId===pack.id)!;data.words.push({...word,id:'qa-copy-exact'});data.words.push({...word,id:'qa-copy-case',term:'Book'});});
    const counts=new Map<string,number>(),original=f.integration.getCachedSpeech;
    f.integration.getCachedSpeech=async input=>{counts.set(input.text,(counts.get(input.text)??0)+1);return original(input);};
    const missing=await f.manager.getStatus(pack.id);assert.equal(missing.total,4);assert.deepEqual([...counts.values()],[1,1,1]);counts.clear();
    await f.manager.start(pack.id);const ready=await completed(f.manager,pack.id);assert.equal(ready.cached,4);assert.deepEqual(inputs,['book','tree','Book']);assert.equal(f.store.read().charges.length,3);
  }finally{await f.cleanup();}
});

test('same-pack starts are idempotent; different-pack work conflicts and cancellation stops remaining words',async()=>{
  const entered=deferred(),aborted=deferred();let requests=0;
  const f=await fixture(async(_url,init)=>{requests++;entered.resolve();return new Promise<Response>((_resolve,reject)=>{const cancel=()=>{aborted.resolve();reject(new Error('upstream cancellation'));};init!.signal!.addEventListener('abort',cancel,{once:true});});});
  try{
    const one=f.pack(),two=f.pack(['fish']);
    const [a,b]=await Promise.all([f.manager.start(one.id),f.manager.start(one.id)]);assert.equal(a.status,'running');assert.equal(b.status,'running');await entered.promise;
    assert.equal(f.manager.busy(),true);await assert.rejects(f.manager.start(two.id),(error:any)=>error.code==='PACK_AUDIO_BUSY');
    const cancelled=await f.manager.cancel(one.id);await aborted.promise;assert.equal(cancelled.status,'stopped');assert.equal(f.manager.busy(),false);assert.equal(requests,1);
    const charge=f.store.read().charges[0];assert.ok(charge.reserved>0);assert.equal(charge.actual,undefined,'dispatched unknown usage retains its reservation');
    await f.manager.getStatus(one.id);assert.equal(requests,1);
  }finally{await f.cleanup();}
});

test('budget rejection happens before request ownership dispatch and reads never retry',async()=>{
  let requests=0;const f=await fixture(async()=>{requests++;return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
  try{
    const pack=f.pack();f.store.updateSettings({monthlyBudgetCny:0});await f.manager.start(pack.id);
    const status=await completed(f.manager,pack.id);assert.equal(status.status,'error');assert.match(status.error!,/预算/);assert.equal(requests,0);assert.equal(f.store.read().charges.length,0);
    await f.manager.getStatus(pack.id);assert.equal(requests,0);f.store.updateSettings({monthlyBudgetCny:1});assert.equal((await f.manager.getStatus(pack.id)).status,'error');
    await f.manager.start(pack.id);assert.equal((await completed(f.manager,pack.id)).status,'ready');assert.equal(requests,2);
  }finally{await f.cleanup();}
});

test('quota failure stops on first error, keeps successes and unknown reservation, and explicit retry skips success',async()=>{
  let requests=0,refuse=true;const f=await fixture(async()=>{requests++;return requests===2&&refuse?new Response('private quota body '+settings.ELEVENLABS_API_KEY,{status:429}):new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
  try{
    const pack=f.pack(['book','tree','bird']);await f.manager.start(pack.id);const stopped=await completed(f.manager,pack.id);
    assert.equal(stopped.status,'error');assert.equal(stopped.cached,1);assert.match(stopped.error!,/额度/);assert.ok(!JSON.stringify(stopped).includes(settings.ELEVENLABS_API_KEY));assert.equal(requests,2);
    assert.equal(f.store.read().charges.length,2);assert.ok(f.store.read().charges[0].actual!>0);assert.equal(f.store.read().charges[1].actual,undefined);
    await f.manager.getStatus(pack.id);assert.equal(requests,2);refuse=false;
    await f.manager.start(pack.id);assert.equal((await completed(f.manager,pack.id)).status,'ready');assert.equal(requests,4);assert.equal(f.store.read().charges.length,4);
  }finally{await f.cleanup();}
});

test('all cached words work without key or remaining budget and never write another charge',async()=>{
  let requests=0;const f=await fixture(async()=>{requests++;return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
  let restarted:ReturnType<typeof createPackAudioManager>|undefined;
  try{
    const pack=f.pack();await f.manager.start(pack.id);await completed(f.manager,pack.id);await f.manager.close();f.store.updateSettings({monthlyBudgetCny:0});
    const keyless=createElevenLabsProvider({env:{ELEVENLABS_VOICE_ID:'mock_voice'},fetch:async()=>{throw new Error('must not request');}});
    restarted=createPackAudioManager({store:f.store,dataDir:f.dataDir,toMediaUrl:f.toMediaUrl,integration:{ttsStatus:keyless.status,getCachedSpeech:keyless.getCachedSpeech,synthesizeSpeech:keyless.synthesizeSpeech,estimateTtsCost:keyless.estimateTtsCost}});
    const before=f.store.read();assert.equal((await restarted.getStatus(pack.id)).status,'ready');assert.equal((await restarted.start(pack.id)).status,'ready');assert.deepEqual(f.store.read(),before);assert.equal(requests,2);
  }finally{await restarted?.close();await f.cleanup();}
});

test('missing configuration and a different selected provider cannot trigger fallback or a new reservation',async()=>{
  for(const provider of ['keyless','azure'] as const){
    let requests=0;const f=await fixture(async()=>{requests++;return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});},provider==='keyless'?{ELEVENLABS_VOICE_ID:'mock_voice'}:{...settings});
    try{
      if(provider==='azure')f.integration.ttsStatus=()=>({provider:'azure',configured:true,available:true,status:'verified',detail:'explicit alternate'});
      const pack=f.pack();await f.manager.start(pack.id);const status=await completed(f.manager,pack.id);assert.equal(status.status,'error');assert.match(status.error!,/ElevenLabs/);assert.equal(requests,0);assert.equal(f.store.read().charges.length,0);
    }finally{await f.cleanup();}
  }
});

test('shared ElevenLabs file and streaming owners are not charged a second time by the manager',async()=>{
  for(const owner of ['file','stream'] as const){
    const gate=deferred(),entered=deferred();let requests=0;
    const f=await fixture(async()=>{requests++;entered.resolve();await gate.promise;return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
    try{
      const pack=f.pack(['book']);let ownerCharge:string|undefined;
      const values={...requestInput(f.dataDir,'book'),beforeRequest:()=>{ownerCharge=f.store.reserve('tts',f.provider.estimateTtsCost('book'),4);}};
      const ownerResult=owner==='file'?f.provider.synthesizeSpeech(values):f.provider.streamSpeech(values);await entered.promise;
      await f.manager.start(pack.id);assert.equal(f.store.read().charges.length,1);gate.resolve();
      if(owner==='file'){const result=await ownerResult;assert.ok('costCny'in result);f.store.settle(ownerCharge!,result.costCny as number);}
      else{const stream=await ownerResult;assert.ok('stream'in stream);for await(const _bytes of (stream as Awaited<ReturnType<typeof f.provider.streamSpeech>>).stream){}const result=await (stream as Awaited<ReturnType<typeof f.provider.streamSpeech>>).completed;f.store.settle(ownerCharge!,result.costCny);}
      assert.equal((await completed(f.manager,pack.id)).status,'ready');assert.equal(requests,1);assert.equal(f.store.read().charges.length,1);
    }finally{gate.resolve();await f.cleanup();}
  }
});

test('manager request owner charges once when a foreground file waiter joins',async()=>{
  const gate=deferred(),entered=deferred();let requests=0,foregroundReservations=0;
  const f=await fixture(async()=>{requests++;entered.resolve();await gate.promise;return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
  try{
    const pack=f.pack(['book']);await f.manager.start(pack.id);await entered.promise;
    const foreground=f.provider.synthesizeSpeech({...requestInput(f.dataDir,'book'),beforeRequest:()=>{foregroundReservations++;}});await new Promise(done=>setImmediate(done));gate.resolve();
    const result=await foreground;assert.equal(result.cached,true);assert.equal(result.costCny,0);assert.equal((await completed(f.manager,pack.id)).status,'ready');assert.equal(foregroundReservations,0);assert.equal(requests,1);assert.equal(f.store.read().charges.length,1);
  }finally{gate.resolve();await f.cleanup();}
});

test('a term or pack membership edit during generation cannot mark a stale snapshot ready or start another word',async()=>{
  for(const change of ['term','membership'] as const){
    const gate=deferred(),entered=deferred();let requests=0;
    const f=await fixture(async()=>{requests++;entered.resolve();await gate.promise;return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
    try{
      const pack=f.pack();await f.manager.start(pack.id);await entered.promise;
      f.store.mutate(data=>{const word=data.words.find(word=>word.packId===pack.id)!;if(change==='term')word.term='new book';else data.words.push({...word,id:'qa-added-word',term:'new book'});});gate.resolve();
      const status=await completed(f.manager,pack.id);assert.notEqual(status.status,'ready');assert.equal(requests,1);assert.ok(f.store.read().charges[0].actual!>0,'known completed provider usage is settled despite an edit');
      if(change==='term')assert.equal(status.words[0].term,'new book');
    }finally{gate.resolve();await f.cleanup();}
  }
});

test('parallel picture approval, meaning edits, pack title and enablement do not stop exact English audio preparation',async()=>{
  const entered=deferred(),gate=deferred();let requests=0;
  const f=await fixture(async()=>{requests++;if(requests===1){entered.resolve();await gate.promise;}return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});});
  try{
    const pack=f.pack();await f.manager.start(pack.id);await entered.promise;
    f.store.mutate(data=>{const item=data.packs.find(item=>item.id===pack.id)!;item.enabled=true;item.title='家长确认的新标题';for(const word of data.words.filter(word=>word.packId===pack.id)){word.meaning='家长确认词义';word.assetStatus='approved';word.imageUrl='/assets/words/apple.svg';word.learningVersion=2;}});
    gate.resolve();const status=await completed(f.manager,pack.id);assert.equal(status.status,'ready');assert.equal(status.cached,2);assert.equal(requests,2);assert.equal(f.store.read().charges.length,2);
  }finally{gate.resolve();await f.cleanup();}
});

test('cancel during the initial cache scan and close drain before returning without a late request',async()=>{
  const f=await fixture();const gate=deferred(),entered=deferred();
  try{
    const pack=f.pack(['book']);f.integration.getCachedSpeech=async()=>{entered.resolve();await gate.promise;return undefined;};
    const start=f.manager.start(pack.id);await entered.promise;let closed=false;
    const closing=f.manager.close().then(()=>{closed=true;});await new Promise(done=>setImmediate(done));assert.equal(closed,false);gate.resolve();await closing;
    assert.equal((await start).status,'stopped');assert.equal(f.store.read().charges.length,0);assert.equal(f.manager.busy(),false);
    await assert.rejects(f.manager.start(pack.id),(error:any)=>error.code==='PACK_AUDIO_CLOSED');
  }finally{gate.resolve();await f.cleanup();}
});

test('close aborts a request and restart only scans; incomplete cache never silently resumes paid work',async()=>{
  const entered=deferred();let requests=0;const f=await fixture(async(_url,init)=>{requests++;entered.resolve();return new Promise<Response>((_done,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});});
  let restarted:ReturnType<typeof createPackAudioManager>|undefined;
  try{
    const pack=f.pack();await f.manager.start(pack.id);await entered.promise;await f.manager.close();assert.equal(f.manager.busy(),false);
    restarted=createPackAudioManager({store:f.store,integration:f.integration,dataDir:f.dataDir,toMediaUrl:f.toMediaUrl});const status=await restarted.getStatus(pack.id);assert.equal(status.status,'idle');assert.equal(status.cached,0);assert.equal(requests,1);assert.equal(f.store.read().charges[0].actual,undefined);
  }finally{await restarted?.close();await f.cleanup();}
});

test('empty/missing/invalid packs are explicit and a rejected media path cannot establish ready',async()=>{
  const f=await fixture();
  try{
    await assert.rejects(f.manager.getStatus('missing'),(error:any)=>error.code==='PACK_AUDIO_NOT_FOUND');await assert.rejects(f.manager.start('missing'),(error:any)=>error.code==='PACK_AUDIO_NOT_FOUND');
    const empty=f.pack(['book']);f.store.mutate(data=>{data.words=data.words.filter(word=>word.packId!==empty.id);});assert.equal((await f.manager.start(empty.id)).status,'error');assert.equal(f.manager.busy(),false);
    const bad=f.pack(['tree']);f.store.mutate(data=>{data.words.find(word=>word.packId===bad.id)!.term=' ';});assert.equal((await f.manager.start(bad.id)).status,'error');
    const unsafe=f.pack(['fish']);f.integration.getCachedSpeech=async()=>'/outside/project.mp3';const status=await f.manager.getStatus(unsafe.id);assert.equal(status.status,'error');assert.equal(status.cached,0);assert.equal(f.store.read().charges.length,0);
  }finally{await f.cleanup();}
});

test('arbitrary provider errors are safe, no local fallback response counts as cached readiness',async()=>{
  const f=await fixture();
  try{
    const pack=f.pack(['book']);f.integration.synthesizeSpeech=async()=>{throw new Error('Bearer '+settings.ELEVENLABS_API_KEY);};await f.manager.start(pack.id);const failure=await completed(f.manager,pack.id);assert.equal(failure.status,'error');assert.ok(!failure.error!.includes(settings.ELEVENLABS_API_KEY));
    f.integration.synthesizeSpeech=async()=>({mode:'local',cached:false,costCny:0});await f.manager.start(pack.id);assert.equal((await completed(f.manager,pack.id)).status,'error');assert.equal(f.store.read().charges.length,0);
  }finally{await f.cleanup();}
});
