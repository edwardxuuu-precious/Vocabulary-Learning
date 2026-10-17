/** Isolated local acceptance: real existing audio caches, no cloud generation or formal child writes. */
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createApp } from '../server/index.ts';
import { getCachedSpeech } from '../server/integrations/index.ts';
import { derivedGameKinds, derivedWordMaterial } from '../shared/game-material-builder.ts';
import { gameMaterialAudioCues } from '../server/game-audio-preparation.ts';
import { gameRegistry, type GamePlanOptions } from '../shared/game-registry.ts';
import type { GameKind, ServiceStatus } from '../shared/contracts.ts';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),source=resolve(root,process.env.PLAYROOM_DATA_DIR??'data');
const dataDir=join(root,'artifacts',`automatic-games-qa-${randomUUID()}`),port=8828;
mkdirSync(join(dataDir,'speech','fixture'),{recursive:true});
const audio=new Map<string,string>(),policy:GamePlanOptions={};let denied=0;
const unavailable:ServiceStatus={configured:false,available:false,status:'isolated',detail:'独立验收，复用已有缓存，禁止云端生成。'};
const deny=async():Promise<never>=>{denied++;throw Error('隔离验收禁止云调用。');};
const app=createApp({rootDir:root,dataDir,learningGames:policy,dialogue:{status:async()=>unavailable,turn:deny,cancel(){},reset:async()=>{},close:async()=>{}},integrations:{probeIntegrations:async()=>({speech:unavailable,tts:{...unavailable,configured:true,provider:'elevenlabs'},codex:unavailable}),ttsStatus:()=>({...unavailable,configured:true,provider:'elevenlabs'}),getCachedSpeech:async input=>audio.get(input.locale+':'+input.text),synthesizeSpeech:deny,streamSpeech:deny,generateIllustration:deny,transcribeSpeech:deny}});
app.store.mutate(data=>{
  const seed=data.words.filter(w=>['apple','cat','run'].includes(w.term));
  data.packs=[{id:'formal-qa',title:'自动游戏验收（独立档案）',enabled:true,isSample:false,createdAt:new Date().toISOString()}];
  data.words=seed.map(w=>({...w,id:`qa-${w.term}`,packId:'formal-qa',partOfSpeech:w.term==='run'?'verb':'noun'}));
  data.progress=data.words.map(w=>({wordId:w.id,skill:'listen',stage:0,dueAt:'2099-01-01T00:00:00Z',attempts:1,successes:0}));
  data.sessions=[];data.attempts=[];data.profile.nickname='自动游戏验收';data.settings.monthlyBudgetCny=0;
});
for(const word of app.store.read().words){
  const cues=[{text:word.term,locale:'en-US' as const},...derivedGameKinds.flatMap(kind=>gameMaterialAudioCues(word,kind,derivedWordMaterial(word,kind)!))];
  for(const cue of cues){
    const key=cue.locale+':'+cue.text;if(audio.has(key))continue;
    const file=await getCachedSpeech({...cue,dataDir:source,tone:'clear'});if(!file||!existsSync(file))continue;
    const target=join(dataDir,'speech','fixture',createHash('sha256').update(key).digest('hex')+'.mp3');copyFileSync(file,target);audio.set(key,target);
  }
}
const original=app.server.listeners('request')[0] as (...args:any[])=>void;app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{
  if(req.url?.startsWith('/__qa/game/')&&req.method==='POST'){
    const kind=decodeURIComponent(req.url.slice('/__qa/game/'.length));
    if(kind!=='random'&&!gameRegistry.some(g=>g.kind===kind)){res.writeHead(400);res.end();return;}
    policy.forcedKind=kind==='random'?undefined:kind as GameKind;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({kind,denied}));return;
  }
  if(req.url==='/__qa/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({isolated:true,denied,audioCacheCount:audio.size}));return;}
  original.call(app.server,req,res);
});
app.server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}`,isolated:true,audioCacheCount:audio.size,dataDir})));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void app.close().then(()=>process.exit(0)));
