import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp, type AppOptions } from '../server/index.ts';
const unavailable={configured:false,available:false,status:'unconfigured',detail:'test'};
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
async function fixture(dialogue:AppOptions['dialogue']){
  const directory=mkdtempSync(join(tmpdir(),'word-prepare-'));
  const app=createApp({chatEnabled:true,dataDir:directory,dialogue,integrations:{probeIntegrations:async()=>({speech:unavailable,codex:unavailable})}});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+(app.server.address() as {port:number}).port;
  const post=(route:string,body:unknown,origin?:string)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  return {app,post,async close(){await app.close();if(resolve(directory).startsWith(resolve(tmpdir())+'\\word-prepare-')||resolve(directory).startsWith(resolve(tmpdir())+'/word-prepare-'))rmSync(directory,{recursive:true,force:true});}};
}
function fake(extra:Partial<NonNullable<AppOptions['dialogue']>>={}):NonNullable<AppOptions['dialogue']>{return {status:async()=>unavailable,turn:async()=>({conversationId:'owned',reply:{text:'我在听。',tone:'gentle',action:{type:'none'}}}),cancel(){},reset:async()=>{},close:async()=>{},...extra};}

test('microphone preparation enforces same origin and bounded identifiers, never generating or changing child facts or charges',async()=>{
  let prepared=0,turns=0;
  const f=await fixture(fake({prepareTurn:async()=>{prepared++;},turn:async()=>{turns++;throw new Error('must not infer');}}));
  try{
    const before=f.app.store.read();
    assert.equal((await f.post('/api/chat/prepare',{preparationId:'p1'},'https://external.example')).status,403);
    assert.equal((await f.post('/api/chat/prepare',{preparationId:'p1',message:'not allowed'})).status,400);
    assert.equal((await f.post('/api/chat/prepare',{preparationId:'../bad'})).status,400);
    assert.equal((await f.post('/api/chat/prepare',{preparationId:'p1',conversationId:12})).status,400);
    assert.deepEqual(await(await f.post('/api/chat/prepare',{preparationId:'p1',conversationId:'owned'})).json(),{prepared:true});
    assert.equal(prepared,1);assert.equal(turns,0);
    const after=f.app.store.read();assert.deepEqual(after.profile,before.profile);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.charges,before.charges);
  }finally{await f.close();}
});

test('cancel-before-prepare blocks a late request, and stale lease cancellation cannot release a newer microphone',async()=>{
  let prepared=0,cancelled=0;
  const f=await fixture(fake({prepareTurn:async()=>{prepared++;},cancelPreparation:async()=>{cancelled++;}}));
  try{
    await f.post('/api/chat/prepare/cancel',{preparationId:'old'});
    assert.deepEqual(await(await f.post('/api/chat/prepare',{preparationId:'old'})).json(),{prepared:false});
    await f.post('/api/chat/prepare',{preparationId:'new'});
    await f.post('/api/chat/prepare/cancel',{preparationId:'old'});
    assert.equal(prepared,1);assert.equal(cancelled,0);
    await f.post('/api/chat/prepare/cancel',{preparationId:'new'});assert.equal(cancelled,1);
  }finally{await f.close();}
});

test('a real turn takes over pending restoration without waiting for its HTTP request, and late cancellation cannot interrupt it',async()=>{
  const restoring=gate(),entered=gate(),turnEntered=gate();let cancelled=0;
  const f=await fixture(fake({prepareTurn:async()=>{entered.release();await restoring.promise;},cancelPreparation:async()=>{cancelled++;},turn:async()=>{turnEntered.release();await restoring.promise;return {conversationId:'owned',reply:{text:'你喜欢什么呀？',tone:'curious',action:{type:'none'}}};}}));
  try{
    const pending=f.post('/api/chat/prepare',{preparationId:'shared',conversationId:'owned'});await entered.promise;
    const response=await f.post('/api/chat/turn',{message:'你好',context:{screen:'interest'}});await turnEntered.promise;
    await f.post('/api/chat/prepare/cancel',{preparationId:'shared'});assert.equal(cancelled,0);
    assert.deepEqual(await(await f.post('/api/chat/prepare',{preparationId:'other'})).json(),{prepared:false});
    restoring.release();assert.match(await response.text(),/"type":"reply"/);assert.equal((await pending).status,200);assert.equal(cancelled,0);
  }finally{restoring.release();await f.close();}
});
