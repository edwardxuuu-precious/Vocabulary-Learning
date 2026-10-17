import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import type { ImageReviewSelection } from '../shared/contracts.ts';
import { visualTheme } from '../shared/visual-theme.ts';

async function fixture(configured=true,slow=false,probeGate?:Promise<void>){
  const dataDir=await mkdtemp(join(tmpdir(),'word-pack-image-api-'));
  await mkdir(join(dataDir,'speech'));const audio=join(dataDir,'speech','mock.mp3');await writeFile(audio,Buffer.concat([Buffer.from('ID3'),Buffer.alloc(50)]));
  const codex={configured,available:false,status:'test_mock',detail:'mock image provider only',provider:'codex' as const},none={configured:false,available:false,status:'mock',detail:'not configured'};
  let requests=0,running=0,maxRunning=0,fail=false;
  const app=createApp({dataDir,dialogue:{status:async()=>none,turn:async()=>{throw Error('must stay disabled');},cancel(){},reset:async()=>{},close:async()=>{}},integrations:{
    probeIntegrations:async()=>{await probeGate;return{speech:{...none,provider:'elevenlabs'},tts:{...none,provider:'elevenlabs'},codex};},ttsStatus:()=>({...none,provider:'elevenlabs'}),
    getCachedSpeech:async()=>audio,synthesizeSpeech:async()=>{throw Error('must use mock cache');},
    generateIllustration:async input=>{
      requests++;running++;maxRunning=Math.max(running,maxRunning);
      try{
        if(slow)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,1000);input.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Object.assign(Error('cancelled'),{code:'CANCELLED'}));},{once:true});});
        if(fail)throw Object.assign(Error('mock quota stop'),{code:'CODEX_RATE_LIMIT'});
        await mkdir(input.outputDir,{recursive:true});const filePath=join(input.outputDir,'fixture.png');
        await writeFile(filePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8y8AAAAASUVORK5CYII=','base64'));
        return{filePath};
      }finally{running--;}
    },
  }});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+(app.server.address() as {port:number}).port;
  async function request(route:string,method='GET',body?:unknown){const response=await fetch(base+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json()};}
  async function waitPack(id:string,stop=['queued','running']){for(let i=0;i<200;i++){const value=(await request(`/api/packs/${id}/images`)).body;if(!stop.includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('image fixture did not settle');}
  const selection=(packId:string):ImageReviewSelection[]=>app.store.read().words.filter(word=>word.packId===packId&&word.assetStatus==='review').map(word=>({wordId:word.id,term:word.term,meaning:word.meaning,imageUrl:word.imageUrl,learningVersion:word.learningVersion??0}));
  return{...app,request,waitPack,selection,requests:()=>requests,maxRunning:()=>maxRunning,fail:(value:boolean)=>{fail=value;},async cleanup(){await app.close();assert.ok(dataDir.startsWith(join(tmpdir(),'word-pack-image-api-')));await rm(dataDir,{recursive:true,force:true});}};
}

test('theme selection is validated; a newly themed sample-matching word generates a review proposal without changing the sample',async()=>{
  const f=await fixture();try{
    const original=f.store.read().words.find(word=>word.id==='starter-apple');
    const invalid=await f.request('/api/packs','POST',{title:'过期主题',rows:[{term:'apple',meaning:'苹果'}],imageTheme:'stale-theme'});
    assert.equal(invalid.status,409);assert.equal(f.requests(),0);assert.equal(f.store.read().packs.length,1);
    const created=await f.request('/api/packs','POST',{title:'机甲苹果',rows:[{term:'apple',meaning:'苹果'}],imageTheme:visualTheme.id});
    const pack=created.body.packs.find((item:{isSample?:boolean})=>!item.isSample);
    assert.equal((await f.waitPack(pack.id)).status,'review');assert.equal(f.requests(),1);
    const word=f.store.read().words.find(word=>word.packId===pack.id)!;
    assert.equal(word.assetStatus,'review');assert.equal(word.imageTheme,visualTheme.id);assert.equal(pack.enabled,false);
    assert.deepEqual(f.store.read().words.find(word=>word.id==='starter-apple'),original);
  }finally{await f.cleanup();}
});

test('confirmed pack automatically generates missing pictures serially and waits for explicit parent review and enable',async()=>{
  const f=await fixture();try{
    const created=await f.request('/api/packs','POST',{title:'自动备图',rows:[{term:'book',meaning:'书'},{term:'tree',meaning:'树'}]});assert.equal(created.status,200);
    const pack=created.body.packs.find((pack:{isSample?:boolean})=>!pack.isSample);
    const status=await f.waitPack(pack.id);assert.equal(status.status,'review',JSON.stringify({status,jobs:f.store.read().jobs,words:f.store.read().words.filter(word=>word.packId===pack.id)}));assert.equal(status.reviewing,2);assert.equal(status.approved,0);
    assert.equal(f.requests(),2);assert.equal(f.maxRunning(),1);assert.equal(f.store.read().packs.find(item=>item.id===pack.id)?.enabled,false);
    assert.deepEqual((await f.request('/api/session/start','POST')).body.wordIds,[]);
    const selections=f.selection(pack.id);assert.equal(selections.length,2);
    const stale=selections.map((item,index)=>index===1?{...item,imageUrl:'/media/stale.svg'}:item);
    const rejected=await f.request(`/api/packs/${pack.id}/images/approve`,'POST',{selections:stale});assert.equal(rejected.status,409);
    assert.equal(f.store.read().words.filter(word=>word.packId===pack.id&&word.assetStatus==='review').length,2);
    const accepted=await f.request(`/api/packs/${pack.id}/images/approve`,'POST',{selections});assert.equal(accepted.status,200);
    assert.equal((await f.request(`/api/packs/${pack.id}/images/approve`,'POST',{selections})).status,200);
    assert.equal((await f.request(`/api/packs/${pack.id}/images`)).body.status,'ready');
    assert.equal((await f.request(`/api/packs/${pack.id}`,'PATCH',{enabled:true})).status,200);
    const session=(await f.request('/api/session/start','POST')).body;assert.equal(session.wordIds.length,2);
    assert.ok(session.wordIds.every((id:string)=>f.store.read().words.find(word=>word.id===id)?.packId===pack.id));
  }finally{await f.cleanup();}
});

test('missing OAuth and provider failure preserve the confirmed pack; state reads never retry generation',async()=>{
  const missing=await fixture(false);try{
    const response=await missing.request('/api/packs','POST',{title:'待登录',rows:[{term:'book',meaning:'书'}]});const pack=response.body.packs.find((p:{isSample?:boolean})=>!p.isSample);
    assert.equal((await missing.waitPack(pack.id)).status,'error');assert.equal(missing.requests(),0);
    await missing.request(`/api/packs/${pack.id}/images`);assert.equal(missing.requests(),0);assert.equal(missing.store.read().packs.length,2);
  }finally{await missing.cleanup();}
  const f=await fixture();try{
    f.fail(true);const response=await f.request('/api/packs','POST',{title:'额度错误',rows:[{term:'book',meaning:'书'},{term:'tree',meaning:'树'}]});const pack=response.body.packs.find((p:{isSample?:boolean})=>!p.isSample);
    assert.equal((await f.waitPack(pack.id)).status,'error');assert.equal(f.requests(),1);
    await f.request('/api/state');await f.request(`/api/packs/${pack.id}/images`);assert.equal(f.requests(),1);
    f.fail(false);await f.request(`/api/packs/${pack.id}/images`,'POST');assert.equal((await f.waitPack(pack.id)).reviewing,2);assert.equal(f.requests(),3);
  }finally{await f.cleanup();}
});

test('pack cancellation stops the current provider and queued words without approving pictures or granting rewards',async()=>{
  const f=await fixture(true,true);try{
    const created=await f.request('/api/packs','POST',{title:'可停止',rows:[{term:'book',meaning:'书'},{term:'tree',meaning:'树'}]});const pack=created.body.packs.find((p:{isSample?:boolean})=>!p.isSample);
    for(let i=0;i<100&&!f.requests();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.requests(),1);
    assert.equal((await f.request(`/api/packs/${pack.id}/images/cancel`,'POST')).body.status,'stopped');
    assert.equal(f.requests(),1);assert.ok(f.store.read().words.filter(word=>word.packId===pack.id).every(word=>word.assetStatus!=='approved'));
    assert.equal(f.store.read().stickers.length,0);assert.equal(f.store.read().packs.find(item=>item.id===pack.id)?.enabled,false);
  }finally{await f.cleanup();}
});

test('cancel during the OAuth status check prevents a late illustration dispatch',async()=>{
  let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});const f=await fixture(true,false,gate);
  try{
    const creation=f.request('/api/packs','POST',{title:'检查时取消',rows:[{term:'book',meaning:'书'}]});
    let id:string|undefined;
    for(let i=0;i<100&&!id;i++){id=f.store.read().packs.find(pack=>!pack.isSample)?.id;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.ok(id);
    for(let i=0;i<100;i++){const status=(await f.request(`/api/packs/${id}/images`)).body;if(status.currentWordId)break;await new Promise(resolve=>setTimeout(resolve,5));}
    const cancellation=f.request(`/api/packs/${id}/images/cancel`,'POST');
    for(let i=0;i<100;i++){if((await f.request(`/api/packs/${id}/images`)).body.status==='stopped')break;await new Promise(resolve=>setTimeout(resolve,5));}
    release();assert.equal((await cancellation).body.status,'stopped');assert.equal((await creation).status,200);
    assert.equal(f.requests(),0);assert.equal(f.store.read().jobs.length,0);
  }finally{release();await f.cleanup();}
});
