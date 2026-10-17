import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ImportRow, ServiceStatus } from '../shared/contracts.ts';

// UI workflow fixture only: deterministic test PNGs, existing MP3s, no credentials or external calls.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const arg=process.argv.find(item=>item.startsWith('--dist='))?.slice(7)??'dist';
if(process.argv.slice(2).some(item=>item!=='--serve'&&!item.startsWith('--dist=')))throw Error('仅支持 --serve 与 --dist');
const inside=(base:string,file:string)=>{const p=relative(base,file);return p!==''&&p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p);};
const dist=realpathSync(resolve(root,arg));assert.ok(inside(root,dist));
const fixtureRoot=join(root,'artifacts','pack-images-qa-'+randomUUID()),dataDir=join(fixtureRoot,'data');
await mkdir(join(dataDir,'speech','fixture'),{recursive:true});
await cp(join(root,'public'),join(fixtureRoot,'public'),{recursive:true});await cp(dist,join(fixtureRoot,'dist'),{recursive:true});
const html=await readFile(join(fixtureRoot,'dist','index.html'),'utf8');await writeFile(join(fixtureRoot,'dist','index.html'),html.replace('<body>','<body><div style="background:#fff0b9;padding:8px;text-align:center;color:#5b4529;font-size:14px">隔离功能验收 · 模拟生图，仅本机测试PNG · 发音复用已缓存MP3 · 外网已封锁</div>'));
for(const name of Object.keys(process.env))if(/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name))delete process.env[name];
const load=process.loadEnvFile;process.loadEnvFile=()=>{};const{createApp}=await import('../server/index.ts');process.loadEnvFile=load;
const denied:Record<string,number>={},imageCalls:string[]=[];let failedCar=false;
const deny=(name:string):never=>{denied[name]=(denied[name]??0)+1;throw Error('QA禁止云请求');};globalThis.fetch=async()=>deny('fetch');
const audio=new Map<string,string>(),manifest=JSON.parse(await readFile(join(root,'artifacts','adaptive-qa-cache.json'),'utf8')) as {term:string;file:string}[];
const mediaRoot=realpathSync(join(root,'data','speech'));
for(const row of manifest){const source=realpathSync(row.file);assert.ok(inside(mediaRoot,source)&&statSync(source).isFile());const file=join(dataDir,'speech','fixture',row.term+'.mp3');await copyFile(source,file);audio.set(row.term,file);}
const tts:ServiceStatus={configured:false,available:false,provider:'elevenlabs',status:'cache_only',detail:'QA仅缓存MP3，不发送TTS'};
const codex:ServiceStatus={configured:true,available:false,provider:'codex',status:'mock_only',detail:'隔离模拟图片编排，不是真实Codex调用'};
const no:ServiceStatus={configured:false,available:false,status:'qa_disabled',detail:'QA禁用'};
const vocabularyCalls:string[][]=[];
const vocabulary:Record<string,ImportRow>={
  apple:{term:'apple',meaning:'苹果',partOfSpeech:'noun',pictureHint:'一颗清晰的大苹果，没有文字',usageNote:''},
  jump:{term:'jump',meaning:'跳跃',partOfSpeech:'verb',pictureHint:'一个孩子双脚离地正在跳跃，没有文字',usageNote:''},
  ball:{term:'ball',meaning:'球',partOfSpeech:'noun',pictureHint:'一个清晰的圆球，没有文字',usageNote:'本次学习玩耍用的球。'},
  car:{term:'car',meaning:'汽车',partOfSpeech:'noun',pictureHint:'一辆清晰的小汽车，没有文字',usageNote:''},
  moon:{term:'moon',meaning:'月亮',partOfSpeech:'noun',pictureHint:'夜空一轮大月亮，没有文字',usageNote:''},
  light:{term:'light',meaning:'轻的',partOfSpeech:'adjective',pictureHint:'一片轻轻飘起的羽毛，对比压弯地面的石头，没有文字',usageNote:'另有光和点亮的意思，本次选形容词轻的。'},
};
const app=createApp({rootDir:fixtureRoot,dataDir,chatEnabled:false,
  dialogue:{status:async()=>no,turn:async()=>deny('chat'),cancel(){},reset:async()=>{},close:async()=>{}},
  integrations:{probeIntegrations:async()=>({speech:tts,tts,codex,stt:no}),ttsStatus:()=>tts,
    enrichVocabulary:async input=>{vocabularyCalls.push(input.rows.map(row=>row.term));await new Promise<void>((done,reject)=>{const timer=setTimeout(done,input.rows.some(row=>row.term==='moon')?30000:700);input.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Object.assign(Error('模拟取消词义补全'),{code:'CANCELLED'}));},{once:true});});return input.rows.map(row=>{const value=vocabulary[row.term];assert.ok(value,'QA只支持明确测试词条');return{...value,...(row.meaning?{meaning:row.meaning}:{}),...(row.partOfSpeech?{partOfSpeech:row.partOfSpeech}:{})};});},
    getCachedSpeech:async input=>input.locale==='en-US'&&input.tone==='clear'&&input.rate===undefined?audio.get(input.text):undefined,
    synthesizeSpeech:async()=>deny('tts'),streamSpeech:async()=>deny('stream'),beginCodexLogin:async()=>deny('oauth'),transcribeSpeech:async()=>deny('stt'),createLiveSttSession:async()=>deny('live'),estimateTtsCost:()=>0,estimateSttCost:()=>0,
    generateIllustration:async input=>{
      imageCalls.push(input.term);
      await new Promise<void>((done,reject)=>{const timer=setTimeout(done,input.term==='moon'?30000:500);input.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Object.assign(Error('QA cancelled'),{code:'CANCELLED'}));},{once:true});});
      if(input.term==='car'&&!failedCar){failedCar=true;throw Object.assign(Error('QA模拟额度不足，停止当前书'),{code:'CODEX_RATE_LIMIT'});}
      assert.ok(['apple','ball','car','moon'].includes(input.term),'QA只有四种明确fixture，不生成其它图');
      const source=join(root,'artifacts','pack-images-qa-assets',input.term+'.png');await mkdir(input.outputDir,{recursive:true});const filePath=join(input.outputDir,'illustration.png');await copyFile(source,filePath);return{filePath};
    },
  }});
const original=app.server.listeners('request')[0] as(req:IncomingMessage,res:ServerResponse)=>void;app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{
  if(req.method==='GET'&&req.url==='/__qa'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({fixture:true,mockImages:true,mockVocabulary:true,state:app.store.state({speech:tts,tts,codex}),data:app.store.read(),imageCalls,vocabularyCalls,denied}));return;}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'");original(req,res);
});
await writeFile(join(fixtureRoot,'audit.json'),JSON.stringify({fixtureRoot,cacheFiles:audio.size,mockImages:true,cloud:false}));
if(process.argv.includes('--serve')){await new Promise<void>(done=>app.server.listen(8793,'127.0.0.1',done));console.log(JSON.stringify({url:'http://127.0.0.1:8793/',fixtureRoot}));for(const signal of['SIGINT','SIGTERM']as const)process.once(signal,()=>void app.close().then(()=>process.exit(0)));}
else{await app.close();console.log(JSON.stringify({prepared:true,fixtureRoot}));}
