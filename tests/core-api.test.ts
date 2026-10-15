import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, validateWav } from '../server/index.ts';

const status = { speech:{ configured:false,available:false,status:'unconfigured',detail:'未配置' }, codex:{ configured:false,available:false,status:'unavailable',detail:'未配置' } };
async function fixture(extra = {}, rootDir?:string) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(),'word-api-'));
  const app = createApp({ dataDir, rootDir, dialogue: { turn: async () => { throw new Error('not used by core API tests'); }, status: async () => status.codex, cancel() {}, reset: async () => {}, close: async () => {} }, integrations:{ probeIntegrations:async () => status, getCachedSpeech:async () => undefined, ...extra } });
  await new Promise<void>(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const port = (app.server.address() as { port:number }).port;
  const call = async (route:string, method='GET', body?:unknown, headers:Record<string,string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`,{ method, headers:{ ...(body !== undefined ? {'Content-Type':'application/json'} : {}),...headers },body:body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); return { response, result };
  };
  return { ...app, call, base:`http://127.0.0.1:${port}`, cleanup:async () => { await app.close(); if (dataDir.startsWith(path.join(os.tmpdir(),'word-api-'))) rmSync(dataDir,{recursive:true,force:true}); } };
}

test('HTTP learning, persistence state, import, validation, same-origin and secret boundary', async () => {
  const app = await fixture();
  try {
    assert.equal((await app.call('/api/health')).result.ok,true);
    const initial = (await app.call('/api/state')).result;
    assert.equal(initial.words.length,12); assert.equal(initial.settings.dailyNewWords,3);
    const session = (await app.call('/api/session/start','POST')).result;
    assert.equal(session.wordIds.length,3);
    await app.call('/api/attempts','POST',{ sessionId:session.id,wordId:session.wordIds[0],skill:'listen',correct:true,hinted:false,source:'click' });
    assert.equal((await app.call('/api/state')).result.progress[0].stage,1);
    assert.equal((await app.call('/api/settings','PATCH',{monthlyBudgetCny:-1})).response.status,400);
    assert.equal((await app.call('/api/profile','POST',{nickname:'恶意'},{Origin:'https://attacker.example'})).response.status,403);
    assert.notEqual((await app.call('/api/state')).result.profile.nickname,'恶意');
    const preview = await app.call('/api/import/preview','POST',{text:'book\t书'}); assert.equal(preview.result.rows[0].term,'book');
    const created = await app.call('/api/packs','POST',{ title:'自定义', rows:preview.result.rows });
    const newWord = created.result.words.find((w:{term:string})=>w.term==='book'); assert.equal(newWord.assetStatus,'draft');
    assert.equal((await app.call(`/api/words/${newWord.id}`,'PATCH',{assetStatus:'approved'})).response.status,400);
    const backup = (await app.call('/api/backup')).result;
    assert.equal(backup.format,'little-word-playroom'); assert.ok(!JSON.stringify(backup).includes('AZURE_SPEECH_KEY'));
    assert.equal((await app.call('/api/restore','POST',backup)).response.status,200);
  } finally { await app.cleanup(); }
});

test('image tasks stay in review until explicit approval; failed replacement preserves old image', async () => {
  let fail = false;
  const app = await fixture({ generateIllustration:async ({outputDir}:{outputDir:string}) => { if (fail) throw Object.assign(new Error('测试生成失败'),{code:'IMAGE_FAILED'}); mkdirSync(outputDir,{recursive:true}); const target=path.join(outputDir,'test.png'); writeFileSync(target,Buffer.from('test-image')); return {filePath:target}; } });
  try {
    const response = await app.call('/api/words/starter-apple/illustrate','POST'); assert.equal(response.response.status,202);
    for (let i=0;i<20;i++) { if ((await app.call('/api/jobs')).result.jobs[0].status==='review') break; await new Promise(resolve=>setTimeout(resolve,10)); }
    let word = (await app.call('/api/state')).result.words[0]; assert.equal(word.assetStatus,'review'); assert.match(word.imageUrl,/^\/media\/images\//);
    const oldImage = word.imageUrl;
    await app.call('/api/words/starter-apple','PATCH',{assetStatus:'approved'});
    assert.equal((await app.call('/api/state')).result.words[0].assetStatus,'approved');
    assert.equal((await fetch(app.base+oldImage)).status,200);
    fail=true; await app.call('/api/words/starter-apple/illustrate','POST');
    for (let i=0;i<20;i++) { if ((await app.call('/api/jobs')).result.jobs.at(-1).status==='error') break; await new Promise(resolve=>setTimeout(resolve,10)); }
    word = (await app.call('/api/state')).result.words[0]; assert.equal(word.imageUrl,oldImage); assert.equal(word.assetStatus,'approved');
    assert.equal((await fetch(app.base+'/media/speech/..%2f..%2f.env')).status,404);
  } finally { await app.cleanup(); }
});

test('in-flight image success, failure and cancellation cannot reapprove a changed word; interest-only changes preserve old approval',async()=>{
  for(const scenario of ['success','failure','cancel','interest'] as const) {
    let finish!:()=>void,fail!:()=>void,entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    const app=await fixture({generateIllustration:({outputDir}:{outputDir:string})=>new Promise<{filePath:string}>((resolve,reject)=>{
      finish=()=>{mkdirSync(outputDir,{recursive:true});const target=path.join(outputDir,'new.png');writeFileSync(target,'new-image');resolve({filePath:target});};
      fail=()=>reject(Object.assign(new Error('生成失败'),{code:'IMAGE_FAILED'}));entered();
    })});
    try {
      const oldImage='/assets/words/apple.svg';
      const job=(await app.call('/api/words/starter-apple/illustrate','POST')).result;
      await started;
      if(scenario==='interest') await app.call('/api/profile','POST',{interests:['会变身的挖掘机']});
      else {
        const edit=scenario==='success'?{term:'pear'}:scenario==='failure'?{meaning:'苹果树上的果实'}:{term:'pear',meaning:'梨子'};
        const changed=await app.call('/api/words/starter-apple','PATCH',edit);
        assert.equal(changed.result.words[0].assetStatus,'draft',scenario);
      }
      if(scenario==='cancel') await app.call(`/api/jobs/${job.id}/cancel`,'POST');
      if(scenario==='failure')fail();else finish();
      for(let i=0;i<30;i++) {if(!['queued','running'].includes((await app.call('/api/jobs')).result.jobs[0].status))break;await new Promise(resolve=>setTimeout(resolve,5));}
      const state=(await app.call('/api/state')).result,word=state.words[0];
      assert.equal(word.imageUrl,oldImage,scenario);
      assert.equal(word.assetStatus,scenario==='interest'?'approved':'draft',scenario);
      assert.equal((await app.call('/api/jobs')).result.jobs[0].status,scenario==='cancel'?'cancelled':'error',scenario);
      if(scenario!=='interest')assert.ok(!(await app.call('/api/session/start','POST')).result.wordIds.includes(word.id),scenario);
    } finally {await app.cleanup();}
  }
});

test('speech errors retain reserved cost and over-budget requests never call provider', async () => {
  let calls=0;
  const app = await fixture({ probeIntegrations:async()=>({...status,speech:{...status.speech,configured:true,available:true}}), estimateTtsCost:()=>0.6, synthesizeSpeech:async()=>{calls++;throw Object.assign(new Error('timeout'),{code:'AZURE_TIMEOUT'});} });
  try {
    await app.call('/api/settings','PATCH',{monthlyBudgetCny:1});
    assert.equal((await app.call('/api/speech/tts','POST',{text:'apple',locale:'en-US'})).response.status,504);
    assert.equal((await app.call('/api/state')).result.usage.estimatedCny,0.6);
    assert.equal((await app.call('/api/speech/tts','POST',{text:'apple',locale:'en-US'})).response.status,402); assert.equal(calls,1);
  } finally { await app.cleanup(); }
});

test('known-invalid speech input consumes no budget; cached speech works when budget is zero', async()=>{
  let providerCalls = 0, cached:string|undefined;
  const app = await fixture({ probeIntegrations:async()=>({...status,speech:{...status.speech,configured:true,available:true}}), getCachedSpeech:async()=>cached, estimateTtsCost:()=>0.6, synthesizeSpeech:async()=>{providerCalls++; throw new Error('must not call');} });
  try {
    const invalid = await app.call('/api/speech/tts','POST',{text:'a'.repeat(501),locale:'en-US'});
    assert.equal(invalid.response.status,400);assert.match(invalid.result.error,/500/);
    assert.equal((await app.call('/api/state')).result.usage.estimatedCny,0);
    await app.call('/api/settings','PATCH',{monthlyBudgetCny:0});
    mkdirSync(path.join(app.dataDir,'speech'),{recursive:true});cached=path.join(app.dataDir,'speech','cache.mp3');writeFileSync(cached,'cached');
    const result = await app.call('/api/speech/tts','POST',{text:'apple',locale:'en-US'});
    assert.equal(result.response.status,200);assert.equal(result.result.cached,true);assert.equal(providerCalls,0);
  } finally {await app.cleanup();}
});

test('HTTP planned completion requires ordered per-step evidence and persists TTS-only practice without creating recall progress',async()=>{
  const app=await fixture();
  try{
    await app.call('/api/settings','PATCH',{dailyNewWords:1});const session=(await app.call('/api/session/start','POST')).result,wordId=session.wordIds[0];
    assert.deepEqual(session.tasks[0].steps,['learn','listen','sound','recall']);
    assert.equal((await app.call('/api/session','PATCH',{completedWordId:wordId})).response.status,400);
    assert.equal((await app.call('/api/session','PATCH',{completedStep:{wordId,step:'learn'}})).response.status,200);
    const input={sessionId:session.id,wordId,skill:'listen',step:'listen',correct:false,hinted:false,source:'click'};
    await app.call('/api/attempts','POST',input);
    assert.equal((await app.call('/api/session','PATCH',{completedStep:{wordId,step:'listen'}})).result.code,'SESSION_STEP_EVIDENCE');
    await app.call('/api/attempts','POST',{...input,correct:true,hinted:true});await app.call('/api/session','PATCH',{completedStep:{wordId,step:'listen'}});
    assert.equal((await app.call('/api/session','PATCH',{completedStep:{wordId,step:'sound'}})).result.code,'SESSION_STEP_EVIDENCE');
    await app.call('/api/attempts','POST',{...input,step:'sound',practiceOnly:true});await app.call('/api/session','PATCH',{completedStep:{wordId,step:'sound'}});
    await app.call('/api/attempts','POST',{...input,skill:'recall',step:'recall',practiceOnly:true});await app.call('/api/session','PATCH',{completedStep:{wordId,step:'recall'}});
    await app.call('/api/session','PATCH',{complete:true});await app.call('/api/session','PATCH',{complete:true});
    const state=(await app.call('/api/state')).result;assert.equal(state.stickers.length,1);assert.deepEqual(state.activeSession.completedWordIds,[wordId]);assert.deepEqual(state.activeSession.completedSteps[wordId],session.tasks[0].steps);assert.equal(state.progress.length,1);assert.equal(state.progress[0].stage,0);
    assert.equal((await app.call('/api/restore','POST',(await app.call('/api/backup')).result)).response.status,200);
    assert.deepEqual((await app.call('/api/state')).result.activeSession.tasks,session.tasks);
  }finally{await app.cleanup();}
});

test('WAV validation checks PCM channels, rate and bounded duration',()=>{
  const wav=Buffer.alloc(44+32000); wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  assert.equal(validateWav(wav),1); wav.writeUInt32LE(48000,24);assert.throws(()=>validateWav(wav),/16kHz/);assert.throws(()=>validateWav(Buffer.from('bad')),/WAV/);
});

test('production serves Vite JS/CSS bundles and public seed SVG with correct MIME and safe paths',async()=>{
  const rootDir=mkdtempSync(path.join(os.tmpdir(),'word-static-'));
  mkdirSync(path.join(rootDir,'dist','assets'),{recursive:true});mkdirSync(path.join(rootDir,'public','assets','words'),{recursive:true});
  writeFileSync(path.join(rootDir,'dist','index.html'),'<script type="module" src="/assets/index-test.js"></script>');
  writeFileSync(path.join(rootDir,'dist','assets','index-test.js'),'console.log("bundle works");');
  writeFileSync(path.join(rootDir,'dist','assets','index-test.css'),'body { color: green; }');
  writeFileSync(path.join(rootDir,'public','assets','words','apple.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(rootDir,'.env'),'AZURE_SPEECH_KEY=never-serve');
  const app=await fixture({},rootDir);
  try {
    const home=await fetch(app.base+'/');assert.equal(home.status,200);assert.match(home.headers.get('content-type')!,/text\/html/);
    for(const [resource,mime,content] of [['/assets/index-test.js','text/javascript','bundle works'],['/assets/index-test.css','text/css','green'],['/assets/words/apple.svg','image/svg+xml','svg']]) {
      const result=await fetch(app.base+resource);assert.equal(result.status,200,resource);assert.ok(result.headers.get('content-type')?.includes(mime));assert.ok((await result.text()).includes(content));
    }
    assert.equal((await fetch(app.base+'/assets/missing.js')).status,404);
    const blocked=await fetch(app.base+'/assets/%2e%2e%2f%2e%2e%2f.env');assert.equal(blocked.status,404);assert.ok(!(await blocked.text()).includes('never-serve'));
  } finally {await app.cleanup();if(rootDir.startsWith(path.join(os.tmpdir(),'word-static-')))rmSync(rootDir,{recursive:true,force:true});}
});
