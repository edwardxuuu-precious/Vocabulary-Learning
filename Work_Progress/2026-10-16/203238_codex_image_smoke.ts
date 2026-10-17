import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { codexServerArguments, generateIllustration, illustrationPrompt, probeCodex, validateImageBytes } from '../../server/integrations/codex.ts';

// One explicitly authorized live smoke. No .env loading, auth-file access, Store, API fallback, or automatic retry.
const jobId=`smoke-pack-auto-20261016-${randomUUID()}`,outputDir=resolve('data','images',jobId);
await mkdir(outputDir,{recursive:true});
const args=codexServerArguments(true).join(' ');
for(const rule of ['features.shell_tool=false','features.apps=false','features.plugins=false','features.multi_agent=false','network.enabled=false','"**/.env*" = "deny"'])assert.ok(args.includes(rule));
assert.ok(!args.includes('danger-full-access'));
const metadata:Record<string,unknown>={jobId,outputDir,term:'book',meaning:'书',interests:[],startedAt:new Date().toISOString(),generationCalls:0,
  restrictions:{officialChatGptOAuth:true,isolatedAssetDirectory:true,ephemeralThread:true,noApiFallback:true,noRecharge:true,noLearningWrites:true},
  prompt:illustrationPrompt({term:'book',meaning:'书',interests:[]})};
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),200_000),start=performance.now();
const persist=()=>writeFile(join(outputDir,'smoke-result.json'),JSON.stringify(metadata,null,2));
try{
  const before=await probeCodex();metadata.oauth={configured:before.configured,status:before.status};
  if(!before.configured)throw Object.assign(new Error('官方Codex OAuth尚未连接；没有启动生图或登录。'),{code:'CODEX_LOGIN_REQUIRED'});
  metadata.generationCalls=1;
  const result=await generateIllustration({jobId,term:'book',meaning:'书',interests:[],outputDir,signal:controller.signal});
  const bytes=await readFile(result.filePath),format=validateImageBytes(bytes);
  Object.assign(metadata,{status:'generated',filePath:result.filePath,format,bytes:bytes.length,imageSha256:createHash('sha256').update(bytes).digest('hex')});
  if(format==='png')metadata.dimensions={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}catch(error){metadata.status='failed';metadata.code=typeof(error as {code?:unknown})?.code==='string'?(error as {code:string}).code:'SMOKE_FAILED';metadata.message=error instanceof Error&&/^(CODEX_|INVALID_|CANCELLED)/.test(String(metadata.code))?error.message:'单次生图未完成；不重试或换服务。';process.exitCode=1;}
finally{clearTimeout(timer);metadata.completedAt=new Date().toISOString();metadata.elapsedMs=Math.round(performance.now()-start);await persist();console.log(JSON.stringify({status:metadata.status,code:metadata.code,elapsedMs:metadata.elapsedMs,generationCalls:metadata.generationCalls,filePath:metadata.filePath,bytes:metadata.bytes,metadata:join(outputDir,'smoke-result.json')}));}
