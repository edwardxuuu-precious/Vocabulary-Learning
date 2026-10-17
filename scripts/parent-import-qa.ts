import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServiceStatus } from '../shared/contracts.ts';

// Explicit isolated browser harness: no credentials, no OAuth, no outbound generation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find(item => item.startsWith('--dist='))?.slice(7) ?? 'dist';
const missingAudio = process.argv.find(item => item.startsWith('--missing-audio='))?.slice(16);
if (process.argv.slice(2).some(item => item !== '--serve' && !item.startsWith('--dist=') && !item.startsWith('--missing-audio='))) throw Error('仅支持 --serve、--dist=项目内目录、--missing-audio=已有单词');
if (missingAudio !== undefined && !/^[a-z]+$/.test(missingAudio)) throw Error('缺音场景必须指定已有英文单词。');
const inside = (base:string, file:string) => { const p=relative(base,file); return p !== '' && p !== '..' && !p.startsWith('..'+sep) && !isAbsolute(p); };
const dist = realpathSync(resolve(root,arg));
assert.ok(inside(root,dist)); assert.ok(existsSync(join(dist,'index.html')));
const fixtureRoot = join(root,'artifacts','parent-import-qa-'+randomUUID()),dataDir=join(fixtureRoot,'data');
await mkdir(join(dataDir,'speech','fixture'),{recursive:true});
await cp(join(root,'public'),join(fixtureRoot,'public'),{recursive:true});
await cp(dist,join(fixtureRoot,'dist'),{recursive:true});
for(const name of Object.keys(process.env))if(/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name))delete process.env[name];
const realLoad = process.loadEnvFile; process.loadEnvFile=()=>{};
const {createApp}=await import('../server/index.ts'); process.loadEnvFile=realLoad;
const denied:Record<string,number>={};
const deny=(name:string):never=>{denied[name]=(denied[name]??0)+1;throw Object.assign(Error('隔离验收禁止外部服务。'),{code:'SPEECH_UNAVAILABLE'});};
globalThis.fetch=async()=>deny('fetch');
const audio=new Map<string,string>();
const manifest=JSON.parse(await readFile(join(root,'artifacts','adaptive-qa-cache.json'),'utf8')) as {term:string;file:string}[];
const mediaRoot=realpathSync(join(root,'data','speech'));
for(const item of manifest){const source=realpathSync(item.file); assert.ok(inside(mediaRoot,source));assert.ok(statSync(source).isFile());const target=join(dataDir,'speech','fixture',item.term+'.mp3');await copyFile(source,target);audio.set(item.term,target);}
if(missingAudio){assert.ok(audio.has(missingAudio),'只能模拟已有单词缺音');audio.delete(missingAudio);}
const tts:ServiceStatus={configured:false,available:false,provider:'elevenlabs',status:'cache_only',detail:'隔离验收只使用既有MP3，缺缓存即停止。'};
const unavailable:ServiceStatus={configured:false,available:false,status:'qa_disabled',detail:'隔离验收不上云。'};
const app=createApp({rootDir:fixtureRoot,dataDir,chatEnabled:false,
  dialogue:{status:async()=>unavailable,turn:async()=>deny('chat'),cancel(){},reset:async()=>{},close:async()=>{}},
  integrations:{probeIntegrations:async()=>({speech:tts,tts,stt:unavailable,codex:unavailable}),ttsStatus:()=>tts,
    getCachedSpeech:async input=>input.locale==='en-US'&&input.tone==='clear'&&input.rate===undefined?audio.get(input.text):undefined,
    synthesizeSpeech:async()=>deny('tts'),streamSpeech:async()=>deny('stream'),generateIllustration:async()=>deny('image'),
    beginCodexLogin:async()=>deny('oauth'),enrichVocabulary:async()=>deny('vocabulary'),transcribeSpeech:async()=>deny('stt'),createLiveSttSession:async()=>deny('live'),estimateTtsCost:()=>0,estimateSttCost:()=>0,
  }});
assert.equal(app.store.read().packs[0].enabled,false);
assert.equal(app.store.startSession().wordIds.length,0);
const original=app.server.listeners('request')[0] as (req:IncomingMessage,res:ServerResponse)=>void;
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{
  if(req.method==='GET'&&req.url==='/__qa'){
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({fixture:true,missingAudio,state:app.store.state({speech:tts,tts,codex:unavailable}),data:app.store.read(),denied}));return;
  }
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'");
  original(req,res);
});
await writeFile(join(fixtureRoot,'audit.json'),JSON.stringify({fixture:true,cached:audio.size,dataDir,cloud:false}));
if(process.argv.includes('--serve')){
  await new Promise<void>(resolve=>app.server.listen(8792,'127.0.0.1',resolve));
  console.log(JSON.stringify({url:'http://127.0.0.1:8792/',fixtureRoot,cached:audio.size}));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void app.close().then(()=>process.exit(0)));
}else{await app.close();console.log(JSON.stringify({prepared:true,fixtureRoot,cached:audio.size}));}
