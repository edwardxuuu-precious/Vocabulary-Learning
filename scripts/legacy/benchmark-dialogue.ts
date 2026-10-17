import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createDialogueProvider, type DialogueTimingPhase } from '../../server/integrations/dialogue.ts';
import { isolatedProcessEnvironment } from '../../server/integrations/codex.ts';

// Explicit opt-in only; never load project .env, select a paid service tier, or reuse an old benchmark silently.
const argument=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
if(!process.argv.includes('--live'))throw new Error('需要 --live 才调用 Codex 账号；本脚本会消耗账号现有额度。');
const model=argument('model')?.trim();
if(!model||!/^[-a-zA-Z0-9_.]{1,100}$/.test(model))throw new Error('先用官方 model/list 确认，再显式指定 --model=型号。');
const runs=Number(argument('runs')??2);
if(!Number.isInteger(runs)||runs<1||runs>4)throw new Error('--runs 只允许 1–4 次有限回合。');
const dataDir=resolve(argument('data-dir')??join('artifacts',`dialogue-benchmark-${randomUUID()}`));
if(existsSync(join(dataDir,'dialogue','conversations.json')))throw new Error('基准目录已有历史，请选择新的 --data-dir 保持冷启动可比性。');
const output=resolve(argument('output')??join(dataDir,'results.json'));
const prewarm=process.argv.includes('--prepare-turn'),startedAt=performance.now(),controller=new AbortController();
const protocol:{method:string;elapsedMs:number;failed:boolean;atMs:number}[]=[],rows:unknown[]=[];
const env={...isolatedProcessEnvironment(),CODEX_DIALOGUE_MODEL:model,...(process.env.CODEX_BIN?{CODEX_BIN:process.env.CODEX_BIN}:{})};
const dialogue=createDialogueProvider({dataDir,env,onProtocolTiming:value=>protocol.push({...value,atMs:performance.now()-startedAt})});
const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
let conversationId:string|undefined,failure:string|undefined;
try{
  for(let round=0;round<runs;round++){
    let preparationMs:number|undefined;
    if(conversationId&&prewarm){const start=performance.now();await dialogue.prepareTurn(conversationId);preparationMs=performance.now()-start;}
    const start=performance.now(),phases:Partial<Record<DialogueTimingPhase,number>>={};
    const message=round%2===0?'我喜欢会变身的挖掘机。':'我现在最喜欢的是会变身的挖掘机。';
    const result=await dialogue.turn({message,conversationId,context:{screen:'interest'},profile:{nickname:'小朋友',interests:[],interestVersion:0,onboardingCompleted:false},words:[]},{signal:controller.signal,onTiming:value=>{phases[value.phase]=value.elapsedMs;}});
    rows.push({round:round+1,mode:conversationId?'same_history':'cold',preparationMs,phases,replyMs:performance.now()-start,reply:result.reply});conversationId=result.conversationId;
  }
}catch(error){failure=typeof(error as {code?:unknown})?.code==='string'?(error as {code:string}).code:'BENCHMARK_FAILED';process.exitCode=1;}
finally{
  await dialogue.close();process.off('SIGINT',abort);process.off('SIGTERM',abort);
  const result={model,effort:'low',serviceTier:'default',dataDir,prewarmExistingHistory:prewarm,runs,rows,protocol,...(failure?{failure}:{})};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2),'utf8');
  console.log(JSON.stringify({output,model,completed:rows.length,...(failure?{failure}:{})}));
}
