import assert from 'node:assert/strict';
import {createReadStream,existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {sentenceLesson} from '../shared/sentence-study.ts';
import {dirname,extname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createApp} from '../server/index.ts';
import {ParentGate} from '../server/parent-gate.ts';

/** Explicit isolated examples only. No family database, audio, PIN or external service is used. */
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const port=Number(args.find(arg=>arg.startsWith('--port='))?.slice(7)??8843),build=resolve(args.find(arg=>arg.startsWith('--dist='))?.slice(7)??join(root,'dist'));
assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);assert.ok(existsSync(join(build,'index.html')));
const run=join(root,'artifacts','learning-followup-qa',`run-${Date.now()}-${port}`),dataDir=join(run,'data'),fixture=run.split(/[\\/]/).at(-1)!;
mkdirSync(join(dataDir,'speech'),{recursive:true});const audio=join(dataDir,'speech','explicit-silent-fixture.wav');writeFileSync(audio,Buffer.alloc(64));
let offset=0;const denied:string[]=[],deny=(name:string):never=>{denied.push(name);throw Error('工程隔离示例禁止云调用。');};
const sentenceAudio=new Map<string,string>();
globalThis.fetch=async()=>deny('fetch');
const off={configured:false,available:false,status:'engineering_fixture',detail:'隔离工程示例，模拟素材就绪，不调用云服务'};
const app=createApp({rootDir:root,dataDir,clock:()=>new Date(Date.now()+offset),observationAudience:'engineering',chatEnabled:false,
  dialogue:{status:async()=>off,turn:async()=>deny('dialogue'),cancel(){},reset:async()=>{},close:async()=>{}},
  challengeServices:{transcribe:async()=>deny('transcribe'),grade:async()=>deny('grade')},
  integrations:{probeIntegrations:async()=>({speech:off,codex:off}),ttsStatus:()=>off,sttStatus:()=>off,getCachedSpeech:async input=>sentenceAudio.get(input.text)??(args.includes('--sentence-audio')&&input.text.includes(' ')?undefined:audio),
    synthesizeSpeech:async()=>deny('tts'),streamSpeech:async()=>deny('stream'),transcribeSpeech:async()=>deny('stt'),generateIllustration:async()=>deny('image'),enrichVocabulary:async()=>deny('vocabulary'),beginCodexLogin:async()=>deny('login'),createLiveSttSession:async()=>deny('live')},
});
new ParentGate(dataDir).setup('684219');
app.store.mutate(data=>{
  const now=app.store.clock().toISOString();data.profile.nickname='工程隔离示例';data.settings={...data.settings,voiceEnabled:args.includes('--sentence-audio'),learningStrategy:'memory-loop',dailyNewWords:10,monthlyBudgetCny:0};
  data.packs=[{id:'qa-followup',title:'工程隔离示例词书',enabled:true,createdAt:now}];data.words=data.words.map((word,n)=>({...word,packId:'qa-followup',learningVersion:0,...(args.includes('--ambiguous')&&n<3?{term:['am','are','be'][n],meaning:'是'}:{})}));
  if(args.includes('--ten-contexts')){
    const terms=['all','am','are','at','ate','be','black','brown','but','came'],meanings=['所有的','是','是','在……处','吃了','是','黑色的','棕色的','但是','来了'];
    data.words=data.words.map((word,n)=>n<10?{...word,term:terms[n],meaning:meanings[n]}:word);
  }
  const ids=data.words.slice(0,10).map(word=>word.id);data.sessions=[{id:'qa-completed-ten',entrySource:{entry:'learn',kind:'selected'},wordIds:ids,completedWordIds:ids,startedAt:now,completedAt:now,rewardGranted:true,exposures:ids.map(wordId=>({wordId,learningVersion:0,introducedAt:now}))}];
});
app.store.startSession(false,{}, {entry:'learn',mode:'relearn',wordIds:app.store.read().words.slice(0,3).map(word=>word.id)});
if(args.includes('--sentence-audio')){
  if(existsSync(join(root,'.env')))process.loadEnvFile(join(root,'.env'));
  const speech=await import('../server/integrations/speech-router.ts');
  for(const [index,word] of app.store.read().words.entries()){
    const lesson=sentenceLesson(word);if(!lesson)continue;
    const cached=await speech.getCachedSpeech({text:lesson.full,locale:'en-US',tone:'clear',dataDir:join(root,'data')});
    assert.ok(cached,'先准备这句的真实缓存：'+lesson.full);
    const target=join(dataDir,'speech',`explicit-lesson-${index}.mp3`);copyFileSync(cached,target);sentenceAudio.set(lesson.full,target);
  }
}
const origin=`http://127.0.0.1:${port}`,original=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>void;
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{void(async()=>{
  const url=new URL(req.url??'/',origin),route=url.pathname;
  if(route==='/__qa/time'&&req.method==='POST'){
    if(req.headers['x-qa-fixture']!==fixture){res.writeHead(403);res.end();return;}
    const action=url.searchParams.get('action');
    if(action==='near-limit'){app.store.screenTime.unlock();app.store.screenTime.heartbeat('qa-visible-tab',true);for(let n=0;n<179;n++){offset+=5000;app.store.screenTime.heartbeat('qa-visible-tab',true);}}
    else if(action==='rest-complete')offset+=300_001;
    else {res.writeHead(400);res.end();return;}
    req.resume();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fixture:true,screenTime:app.store.screenTime.view()}));return;
  }
  if(route==='/__qa/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fixture,isolated:true,denied,screenTime:app.store.screenTime.view(),assessments:app.store.read().assessments?.length,formalAttempts:app.store.read().assessmentAttempts?.length,source:'explicit-example-only'}));return;}
  if(req.method==='GET'&&(route==='/'||route==='/index.html')){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
    res.end(readFileSync(join(build,'index.html'),'utf8').replace('<body>','<body><aside style="position:fixed;top:0;right:0;z-index:99999;pointer-events:none;padding:5px 10px;background:#fff1bf;color:#755e32;font:12px sans-serif">工程隔离示例 · 无真实学习数据或云调用</aside>'));return;
  }
  const file=resolve(build,'.'+decodeURIComponent(route));
  if(req.method==='GET'&&route.startsWith('/assets/')&&file.startsWith(build+sep)&&existsSync(file)){
    res.setHeader('Content-Type',({'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'} as Record<string,string>)[extname(file)]??'application/octet-stream');createReadStream(file).pipe(res);return;
  }
  original(req,res);
})().catch(error=>{res.writeHead(500);res.end(String(error));});});
await new Promise<void>(done=>app.server.listen(port,'127.0.0.1',done));
writeFileSync(join(run,'manifest.json'),JSON.stringify({origin,fixture,isolated:true,build},null,2));
console.log(JSON.stringify({origin,fixture,run,isolated:true}));
const close=async()=>{await app.close();process.exit(0);};process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
