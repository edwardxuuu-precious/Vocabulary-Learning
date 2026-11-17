import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createApp} from '../server/index.ts';

/** Disposable, explicitly marked example profile. Never reads the family's data or calls providers. */
const root=fileURLToPath(new URL('..',import.meta.url));
const resume=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9);if(resume)assert.match(resume,/^run-\d+$/);
const run=resolve(root,'artifacts','entry-integration-qa',resume??`run-${Date.now()}`);assert.ok(run.startsWith(resolve(root,'artifacts','entry-integration-qa')+sep));
await mkdir(run,{recursive:true});
const port=Number(process.argv.find(arg=>arg.startsWith('--port='))?.slice(7)??8791);
assert.ok(Number.isInteger(port)&&port>0&&port<65536);
const reviewDedup=process.argv.includes('--review-dedup');
const continuityMode=reviewDedup||process.argv.includes('--continuity');
const businessMode=continuityMode||process.argv.includes('--business');
let failRecording=0,failPosition=0;
const recommendations=businessMode||process.argv.includes('--recommendations'),noDue=process.argv.includes('--no-due'),unprepared=process.argv.includes('--unprepared');
const audioFixture=join(run,'data','speech','explicit-silent-fixture.wav');
if(recommendations){await mkdir(join(run,'data','speech'),{recursive:true});writeFileSync(audioFixture,Buffer.alloc(64));}

const offline={configured:false,available:false,status:'isolated_fixture',detail:'工程隔离示例，静音且无云调用'};
const denied:string[]=[];
const deny=(action:string):never=>{denied.push(action);throw Error(`External action disabled: ${action}`);};
const app=createApp({observationAudience:'engineering',rootDir:root,dataDir:join(run,'data'),chatEnabled:false,
  dialogue:{status:async()=>offline,turn:async()=>deny('dialogue'),cancel(){},reset:async()=>{},close:async()=>{}},
  integrations:{probeIntegrations:async()=>({speech:offline,codex:offline}),ttsStatus:()=>offline,getCachedSpeech:async()=>recommendations&&!unprepared?audioFixture:undefined,
    synthesizeSpeech:async()=>deny('tts'),streamSpeech:async()=>deny('stream'),generateIllustration:async()=>deny('image'),enrichVocabulary:async()=>deny('vocabulary'),
    transcribeSpeech:async()=>deny('stt'),createLiveSttSession:async()=>deny('live'),beginCodexLogin:async()=>deny('oauth')},
});
let reviewClock=Date.now();if(reviewDedup)app.store.clock=()=>new Date(reviewClock);
if(!resume)app.store.mutate(data=>{
  data.profile.nickname='工程隔离示例';data.settings.voiceEnabled=false;data.settings.monthlyBudgetCny=0;
  data.packs=[{id:'qa-family',title:'工程验收示例词书',enabled:true,createdAt:'2026-10-01T00:00:00Z'}];
  data.settings.learningStrategy='memory-loop';data.settings.dailyNewWords=3;data.settings.dailyReviewWords=2;
  if(recommendations)data.packs.push({id:'qa-second',title:'工程验收示例乙',enabled:true,createdAt:'2026-10-02T00:00:00Z'});
  data.words=data.words.slice(0,recommendations?8:6).map(word=>({...word,packId:'qa-family',learningVersion:0,assetStatus:'approved'}));
  if(recommendations)data.words.forEach((word,index)=>{if(index%2)word.packId='qa-second';});
  const ids=data.words.slice(0,2).map(word=>word.id);
  data.sessions=[{id:'qa-prior-introductions',wordIds:ids,completedWordIds:ids,startedAt:'2026-10-01T00:00:00Z',completedAt:'2026-10-01T00:00:00Z',rewardGranted:false,
    exposures:ids.map(wordId=>({wordId,learningVersion:0,introducedAt:noDue?app.store.clock().toISOString():'2026-10-01T00:00:00Z'}))}];
  if(reviewDedup){
    const word=data.words[0],id='qa-confirmed-weak-recall',at='2026-10-24T00:00:00Z',snapshot={id:word.id,term:word.term,meaning:word.meaning,imageUrl:word.imageUrl,learningVersion:0};
    data.assessments=[{id,mode:'full',wordIds:[word.id],startedAt:at,completedAt:at,items:[{id,dimension:'zh-en',word:snapshot,choices:[],result:'incorrect'}]}];
    data.assessmentAttempts=[{id,sessionId:id,itemId:id,wordId:word.id,learningVersion:0,dimension:'zh-en',source:'parent',result:'incorrect',createdAt:at,confirmedAt:at}];
    data.assessmentProgress=[{wordId:word.id,learningVersion:0,dimension:'zh-en',stage:0,dueAt:at}];
  }
});
const ids=app.store.read().words.map(word=>word.id);
if(!resume){
app.store.startSession(false,{}, {mode:'practice',wordIds:recommendations?ids.slice(0,2):ids.slice(4),strategy:'classic'});
if(!recommendations)app.store.startSession(false,{}, {entry:'learn',mode:'practice',wordIds:ids.slice(2,4),strategy:'classic'});
app.store.startSession(false,{}, {entry:'review',mode:'practice',packId:'qa-family',wordIds:recommendations?[ids[0]]:ids.slice(0,2),strategy:'classic'});
}
const original=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>void;
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{void(async()=>{
  const route=new URL(req.url??'/',`http://127.0.0.1:${port}`).pathname;
  if(reviewDedup&&req.method==='POST'&&route==='/__qa/day'){
    if(req.headers['x-qa-fixture']!==run.split(/[\\/]/).at(-1)){res.writeHead(403);res.end();return;}
    reviewClock+=86_400_000;req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({fixture:true,now:app.store.clock().toISOString()}));return;
  }
  if(continuityMode&&req.method==='POST'&&route==='/__qa/failure'){
    if(req.headers['x-qa-fixture']!==run.split(/[\\/]/).at(-1)){res.writeHead(403);res.end();return;}
    const kind=new URL(req.url!,`http://127.0.0.1:${port}`).searchParams.get('kind');
    if(kind==='recording')failRecording=1;else if(kind==='position')failPosition=1;else{res.writeHead(400);res.end();return;}
    req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.end('{"fixture":true}');return;
  }
  if(continuityMode&&req.method==='POST'&&(route==='/api/practice-recordings'&&failRecording>0||route==='/api/session/save-position'&&failPosition>0)){
    if(route==='/api/practice-recordings')failRecording--;else failPosition--;req.resume();res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'工程故障示例：保存暂不可用。',code:'QA_SAVE_FAILURE'}));return;
  }
  if(route.startsWith('/api/'))res.once('finish',audit);
  if(req.method==='GET'&&['/','/index.html'].includes(route)){
    const html=await readFile(join(root,'dist/index.html'),'utf8');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    const microphone=continuityMode?`<script>navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const s=c.createOscillator(),g=c.createGain(),d=c.createMediaStreamDestination();s.frequency.value=440;g.gain.value=.12;s.connect(g);g.connect(d);s.start();let stopped=false;for(const t of d.stream.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{if(!stopped){stopped=true;s.stop();void c.close();}stop();};}return d.stream;};</script>`:'';
    res.end(html.replace('<body>',`<body>${microphone}<aside style="position:fixed;top:0;right:0;z-index:99999;pointer-events:none;padding:7px 12px;background:#fff1bf;color:#755e32;font:12px sans-serif">工程验收 · 隔离示例 · 静音/无云 · ${continuityMode?'模拟麦克风 · 非真人录音 · ':''}发音为替身 · 示例PIN123456</aside>`));return;
  }
  original(req,res);
})().catch(error=>{res.writeHead(500);res.end(String(error));});});
const audit=()=>{const data=app.store.read();writeFileSync(join(run,'audit.json'),JSON.stringify({isolated:true,denied,
  sessions:data.sessions.map(session=>({id:session.id,entrySource:session.entrySource,wordIds:session.wordIds,completedAt:session.completedAt,completedSteps:session.completedSteps})),
  formalAttempts:data.assessmentAttempts?.length??0,charges:data.charges.length},null,2));};
await audit();
await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',done);});
if(businessMode&&!resume){const response=await fetch(`http://127.0.0.1:${port}/api/parent-gate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'123456'})});assert.equal(response.status,200);}
console.log(JSON.stringify({url:`http://127.0.0.1:${port}`,run,isolated:true}));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{audit();void app.close().then(()=>process.exit(0));});
