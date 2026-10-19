/** Offline, disposable example classroom. Never opens the family's data or cloud services. */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),port=Number(args.find(a=>a.startsWith('--port='))?.slice(7)??8864);
if(args.some(a=>a!=='--games'&&!/^--port=\d+$/.test(a))||!Number.isInteger(port)||port<1024||port>65535)throw Error('仅支持 --port=本机端口 和 --games。');
const siteRoot=join(root,'artifacts/classroom-preview');
if(!existsSync(join(root,'dist/index.html')))throw Error('先运行 npm run build。');
// Read/write copies avoid a native fs.cpSync crash observed on this Windows host.
function copyPublic(source:string,target:string) {
  mkdirSync(target,{recursive:true});
  for(const entry of readdirSync(source,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw Error('隔离素材不能使用符号链接。');
    const from=join(source,entry.name),to=join(target,entry.name);
    if(entry.isDirectory())copyPublic(from,to);else writeFileSync(to,readFileSync(from));
  }
}
copyPublic(join(root,'public'),join(siteRoot,'public'));
copyPublic(join(root,'dist'),join(siteRoot,'dist'));
const dataDir=join(root,'artifacts',`classroom-qa-${randomUUID()}`);mkdirSync(dataDir,{recursive:true});
for(const key of Object.keys(process.env))if(/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(key))delete process.env[key];
const envLoad=process.loadEnvFile;process.loadEnvFile=()=>{};
const {createApp}=await import('../server/index.ts');process.loadEnvFile=envLoad;
const {ParentGate}=await import('../server/parent-gate.ts');
const denied:Record<string,number>={},deny=(kind:string):never=>{denied[kind]=(denied[kind]??0)+1;throw Error('隔离示例不允许云调用。');};
globalThis.fetch=async()=>deny('outbound');
const disabled={configured:false,available:false,status:'qa_offline',detail:'隔离示例；发音关闭、云服务禁用。'};
const app=createApp({rootDir:siteRoot,dataDir,chatEnabled:false,learningGames:args.includes('--games')?{}:{allowedKinds:[]},clock:()=>new Date('2026-10-18T08:00:00Z'),
  dialogue:{status:async()=>disabled,turn:async()=>deny('dialogue'),cancel(){},reset:async()=>{},close:async()=>{}},
  challengeServices:{transcribe:async()=>deny('transcribe'),grade:async()=>deny('grade')},
  integrations:{probeIntegrations:async()=>({speech:disabled,codex:disabled}),ttsStatus:()=>disabled,sttStatus:()=>disabled,getCachedSpeech:async()=>undefined,
    synthesizeSpeech:async()=>deny('tts'),streamSpeech:async()=>deny('stream'),transcribeSpeech:async()=>deny('stt'),generateIllustration:async()=>deny('image'),enrichVocabulary:async()=>deny('enrich'),createLiveSttSession:async()=>deny('live'),beginCodexLogin:async()=>deny('login'),estimateTtsCost:()=>0,estimateSttCost:()=>0}});
new ParentGate(dataDir).setup('123456');
const examples=app.store.read().words;
const pack=app.store.createPack('隔离示例 · 本课40词',Array.from({length:40},(_,i)=>({term:examples[i%12].term+(i<12?'':`-${String.fromCharCode(97+Math.floor(i/12))}`),meaning:examples[i%12].meaning})));
app.store.mutate(data=>{data.profile.nickname='课堂分段验收（示例）';data.settings.voiceEnabled=false;data.settings.monthlyBudgetCny=0;data.packs.find(p=>p.id===pack.id)!.enabled=true;data.words.filter(w=>w.packId===pack.id).forEach((w,i)=>{w.imageUrl=examples[i%12].imageUrl;w.assetStatus='approved';});});
const ids=app.store.read().words.filter(w=>w.packId===pack.id).map(w=>w.id);
app.store.saveLessonPlan({title:'示例英语课',wordIds:ids,focusWordIds:ids.slice(0,8),segmentMinutes:8},()=>true);
const first=app.store.startSession(false,{}, {strategy:'memory-loop'});app.store.updateSession({sessionId:first.id,completedStep:{wordId:first.wordIds[0],step:'learn'}});
const original=app.server.listeners('request')[0] as (req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse)=>void;
app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{
  if(req.method==='GET'&&req.url==='/__qa/audit'){
    const data=app.store.read();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({isolated:true,dataDir,denied,charges:data.charges.length,lesson:data.lessonPlan,sessions:data.sessions.map(s=>({id:s.id,wordIds:s.wordIds,completedWordIds:s.completedWordIds,endReason:s.endReason,suspendedAt:s.suspendedAt,replacementSessionId:s.replacementSessionId,lessonPlanId:s.lessonPlanId})),attempts:data.attempts.length,formalProgress:data.progress.length}));return;
  }
  original(req,res);
});
await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',done);});
console.log(JSON.stringify({isolated:true,url:`http://127.0.0.1:${port}/`,dataDir,fixtureParentPin:'123456',note:'仅用于本隔离示例的家长PIN；不是家庭PIN。'}));
process.once('SIGINT',()=>void app.close().then(()=>process.exit()));
