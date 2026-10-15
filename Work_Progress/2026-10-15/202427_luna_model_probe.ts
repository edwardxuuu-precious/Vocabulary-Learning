import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dialogueServerArguments } from '../../server/integrations/dialogue.ts';
import { isolatedProcessEnvironment, resolveCodexInvocation } from '../../server/integrations/codex.ts';
const directory=resolve('Work_Progress/2026-10-15/202427_luna_comparison');
await mkdir(directory,{recursive:true});
const invocation=resolveCodexInvocation(),child=spawn(invocation.command,[...invocation.prefix,...dialogueServerArguments()],{cwd:directory,env:isolatedProcessEnvironment(),shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
let buffer='',id=0;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
child.stderr.resume();child.stdout.setEncoding('utf8');
child.stdout.on('data',(chunk:string)=>{buffer+=chunk;let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message:any;try{message=JSON.parse(line);}catch{continue;}const request=pending.get(message.id);if(!request)continue;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error('Official model/list probe rejected.')):request.resolve(message.result);}});
child.on('exit',()=>{for(const value of pending.values()){clearTimeout(value.timer);value.reject(new Error('Official probe exited.'));}pending.clear();});
const rpc=(method:string,params:Record<string,unknown>)=>new Promise<any>((resolveRequest,reject)=>{const requestId=++id;const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Official model/list probe timed out.'));},12000);pending.set(requestId,{resolve:resolveRequest,reject,timer});child.stdin.write(JSON.stringify({id:requestId,method,params})+'\n');});
try{
  await rpc('initialize',{clientInfo:{name:'little_word_luna_comparison',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  const models:any[]=[];let cursor:string|undefined;
  do{const result=await rpc('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});if(!Array.isArray(result?.data))throw new Error('Official model/list returned invalid data.');models.push(...result.data);cursor=result.nextCursor??undefined;if(models.length>100)throw new Error('Unexpected model/list size.');}while(cursor);
  const visible=models.map(value=>({id:value.id,model:value.model,displayName:value.displayName,isDefault:value.isDefault,defaultReasoningEffort:value.defaultReasoningEffort,supportedReasoningEfforts:value.supportedReasoningEfforts}));
  await writeFile(join(directory,'models.json'),JSON.stringify({at:new Date().toISOString(),models:visible},null,2),'utf8');console.log(JSON.stringify(visible));
}finally{
  child.stdin.end();
  if(process.platform==='win32'&&child.pid){const killer=spawn(join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});killer.on('error',()=>child.kill());await new Promise<void>(resolveExit=>killer.once('close',()=>resolveExit()));}else child.kill();
}
