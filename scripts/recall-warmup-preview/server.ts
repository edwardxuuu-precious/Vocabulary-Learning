import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, realpathSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join, sep, extname, dirname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dailyLearningPlan, learningDay, learningWeakness } from '../../shared/learning.ts';
import { assessmentCue } from '../../shared/assessment-cues.ts';
import { wordLearningProfiles } from '../../shared/word-learning.ts';
import { getCachedSpeech } from '../../server/integrations/speech-router.ts';
import { visualTheme } from '../../shared/visual-theme.ts';
import type { StoredData } from '../../server/store.ts';
import { currentActivity } from '../../shared/game-plan.ts';

const here=fileURLToPath(new URL('.',import.meta.url));
const root=resolve(here,'../..'), source=realpathSync(join(root,'data'));
const port=Number(process.argv[2]??8863);
if(!Number.isInteger(port)||port<8863||port>8899)throw Error('需要指定8863至8899之间的隔离试用端口');
const database=new DatabaseSync(join(source,'playroom.sqlite'),{readOnly:true});
let body:string;
try { body=(database.prepare('SELECT body FROM documents WHERE id=1').get() as {body:string}).body; }
finally { database.close(); }
const data=JSON.parse(body) as StoredData;
const sourceHash=createHash('sha256').update(body).digest('hex');

// Read just the non-secret settings needed to locate existing local recordings.
const config=join(root,'.env');
if(existsSync(config)){
  const values=Object.fromEntries(readFileSync(config,'utf8').split(/\r?\n/).flatMap(line=>{
    const match=/^([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    return match?[[match[1],match[2].replace(/^["']|["']$/g,'')]]:[];
  }));
  for(const key of ['SPEECH_OUTPUT_PROVIDER','ELEVENLABS_VOICE_ID','ELEVENLABS_VOICE_ID_EN','ELEVENLABS_TTS_MODEL','ELEVENLABS_OUTPUT_FORMAT','AZURE_TTS_VOICE_EN']){
    if(values[key])process.env[key]=values[key];
  }
}

const responses=new Map<string,{type:string;bytes:Buffer|string;}>();
const add=(url:string,type:string,bytes:Buffer|string)=>responses.set(url,{type,bytes});
const mediaTypes:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.mp3':'audio/mpeg'};
function copyAsset(url:string,path:string,base:string){
  if(!existsSync(path))return false;
  const real=realpathSync(path), allowed=realpathSync(base)+sep, type=mediaTypes[extname(real).toLowerCase()];
  if(!real.startsWith(allowed)||!type)return false;
  add(url,type,readFileSync(real));
  return true;
}
const profiles=wordLearningProfiles(data).filter(row=>row.available&&row.encountered);
const historyIds=new Set(profiles.map(row=>row.wordId));
const words=data.words.filter(word=>historyIds.has(word.id));
const usable=new Map<string,{term:string;meaning:string;picture:string;sound?:string}>();
for(const word of words){
  const image=decodeURIComponent(word.imageUrl);
  const base=image.startsWith('/media/')?source:join(root,'public');
  if(!image.startsWith('/media/')&&!image.startsWith('/assets/'))continue;
  const key='/images/'+usable.size;
  if(!copyAsset(key,resolve(base,image.startsWith('/media/')?image.slice(7):image.slice(1)),base))continue;
  const clip=await getCachedSpeech({text:word.term,locale:'en-US',tone:'clear',dataDir:source}).catch(()=>undefined);
  const sound='/audio/'+usable.size+'.mp3';
  usable.set(word.id,{term:word.term,meaning:word.meaning,picture:key,sound:clip&&copyAsset(sound,clip,join(source,'speech'))?sound:undefined});
}
const input={...data,learningReadyWordIds:[...usable.keys()],settings:{...data.settings,learningStrategy:'memory-loop' as const,dailyReviewWords:50,sessionMinutes:30}};
type Prompt=NonNullable<ReturnType<typeof usable.get>>;
const distinct=(a:Prompt,b:Prompt)=>
  a.term.toLowerCase()!==b.term.toLowerCase()&&a.meaning!==b.meaning&&a.picture!==b.picture;
function choosePlan(now:Date){
  const day=learningDay(now);
  const profiles=wordLearningProfiles(input,now).filter(row=>row.available&&row.encountered);
  const due=new Set(dailyLearningPlan(input,now,'review').tasks.filter(task=>task.steps.some(step=>step==='recall'||step==='practice-zh-en')).map(task=>task.wordId));
  const targets=profiles.filter(row=>row.firstEncounterAt&&learningDay(new Date(row.firstEncounterAt))<day
    &&due.has(row.wordId)&&usable.get(row.wordId)?.sound&&!row.abilities.recall.pendingReview
    &&(!row.abilities.recall.verified||row.abilities.recall.independentDays<2))
    .map(row=>data.words.find(word=>word.id===row.wordId)!)
    .filter(word=>assessmentCue(word,words).kind==='meaning')
    .sort((a,b)=>learningWeakness(data,a,'recall',now)-learningWeakness(data,b,'recall',now));
  const selected:Prompt[]=[];
  for(const target of targets){
    const row=usable.get(target.id)!;
    if(selected.every(other=>distinct(row,other)))selected.push(row);
    if(selected.length===2)break;
  }
  const fillers:typeof selected=[];
  for(const row of usable.values()){
    if([...selected,...fillers].every(other=>distinct(row,other)))fillers.push(row);
    if(fillers.length===3)break;
  }
  return {day,selected,fillers:fillers.length>=3?fillers:[]};
}
copyAsset('/brand',resolve(root,'public',visualTheme.brandIcon.slice(1)),join(root,'public'));
copyAsset('/background',resolve(root,'public',visualTheme.homeDesktop.slice(1)),join(root,'public'));
add('/','text/html; charset=utf-8',readFileSync(join(here,'index.html')));
add('/trial.js','text/javascript; charset=utf-8',readFileSync(join(here,'trial.js')));
add('/trial.css','text/css; charset=utf-8',readFileSync(join(here,'trial.css')));

// The app uses its own persistent Store. The only formal database handle above was read-only.
const run=join(root,'artifacts',`recall-warmup-${port}`), studyDir=join(run,'study');
mkdirSync(studyDir,{recursive:true});
if(realpathSync(studyDir)!==studyDir||studyDir.startsWith(source+sep))throw Error('试用目录须为独立实体目录');
const studyDatabase=join(studyDir,'playroom.sqlite');
if(existsSync(studyDatabase)&&realpathSync(studyDatabase)!==studyDatabase)throw Error('试用数据库不能是链接');
const firstRun=!existsSync(studyDatabase);
if(firstRun){
  const images=new Set<string>();
  const collect=(value:unknown):void=>{
    if(typeof value==='string'&&value.startsWith('/media/')){
      const name=decodeURIComponent(value.slice(7));
      if(/^\.(?:png|jpe?g|webp|svg)$/i.test(extname(name)))images.add(name);
    }else if(value&&typeof value==='object')Object.values(value).forEach(collect);
  };
  collect(data.words);
  collect(data.sessions);
  collect(data.assessments);
  for(const name of images){
    const original=resolve(source,name), local=resolve(studyDir,name);
    if(!original.startsWith(source+sep)||!local.startsWith(studyDir+sep)||!existsSync(original)||!realpathSync(original).startsWith(source+sep))continue;
    mkdirSync(dirname(local),{recursive:true});
    if(!realpathSync(dirname(local)).startsWith(studyDir+sep))throw Error('试用素材目录不能是链接');
    copyFileSync(original,local);
  }
}
const speechDir=join(studyDir,'speech');
mkdirSync(speechDir,{recursive:true});
if(realpathSync(speechDir)!==speechDir)throw Error('试用音频目录不能是链接');
const cachedSpeech:typeof getCachedSpeech=async cue=>{
  const local=await getCachedSpeech({...cue,dataDir:studyDir}).catch(()=>undefined);
  if(local&&realpathSync(local).startsWith(speechDir+sep))return local;
  const original=await getCachedSpeech({...cue,dataDir:source}).catch(()=>undefined);
  if(!original||!realpathSync(original).startsWith(join(source,'speech')+sep))return;
  const to=join(speechDir,basename(original));
  if(existsSync(to)&&realpathSync(to)!==to)throw Error('试用音频不能是链接');
  copyFileSync(original,to);
  return to;
};
const offline={configured:false,available:false,status:'preview_offline',detail:'独立试用使用已有缓存'};
const deny=async():Promise<never>=>{throw Error('独立试用只使用已有缓存。');};
const {createApp}=await import('../../server/index.ts');
const app=createApp({rootDir:root,dataDir:studyDir,observationAudience:'engineering',chatEnabled:false,
  challengeServices:{transcribe:deny,grade:deny},
  dialogue:{status:async()=>offline,turn:deny,cancel(){},reset:async()=>{},close:async()=>{}},
  integrations:{probeIntegrations:async()=>({speech:offline,codex:offline}),ttsStatus:()=>offline,sttStatus:()=>offline,getCachedSpeech:cachedSpeech,
    synthesizeSpeech:deny,streamSpeech:deny,transcribeSpeech:deny,generateIllustration:deny,enrichVocabulary:deny,beginCodexLogin:deny,createLiveSttSession:deny},
});
if(firstRun)app.store.mutate(trial=>{
  Object.assign(trial,structuredClone(data));
  trial.learningTaskPolicy=1;
  trial.charges=[];
  trial.jobs=[];
  for(const take of trial.practiceRecordings??[])if(take.status==='ready')take.status='missing';
  for(const assessment of trial.assessments??[])for(const item of assessment.items){
    const take=item.response?.recording;
    if(take?.status==='ready')take.status='missing';
  }
});
const current=()=> {
  const trial=app.store.read();
  return trial.sessions.find(session=>session.id===trial.activeLearningSessionId&&!session.completedAt&&!session.suspendedAt);
};
const build=resolve(process.env.RECALL_PREVIEW_DIST??join(root,'dist'));
const shell=readFileSync(join(build,'index.html'),'utf8')
  .replace('</head>','<link rel="stylesheet" href="/isolated-banner.css"></head>')
  .replace('<body>','<body><aside class="isolated-banner">独立试用 <a href="/">回短回忆首页</a></aside>');
add('/study','text/html; charset=utf-8',shell);
add('/isolated-banner.css','text/css; charset=utf-8','.isolated-banner{padding:6px 12px;background:#fff3c6;color:#634c13;text-align:center;font:600 14px/1.4 system-ui}.isolated-banner a{margin-inline-start:12px;color:inherit}');
for(const match of shell.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)){
  const path=match[1];
  add(path,path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8',readFileSync(join(build,path.slice(1))));
}
const handler=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>void;
app.server.removeAllListeners('request');
app.server.on('request',(request,response)=>{
  const route=request.url?.split('?')[0]??'';
  if(request.method==='GET'&&route==='/continue-learning'){
    response.writeHead(303,{Location:'/study#'+(current()?'play':'learn'),'Cache-Control':'no-store'});
    response.end();
    return;
  }
  const asset=request.method!=='GET'?undefined:route==='/plan'
    ?{type:'application/json; charset=utf-8',bytes:JSON.stringify({...choosePlan(new Date()),canResume:!!current()})}
    :responses.get(route);
  if(!asset&&(
    request.method==='GET'&&/^\/(assets|media)\//.test(route)
    ||/^\/api\/(?:state|health|screen-time|study(?:\/(?:start|save))?|session(?:\/(?:start|save-position|activity|assessment-practice|review-support|daily-choice|end|upgrade-experience))?|sentence-study|attempts|practice-recordings(?:\/[a-zA-Z0-9-]+\/audio)?|speech\/tts(?:\/stream)?|business\/events|assessments(?:\/[a-zA-Z0-9-]+(?:\/(?:responses|recordings|submit))?)?)$/.test(route)
  )){handler(request,response);return;}
  response.writeHead(asset?200:404,{'Content-Type':asset?.type??'text/plain; charset=utf-8','Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});
  response.end(asset?.bytes??'页面不存在');
});
app.server.listen(port,'127.0.0.1',()=>{
  const {selected,fillers}=choosePlan(new Date());
  const session=current();
  console.log(JSON.stringify({url:'http://127.0.0.1:'+port,sourceHash,targets:selected.length,gapQuestions:fillers.length>=3?2:0,
    sessionId:session?.id,activityId:session&&currentActivity(session)?.id}));
});
