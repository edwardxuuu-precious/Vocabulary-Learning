import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,realpathSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {IncomingMessage,ServerResponse} from 'node:http';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.ts';
import {ParentGate} from '../server/parent-gate.ts';
import {sentenceLesson} from '../shared/sentence-study.ts';
import {createAssessment,rebuildAssessmentProgress} from '../server/assessments.ts';
import {gameWord} from '../shared/game-plan.ts';
import type {StoredData} from '../server/store.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const sourceArg=args.find(arg=>arg.startsWith('--source='))?.slice(9);assert.ok(sourceArg,'必须明确只读原素材来源');
const source=realpathSync(sourceArg),build=resolve(args.find(arg=>arg.startsWith('--dist='))?.slice(7)??join(root,'artifacts/refactor-v2/execution-dist'));
const port=Number(args.find(arg=>arg.startsWith('--port='))?.slice(7)??8848);assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
const db=new DatabaseSync(join(source,'playroom.sqlite'),{readOnly:true});const original=JSON.parse((db.prepare('SELECT body FROM documents WHERE id=1').get() as {body:string}).body) as StoredData;db.close();
const run=join(root,'artifacts/refactor-v2',`qa-${Date.now()}`),dataDir=join(run,'data');mkdirSync(dataDir,{recursive:true});
const media=new Set<string>();const collect=(value:unknown)=>{if(typeof value==='string'&&value.startsWith('/media/')&&/\.(?:png|jpe?g|webp|svg)$/i.test(value))media.add(decodeURIComponent(value.slice(7)));else if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')Object.values(value).forEach(collect);};collect(original);
for(const name of media){const from=resolve(source,name);assert.ok(from.startsWith(source+sep));if(!existsSync(from))continue;assert.ok(realpathSync(from).startsWith(source+sep));const to=resolve(dataDir,name);assert.ok(to.startsWith(dataDir+sep));mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);}
// Only cache lookup uses the real configuration; every network/generation operation is denied.
if(existsSync(join(root,'.env')))process.loadEnvFile(join(root,'.env'));
const speech=await import('../server/integrations/speech-router.ts');
const clips=new Map<string,string>();mkdirSync(join(dataDir,'speech'),{recursive:true});
for(const word of original.words.filter(word=>word.assetStatus==='approved')){
  for(const [text,locale] of [[word.term,'en-US'],[`意思是，${word.meaning.replace(/[。！？!?]+$/u,'')}。`,'zh-CN'],...(sentenceLesson(word)?[[sentenceLesson(word)!.full,'en-US']]:[])] as [string,'en-US'|'zh-CN'][]){
    const key=JSON.stringify([text,locale]);if(clips.has(key))continue;
    const cached=await speech.getCachedSpeech({text,locale,tone:'clear',dataDir:source});if(!cached)continue;
    const real=realpathSync(cached);assert.ok(real.startsWith(join(source,'speech')+sep));const to=join(dataDir,'speech',`approved-${clips.size}.mp3`);copyFileSync(real,to);clips.set(key,to);
  }
}
const denied:string[]=[],deny=(name:string):never=>{denied.push(name);throw Error('隔离验收禁止外部服务：'+name);};globalThis.fetch=async()=>deny('fetch');
const offline={configured:false,available:false,status:'engineering-copy',detail:'原素材隔离副本，无外部调用'};
const app=createApp({rootDir:root,dataDir,observationAudience:'engineering',chatEnabled:false,challengeServices:{transcribe:async()=>deny('transcribe'),grade:async()=>deny('grade')},integrations:{probeIntegrations:async()=>({speech:offline,codex:offline}),ttsStatus:()=>offline,sttStatus:()=>offline,getCachedSpeech:async input=>clips.get(JSON.stringify([input.text,input.locale])),synthesizeSpeech:async()=>deny('tts'),streamSpeech:async()=>deny('stream'),transcribeSpeech:async()=>deny('stt'),generateIllustration:async()=>deny('image'),enrichVocabulary:async()=>deny('words')}});
new ParentGate(dataDir).setup('684219');
const enabled=new Set(original.packs.filter(pack=>pack.enabled&&!pack.isSample&&!pack.deletedAt).map(pack=>pack.id));
const ready=original.words.filter(word=>enabled.has(word.packId)&&word.assetStatus==='approved'&&!word.deletedAt&&clips.has(JSON.stringify([word.term,'en-US'])));
const basic=ready.filter(word=>!sentenceLesson(word)).slice(0,3),usage=ready.find(word=>word.term.toLowerCase()==='be')??ready.find(word=>sentenceLesson(word));assert.ok(basic.length>=2);
function scenario(name:string){
  assert.ok(['original','fresh','weak','pending','usage','empty','archive'].includes(name));
  app.store.mutate(data=>{
    Object.assign(data,structuredClone(original));data.profile={...data.profile,nickname:'工程隔离副本'};data.settings={...data.settings,voiceEnabled:true};
    data.studyReceipts=[];data.practiceRecordings=(data.practiceRecordings??[]).map(row=>({...row,status:'missing'}));
    for(const session of data.assessments??[])for(const item of session.items)if(item.response?.recording)item.response.recording.status='missing';
    if(name==='original')return;
    data.sessions=[];data.attempts=[];data.progress=[];data.assessments=[];data.assessmentAttempts=[];data.assessmentProgress=[];data.assessmentPractices=[];data.sentenceStudies=[];data.practiceRecordings=[];data.activeLearningSessionId=null;delete data.lastCompletedLearningSessionId;
    const words=name==='usage'&&usage?[usage]:basic;data.settings.dailyNewWords=3;
    data.dailyLearningChoice={day:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),revision:1,goal:3,wordIds:words.map(word=>word.id),wordVersions:Object.fromEntries(words.map(word=>[word.id,word.learningVersion??0]))};
    if(name==='fresh')return;
    const prior=new Date(Date.now()-2*86400000).toISOString(),ids=words.map(word=>word.id);
    data.sessions.push({id:randomUUID(),wordIds:ids,completedWordIds:ids,startedAt:prior,completedAt:prior,rewardGranted:false,exposures:words.map(word=>({wordId:word.id,learningVersion:word.learningVersion??0,introducedAt:prior}))});
    if(name==='usage')return;
    if(name==='pending'){
      const test=createAssessment(data,{mode:'full',workflow:'recorded',wordIds:[words[0].id],cueVersion:2},new Date());
      const answeredAt=new Date().toISOString();for(const item of test.items)item.response={version:1,kind:'skipped',answeredAt};test.submittedAt=answeredAt;test.completedAt=answeredAt;test.job={status:'review',stage:'grade',runs:0};
      // Ready metadata is isolated; no real child recording is copied or claimed as correct.
      const item=test.items.find(item=>item.dimension==='read')!;const wave=Buffer.alloc(32044);wave.write('RIFF');wave.writeUInt32LE(32036,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(32000,40);const takeId=randomUUID();mkdirSync(join(dataDir,'assessment-recordings'),{recursive:true});writeFileSync(join(dataDir,'assessment-recordings',takeId+'.wav'),wave);item.response={version:1,kind:'recording',answeredAt,recording:{id:takeId,bytes:32044,seconds:1,sha256:createHash('sha256').update(wave).digest('hex'),status:'ready'}};return;
    }
    if(name==='weak'||name==='empty'||name==='archive'){
      const at=new Date(Date.now()-86400000).toISOString(),test=createAssessment(data,{mode:'full',wordIds:ids},new Date(at));
      test.completedAt=at;
      for(const item of test.items){const result=(name==='weak'||name==='archive')&&item.dimension==='read'&&item.word.id===words[0].id?'incorrect':'correct';item.result=result;if(item.dimension==='look')item.selectedId=item.word.id;(data.assessmentAttempts??=[]).push({id:`${test.id}:${item.id}`,sessionId:test.id,itemId:item.id,wordId:item.word.id,learningVersion:item.word.learningVersion,dimension:item.dimension,result,source:item.dimension==='look'?'server':'parent',createdAt:at});}
      rebuildAssessmentProgress(data);if(name==='empty')for(const progress of data.assessmentProgress??[])progress.dueAt=new Date(Date.now()+86400000).toISOString();
    }
  });
}
scenario(args.includes('--original')?'original':'fresh');
const listener=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>void;app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{const url=new URL(req.url??'/',`http://127.0.0.1:${port}`);if(url.pathname==='/__study-qa/scenario'){scenario(url.searchParams.get('name')??'fresh');res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('工程隔离场景已切换');return;}if(url.pathname==='/__study-qa/status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({isolated:true,run,denied}));return;}if(url.pathname==='/'||url.pathname==='/index.html'){let html=readFileSync(join(build,'index.html'),'utf8');html=html.replace('</body>','<div style="position:fixed;bottom:0;right:0;z-index:9999;pointer-events:none;background:#fff3c4;padding:5px 12px;font:12px sans-serif;color:#795e18">工程隔离副本 · 原词图/缓存发音 · 不修改正式进度</div></body>');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}if(/^\/assets\/index-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname)){const file=join(build,url.pathname.slice(1));if(existsSync(file)){res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/css','Cache-Control':'no-store'});res.end(readFileSync(file));return;}}listener(req,res);});
writeFileSync(join(run,'qa-scope.json'),JSON.stringify({isolated:true,images:media.size,clips:clips.size,sourceReadOnly:true,privateAudioCopied:false},null,2));
await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));console.log(JSON.stringify({url:`http://127.0.0.1:${port}`,run,originalImages:media.size,cachedClips:clips.size,privateAudioCopied:false}));
