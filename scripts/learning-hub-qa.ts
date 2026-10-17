import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { recommendedAssessmentItems } from '../shared/assessment.ts';
import { dailyLearningPlan } from '../shared/learning.ts';

// Offline fixtures only. Never open the real child's database or load .env.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), port=Number(args.find(arg=>arg.startsWith('--port='))?.slice(7)??8811);
if(args.some(arg=>!/^--port=\d+$/.test(arg)) || !Number.isInteger(port) || port<1024 || port>65535)throw Error('仅支持 --port=本机端口。');
const origin=`http://127.0.0.1:${port}`, dataDir=join(root,'artifacts',`learning-hub-qa-${randomUUID()}`);
await mkdir(dataDir,{recursive:true});
for(const name of Object.keys(process.env))if(/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name))delete process.env[name];
const originalEnvLoad=process.loadEnvFile;process.loadEnvFile=()=>{};
const {createApp}=await import('../server/index.ts');process.loadEnvFile=originalEnvLoad;
const denied:Record<string,number>={}, deny=(name:string):never=>{denied[name]=(denied[name]??0)+1;throw Error('隔离验收禁止云服务。');};
globalThis.fetch=async()=>deny('outboundFetch');
const disabled={configured:false,available:false,status:'qa_offline',detail:'隔离示例；语音关闭，不调用云服务。'};
const base=new Date('2026-10-17T03:00:00Z');let now=new Date(base);
const app=createApp({rootDir:root,dataDir,clock:()=>now,chatEnabled:false,learningGames:{allowedKinds:[]},
  challengeServices:{transcribe:async()=>deny('challenge-stt'),grade:async()=>deny('challenge-grade')},
  dialogue:{status:async()=>disabled,turn:async()=>deny('chat'),cancel(){},reset:async()=>{},close:async()=>{}},
  integrations:{probeIntegrations:async()=>({speech:disabled,codex:disabled}),ttsStatus:()=>disabled,sttStatus:()=>disabled,
    getCachedSpeech:async()=>undefined,synthesizeSpeech:async()=>deny('tts'),streamSpeech:async()=>deny('tts-stream'),
    transcribeSpeech:async()=>deny('stt'),generateIllustration:async()=>deny('image'),enrichVocabulary:async()=>deny('vocabulary'),
    createLiveSttSession:async()=>deny('live'),beginCodexLogin:async()=>deny('login'),estimateTtsCost:()=>0,estimateSttCost:()=>0}});
const initial=app.store.read();
function seed(scenario:string){
  now=new Date(base);
  app.store.mutate(data=>{
    Object.assign(data,structuredClone(initial));delete data.activeLearningSessionId;delete data.lastCompletedLearningSessionId;
    data.profile.nickname='学习大厅验收（隔离档案）';data.settings.voiceEnabled=false;data.settings.monthlyBudgetCny=0;
    data.packs=[{id:'batch-a',title:'第一批 · 生活朋友',createdAt:'2026-10-15T00:00:00Z',enabled:scenario!=='empty'}, {id:'batch-b',title:'第二批 · 户外朋友',createdAt:'2026-10-16T00:00:00Z',enabled:scenario!=='empty'}];
    data.words.forEach((word,index)=>{word.packId=index<6?'batch-a':'batch-b';});
    if(scenario!=='completed')return;
    for(const [group,words,offset] of [['old',data.words.slice(3,9),2],['today',data.words.slice(0,3),0]] as const){
      const at=new Date(now.getTime()-offset*86_400_000).toISOString(),id=`fixture-${group}`;
      data.sessions.push({id,wordIds:words.map(word=>word.id),completedWordIds:words.map(word=>word.id),startedAt:at,completedAt:at,rewardGranted:true});
      data.attempts.push(...words.map(word=>({id:`${id}:${word.id}`,sessionId:id,wordId:word.id,skill:'recall' as const,learningVersion:0,correct:false,hinted:false,practiceOnly:true,source:'click' as const,createdAt:at})));
    }
  });
}
seed('completed');
const original=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>void;
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{void(async()=>{
  const route=new URL(req.url??'/',origin).pathname;
  if(req.method==='GET'&&route==='/__qa'){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<h1>学习大厅 · 隔离验收</h1><p>两个示例批次，合成学习历史；云服务禁用，不写正式档案。</p><form method="post" action="/__qa/scenario"><button name="scenario" value="completed">今日已完成</button> <button name="scenario" value="fresh">全新学习</button> <button name="scenario" value="empty">词书未准备</button> <button name="scenario" value="next-day">下一天</button></form><p><a href="/">打开应用</a> · <a href="/__qa/audit">核对隔离记录</a></p>');return;
  }
  if(req.method==='GET'&&route==='/__qa/audit'){
    const data=app.store.read();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({isolated:true,dataDir,denied,charges:data.charges.length,clock:now,active:data.activeLearningSessionId,sessions:data.sessions.map(session=>({id:session.id,mode:session.mode,practiceOnly:session.practiceOnly,wordIds:session.wordIds,completed:session.completedWordIds,steps:session.completedSteps,completedAt:session.completedAt})),plan:dailyLearningPlan(data,now),recommendedTests:recommendedAssessmentItems(data,now)}));return;
  }
  if(req.method==='POST'&&route==='/__qa/scenario'){
    if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>100)throw Error('请求过大。');}
    const scenario=new URLSearchParams(body).get('scenario');
    if(scenario==='next-day')now=new Date(now.getTime()+86_400_000);else if(scenario&&['completed','fresh','empty'].includes(scenario))seed(scenario);else throw Error('未知场景。');
    res.writeHead(303,{Location:'/'});res.end();return;
  }
  original(req,res);
})().catch(()=>{res.writeHead(500);res.end('隔离验收请求失败。');});});
await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',done);});
console.log(JSON.stringify({url:`${origin}/__qa`,isolated:true,dataDir}));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
