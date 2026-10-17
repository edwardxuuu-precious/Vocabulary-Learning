import { extendedKinds } from '../shared/game-materials.ts';
import { extendedDemo } from './game-material-fixtures.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GameKind, IntegrationStatus, ServiceStatus } from '../shared/contracts.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { gameRegistry as allGames, type GamePlanOptions } from '../shared/game-registry.ts';
import { Script } from 'node:vm';
import { batchTwoKinds } from '../shared/game-boards.ts';

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
for (const value of process.argv.slice(2)) if (value !== '--serve' && value !== '--synthetic-mic' && !/^--(?:port|dist|batch|restore|resume-data)=/.test(value)) throw Error('支持--serve、--synthetic-mic（仅验收）、--port=端口、--dist=项目内构建目录、--batch=1至5、--restore=项目artifacts内体验备份。');
const batch = Number(arg('batch') ?? 2); assert.ok([1,2,3,4,5].includes(batch));
const gameRegistry=allGames.filter(game=>(game.batch??(batchTwoKinds.has(game.kind)?2:1))<=batch);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), port = Number(arg('port') ?? (batch===1?8793:8794)), origin = `http://127.0.0.1:${port}`;
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
const inside = (base: string, target: string) => { const path = relative(base, target); return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep); };
const dist = resolve(root, arg('dist') ?? `artifacts/games-batch${batch}-dist`);
assert.ok(inside(root, dist) && existsSync(join(dist, 'index.html')) && inside(realpathSync(root), realpathSync(dist)), '先构建项目内的独立产物。');
const resumeData=arg('resume-data');assert.ok(!resumeData||!arg('restore'),'续用原档案与导入备份不能同时使用。');
const dataDir = resumeData?resolve(root,resumeData):join(root,'artifacts',`games-batch${batch}-${randomUUID()}`);
if(resumeData)assert.ok(inside(resolve(root,'artifacts'),dataDir)&&existsSync(join(dataDir,'playroom.sqlite'))&&inside(realpathSync(resolve(root,'artifacts')),realpathSync(dataDir)),'续用只允许项目artifacts内现有体验档案。');
await mkdir(dataDir,{recursive:true});const controlTokenFile=join(dataDir,'qa-control-token.txt'),token=existsSync(controlTokenFile)?(await readFile(controlTokenFile,'utf8')).trim():randomUUID();assert.ok(/^[a-f0-9-]{36}$/.test(token));if(!existsSync(controlTokenFile))await writeFile(controlTokenFile,token,{flag:'wx'});
await mkdir(join(dataDir, 'speech', 'fixture'), { recursive: true });
for (const name of Object.keys(process.env)) if (/(?:API_KEY|SPEECH_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)$/i.test(name)) delete process.env[name];
const originalLoad = process.loadEnvFile; process.loadEnvFile = () => {};
let createApp: typeof import('../server/index.ts')['createApp'];
try { ({ createApp } = await import('../server/index.ts')); } finally { process.loadEnvFile = originalLoad; }
const { AppError, Store } = await import('../server/store.ts');
const requestHistory: {term:string;cached:boolean}[]=[];
const denied: string[] = [], requests: { term: string; cached: boolean }[] = [], audio = new Map<string, string>();
const deny = (name: string): never => { denied.push(name); throw Error('游戏体验只使用已有缓存，不调用云服务。'); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => { const url = new URL(input instanceof Request ? input.url : String(input)); if (url.origin !== origin) return deny('outbound'); return realFetch(input, init); };
const unavailable: ServiceStatus = { configured: false, available: false, status: 'qa', detail: '独立游戏体验，只用已准备的发音。' };
const statuses: IntegrationStatus = { speech: unavailable, tts: { ...unavailable, provider: 'elevenlabs' }, stt: unavailable, codex: unavailable };
const policy: GamePlanOptions = {allowedKinds:gameRegistry.map(game=>game.kind)}, app = createApp({ rootDir: root, dataDir, chatEnabled: false, learningGames: policy,
  dialogue: { status: async () => unavailable, turn: async () => deny('chat'), cancel() {}, reset: async () => {}, close: async () => {} },
  integrations: { probeIntegrations: async () => statuses, speechStatus: () => unavailable, ttsStatus: () => statuses.tts!, sttStatus: () => unavailable,
    getCachedSpeech: async input => { const file = (input.tone ?? 'clear') === 'clear' ? (input.locale==='en-US'?audio.get(input.text)??audio.get('en-US:'+input.text):audio.get(input.locale+':'+input.text)) : undefined; requests.push({term: input.text,cached: !!file}); requestHistory.push({term:input.text,cached:!!file}); if (!file && input.locale === 'zh-CN') throw new AppError('独立体验还没有中文讲解缓存，请点箭头继续。', 'AUDIO_CACHE_MISSING', 409); return file; },
    synthesizeSpeech: async () => deny('tts'), streamSpeech: async () => deny('stream'), transcribeSpeech: async () => deny('stt'), createLiveSttSession: async () => deny('stt'), createSonioxSession: async () => deny('stt'),
    generateIllustration: async () => deny('image'), beginCodexLogin: async () => deny('oauth'), estimateTtsCost: () => 0, estimateSttCost: () => 0,
  },
});
const manifest = JSON.parse(await readFile(join(root, 'artifacts/adaptive-qa-cache.json'), 'utf8')) as {term: string;file: string}[];
assert.equal(manifest.length, 12);
const speechRoot = realpathSync(join(root, 'data', 'speech')), copied: {term: string;hash: string}[] = [];
for (const item of manifest) {
  const source = realpathSync(item.file); assert.ok(source.startsWith(speechRoot + sep) && /[a-f0-9]{64}\.mp3$/i.test(source));
  const bytes = await readFile(source); assert.ok(bytes.length > 32 && bytes.length < 2_000_000);
  const target = join(dataDir, 'speech/fixture', item.term + '.mp3'); await copyFile(source, target);
  audio.set(item.term, target); copied.push({term:item.term,hash:createHash('sha256').update(bytes).digest('hex')});
}
const baseline=resumeData?new Store(join(dataDir,`qa-reset-baseline-${randomUUID()}`)):app.store;
baseline.enablePack('starter',true);
baseline.mutate(data=>{data.practiceRecordings=[];data.settings.monthlyBudgetCny=0;data.profile.nickname='游戏库体验（独立档案）';for(const word of data.words)word.partOfSpeech=['run','jump'].includes(word.term)?'verb':'noun';});
let localDemoCues=0;const cueCacheFile=join(dataDir,'qa-cue-cache.json'),savedCues:{text:string;locale:string;file:string}[]=existsSync(cueCacheFile)?JSON.parse(await readFile(cueCacheFile,'utf8')):[];
for(const c of savedCues){assert.ok(['en-US','zh-CN'].includes(c.locale)&&typeof c.text==='string'&&c.text.length<=1000&&/^speech\/fixture\/[a-z0-9-]+\.wav$/.test(c.file));const file=join(dataDir,c.file);assert.ok(existsSync(file)&&inside(realpathSync(join(dataDir,'speech')),realpathSync(file)));audio.set(c.locale+':'+c.text,file);}
if(batch>=3){
 const local=JSON.parse((await readFile(join(root,'artifacts/game-demo-assets/manifest.json'),'utf8')).replace(/^\uFEFF/,'')) as {text:string;locale:string;file:string}[];
 localDemoCues=local.length;
 await mkdir(join(dataDir,'images/game-demo'),{recursive:true});
 const {readdir}=await import('node:fs/promises');
 for(const name of await readdir(join(root,'artifacts/game-demo-assets')))if(name.endsWith('.png'))await copyFile(join(root,'artifacts/game-demo-assets',name),join(dataDir,'images/game-demo',name));
 for(const c of local){const source=realpathSync(c.file);assert.ok(inside(realpathSync(join(root,'artifacts/game-demo-assets')),source));const key=createHash('sha256').update(c.locale+':'+c.text).digest('hex'),file=`speech/fixture/cue-${key}.wav`,target=join(dataDir,file);if(!existsSync(target))await copyFile(source,target);audio.set(c.locale+':'+c.text,target);const old=savedCues.findIndex(v=>v.locale===c.locale&&v.text===c.text);if(old>=0)savedCues[old]={text:c.text,locale:c.locale,file};else savedCues.push({text:c.text,locale:c.locale,file});}
 await writeFile(cueCacheFile,JSON.stringify(savedCues));
}
const initial=structuredClone(baseline.read());if(resumeData)baseline.close();let selected='random';
function select(kind: string) {
  if (kind !== 'random' && !gameRegistry.some(game => game.kind === kind)) throw Error('这个玩法尚未实现。');
  app.store.mutate(data => Object.assign(data, structuredClone(initial))); requests.length = 0; selected = kind;writeFileSync(join(dataDir,'qa-selection.json'),JSON.stringify({selected:kind}));
  policy.forcedKind = kind === 'random' ? undefined : kind as GameKind;
  if (kind === 'random'&&batch<3) return;
  if(kind==='random')kind=gameRegistry[Math.floor(Math.random()*gameRegistry.length)].kind;
  policy.forcedKind=kind as GameKind;
  app.store.mutate(data=>{ if(kind==='mimic')data.words=data.words.filter(word=>word.partOfSpeech==='verb'); if(extendedKinds.has(kind))data.words=extendedDemo(kind as GameKind).words; data.settings.familyGamesEnabled=kind==='quiz'||kind==='information'; data.settings.contextGamesEnabled=extendedKinds.has(kind); data.settings.spellingEnabled=kind==='letter-path'||allGames.find(g=>g.kind===kind)?.step==='spell'; data.settings.sessionMinutes=15; });
  const session = app.store.startSession('random', policy);
  if(selected==='random')return;
  for (let i = 0; i < 30; i++) {
    const active = app.store.read().sessions.find(item => item.id === session.id)!, activity = currentActivity(active);
    if (!activity || activity.kind === kind) break;
    if (activity.kind === 'standard') {
      if (activity.step !== 'learn') app.store.attempt({ sessionId:session.id,wordId:activity.wordId,step:activity.step,skill:activity.step==='sound'?'listen':activity.step,correct:false,hinted:true,practiceOnly:true,source:'click' });
      app.store.updateSession({ completedStep:{wordId:activity.wordId,step:activity.step} });
    } else { for (const action of ['skip','next']) app.store.activityEvent({sessionId:session.id,activityId:activity.id,action}); }
  }
  assert.equal(currentActivity(app.store.read().sessions.at(-1)!)?.kind, kind);
}
function inspect() { const data=app.store.read(); return {selected,implemented:gameRegistry,syntheticPreparation:selected!=='random',syntheticMic:process.argv.includes('--synthetic-mic'),localDemoCues,state:app.store.state(statuses),charges:data.charges,requests,requestHistory,denied,copiedAudio:copied.length,dataDir,dist}; }
const json = (res: ServerResponse, value: unknown, status=200) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
const panel = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>单词游乐园 · 游戏体验</title><style>
*{box-sizing:border-box}body{margin:0;font:16px system-ui;background:#f1f5fc;color:#314765}iframe{display:block;border:0;width:100%;height:100dvh;background:#edf5ff}
#tools{position:fixed;right:16px;top:88px;z-index:20;width:40px;height:40px;border:1px solid #d9e2ef;border-radius:14px;background:#ffffffca;color:#8192aa;display:grid;place-items:center;cursor:pointer}#tools:hover,#tools:focus-visible{background:white;color:#4e6593}button:focus-visible,select:focus-visible{outline:3px solid #687dde;outline-offset:3px}
dialog{width:min(480px,calc(100% - 32px));max-height:90dvh;padding:30px;border:1px solid #dfe6f0;border-radius:26px;box-shadow:0 24px 90px #263e6330;color:#314765}dialog::backdrop{background:#263e635c;backdrop-filter:blur(4px)}.top{display:flex;justify-content:space-between;align-items:center;gap:16px}.top h1{font-size:23px;margin:0}#close{width:44px;height:44px;border:0;border-radius:14px;background:#f1f5fb;color:#6c7e99;font-size:26px;cursor:pointer}.intro{font-size:15px;color:#71839c;line-height:1.7;margin:14px 0 26px}label{display:block;font-size:14px;color:#657a98;margin-bottom:10px}select{width:100%;font:inherit;min-height:54px;border:1.5px solid #cedaeb;border-radius:15px;padding:10px 12px;background:white;color:#314765}#start{width:100%;font:600 17px system-ui;min-height:54px;border:0;border-radius:15px;background:#586fd2;color:white;margin-top:16px;cursor:pointer}#start:disabled{opacity:.6;cursor:wait}.notice{font-size:13px;line-height:1.8;color:#8492a7;margin:14px 0 0}details{margin-top:24px;padding-top:18px;border-top:1px solid #e5ebf3;font-size:13px;line-height:1.9;color:#7a8ca6}summary{cursor:pointer}.info-link{display:inline-block;margin-top:16px;color:#617aa7;font-size:14px}#status{display:block;min-height:20px;margin-top:12px;font-size:14px;color:#6a7e9c}@media(max-width:600px){#tools{right:12px;top:78px;width:36px;height:36px;border-radius:12px}dialog{padding:24px}}
</style></head><body><iframe id="app" title="游戏体验" src="/__qa/app"></iframe>
<button id="tools" aria-label="打开体验设置" title="体验设置"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="white"/><circle cx="15" cy="17" r="3" fill="white"/></svg></button>
<dialog id="settings" aria-labelledby="settings-title"><div class="top"><h1 id="settings-title">游戏体验</h1><button id="close" aria-label="关闭体验设置">×</button></div><p class="intro">已开放 ${gameRegistry.length} 种单词游戏。<br>正式学习会自动安排适合当前单词的玩法。</p><label for="game">这次想体验什么？</label><select id="game"><option value="random">随机完整一轮</option>${[...gameRegistry].sort((a,b)=>a.number-b.number).map(game=>`<option value="${game.kind}">${String(game.number).padStart(2,'0')} ${game.title}</option>`).join('')}</select><button id="start">开始新的体验</button><p class="notice">此按钮会重新开始独立体验档案。关闭窗口可继续当前进度。</p><output id="status" aria-live="polite"></output><details><summary>关于这个体验版</summary><p>这里的选择器是临时测试工具，正式儿童页不显示。已实现的游戏会保留；亲子、动作和字母玩法会按家长设置与单词条件出现。</p><p>使用独立示例词、已有英文缓存及本机离线示例讲解，不写正式孩子记录、不调用云服务。示例关系、短句与动画是独立验收素材，不代表家长已经审核正式词书。指定玩法会用练习记录准备前置步骤；随机体验先选一组已备示例材料，再从头进入流程。中文讲解暂无缓存时可点箭头继续。</p><a class="info-link" href="/__qa/app" target="_blank" rel="noopener">单独打开儿童页面 ↗</a></details></dialog>
<script>const token=${JSON.stringify(token)};const settings=document.getElementById('settings'),start=document.getElementById('start'),picker=document.getElementById('game');picker.value='__CURRENT_KIND__';document.getElementById('tools').onclick=()=>settings.showModal();document.getElementById('close').onclick=()=>settings.close();start.onclick=async()=>{start.disabled=true;document.getElementById('status').textContent='正在准备…';try{const response=await fetch('/__qa/select',{method:'POST',headers:{'Content-Type':'application/json','X-QA-Token':token},body:JSON.stringify({kind:picker.value})});const data=await response.json();if(!response.ok)throw Error(data.error||'体验准备失败');document.getElementById('status').textContent='已准备好';settings.close();document.getElementById('app').src='/__qa/app?v='+Date.now();}catch(error){document.getElementById('status').textContent=error.message||'暂时无法准备，请重试';}finally{start.disabled=false;}};</script></body></html>`;
new Script(panel.match(/<script>([\s\S]*?)<\/script>/)![1]);
if(!resumeData){for(const game of gameRegistry)select(game.kind);select('random');}else{const session=app.store.state(statuses).activeSession,kind=session&&currentActivity(session)?.kind;selected=gameRegistry.some(g=>g.kind===kind)?kind!:'random';if(existsSync(join(dataDir,'qa-selection.json'))){const saved=JSON.parse(await readFile(join(dataDir,'qa-selection.json'),'utf8'));if(saved.selected==='random'||gameRegistry.some(g=>g.kind===saved.selected))selected=saved.selected;}}
if(arg('restore')) {
  const fixture=resolve(root,arg('restore')!); assert.ok(inside(resolve(root,'artifacts'),fixture)&&inside(realpathSync(resolve(root,'artifacts')),realpathSync(fixture)),'仅允许恢复artifacts内的独立体验备份。');
  app.store.restoreBackup(JSON.parse(await readFile(fixture,'utf8')));
  const session=app.store.read().sessions.at(-1),kind=session&&currentActivity(session)?.kind;
  selected=gameRegistry.some(game=>game.kind===kind)?kind!:'random';
  policy.forcedKind=selected==='random'?undefined:selected as GameKind;
}

await writeFile(join(dataDir,'fixture-audit.json'),JSON.stringify({copied,templates:gameRegistry.length,cloudCalls:denied.length,isolated:true},null,2));
const original=app.server.listeners('request')[0] as (req: IncomingMessage,res:ServerResponse)=>void; app.server.removeAllListeners('request');
app.server.on('request',(req,res)=>{void(async()=>{
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host??''))return json(res,{error:'仅允许此本机端口。'},403);
  const url=new URL(req.url??'/',origin);
  if(req.method==='GET'&&url.pathname==='/') {res.writeHead(302,{Location:'/__qa'});res.end();return;}
  if(req.method==='GET'&&url.pathname==='/__qa') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(panel.replace('__CURRENT_KIND__',selected));return;}
  if(req.method==='GET'&&url.pathname==='/__qa/app') {
    const html=await readFile(join(dist,'index.html'),'utf8');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    if(process.argv.includes('--synthetic-mic')) {
      const fixture=url.searchParams.get('mic')??'tone';
      const script=`<script>navigator.mediaDevices.getUserMedia=async()=>{if(${JSON.stringify(fixture)}==='denied')throw new DOMException('fixture denied','NotAllowedError');const c=new AudioContext();await c.resume();const s=c.createOscillator(),g=c.createGain(),d=c.createMediaStreamDestination();s.frequency.value=440;g.gain.value=${fixture==='silent'?'0':'.12'};s.connect(g);g.connect(d);s.start();let stopped=false;for(const t of d.stream.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{if(!stopped){stopped=true;s.stop();void c.close();}stop();};}return d.stream;};</script><div style="position:fixed;left:8px;bottom:0;z-index:50;font:11px system-ui;color:#8b6170;background:white;pointer-events:none">模拟麦克风验收 · 非真人录音</div>`;
      res.end(html.replace('<body>','<body>'+script));
    } else res.end(html);return;
  }
  if(req.method==='GET'&&url.pathname==='/__qa/state')return json(res,inspect());
  if(req.method==='POST'&&url.pathname==='/__qa/select') {
    if(req.headers['x-qa-token']!==token||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return json(res,{error:'体验请求来源无效。'},403);
    let text='';for await(const bytes of req){text+=bytes;if(text.length>1024)throw Error('请求过大。');}const value=JSON.parse(text);select(value.kind);return json(res,{ready:true,selected});
  }
  if(['GET','HEAD'].includes(req.method??'')&&url.pathname.startsWith('/assets/')){
    const file=resolve(dist,'.'+decodeURIComponent(url.pathname));if(inside(dist,file)&&existsSync(file)&&statSync(file).isFile()){
      const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);return;
    }
  }
  if(url.pathname.startsWith('/__qa'))return json(res,{error:'未知体验接口。'},404);
  original(req,res);
})().catch(error=>{if(!res.headersSent)json(res,{error:error instanceof Error?error.message:'体验请求失败'},400);else res.end();});});
if(process.argv.includes('--serve')){
  await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',done);});
  console.log(JSON.stringify({ready:true,url:origin+'/__qa',templates:gameRegistry.length,dataDir,dist,cachedWords:copied.length}));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
}else{await app.close();console.log(JSON.stringify({checked:true,templates:gameRegistry.length,cachedWords:copied.length,cloudCalls:denied.length}));}
