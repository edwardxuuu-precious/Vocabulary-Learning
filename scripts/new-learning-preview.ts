import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {cpSync,existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createApp} from '../server/index.ts';
import type {Store} from '../server/store.ts';
import type {LearningStep} from '../shared/contracts.ts';
import {gameWord} from '../shared/game-plan.ts';

/** Explicit local content/progress copy. Never opens the source Store or writes the source database. */
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),sourceArg=args.find(arg=>arg.startsWith('--source='))?.slice(9);
const port=Number(args.find(arg=>arg.startsWith('--port='))?.slice(7)??8813);
const distArg=args.find(arg=>arg.startsWith('--dist='))?.slice(7),buildDir=resolve(distArg??join(root,'dist'));
const simulate=args.includes('--simulate-microphone'),scenario=args.find(arg=>arg.startsWith('--scenario='))?.slice(11);
const basicScreens=args.includes('--basic-screens'),basicTerm=args.find(arg=>arg.startsWith('--word='))?.slice(7);
assert.ok(sourceArg&&isAbsolute(sourceArg),'需要显式 --source=正式data的绝对路径，只读复制。');
assert.ok(args.every(arg=>/^--(?:source|port|dist|scenario|word)=/.test(arg)||['--simulate-microphone','--basic-screens'].includes(arg))&&Number.isInteger(port)&&port>=1024&&port<=65535);
assert.ok(!distArg||isAbsolute(distArg));assert.ok(existsSync(join(buildDir,'index.html')));
assert.ok(!scenario||['learn','recognize','listen','recall','sound','read','spell'].includes(scenario),'工程场景只开放明确的学习步骤独立位置。');
assert.ok(!basicScreens||!scenario&&!simulate&&basicTerm,'七类题面须明确 --word，且与录音模拟/固定场景分开。');
assert.ok(!basicTerm||basicScreens,'--word仅用于明确开启的七类独立题面。');
const source=realpathSync(sourceArg),run=join(root,'artifacts','new-learning-entry',`preview-${Date.now()}-${port}`),dataDir=join(run,'data');
assert.notEqual(source,resolve(dataDir));mkdirSync(dataDir,{recursive:true});
const readSource=()=>{const db=new DatabaseSync(join(source,'playroom.sqlite'),{readOnly:true});try{return (db.prepare('SELECT body FROM documents WHERE id=1').get() as {body:string}).body;}finally{db.close();}};
// Only non-secret voice selection is needed to resolve already approved cache files.
const sourceEnv=join(source,'..','.env');
if(existsSync(sourceEnv)){const values=parseEnv(readFileSync(sourceEnv,'utf8'));for(const key of ['SPEECH_OUTPUT_PROVIDER','ELEVENLABS_VOICE_ID','ELEVENLABS_VOICE_ID_EN','ELEVENLABS_VOICE_ID_ZH','ELEVENLABS_TTS_MODEL'])if(values[key])process.env[key]=values[key];}
const sourceBody=readSource(),snapshot=JSON.parse(sourceBody) as ReturnType<Store['read']>;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;}
const sourceFingerprint=digest(JSON.stringify(canonical(snapshot)));
const media=new Set<string>();
function collect(value:unknown){
  if(typeof value==='string'&&value.startsWith('/media/'))media.add(decodeURIComponent(value.slice(7)));
  else if(Array.isArray(value))value.forEach(collect);
  else if(value&&typeof value==='object')Object.values(value).forEach(collect);
}
collect(snapshot);let copiedImages=0;
for(const name of media){
  if(!['.png','.jpg','.jpeg','.webp','.svg'].includes(extname(name).toLowerCase()))continue;
  const original=resolve(source,name),local=resolve(dataDir,name);
  if(!original.startsWith(source+sep)||!local.startsWith(dataDir+sep)||!existsSync(original))continue;
  if(!realpathSync(original).startsWith(source+sep))throw Error('素材链接超出明确的来源目录。');
  mkdirSync(dirname(local),{recursive:true});cpSync(original,local);copiedImages++;
}
const speech=join(source,'speech');
if(existsSync(speech))cpSync(speech,join(dataDir,'speech'),{recursive:true,filter:path=>extname(path)===''||extname(path)==='.mp3'});
const denied:Record<string,number>={};
const deny=(name:string):never=>{denied[name]=(denied[name]??0)+1;throw Error('独立预览只使用现有素材与缓存，不调用云服务。');};
globalThis.fetch=async()=>deny('outbound-fetch');
const offline={configured:false,available:false,status:'preview_offline',detail:'独立预览，现有本机缓存可用，云服务关闭。'};
const app=createApp({rootDir:root,dataDir,observationAudience:'engineering',chatEnabled:false,
  challengeServices:{transcribe:async()=>deny('transcribe'),grade:async()=>deny('grade')},
  dialogue:{status:async()=>offline,turn:async()=>deny('dialogue'),cancel(){},reset:async()=>{},close:async()=>{}},
  integrations:{probeIntegrations:async()=>({speech:offline,codex:offline}),ttsStatus:()=>offline,sttStatus:()=>offline,
    synthesizeSpeech:async()=>deny('tts'),streamSpeech:async()=>deny('stream'),transcribeSpeech:async()=>deny('stt'),
    generateIllustration:async()=>deny('image'),enrichVocabulary:async()=>deny('vocabulary'),beginCodexLogin:async()=>deny('login'),createLiveSttSession:async()=>deny('live')},
});
app.store.mutate(data=>Object.assign(data,snapshot));
const basicSteps=['learn','recognize','listen','sound','recall','read','spell','repair'] as const;
function prepareBasicScreen(scene:typeof basicSteps[number]) {
  const step:LearningStep=scene==='repair'?'sound':scene;
  assert.ok(basicScreens&&basicSteps.includes(scene));
  app.store.mutate(data=>{
    Object.assign(data,structuredClone(snapshot));
    const word=data.words.find(row=>row.term===basicTerm&&row.assetStatus==='approved'&&data.packs.some(pack=>pack.id===row.packId&&pack.enabled&&!pack.isSample&&!pack.deletedAt));
    assert.ok(word,'指定单词须来自已交付原词书且图片已批准。');
    const session=[...data.sessions].reverse().find(row=>!row.completedAt&&!row.suspendedAt&&row.entrySource?.entry==='learn'&&row.wordIds.includes(word.id)&&row.activities?.length&&row.tasks?.length);
    assert.ok(session?.activities&&session.tasks,'需要包含该原词的既有学习副本。');
    const choices=[word,...session.wordIds.filter(id=>id!==word.id).map(id=>data.words.find(row=>row.id===id)).filter((row):row is typeof word=>!!row&&row.assetStatus==='approved'&&row.imageUrl!==word.imageUrl)].slice(0,3);
    assert.ok(choices.length>=2,'基础选图与听选需要同轮原词图。');
    let at=session.activities.findIndex(activity=>activity.wordId===word.id&&activity.step===step);
    // memory-loop renders its core recall-first page through the portal activity kind.
    const target={id:`${word.id}:${step}`,wordId:word.id,step,kind:scene==='repair'?'repair' as const:step==='recall'?'portal' as const:'standard' as const,word:gameWord(word),choices:['recognize','listen','sound'].includes(step)?choices.map(gameWord):[]};
    if(at<0){assert.equal(step,'spell','只为可选拼写补一个独立展示位置。');at=session.activities.length;session.activities.push(target);const task=session.tasks.find(row=>row.wordId===word.id);assert.ok(task);task.steps.push(step);}
    else session.activities[at]=target;
    // The preview keeps the approved words and existing order while presenting core task templates.
    if(scene!=='repair')for(const activity of session.activities){
      if(!['learn','recognize','listen','sound','recall','read','spell'].includes(activity.step))continue;
      activity.kind=activity.step==='recall'?'portal':'standard';
      const current=data.words.find(row=>row.id===activity.wordId)!;
      activity.choices=['recognize','listen','sound'].includes(activity.step)?[current,...choices.filter(row=>row.id!==current.id)].slice(0,3).map(gameWord):[];
    }
    data.settings.spellingEnabled=step==='spell'||data.settings.spellingEnabled;
    data.attempts=data.attempts.filter(row=>row.sessionId!==session.id||row.wordId!==word.id||row.step!==step);
    data.practiceRecordings=data.practiceRecordings.filter(row=>row.sessionId!==session.id||row.activityId!==target.id);
    session.completedSteps={};session.activityStates={};session.completedWordIds=[];delete session.pauseState;delete session.reviewSupport;
    session.acknowledgedCheckpoints=[...(session.learningPolicy?.checkpoints??[])];
    for(const activity of session.activities.slice(0,at)){
      session.completedSteps[activity.wordId]=[...new Set([...(session.completedSteps[activity.wordId]??[]),activity.step])];
      session.activityStates[activity.id]={outcome:'practice'};
    }
    session.lastResumedAt=new Date().toISOString();data.activeLearningSessionId=session.id;
  });
}
if(scenario)app.store.mutate(data=>{
  const session=[...data.sessions].reverse().find(row=>!row.completedAt&&!row.suspendedAt&&row.entrySource?.entry==='learn'&&row.activities?.some(activity=>activity.step===scenario));
  assert.ok(session?.activities,'副本没有可展示的该类任务。');
  const at=session.activities.findIndex(activity=>activity.step===scenario);
  const target=session.activities[at];
  // Reset only this explicitly simulated task in the disposable copy.
  data.attempts=data.attempts.filter(row=>row.sessionId!==session.id||row.wordId!==target.wordId||row.step!==target.step);
  data.practiceRecordings=data.practiceRecordings.filter(row=>row.sessionId!==session.id||row.activityId!==target.id);
  session.completedSteps={};session.activityStates={};session.completedWordIds=[];delete session.pauseState;
  session.acknowledgedCheckpoints=[...(session.learningPolicy?.checkpoints??[])];
  for(const activity of session.activities.slice(0,at)){
    session.completedSteps[activity.wordId]=[...new Set([...(session.completedSteps[activity.wordId]??[]),activity.step])];
    session.activityStates[activity.id]={outcome:'practice'};
  }
  data.activeLearningSessionId=session.id;
});
if(basicScreens)prepareBasicScreen('recognize');
const origin=`http://127.0.0.1:${port}`;
const original=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>void;
app.server.removeAllListeners('request');
const audit=()=>{const data=app.store.read(),current=readSource();const result={url:origin+'/#learn',isolated:true,sourceUnchanged:digest(JSON.stringify(canonical(JSON.parse(current))))===sourceFingerprint,sourceBytesUnchanged:digest(current)===digest(sourceBody),sourceSnapshotSha256:sourceFingerprint,copiedImages,words:data.words.length,sessions:data.sessions.length,denied};writeFileSync(join(run,'audit.json'),JSON.stringify(result,null,2));return result;};
app.server.on('request',(req,res)=>{void(async()=>{
  const route=new URL(req.url??'/',origin).pathname;
  if(req.method==='GET'&&route==='/__preview/audit'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(audit()));return;}
  if(req.method==='POST'&&route==='/__preview/show'){
    assert.ok(basicScreens);let body='';for await(const chunk of req){body+=String(chunk);assert.ok(body.length<256);}
    const scene=new URLSearchParams(body).get('scene');assert.ok(basicSteps.includes(scene as typeof basicSteps[number]));
    prepareBasicScreen(scene as typeof basicSteps[number]);res.writeHead(303,{Location:'/#learn'});res.end();return;
  }
  if(req.method==='POST'&&route==='/__preview/basic-scene'){
    const step=new URL(req.url??'/',origin).searchParams.get('step');
    assert.ok(basicScreens&&basicSteps.includes(step as typeof basicSteps[number]),'需要明确开启七类独立题面，并指定合法步骤。');
    prepareBasicScreen(step as typeof basicSteps[number]);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({isolated:true,step,term:basicTerm}));return;
  }
  const learningRoute=/^\/api\/(?:session(?:\/(?:start|end|daily-choice|save-position|activity|upgrade-experience|review-support|assessment-practice))?|attempts|practice-recordings(?:\/[^/]+\/audio)?|speech\/tts(?:\/stream)?|business\/events)$/.test(route);
  if(route.startsWith('/api/')&&!['/api/state','/api/health','/api/screen-time'].includes(route)&&!learningRoute){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'独立预览保留原词书与素材，仅开放学习体验。'}));return;}
  if(req.method==='GET'&&['/','/index.html'].includes(route)){
    const html=readFileSync(join(buildDir,'index.html'),'utf8');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
    const microphone=simulate?`<script>sessionStorage.removeItem('word-play-speaking:'+${JSON.stringify(app.store.read().activeLearningSessionId)});const nativeQuery=navigator.permissions.query.bind(navigator.permissions);navigator.permissions.query=async d=>d.name==='microphone'?{state:'granted'}:nativeQuery(d);navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const o=c.createOscillator(),g=c.createGain(),d=c.createMediaStreamDestination();o.frequency.value=440;g.gain.value=0;g.gain.setValueAtTime(.12,c.currentTime+.3);g.gain.setValueAtTime(0,c.currentTime+1);o.connect(g);g.connect(d);o.start();let stopped=false;for(const t of d.stream.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{if(!stopped){stopped=true;o.stop();void c.close();}stop();};}return d.stream;};</script>`:'';
    const sceneNames={learn:'认识',recognize:'认意思',listen:'听音选图',sound:'看图选声音',recall:'回忆',read:'朗读',spell:'拼写',repair:'连线维修'};
    const capture=new URL(req.url??'/',origin).searchParams.has('capture');
    const toolbar=basicScreens&&!capture?`<form method="post" action="/__preview/show" style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:0;padding:10px 16px;background:#f5f0ff;color:#695286;font:13px Microsoft YaHei,sans-serif"><strong style="margin-right:8px">优化预览 · 独立进度</strong>${basicSteps.map(key=>`<button name="scene" value="${key}" style="min-height:32px;padding:5px 10px;border:1px solid #dcd3ee;border-radius:9px;color:#615184;background:white;cursor:pointer">${sceneNames[key]}</button>`).join('')}<span style="margin-left:auto;font-size:11px">切换只重置副本，正式进度保留</span></form>`:'';
    res.end(html.replace('<body>',`<body>${toolbar}${microphone}<aside style="position:fixed;top:0;right:0;z-index:99999;pointer-events:none;padding:5px 10px;background:#fff1bf;color:#755e32;font:12px sans-serif">${basicScreens?'七类题面预览 · 原词图，独立进度':simulate?'交互验收 · 模拟麦克风与练习位置':scenario?'交互演示 · 原词图与发音，独立进度位置':'独立预览 · 原词书与进度副本'}</aside>`));return;
  }
  if(req.method==='GET'&&/^\/assets\/[^/]+\.(?:js|css)$/.test(route)){
    const local=resolve(buildDir,'.'+decodeURIComponent(route));
    if(local.startsWith(buildDir+sep)&&existsSync(local)){res.setHeader('Content-Type',route.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(readFileSync(local));return;}
  }
  original(req,res);
})().catch(error=>{if(!res.headersSent)res.writeHead(500);res.end(String(error));});});
await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',done);});
console.log(JSON.stringify({...audit(),run:relative(root,run)}));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{audit();void app.close().then(()=>process.exit(0));});
