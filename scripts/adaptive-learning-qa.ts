import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import type { IntegrationStatus, LearningSession, ServiceStatus } from '../shared/contracts.ts';
import { dailyLearningPlan, learningDay } from '../shared/learning.ts';

// Offline fixture runner. No server or browser starts unless the caller explicitly adds --serve.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=Number(process.argv.find(value=>value.startsWith('--port='))?.slice(7)??8791),origin=`http://127.0.0.1:${port}`;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port需要1024–65535之间的本机端口。');
const scenarios=['fresh','mixed','backlog','short-budget','legacy','spelling'] as const;
type Scenario=typeof scenarios[number];
const days={today:0,'next-day':1,overdue:8} as const;
type Day=keyof typeof days;
const argument=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
for(const arg of process.argv.slice(2))if(!['--serve','--check','--games'].includes(arg)&&!/^--(?:scenario|manifest|dist|port)=/.test(arg))throw new Error('仅支持 --serve、--check、--games、--scenario=场景、--manifest=缓存清单、--dist=项目内构建目录、--port=端口。');
const games = process.argv.includes('--games');
const distDir=resolve(root,argument('dist')??'dist');
const inside=(base:string,target:string)=>{const name=relative(base,target);return name!==''&&name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name);};
if(!inside(root,distDir)||existsSync(distDir)&&!inside(realpathSync(root),realpathSync(distDir)))throw new Error('--dist 必须位于当前项目内，不能经符号链接指向项目之外。');
const selected=argument('scenario')??'fresh';
if(!scenarios.includes(selected as Scenario))throw new Error('未知QA场景。');
const baseTime=new Date('2026-10-15T02:00:00.000Z'),dayMs=86_400_000;
let now=new Date(baseTime),scenario=selected as Scenario,day:Day='today',suppressedEnvLoads=0;
const dataDir=join(root,'artifacts',`adaptive-learning-qa-${randomUUID()}`),token=randomUUID();
await mkdir(join(dataDir,'speech','fixture'),{recursive:true});

// server/index currently loads .env at module import. Suppress it before importing that module.
// Delete inherited service secrets by name; none are inspected, copied or logged.
for(const name of Object.keys(process.env))if(/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name))delete process.env[name];
const actualLoadEnv=process.loadEnvFile;
process.loadEnvFile=()=>{suppressedEnvLoads++;};
let createApp:typeof import('../server/index.ts')['createApp'];
try{({createApp}=await import('../server/index.ts'));}finally{process.loadEnvFile=actualLoadEnv;}
const deniedCalls:Record<string,number>={};
const deny=(name:string):never=>{deniedCalls[name]=(deniedCalls[name]??0)+1;throw Object.assign(new Error('此隔离QA只使用既有单词缓存，云服务已禁用。'),{code:'SPEECH_UNAVAILABLE'});};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==origin)return deny('outboundFetch');return nativeFetch(input,init);};
const unavailable=(provider:ServiceStatus['provider'],detail:string):ServiceStatus=>({provider,configured:false,available:false,status:'qa_disabled',detail});
const tts:ServiceStatus={provider:'elevenlabs',configured:false,available:false,status:'cache_only',detail:'隔离QA：仅复用12词已有真实MP3；缺缓存即停止，不调用云端。'};
const statuses:IntegrationStatus={speech:tts,tts,stt:unavailable('elevenlabs','隔离QA不识别录音。'),codex:unavailable('codex','隔离QA不登录、不探测、不生成图片。')};
const audio=new Map<string,string>(),copied:{term:string;bytes:number;sha256:string}[]=[];
const audioRequests:{text:string;locale:string;tone:string;cached:boolean}[]=[];
const app=createApp({rootDir:root,dataDir,clock:()=>new Date(now),chatEnabled:false,
  dialogue:{status:async()=>unavailable('codex','QA聊天关闭。'),turn:async()=>deny('dialogue'),cancel(){},reset:async()=>{},close:async()=>{}},
  integrations:{
    probeIntegrations:async()=>structuredClone(statuses),speechStatus:()=>tts,ttsStatus:()=>tts,sttStatus:()=>statuses.stt!,
    getCachedSpeech:async input=>{
      const cached=input.locale==='en-US'&&(input.tone??'clear')==='clear'&&input.rate===undefined?audio.get(input.text):undefined;
      audioRequests.push({text:input.text,locale:input.locale,tone:input.tone??'clear',cached:Boolean(cached)});
      return cached;
    },
    synthesizeSpeech:async()=>deny('tts-cache-miss'),streamSpeech:async()=>deny('tts-stream-cache-miss'),
    transcribeSpeech:async()=>deny('stt'),createLiveSttSession:async()=>deny('live-stt'),createSonioxSession:async()=>deny('soniox'),
    generateIllustration:async()=>deny('image'),beginCodexLogin:async()=>deny('oauth'),estimateTtsCost:()=>0,estimateSttCost:()=>0,
  },
});
// This historical lesson harness explicitly opts into sample practice; product defaults stay disabled.
app.store.enablePack('starter',true);
if (games) app.store.mutate(data => { for (const word of data.words) word.partOfSpeech = ['jump','run'].includes(word.term) ? 'verb' : 'noun'; });
const initial=structuredClone(app.store.read());
const manifestPath=resolve(root,argument('manifest')??'artifacts/adaptive-qa-cache.json');
try{
  const manifest:unknown=JSON.parse(await readFile(manifestPath,'utf8'));
  if(!Array.isArray(manifest)||manifest.length!==initial.words.length)throw new Error('缓存清单需要恰好对应当前12个内置词。');
  const sourceRoot=realpathSync(join(root,'data','speech'));
  for(const item of manifest){
    if(!item||typeof item.term!=='string'||typeof item.file!=='string'||audio.has(item.term)||!initial.words.some(word=>word.term===item.term))throw new Error('缓存清单词条无效或重复。');
    const source=realpathSync(resolve(item.file));
    if(!source.startsWith(sourceRoot+sep)||!/[a-f0-9]{64}\.mp3$/i.test(source))throw new Error('缓存来源必须为正式data/speech内的既有MP3，不接受其他文件。');
    const bytes=await readFile(source);
    if(bytes.length<=32||bytes.length>2_000_000||!(bytes.toString('ascii',0,3)==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))throw new Error('缓存音频未通过MP3检查。');
    const target=join(dataDir,'speech','fixture',item.term+'.mp3');await copyFile(source,target);
    assert.deepEqual(await readFile(target),bytes);audio.set(item.term,target);copied.push({term:item.term,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}catch(error){await app.close();throw error;}

function resetScenario(name:Scenario){
  now=new Date(baseTime);scenario=name;day='today';
  audioRequests.length=0;
  app.store.mutate(data=>{Object.assign(data,structuredClone(initial));data.profile.nickname=games?'游戏体验（独立档案）':'隔离验收小朋友';data.profile.onboardingCompleted=true;data.settings.monthlyBudgetCny=0;data.settings.dailyReviewWords=3;});
  const oldCount=name==='mixed'?2:name==='backlog'?6:0;
  if(oldCount){
    now=new Date(baseTime.getTime()-dayMs);
    const oldIds=initial.words.slice(0,oldCount).map(word=>word.id);
    const history:LearningSession={id:`qa-fixture-history-${name}`,wordIds:oldIds,completedWordIds:[],startedAt:now.toISOString(),rewardGranted:false,tasks:oldIds.map(wordId=>({wordId,mode:'review',steps:['listen']})),completedSteps:{}};
    app.store.mutate(data=>{data.sessions.push(history);});
    for(const wordId of oldIds){
      app.store.attempt({id:`qa-fixture-${name}-${wordId}-listen`,sessionId:history.id,wordId,skill:'listen',step:'listen',correct:true,hinted:false,source:'click'});
      app.store.updateSession({completedStep:{wordId,step:'listen'}});
    }
    app.store.updateSession({complete:true});now=new Date(baseTime);
  }
  if(name==='short-budget')app.store.updateSettings({dailyNewWords:8,sessionMinutes:3});
  if(name==='spelling')app.store.updateSettings({spellingEnabled:true,dailyNewWords:1});
  if(name==='legacy')app.store.mutate(data=>{data.sessions.push({id:'qa-fixture-legacy-active',wordIds:data.words.slice(0,3).map(word=>word.id),completedWordIds:[data.words[0].id],startedAt:now.toISOString(),rewardGranted:false});});
}
function inspect(){
  const data=app.store.read(),plan=dailyLearningPlan(data,now);
    return{qa:true,scenario,day,now:now.toISOString(),localDay:learningDay(now),dataDir,distDir,syntheticHistory:true,copiedAudio:copied.length,deniedCalls,suppressedEnvLoads,
    plan:{review:plan.review.map(word=>word.term),fresh:plan.fresh.map(word=>word.term),due:plan.due.map(word=>word.term),tasks:plan.tasks,taskCount:plan.taskCount,taskLimit:plan.taskLimit,estimatedMinutes:plan.estimatedMinutes,reductionReason:plan.reductionReason},
    state:app.store.state(statuses),sessions:data.sessions,charges:data.charges,audioRequests};
}
function selfCheck(){
  const results:unknown[]=[];
  for(const name of scenarios){
    resetScenario(name);const view=inspect();assert.equal(view.state.words.length,12);assert.equal(view.charges.length,0);assert.ok(view.plan.taskCount<=view.plan.taskLimit);
    if(name==='fresh'){assert.equal(view.plan.fresh.length,3);assert.ok(view.plan.tasks.every(task=>task.mode==='new'&&task.steps.join(',')==='learn,listen,sound,recall'));}
    if(name==='mixed'){assert.equal(view.plan.due.length,2);assert.equal(view.plan.review.length,2);assert.equal(view.plan.fresh.length,2);assert.equal(view.state.attempts.length,2);assert.ok(view.plan.tasks.slice(0,2).every(task=>task.mode==='review'&&task.steps.length===1));}
    if(name==='backlog'){assert.equal(view.plan.due.length,6);assert.equal(view.plan.review.length,3);assert.equal(view.plan.fresh.length,0);assert.equal(view.state.attempts.length,6);assert.equal(view.plan.reductionReason,'backlog');}
    if(name==='short-budget'){assert.equal(view.plan.taskLimit,4);assert.equal(view.plan.taskCount,4);assert.equal(view.plan.fresh.length,1);}
    if(name==='spelling'){assert.equal(view.plan.fresh.length,1);assert.equal(view.plan.taskCount,5);assert.equal(view.plan.tasks[0].steps.join(','),'learn,listen,sound,recall,spell');}
    if(name==='legacy'){const resumed=app.store.startSession();assert.equal(resumed.id,'qa-fixture-legacy-active');assert.equal(resumed.tasks,undefined);assert.equal(resumed.completedWordIds.length,1);}
    results.push({scenario:name,plan:view.plan,attempts:view.state.attempts.length,progress:view.state.progress.length});
  }
  resetScenario('fresh');const session=app.store.startSession(),wordId=session.wordIds[0];
  app.store.attempt({id:'qa-fixture-practice-only',sessionId:session.id,wordId,skill:'recall',step:'recall',correct:false,hinted:true,practiceOnly:true,source:'click'});
  assert.equal(app.store.read().attempts.length,1);assert.equal(app.store.read().progress.length,0);
  now=new Date(baseTime.getTime()+dayMs);assert.equal(learningDay(now),'2026-10-16');assert.ok(dailyLearningPlan(app.store.read(),now).review.some(word=>word.id===wordId));
  assert.deepEqual(deniedCalls,{});resetScenario(selected as Scenario);return results;
}
const checks=selfCheck();
await writeFile(join(dataDir,'fixture-audit.json'),JSON.stringify({at:new Date().toISOString(),copied,checks,practiceOnlyCreatesNoProgress:true,noCloudCalls:true,suppressedEnvLoads},null,2));

const send=(res:ServerResponse,body:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
function bootstrap(){return `<script>(()=>{const NativeDate=Date,instant=${JSON.stringify(now.toISOString())};function FixtureDate(...args){if(!new.target)return new NativeDate(instant).toString();return Reflect.construct(NativeDate,args.length?args:[instant],new.target);}Object.setPrototypeOf(FixtureDate,NativeDate);FixtureDate.prototype=NativeDate.prototype;FixtureDate.now=()=>new NativeDate(instant).getTime();window.Date=FixtureDate;window.__ADAPTIVE_QA__={day:${JSON.stringify(day)},scenario:${JSON.stringify(scenario)},now:instant};try{Object.defineProperty(speechSynthesis,'speak',{value:(utterance)=>queueMicrotask(()=>utterance.onerror?.({error:'not-allowed'}))});}catch{};})();</script>`;}
function panel(){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>每日任务隔离验收</title><style>body{margin:0;font:15px system-ui;background:#f5f3eb;color:#233b30}header{padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}button,select{padding:8px}main{display:grid;grid-template-columns:minmax(320px,1fr) 340px;height:calc(100vh - 110px)}iframe{width:100%;height:100%;border:1px solid #ccc;background:white}pre{padding:10px;overflow:auto;font-size:12px;white-space:pre-wrap}p{margin:0 12px 10px}</style><header><strong>隔离QA</strong><label>场景 <select id="scenario">${scenarios.map(name=>`<option ${scenario===name?'selected':''}>${name}</option>`).join('')}</select></label><button id="reset">重置场景</button><label>日期 <select id="day">${Object.keys(days).map(name=>`<option ${day===name?'selected':''}>${name}</option>`).join('')}</select></label><button id="clock">切换日期</button><button id="reload">只刷新应用</button><a href="/__qa/state" target="_blank">查看JSON</a><span id="status"></span></header><p>仅既有12词MP3；无云、无录音、无OAuth。历史均为合成测试记录。切场景重置此隔离档案，切日期保留当前记录。</p><main><iframe id="app" src="/__qa/app"></iframe><pre id="details"></pre></main><script>const token=${JSON.stringify(token)};const api=async(path,body)=>{const response=await fetch('/__qa/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-QA-Token':token}:{},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};const refresh=async()=>{const view=await api('state');document.getElementById('status').textContent=view.localDay+' · '+view.scenario;document.getElementById('details').textContent=JSON.stringify({scenario:view.scenario,now:view.now,plan:view.plan,activeSession:view.state.activeSession,attempts:view.state.attempts,progress:view.state.progress,charges:view.charges,deniedCalls:view.deniedCalls},null,2);};const reload=()=>{document.getElementById('app').src='/__qa/app?t='+performance.now();void refresh();};document.getElementById('reset').onclick=async()=>{await api('scenario',{scenario:document.getElementById('scenario').value});document.getElementById('day').value='today';reload();};document.getElementById('clock').onclick=async()=>{await api('clock',{day:document.getElementById('day').value});reload();};document.getElementById('reload').onclick=reload;setInterval(()=>void refresh(),1000);void refresh();</script></html>`;}
async function body(req:IncomingMessage){let text='';for await(const bytes of req){text+=bytes;if(text.length>2048)throw new Error('QA请求过大。');}return JSON.parse(text||'{}') as Record<string,unknown>;}
const original=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>void;
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{void(async()=>{
  const host=req.headers.host??'';
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return send(res,{error:'仅允许此本机QA端口。'},403);
  const url=new URL(req.url??'/',`http://${host}`);
  if(req.method==='GET'&&url.pathname==='/'){res.writeHead(302,{Location:'/__qa','Cache-Control':'no-store'});return res.end();}
  // Prefer assets from the selected build; never rewrite or copy that build into production dist.
  if(['GET','HEAD'].includes(req.method??'')&&url.pathname.startsWith('/assets/')){
    const file=resolve(distDir,'.'+decodeURIComponent(url.pathname));
    if(inside(distDir,file)&&existsSync(file)&&statSync(file).isFile()){
      if(!inside(realpathSync(distDir),realpathSync(file)))return send(res,{error:'构建素材路径无效。'},403);
      const ext=file.split('.').at(-1)?.toLowerCase()??'',mime:Record<string,string>={js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',woff:'font/woff',woff2:'font/woff2'};
      if(!mime[ext])return send(res,{error:'不支持该构建素材。'},404);
      res.writeHead(200,{'Content-Type':mime[ext],'Content-Length':statSync(file).size,'Cache-Control':'no-store'});
      if(req.method==='HEAD')return res.end();const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return;
    }
  }
  if(!url.pathname.startsWith('/__qa'))return original(req,res);
  if(req.method!=='GET'&&(req.headers['x-qa-token']!==token||req.headers.origin&&req.headers.origin!==`http://${host}`||req.headers['sec-fetch-site']==='cross-site'))return send(res,{error:'QA请求来源无效。'},403);
  if(req.method==='GET'&&url.pathname==='/__qa/state')return send(res,inspect());
  if(req.method==='POST'&&url.pathname==='/__qa/scenario'){const value=await body(req);if(!scenarios.includes(value.scenario as Scenario))return send(res,{error:'未知场景。'},400);resetScenario(value.scenario as Scenario);return send(res,inspect());}
  if(req.method==='POST'&&url.pathname==='/__qa/clock'){const value=await body(req);if(!Object.hasOwn(days,String(value.day)))return send(res,{error:'未知日期。'},400);day=value.day as Day;now=new Date(baseTime.getTime()+days[day]*dayMs);return send(res,inspect());}
  if(req.method==='GET'&&['/__qa','/__qa/','/__qa/app'].includes(url.pathname)){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'");
    if(url.pathname==='/__qa/app'){const html=await readFile(join(distDir,'index.html'),'utf8');return res.end(html.replace('</head>',bootstrap()+'</head>').replace('<body>', games ? '<body><div style="position:fixed;right:12px;bottom:8px;z-index:50;padding:5px 10px;border-radius:12px;background:#ffffffde;color:#435c77;font:13px system-ui;pointer-events:none">游戏体验 · 独立档案</div>' : '<body>'));}
    return res.end(panel());
  }
  return send(res,{error:'没有这个QA接口。'},404);
})().catch(error=>{if(!res.headersSent)send(res,{error:error instanceof Error?error.message:'QA失败。'},400);else res.end();});});

// Parse fixture-only browser code without executing it or opening a browser.
for(const html of [bootstrap(),panel()])for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(match[1]);

if(!process.argv.includes('--serve')){
  await app.close();console.log(JSON.stringify({prepared:true,listening:false,scenarios:scenarios.length,audioFiles:copied.length,dataDir,distDir,audit:join(dataDir,'fixture-audit.json')}));
}else{
  if(!existsSync(join(distDir,'index.html'))){await app.close();throw new Error('请先由总控构建所选dist，再启动浏览器验收。');}
  await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',done);});
  console.log(`隔离验收 ${origin}/__qa；${learningDay(now)}；数据 ${relative(root,dataDir)}；仅已有MP3，不使用云服务。`);
  let closing=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{if(closing)return;closing=true;void app.close().then(()=>process.exit(0));});
}
