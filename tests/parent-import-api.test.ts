import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';

async function fixture() {
  const dataDir=await mkdtemp(join(tmpdir(),'word-parent-import-'));
  await mkdir(join(dataDir,'speech'));
  const cache=new Map<string,string>(); let calls=0, fail=false;
  const tts={configured:true,available:false,provider:'elevenlabs' as const,status:'test_only',detail:'模拟，非真实云验证'};
  const none={configured:false,available:false,status:'test_only',detail:'模拟'};
  async function put(term:string){const file=join(dataDir,'speech',encodeURIComponent(term)+'.mp3');await writeFile(file,Buffer.concat([Buffer.from('ID3'),Buffer.alloc(50)]));cache.set(term,file);return file;}
  const app=createApp({dataDir,dialogue:{status:async()=>none,turn:async()=>{throw Error('not used');},cancel(){},reset:async()=>{},close:async()=>{}},integrations:{
    probeIntegrations:async()=>({speech:tts,tts,codex:none}),ttsStatus:()=>tts,
    getCachedSpeech:async input=>{assert.equal(input.locale,'en-US');assert.equal(input.tone,'clear');return cache.get(input.text);},
    estimateTtsCost:()=>0.01,synthesizeSpeech:async input=>{input.beforeRequest?.();calls++;if(fail)throw Object.assign(Error('mock quota'),{code:'SPEECH_QUOTA_EXCEEDED'});const filePath=await put(input.text);return{filePath,mode:'api',cached:false,costCny:0.01};},
  }});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(app.server.address() as {port:number}).port;
  async function request(path:string,method='GET',body?:unknown){const response=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json()};}
  async function settled(id:string){for(let i=0;i<100;i++){const result=(await request(`/api/packs/${id}/audio`)).body;if(result.status!=='running')return result;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('mock job did not settle');}
  return{...app,request,put,cache,settled,calls:()=>calls,fail:(value:boolean)=>{fail=value;},async cleanup(){await app.close();assert.ok(dataDir.startsWith(join(tmpdir(),'word-parent-import-')));await rm(dataDir,{recursive:true,force:true});}};
}

test('default sample stays outside learning; preview validates plain paste without saving or spending; invalid confirmation is atomic',async()=>{
  const f=await fixture();try{
    assert.equal(f.store.read().packs[0].isSample,true);assert.equal(f.store.read().packs[0].enabled,false);
    assert.deepEqual((await f.request('/api/session/start','POST')).body.wordIds,[]);
    const before=f.store.read();
    const preview=await f.request('/api/import/preview','POST',{text:'apple 苹果\nice cream 冰淇淋'});
    assert.deepEqual(preview.body.rows,[{term:'apple',meaning:'苹果'},{term:'ice cream',meaning:'冰淇淋'}]);assert.deepEqual(preview.body.errors,[]);
    assert.deepEqual(f.store.read(),before);assert.equal(f.calls(),0);
    const invalid=await f.request('/api/packs','POST',{title:'重复词',rows:[{term:'cat',meaning:'猫'},{term:'Cat',meaning:'猫'}]});
    assert.equal(invalid.status,400);assert.equal(f.store.read().packs.length,1);assert.equal(f.calls(),0);
  }finally{await f.cleanup();}
});

test('parent-confirmed cached list activates only its words and does not charge for sample cache reuse',async()=>{
  const f=await fixture();try{
    await f.put('apple');await f.put('cat');f.store.updateSettings({monthlyBudgetCny:0});
    const created=await f.request('/api/packs','POST',{title:'家长指定两词',rows:[{term:'apple',meaning:'苹果'},{term:'cat',meaning:'猫'}]});
    assert.equal(created.status,200);const pack=created.body.packs.find((p:{isSample?:boolean})=>!p.isSample);
    assert.ok(pack.confirmedAt);assert.equal(pack.enabled,false);
    const ready=await f.settled(pack.id);assert.equal(ready.status,'ready');assert.equal(ready.cached,2);assert.equal(f.calls(),0);
    assert.deepEqual((await f.request('/api/session/start','POST')).body.wordIds,[]);
    const enabled=await f.request(`/api/packs/${pack.id}`,'PATCH',{enabled:true});assert.equal(enabled.status,200);assert.equal(enabled.body.packs.find((p:{id:string})=>p.id==='starter').enabled,false);
    const session=(await f.request('/api/session/start','POST')).body;
    assert.equal(session.wordIds.length,2);assert.ok(session.wordIds.every((id:string)=>f.store.read().words.find(word=>word.id===id)?.packId===pack.id));
    assert.equal(f.store.read().charges.length,0);
    assert.equal((await f.request(`/api/packs/${pack.id}/audio`,'POST')).body.status,'ready');assert.equal(f.calls(),0);
  }finally{await f.cleanup();}
});

test('quota failure preserves confirmed list and successes; explicit retry fills missing audio, activation requires approved images and cached audio',async()=>{
  const f=await fixture();try{
    await f.put('apple');f.fail(true);
    const created=await f.request('/api/packs','POST',{title:'失败后可继续',rows:[{term:'apple',meaning:'苹果'},{term:'book',meaning:'书'}]});
    assert.equal(created.status,200);const pack=created.body.packs.find((p:{isSample?:boolean})=>!p.isSample);
    let audio=await f.settled(pack.id);assert.equal(audio.status,'error');assert.equal(audio.cached,1);assert.equal(f.calls(),1);
    assert.equal(f.store.read().packs.find(p=>p.id===pack.id)?.enabled,false);
    assert.equal(f.store.read().charges.length,1);assert.equal(f.store.read().charges[0].actual,undefined);
    // A missing audio file cannot be bypassed through the pack activation endpoint.
    f.cache.delete('apple');const pending=await f.request(`/api/packs/${pack.id}`,'PATCH',{enabled:true});assert.equal(pending.status,400);assert.equal(pending.body.code,'PACK_AUDIO_PENDING');
    f.fail(false);await f.put('apple');await f.request(`/api/packs/${pack.id}/audio`,'POST');audio=await f.settled(pack.id);
    assert.equal(audio.status,'ready');assert.equal(audio.cached,2);assert.equal(f.calls(),2);
    assert.equal((await f.request(`/api/packs/${pack.id}`,'PATCH',{enabled:true})).status,200);
    const book=f.store.read().words.find(w=>w.packId===pack.id&&w.term==='book')!;
    assert.equal((await f.request(`/api/words/${book.id}`,'PATCH',{assetStatus:'approved'})).status,400);
    const unpictured=await f.request('/api/packs','POST',{title:'尚未准备图片',rows:[{term:'book',meaning:'书'}]});
    const other=unpictured.body.packs.filter((p:{isSample?:boolean})=>!p.isSample).at(-1);
    assert.equal((await f.request(`/api/packs/${other.id}`,'PATCH',{enabled:true})).body.code,'PACK_IMAGES_PENDING');
    const replay=(await f.request(`/api/packs/${pack.id}/audio`,'POST')).body;assert.equal(replay.cached,2);assert.equal(f.calls(),2);
  }finally{await f.cleanup();}
});
