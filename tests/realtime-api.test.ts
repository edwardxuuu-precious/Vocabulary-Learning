import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createApp, type AppOptions } from '../server/index.ts';
import { attachLiveVoice, type LiveVoiceOptions } from '../server/live-voice.ts';
import type { ChatReply, ServiceStatus, VoiceServerMessage } from '../shared/contracts.ts';
import type { LiveSttSessionInput } from '../server/integrations/speech-router.ts';

const configured: ServiceStatus = { configured:true, available:false, status:'test_transport', provider:'elevenlabs', detail:'模拟，仅测试接线' };
const notConfigured: ServiceStatus = { configured:false, available:false, status:'unconfigured', detail:'未配置' };
const reply: ChatReply = { text:'我记对了吗？', tone:'curious', action:{type:'propose_interest',interest:'我喜欢挖掘机'} };
async function fixture(options: Partial<AppOptions> = {}) {
  const dir=mkdtempSync(join(tmpdir(),'word-realtime-'));
  mkdirSync(join(dir,'speech'));const mockAudio=join(dir,'speech','apple.mp3');writeFileSync(mockAudio,Buffer.concat([Buffer.from('ID3'),Buffer.alloc(50)]));
  let sent=0;
  const app=createApp({chatEnabled:true,dataDir:dir,dialogue:{status:async()=>({...configured,provider:'codex'}),turn:async(input,events)=>{events?.onStatus?.('thinking');return {conversationId:'test_conversation',reply:{...reply,action:{type:'propose_interest',interest:input.message}}};},cancel(){},reset:async()=>{},close:async()=>{}},integrations:{probeIntegrations:async()=>({speech:notConfigured,stt:configured,tts:notConfigured,codex:notConfigured}),estimateSttCost:s=>s*0.001,createLiveSttSession:async(input:LiveSttSessionInput)=>{
    queueMicrotask(()=>input.onEvent({type:'ready'}));
    return {sendAudio(audio:Buffer){sent+=audio.length;input.onEvent({type:'transcript',text:'我喜欢',final:true});},finish(){input.onUsage?.(sent/32000);input.onEvent({type:'endpoint',text:'我喜欢挖掘机'});},cancel(){input.onUsage?.(sent/32000);}};
  },getCachedSpeech:async input=>input.text==='apple'?mockAudio:undefined,ttsStatus:()=>({...notConfigured,provider:'elevenlabs'}),synthesizeSpeech:async()=>{throw Error('mock only; no cloud generation in realtime API tests');}},...options});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  return {...app,base,closeFixture:async()=>{await app.close();if(dir.startsWith(join(tmpdir(),'word-realtime-')))rmSync(dir,{recursive:true,force:true});}};
}
async function connect(base:string,origin=base){
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/voice/stream',{headers:{Origin:origin}});
  const events:VoiceServerMessage[]=[];const waiters=new Set<()=>void>();
  ws.on('message',data=>{events.push(JSON.parse(data.toString()));for(const fn of waiters)fn();});
  await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const next=(type:VoiceServerMessage['type'])=>new Promise<VoiceServerMessage>((resolve,reject)=>{
    const timer=setTimeout(()=>{waiters.delete(check);reject(new Error(`missing ${type}`));},3000);
    const check=()=>{const found=events.find(e=>e.type===type);if(found){clearTimeout(timer);waiters.delete(check);resolve(found);}};waiters.add(check);check();
  });
  return {ws,events,next};
}

test('local PCM stream emits partial and endpoint, settles actual usage, and never saves interests',async()=>{
  const app=await fixture();
  try{
    const client=await connect(app.base);
    client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await client.next('ready');
    client.ws.send(Buffer.alloc(3200));assert.deepEqual(await client.next('transcript'),{type:'transcript',text:'我喜欢',final:true});
    client.ws.send(JSON.stringify({type:'finish'}));assert.deepEqual(await client.next('endpoint'),{type:'endpoint',text:'我喜欢挖掘机'});await client.next('closed');
    assert.equal(app.store.read().charges.length,1);assert.equal(app.store.read().charges[0].units,0.1);assert.equal(app.store.read().charges[0].actual,0.0001);assert.deepEqual(app.store.read().profile.interests,[]);
  }finally{await app.closeFixture();}
});
test('stream rejects cross-site origin and invalid audio before start',async()=>{
  const app=await fixture();try{
    await assert.rejects(connect(app.base,'https://example.com'),/403/);
    const client=await connect(app.base);client.ws.send(Buffer.alloc(8));const e=await client.next('error');assert.equal(e.type==='error'&&e.code,'STT_NOT_READY');assert.equal(app.store.read().charges.length,0);
  }finally{await app.closeFixture();}
});
test('stream enforces single microphone and monthly budget before provider use',async()=>{
  const app=await fixture();try{
    const first=await connect(app.base);first.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await first.next('ready');
    const second=await connect(app.base);second.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));const e=await second.next('error');assert.equal(e.type==='error'&&e.code,'STT_BUSY');
    first.ws.send(JSON.stringify({type:'cancel'}));await first.next('closed');
    app.store.updateSettings({monthlyBudgetCny:0});const third=await connect(app.base);third.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));const budget=await third.next('error');assert.equal(budget.type==='error'&&budget.code,'BUDGET_EXCEEDED');
  }finally{await app.closeFixture();}
});

test('ElevenLabs input uses the generic factory and quota failures never invoke the legacy microphone provider',async()=>{
  let genericCalls=0,legacyCalls=0;
  const app=await fixture({integrations:{probeIntegrations:async()=>({speech:notConfigured,stt:configured,tts:notConfigured,codex:notConfigured}),estimateSttCost:s=>s*0.001,
    createLiveSttSession:async()=>{genericCalls++;throw Object.assign(new Error('provider quota, never expose raw credentials'),{code:'SPEECH_RATE_LIMIT'});},
    createSonioxSession:async()=>{legacyCalls++;throw new Error('legacy must not run');},
  }});
  try{
    const client=await connect(app.base);client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));const error=await client.next('error');
    assert.equal(error.type==='error'&&error.code,'SPEECH_RATE_LIMIT');
    assert.ok(error.type==='error'&&/额度|频率/.test(error.message));assert.ok(error.type==='error'&&!/Soniox|充值|credentials|provider quota/.test(error.message));
    assert.equal(genericCalls,1);assert.equal(legacyCalls,0);assert.equal(app.store.read().charges.length,1);assert.equal(app.store.read().charges[0].actual,undefined);
    assert.deepEqual(app.store.read().profile.interests,[]);assert.equal(app.store.read().attempts.length,0);
  }finally{await app.closeFixture();}
});

test('an unconfigured input provider stops before budget reservation or opening any paid stream',async()=>{
  let calls=0;
  const app=await fixture({integrations:{probeIntegrations:async()=>({speech:notConfigured,stt:{...notConfigured,provider:'elevenlabs'},tts:notConfigured,codex:notConfigured}),createLiveSttSession:async()=>{calls++;throw new Error('must not call');}}});
  try{
    const client=await connect(app.base);client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));const error=await client.next('error');
    assert.equal(error.type==='error'&&error.code,'STT_CONFIG');assert.ok(error.type==='error'&&!/Soniox|充值/.test(error.message));assert.equal(calls,0);assert.equal(app.store.read().charges.length,0);
  }finally{await app.closeFixture();}
});
test('SSE dialogue returns only validated proposal and leaves authority state untouched',async()=>{
  const app=await fixture();try{
    const response=await fetch(app.base+'/api/chat/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'我喜欢挖掘机',context:{screen:'interest'}})});
    assert.match(response.headers.get('content-type')??'',/text\/event-stream/);const body=await response.text();assert.match(body,/"type":"status"/);assert.match(body,/"type":"reply"/);assert.match(body,/"type":"done"/);assert.deepEqual(app.store.read().profile.interests,[]);assert.equal(app.store.read().attempts.length,0);
    const invalid=await fetch(app.base+'/api/chat/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'你好',context:{screen:'other'}})});assert.equal(invalid.status,400);
  }finally{await app.closeFixture();}
});
test('untrusted model action is blocked at HTTP boundary and never becomes a reply',async()=>{
  const app=await fixture({dialogue:{status:async()=>notConfigured,turn:async()=>({conversationId:'test',reply:{text:'好的',tone:'cheerful',action:{type:'exec',command:'bad'}} as unknown as ChatReply}),cancel(){},reset:async()=>{},close:async()=>{}}});try{
    const response=await fetch(app.base+'/api/chat/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'你好',context:{screen:'interest'}})});const body=await response.text();assert.match(body,/CODEX_REPLY_INVALID/);assert.doesNotMatch(body,/"type":"reply"/);assert.equal(app.store.read().attempts.length,0);
  }finally{await app.closeFixture();}
});

test('cancel and socket disconnect abort an unresolved upstream open immediately, settle known zero, and cancel a late handle',async()=>{
  for(const mode of ['cancel','disconnect'] as const){
    let release!:(session:{sendAudio(audio:Buffer):void;finish():void;cancel():void})=>void,entered!:()=>void,aborted!:()=>void;
    const opening=new Promise<void>(resolve=>{entered=resolve;}),abortSeen=new Promise<void>(resolve=>{aborted=resolve;});
    let providerOwnsSocket=true,lateCancelled=0;
    const app=await fixture({integrations:{probeIntegrations:async()=>({speech:notConfigured,stt:configured,tts:notConfigured,codex:notConfigured}),estimateSttCost:s=>s*0.001,createLiveSttSession:async(input:LiveSttSessionInput)=>{
      input.signal!.addEventListener('abort',()=>{providerOwnsSocket=false;input.onUsage?.(0);aborted();},{once:true});
      entered();return new Promise(resolve=>{release=resolve;});
    }}});
    try{
      const client=await connect(app.base);client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await opening;
      const contender=await connect(app.base);contender.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));const busy=await contender.next('error');assert.equal(busy.type==='error'&&busy.code,'STT_BUSY');assert.equal(app.store.read().charges.length,1);
      if(mode==='cancel')client.ws.send(JSON.stringify({type:'cancel'}));else client.ws.close();
      await abortSeen;assert.equal(providerOwnsSocket,false,mode);if(mode==='cancel')await client.next('closed');
      assert.equal(app.store.read().charges[0].units,0,mode);assert.equal(app.store.read().charges[0].actual,0,mode);
      release({sendAudio(){},finish(){},cancel(){lateCancelled++;}});
      await new Promise(resolve=>setImmediate(resolve));assert.equal(lateCancelled,1,mode);
    }finally{await app.closeFixture();}
  }
});

test('unresolved handshake with unknown provider usage retains its budget reservation instead of asserting zero',async()=>{
  let entered!:()=>void,release!:(session:{sendAudio(audio:Buffer):void;finish():void;cancel():void})=>void,input:LiveSttSessionInput|undefined;
  const opening=new Promise<void>(resolve=>{entered=resolve;});
  const app=await fixture({integrations:{probeIntegrations:async()=>({speech:notConfigured,stt:configured,tts:notConfigured,codex:notConfigured}),estimateSttCost:s=>s*0.001,createLiveSttSession:async(value:LiveSttSessionInput)=>{input=value;entered();return new Promise(resolve=>{release=resolve;});}}});
  try{
    const client=await connect(app.base);client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await opening;client.ws.send(JSON.stringify({type:'cancel'}));await client.next('closed');
    const charge=app.store.read().charges[0];assert.equal(charge.actual,undefined);assert.equal(charge.reserved,0.0455);assert.equal(input?.signal?.aborted,true);
    release({sendAudio(){},finish(){},cancel(){input?.onUsage?.(100);}});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(app.store.read().charges[0].actual,undefined);
  }finally{await app.closeFixture();}
});

test('app shutdown cancels live speech and persists final usage before closing SQLite; late usage cannot write again',async()=>{
  let liveInput:LiveSttSessionInput|undefined,cancelled=0;
  const app=await fixture({integrations:{probeIntegrations:async()=>({speech:notConfigured,stt:configured,tts:notConfigured,codex:notConfigured}),estimateSttCost:s=>s*0.001,createLiveSttSession:async(input:LiveSttSessionInput)=>{
    liveInput=input;queueMicrotask(()=>input.onEvent({type:'ready'}));
    return{sendAudio(){},finish(){},cancel(){cancelled++;input.onUsage?.(2.5);}};
  }}});
  const closeStore=app.store.close.bind(app.store);
  app.store.close=()=>{assert.equal(cancelled,1);assert.equal(app.store.read().charges[0].units,2.5);assert.equal(app.store.read().charges[0].actual,0.0025);closeStore();};
  try{const client=await connect(app.base);client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await client.next('ready');}
  finally{await app.closeFixture();}
  assert.doesNotThrow(()=>liveInput?.onUsage?.(10));
});

async function relayFixture(maxSeconds:number,open:LiveVoiceOptions['open']){
  const server=createServer(),settlements:number[]=[];
  const voice=attachLiveVoice(server,{maxSeconds,status:async()=>configured,open,vocabulary:()=>[],reserve:()=> 'charge',settle:(_id,seconds)=>{settlements.push(seconds);}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return{base:`http://127.0.0.1:${(server.address() as{port:number}).port}`,settlements,close:async()=>{voice.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

test('PCM byte cap excludes rejected bytes and finish never extends the absolute wall-clock limit',async()=>{
  let sentBytes=0;
  const byteApp=await relayFixture(0.5,input=>{queueMicrotask(()=>input.onEvent({type:'ready'}));return{sendAudio(audio){sentBytes+=audio.length;},finish(){},cancel(){input.onUsage(0);}};});
  try{
    const client=await connect(byteApp.base);client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await client.next('ready');
    client.ws.send(Buffer.alloc(16000));client.ws.send(Buffer.alloc(2));const error=await client.next('error');
    assert.equal(error.type==='error'&&error.code,'STT_AUDIO_LIMIT');assert.equal(sentBytes,16000);assert.equal(byteApp.settlements[0],0.5);
  }finally{await byteApp.close();}
  let finishCalled=0;
  const timed=await relayFixture(0.3,input=>{queueMicrotask(()=>input.onEvent({type:'ready'}));return{sendAudio(){},finish(){finishCalled++;},cancel(){input.onUsage(0);}};});
  try{
    const client=await connect(timed.base);client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await client.next('ready');
    const started=Date.now();client.ws.send(JSON.stringify({type:'finish'}));const error=await client.next('error');
    assert.equal(error.type==='error'&&error.code,'STT_TIME_LIMIT');assert.equal(finishCalled,1);assert.ok(Date.now()-started<1000);
  }finally{await timed.close();}
});

test('SSE cancellation suppresses a valid but stale reply even when a provider ignores its abort signal',async()=>{
  let resolveTurn!:(value:{conversationId:string;reply:ChatReply})=>void,cancelled=0;
  const app=await fixture({dialogue:{status:async()=>({...configured,provider:'codex'}),turn:async(_input,events)=>{events?.onStatus?.('thinking');return new Promise(resolve=>{resolveTurn=resolve;});},cancel(){cancelled++;},reset:async()=>{},close:async()=>{}}});
  try{
    const response=await fetch(app.base+'/api/chat/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'我喜欢挖掘机',context:{screen:'interest'}})});
    const cancel=await fetch(app.base+'/api/chat/cancel',{method:'POST'});assert.equal(cancel.status,200);assert.equal(cancelled,1);
    resolveTurn({conversationId:'stale_turn',reply});const body=await response.text();assert.doesNotMatch(body,/"type":"reply"/);assert.match(body,/"type":"done"/);assert.deepEqual(app.store.read().profile.interests,[]);
  }finally{await app.closeFixture();}
});

test('isolated voice → interest proposal → explicit confirmation → enabled pack → learning keeps each authority boundary',async()=>{
  const app=await fixture();
  const json=async(route:string,method='GET',body?:unknown)=>{const response=await fetch(app.base+route,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  try{
    assert.deepEqual(app.store.read().profile.interests,[]);assert.equal(app.store.read().attempts.length,0);
    const client=await connect(app.base);client.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await client.next('ready');client.ws.send(Buffer.alloc(3200));await client.next('transcript');client.ws.send(JSON.stringify({type:'finish'}));
    const endpoint=await client.next('endpoint');assert.equal(endpoint.type,'endpoint');const utterance=endpoint.type==='endpoint'?endpoint.text:'';
    const chat=await fetch(app.base+'/api/chat/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:utterance,context:{screen:'interest'}})});
    const frames=(await chat.text()).split('\n\n').filter(frame=>frame.startsWith('data: ')).map(frame=>JSON.parse(frame.slice(6)));
    const proposed=frames.find(frame=>frame.type==='reply')!.reply.action;assert.deepEqual(proposed,{type:'propose_interest',interest:utterance});
    assert.deepEqual(app.store.read().profile.interests,[]);assert.equal(app.store.read().profile.onboardingCompleted,false);
    await json('/api/profile','POST',{interests:[proposed.interest],onboardingCompleted:true});assert.deepEqual(app.store.read().profile.interests,[utterance]);assert.equal(app.store.read().profile.onboardingCompleted,true);
    await json('/api/packs/starter','PATCH',{enabled:false});assert.deepEqual((await json('/api/session/start','POST')).data.wordIds,[]);
    const imported=await json('/api/packs','POST',{title:'隔离测试词包',rows:[{term:'apple',meaning:'苹果'}]});const pack=imported.data.packs.find((item:{id:string})=>item.id!=='starter');
    assert.equal(pack.enabled,false);assert.deepEqual((await json('/api/session/start','POST')).data.wordIds,[]);
    await json(`/api/packs/${pack.id}`,'PATCH',{enabled:true});const session=(await json('/api/session/start','POST')).data;assert.equal(session.wordIds.length,1);
    const wordId=session.wordIds[0];assert.ok(app.store.read().words.find(word=>word.id===wordId)?.assetStatus==='approved');
    const attempt={sessionId:session.id,wordId,skill:'listen',correct:false,hinted:false,source:'click'};
    assert.equal((await json('/api/attempts','POST',{...attempt,wordId:'starter-cat'})).status,400);assert.equal(app.store.read().attempts.length,0);
    assert.equal((await json('/api/session','PATCH',{complete:true})).status,400);assert.equal(app.store.read().stickers.length,0);
    await json('/api/attempts','POST',attempt);assert.equal(app.store.read().progress[0].stage,0);
    await json('/api/attempts','POST',{...attempt,id:'flow-correct',correct:true});await json('/api/attempts','POST',{...attempt,id:'flow-correct',correct:true});assert.equal(app.store.read().progress[0].stage,1);
    await json('/api/attempts','POST',{...attempt,skill:'recall',correct:true,hinted:true});assert.equal(app.store.read().progress.find(progress=>progress.skill==='recall')!.stage,0);
    assert.equal((await json('/api/session','PATCH',{completedWordId:wordId})).status,400);
    assert.equal((await json('/api/session','PATCH',{completedStep:{wordId,step:'learn'}})).status,200);
    for(const action of ['skip','next'])assert.equal((await json('/api/session/activity','POST',{sessionId:session.id,activityId:`${wordId}:recognize`,action})).status,200);
    assert.equal((await json('/api/session','PATCH',{completedStep:{wordId,step:'listen'}})).status,200);
    assert.equal((await json('/api/session','PATCH',{completedStep:{wordId,step:'sound'}})).status,400,'the listening answer is not evidence for a different exercise');
    await json('/api/attempts','POST',{...attempt,id:'flow-sound',step:'sound',correct:true});
    assert.equal(app.store.read().progress.find(progress=>progress.skill==='listen')!.stage,1,'same-day exercises never advance a second level');
    assert.equal((await json('/api/session','PATCH',{completedStep:{wordId,step:'sound'}})).status,200);
    for(const action of ['skip','next'])assert.equal((await json('/api/session/activity','POST',{sessionId:session.id,activityId:`${wordId}:read`,action})).status,200);
    assert.equal((await json('/api/session','PATCH',{completedStep:{wordId,step:'recall'}})).status,200);
    await json('/api/session','PATCH',{complete:true});await json('/api/session','PATCH',{complete:true});
    assert.equal(app.store.read().attempts.length,6);assert.equal(app.store.read().stickers.length,1);assert.equal(app.store.read().charges.length,1);
  }finally{await app.closeFixture();}
});

test('late events and close from a cancelled microphone cannot end a freshly reconnected stream',async()=>{
  const inputs:LiveSttSessionInput[]=[],cancelled:number[]=[];
  const app=await fixture({integrations:{probeIntegrations:async()=>({speech:notConfigured,stt:configured,tts:notConfigured,codex:notConfigured}),estimateSttCost:s=>s*0.001,createLiveSttSession:async(input)=>{
    const id=inputs.length;inputs.push(input);queueMicrotask(()=>input.onEvent({type:'ready'}));
    return{sendAudio(){input.onEvent({type:'transcript',text:`stream-${id}`,final:false});},finish(){},cancel(){cancelled[id]=(cancelled[id]??0)+1;input.onUsage?.(1);}};
  }}});
  try{
    const first=await connect(app.base);first.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await first.next('ready');first.ws.send(JSON.stringify({type:'cancel'}));await first.next('closed');
    const second=await connect(app.base);second.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));await second.next('ready');
    inputs[0].onEvent({type:'endpoint',text:'late old words'});inputs[0].onEvent({type:'closed'});inputs[0].onUsage?.(999);first.ws.terminate();
    second.ws.send(Buffer.alloc(3200));assert.deepEqual(await second.next('transcript'),{type:'transcript',text:'stream-1',final:false});assert.ok(!second.events.some(event=>event.type==='closed'||event.type==='endpoint'));
    const third=await connect(app.base);third.ws.send(JSON.stringify({type:'start',locale:'zh-CN'}));const busy=await third.next('error');assert.equal(busy.type==='error'&&busy.code,'STT_BUSY');
    second.ws.send(JSON.stringify({type:'cancel'}));await second.next('closed');assert.deepEqual(cancelled,[1,1]);assert.equal(app.store.read().charges.length,2);assert.equal(app.store.read().charges[0].units,1);
  }finally{await app.closeFixture();}
});
