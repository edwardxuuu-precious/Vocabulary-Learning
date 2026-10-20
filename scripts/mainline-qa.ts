/** Disposable UI acceptance with copied approved assets. Never writes the child's store. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { AppState, SpeechResponse } from '../shared/contracts.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { pendingLearningCheckpoint } from '../shared/learning-policy.ts';

const port=Number(process.argv.find(a=>a.startsWith('--port='))?.slice(7)??8873),legacy=process.argv.includes('--legacy');
if(!Number.isInteger(port)||port<1024||port>65535||process.argv.slice(2).some(a=>a!=='--legacy'&&!/^--port=\d+$/.test(a)))throw Error('支持 --port=端口 和 --legacy。');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dataDir=join(root,'artifacts',`mainline-qa-${randomUUID()}`),source='http://127.0.0.1:8787';
mkdirSync(join(dataDir,'images'),{recursive:true});mkdirSync(join(dataDir,'speech'),{recursive:true});
const state=await (await fetch(source+'/api/state')).json() as AppState;
const words=state.words.filter(w=>['here','funny','yellow','blue','help','find'].includes(w.term)&&w.assetStatus==='approved');
if(words.length<2)throw Error('需要本机已批准的非名词样本；不会生成素材或添加示例凑数。');
const cache=new Map<string,string>(),requests:{text:string;cached:boolean}[]=[];
for(const word of words){
  if(!word.imageUrl.startsWith('/media/images/'))throw Error('图片须为已批准的本机素材。');
  const image=await fetch(source+word.imageUrl);if(!image.ok)throw Error('本机图片无法读取。');
  const extension=word.imageUrl.endsWith('.webp')?'webp':word.imageUrl.endsWith('.jpg')?'jpg':'png',file=`images/${word.id}.${extension}`;
  writeFileSync(join(dataDir,file),Buffer.from(await image.arrayBuffer()));word.imageUrl='/media/'+file;
  for(const [text,locale] of [[word.term,'en-US'],[`意思是，${word.meaning.replace(/[。！？!?]+$/u,'')}。`,'zh-CN']]){
    const response=await fetch(source+'/api/speech/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,locale,tone:'clear',cacheOnly:true})});
    if(!response.ok)continue;const asset=await response.json() as SpeechResponse;if(!asset.audioUrl?.startsWith('/media/speech/'))continue;
    const responseAudio=await fetch(source+asset.audioUrl);if(!responseAudio.ok)continue;const file=join(dataDir,'speech',randomUUID()+'.mp3');writeFileSync(file,Buffer.from(await responseAudio.arrayBuffer()));cache.set(locale+':'+text,file);
  }
}
for(const key of Object.keys(process.env))if(/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(key))delete process.env[key];
const load=process.loadEnvFile;process.loadEnvFile=()=>{};const {createApp}=await import('../server/index.ts');process.loadEnvFile=load;
const {ParentGate}=await import('../server/parent-gate.ts');
let denied=0;const deny=async():Promise<never>=>{denied++;throw Error('隔离验收禁用云服务。');};globalThis.fetch=deny;
const status={configured:false,available:false,status:'qa',detail:'独立档案、缓存音图、模拟麦克风；无云服务。'};
const app=createApp({rootDir:root,dataDir,chatEnabled:false,integrations:{probeIntegrations:async()=>({speech:status,codex:status}),ttsStatus:()=>status,getCachedSpeech:async input=>{const file=cache.get(input.locale+':'+input.text);requests.push({text:input.text,cached:!!file});return file;},synthesizeSpeech:deny,streamSpeech:deny,transcribeSpeech:deny,generateIllustration:deny}});
new ParentGate(dataDir).setup('123456');
app.store.mutate(d=>{d.profile.nickname='主线验收（独立档案）';d.words=words;d.packs=state.packs.filter(p=>words.some(w=>w.packId===p.id)).map(p=>({...p,enabled:true}));d.settings.monthlyBudgetCny=0;d.settings.learningStrategy='memory-loop';d.settings.voiceEnabled=true;});
const session=app.store.startSession(!legacy,{}, {strategy:'memory-loop',mode:'practice',wordIds:words.map(w=>w.id)});
if(legacy)while(!pendingLearningCheckpoint(app.store.read().sessions.at(-1)!)){
  const a=currentActivity(app.store.read().sessions.at(-1)!)!;
  if(a.step==='learn')app.store.updateSession({sessionId:session.id,completedStep:{wordId:a.wordId,step:a.step}});
  else if(a.kind==='standard'&&!['recognize','read'].includes(a.step)){app.store.attempt({sessionId:session.id,wordId:a.wordId,step:a.step,skill:a.step==='sound'?'listen':a.step,correct:true,hinted:false,source:'click'});app.store.updateSession({sessionId:session.id,completedStep:{wordId:a.wordId,step:a.step}});}
  else for(const action of ['skip','next'])app.store.activityEvent({sessionId:session.id,activityId:a.id,action});
}
const original=app.server.listeners('request')[0] as (req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse)=>void;
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{
  if(req.method==='GET'&&req.url==='/__qa/audit'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({isolated:true,dataDir,denied,requests,state:app.store.state({speech:status,codex:status})}));return;}
  if(req.method==='GET'&&(req.url==='/'||req.url?.startsWith('/?'))){const html=readFileSync(join(root,'dist/index.html'),'utf8');res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html.replace('<body>',`<body><script>navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const s=c.createOscillator(),g=c.createGain(),d=c.createMediaStreamDestination();g.gain.value=.12;s.connect(g);g.connect(d);s.start();for(const t of d.stream.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{s.stop();void c.close();stop();};}return d.stream;};</script><aside style="position:fixed;bottom:0;left:0;z-index:999;background:#fff2ce;padding:4px 12px;font-size:11px;pointer-events:none">隔离验收 · 模拟麦克风 · 不计孩子进度</aside>`));return;}
  original(req,res);
});
await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
console.log(JSON.stringify({url:`http://127.0.0.1:${port}/`,dataDir,cached:cache.size,fixtureParentPin:'123456',legacy}));
process.once('SIGINT',()=>void app.close().then(()=>process.exit()));
