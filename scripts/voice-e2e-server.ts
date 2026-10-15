import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../server/index.ts';

// Explicit local QA only: real cloud providers, isolated learning/billing data, synthetic microphone.
if (!process.argv.includes('--live')) throw new Error('需要 --live 才会启用真实服务的隔离验收。');
const selectedModel=process.argv.find(value=>value.startsWith('--model='))?.slice(8);
if(selectedModel&&!/^[a-zA-Z0-9_.-]+$/.test(selectedModel))throw new Error('无效的模型配置。');
if(selectedModel)process.env.CODEX_DIALOGUE_MODEL=selectedModel;
const run=process.argv.find(value=>value.startsWith('--run='))?.slice(6);
if(run&&!/^[a-zA-Z0-9_-]{1,60}$/.test(run))throw new Error('无效的隔离验收名称。');
const directory=resolve('artifacts/voice-e2e-data'+(selectedModel?'-'+selectedModel:'')+(run?'-'+run:''));
const port=(name:string,fallback:number)=>{const value=process.argv.find(v=>v.startsWith(`--${name}=`))?.split('=')[1];const parsed=value===undefined?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<1024||parsed>65535)throw new Error('无效测试端口。');return parsed;};
const apiPort=port('api-port',8788),webPort=port('web-port',5174);if(apiPort===webPort)throw new Error('测试网页与后端端口必须不同。');
process.env.DEV_WEB_ORIGIN=`http://127.0.0.1:${webPort}`;
const app=createApp({dataDir:directory,diagnostics:true});
app.store.updateSettings({monthlyBudgetCny:2});
await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(apiPort,'127.0.0.1',done);});
const allowed=new Set(['interest','interest2','pause2','pause3','confirm','start','apple','banana','cat']);
const web=await createServer({configFile:false,root:resolve('.'),plugins:[react(),{name:'synthetic-voice-fixtures',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const match=/^\/__qa\/audio\/([a-z0-9]+)\.wav$/.exec(req.url??'');
  if(!match)return next();
  if(!allowed.has(match[1])){res.statusCode=404;res.end();return;}
  try{const file=await readFile(resolve('artifacts/voice-e2e-fixtures',match[1]+'.wav'));res.setHeader('Content-Type','audio/wav');res.end(file);}catch{res.statusCode=404;res.end();}
});}}],server:{host:'127.0.0.1',port:webPort,strictPort:true,hmr:false,proxy:{'/api':{target:`http://127.0.0.1:${apiPort}`,ws:true,changeOrigin:false},'/media':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:false}}}});
await web.listen();
console.log(`隔离验收：http://127.0.0.1:${webPort}/qa/voice-e2e.html；后端${apiPort}，合成音频代替麦克风，不录制环境声音。`);
let closing=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{if(closing)return;closing=true;void web.close().then(()=>app.close()).then(()=>process.exit(0));});
