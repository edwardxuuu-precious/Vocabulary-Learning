import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,relative,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {getCachedSpeech} from '../../server/integrations/index.ts';
import {sentenceLesson} from '../../shared/sentence-study.ts';
import {visualTheme} from '../../shared/visual-theme.ts';
import {ScreenTime} from '../../server/screen-time.ts';
import type {StoredData} from '../../server/store.ts';
import type {PreviewContent,WordCard} from './model.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2);
const sourceArg=args.find(a=>a.startsWith('--source='))?.slice(9),port=Number(args.find(a=>a.startsWith('--port='))?.slice(7)??8843);
const scopeId=args.find(a=>a.startsWith('--scope='))?.slice(8);
assert.ok(sourceArg&&resolve(sourceArg)===sourceArg.replaceAll('/',sep),'需要显式的正式data绝对路径。');
assert.ok(args.every(a=>/^--(?:source|port|scope)=/.test(a))&&Number.isInteger(port)&&port>=1024&&port<65536);
const source=realpathSync(sourceArg),run=join(root,'artifacts','meaning-games',`preview-${Date.now()}-${port}`),dist=join(run,'dist'),media=join(run,'content');
assert.ok(run.startsWith(join(root,'artifacts')+sep));mkdirSync(media,{recursive:true});
const readSource=()=>{const db=new DatabaseSync(join(source,'playroom.sqlite'),{readOnly:true});try{return (db.prepare('SELECT body FROM documents WHERE id=1').get() as {body:string}).body;}finally{db.close();}};
const original=readSource(),data=JSON.parse(original) as StoredData,sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const envPath=join(source,'..','.env');if(existsSync(envPath)){const env=parseEnv(readFileSync(envPath,'utf8'));for(const key of ['SPEECH_OUTPUT_PROVIDER','ELEVENLABS_VOICE_ID','ELEVENLABS_VOICE_ID_EN','ELEVENLABS_VOICE_ID_ZH','ELEVENLABS_TTS_MODEL'])if(env[key])process.env[key]=env[key];}
let blockedOutbound=0;globalThis.fetch=async()=>{blockedOutbound++;throw Error('本测试仅使用已缓存素材。');};
const files=new Map<string,{file:string;mime:string;hash:string}>(),sourceFiles=new Map<string,string>();
function snapshot(url:string,file:string,base:string,mime:string){const p=realpathSync(file);assert.ok(p.startsWith(realpathSync(base)+sep),'素材超出明确来源目录。');const target=join(media,sha(url)+extname(p));copyFileSync(p,target);const hash=sha(readFileSync(p));sourceFiles.set(p,hash);files.set(url,{file:target,mime,hash});return url;}
const colors:Record<string,string>={black:'#26313c',brown:'#9a623b',red:'#e85d62',blue:'#4b91dd'};
const scope=scopeId?data.sessions.find(s=>s.id===scopeId):[...data.sessions].reverse().find(s=>s.completedAt&&new Set(s.wordIds).size===10);
assert.ok(scope,'需要明确的真实学习范围。');const scopeIds=[...new Set(scope.wordIds)];assert.ok(scopeIds.length>=2&&scopeIds.length<=20);
const cards:WordCard[]=[],lines:PreviewContent['lines']=[];
for(const id of scopeIds){
  const w=data.words.find(w=>w.id===id&&w.assetStatus==='approved'&&w.imageUrl.startsWith('/media/')&&data.packs.some(p=>p.id===w.packId&&p.enabled&&!p.isSample));
  assert.ok(w,'本次范围包含尚未准备的词。');const term=w.term.toLowerCase(),frozen=scope.activities?.find(a=>a.wordId===id)?.word;
  assert.ok(!frozen||frozen.term===w.term&&frozen.meaning===w.meaning&&frozen.imageUrl===w.imageUrl&&(frozen.learningVersion??0)===(w.learningVersion??0),'本次范围的词义或图片已变化，请重新确认。');
  const audio=await getCachedSpeech({text:w.term,locale:'en-US',tone:'clear',dataDir:source});assert.ok(audio,`缺少原音缓存：${term}`);
  const imageFile=resolve(source,decodeURIComponent(w.imageUrl.slice(7)));
  const context=sentenceLesson(w)?.cue.text;
  const card:WordCard={id:w.id,term:w.term,meaning:w.meaning,version:w.learningVersion??0,image:snapshot(`/content/image/${w.id}`,imageFile,source,'image/png'),audio:snapshot(`/content/audio/${w.id}`,audio,source,'audio/mpeg'),...(colors[term]?{color:colors[term]}:{}),...(context?{context}:{})};cards.push(card);
  if(['am','are','be'].includes(term)){
    const lesson=sentenceLesson(w);assert.ok(lesson?.cue.sentence&&lesson.cue.kind==='context');
    const full=await getCachedSpeech({text:lesson.full,locale:'en-US',tone:'clear',dataDir:source});assert.ok(full,`缺少已确认短句缓存：${lesson.full}`);
    lines.push({wordId:w.id,full:lesson.full,gap:lesson.cue.sentence,chinese:lesson.cue.text,phrase:lesson.usage.phrase,usage:lesson.usage.meaning,audio:snapshot(`/content/line/${w.id}`,full,source,'audio/mpeg')});
  }
}
const publicDir=join(root,'public');
function art(name:string,url:string){return snapshot('/content/art/'+name,resolve(publicDir,'.'+url),publicDir,url.endsWith('.svg')?'image/svg+xml':'image/png');}
const content:PreviewContent={key:sha(JSON.stringify([cards,lines,[...files].map(([url,f])=>[url,f.hash])])),words:cards,lines,art:{home:art('home',visualTheme.homeDesktop),hero:art('hero',visualTheme.characters.optimus.image),other:art('other',visualTheme.characters.megatron.image),icon:art('icon',visualTheme.brandIcon)}};
writeFileSync(join(run,'content-check.json'),JSON.stringify({skill:'learning-material-check/v1',scopeSessionId:scope.id,words:cards.map(w=>({id:w.id,term:w.term,version:w.version})),wordImages:cards.length,wordAudio:cards.length,sentenceAudio:lines.length,noGeneration:true},null,2));
await build({configFile:false,root:dirname(fileURLToPath(import.meta.url)),plugins:[react()],logLevel:'warn',build:{outDir:dist,emptyOutDir:false}});
const timerDb=new DatabaseSync(join(run,'preview.sqlite')),screen=new ScreenTime(timerDb,()=>new Date());
const audit=()=>{const value={url:`http://127.0.0.1:${port}`,isolated:true,sourceUnchanged:sha(readSource())===sha(original),sourceMediaUnchanged:[...sourceFiles].every(([p,h])=>existsSync(p)&&sha(readFileSync(p))===h),blockedOutbound,wordImages:cards.length,cachedAudio:cards.length+lines.length,formalWrites:0};writeFileSync(join(run,'audit.json'),JSON.stringify(value,null,2));return value;};
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=createServer((req,res)=>{void(async()=>{
  const url=new URL(req.url??'/',`http://127.0.0.1:${port}`),route=url.pathname;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(route==='/api/screen-time'){
    if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(screen.view()));return;}
    if(req.method==='POST'){if(req.headers.origin&&req.headers.origin!==url.origin){res.writeHead(403);res.end();return;}let body='';for await(const chunk of req){body+=String(chunk);assert.ok(body.length<=1024);}const input=JSON.parse(body);assert.ok(typeof input.clientId==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(input.clientId)&&typeof input.active==='boolean');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(screen.heartbeat(input.clientId,input.active)));return;}
  }
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(route==='/preview/content'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(content));return;}
  if(route==='/preview/audit'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(audit()));return;}
  const file=files.get(route);if(file){res.setHeader('Content-Type',file.mime);res.end(readFileSync(file.file));return;}
  const filePath=route==='/'?join(dist,'index.html'):resolve(dist,'.'+decodeURIComponent(route));
  if(filePath.startsWith(dist+sep)&&existsSync(filePath)&&mime[extname(filePath)]){res.setHeader('Content-Type',mime[extname(filePath)]);res.end(readFileSync(filePath));return;}
  res.writeHead(404);res.end('未找到这个测试资源。');
})().catch(error=>{if(!res.headersSent)res.writeHead(400);res.end(error instanceof Error?error.message:'测试服务暂时不可用。');});});
await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
console.log(JSON.stringify({...audit(),run:relative(root,run),games:3}));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{audit();server.close(()=>{timerDb.close();process.exit(0);});});
