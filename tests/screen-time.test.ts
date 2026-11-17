import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {ScreenTime} from '../server/screen-time.ts';
import {screenRestMs,screenUseLimitMs,screenTimeView} from '../shared/screen-time.ts';
import {createApp} from '../server/index.ts';

function fixture(){const db=new DatabaseSync(':memory:');let time=Date.parse('2026-11-16T04:00:00Z');const usage=new ScreenTime(db,()=>new Date(time));return {db,usage,advance:(ms:number)=>{time+=ms;},run(ms:number,two=false){usage.heartbeat('tab-first',true);for(let n=0;n<ms;n+=5000){time+=Math.min(5000,ms-n);usage.heartbeat('tab-first',true);if(two)usage.heartbeat('tab-second',true);}},close(){db.close();}};}

test('screen use locks at fifteen minutes, counts simultaneous tabs once, and automatically unlocks after five minutes',()=>{
  const f=fixture();try{f.run(screenUseLimitMs-5000,true);assert.equal(f.usage.view().usedMs,screenUseLimitMs-5000);assert.equal(f.usage.view().breakUntil,undefined);f.advance(5000);const locked=f.usage.heartbeat('tab-second',true);assert.ok(locked.breakUntil);assert.equal(locked.usedMs,screenUseLimitMs);f.advance(screenRestMs-1);assert.ok(f.usage.view().breakUntil);f.advance(1);assert.equal(f.usage.view().breakUntil,undefined);assert.equal(f.usage.view().usedMs,0);}finally{f.close();}
});

test('short pauses and reloads keep usage; hidden tabs do not add time; five minutes away reset the continuous period',()=>{
  const f=fixture();try{f.run(120_000);f.usage.heartbeat('tab-first',false);f.advance(30_000);const reloaded=new ScreenTime(f.db,()=>new Date(Date.parse(f.usage.view().serverNow)));assert.equal(reloaded.view().usedMs,120_000);f.advance(screenRestMs);assert.equal(f.usage.view().usedMs,0);f.run(60_000);f.advance(60_000);assert.equal(f.usage.view().usedMs,75_000,'only the bounded visible lease is counted');}finally{f.close();}
});

test('rest persists in its database table and cannot be cleared by reading, reloading, or client-side countdown projection',()=>{
  const f=fixture();try{f.run(screenUseLimitMs);const locked=f.usage.view();assert.ok(locked.breakUntil);assert.deepEqual(f.usage.view(),locked);const restarted=new ScreenTime(f.db,()=>new Date(locked.serverNow));assert.equal(restarted.view().breakUntil,locked.breakUntil);assert.equal(screenTimeView(locked,screenRestMs-1).blocked,true);assert.equal(screenTimeView(locked,screenRestMs).blocked,false);assert.equal(f.usage.view().breakUntil,locked.breakUntil);}finally{f.close();}
});

test('HTTP rest blocks new learning and answers, preserves learning facts, and requires a parent grant for early unlock',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'screen-rest-http-'));let time=Date.parse('2026-11-16T04:00:00Z');const off={configured:false,available:false,status:'fixture',detail:'隔离工程，无云调用'};
  const app=createApp({dataDir:dir,clock:()=>new Date(time),integrations:{probeIntegrations:async()=>({speech:off,codex:off}),ttsStatus:()=>off,getCachedSpeech:async()=>undefined}});
  app.store.mutate(data=>{data.practiceRecordings=[];});
  try{await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
    const send=(path:string,body:unknown={},token?:string)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
    app.store.screenTime.heartbeat('fixture-tab',true);for(let n=0;n<180;n++){time+=5000;app.store.screenTime.heartbeat('fixture-tab',true);}
    const before=app.store.exportBackup();assert.equal((await send('/api/screen-time/unlock')).status,403);
    for(const path of ['/api/session/start','/api/session/activity','/api/attempts','/api/assessments','/api/assessments/test/responses']){const response=await send(path);assert.equal(response.status,423,path);assert.equal((await response.json()).code,'SCREEN_REST_REQUIRED');}
    assert.deepEqual(app.store.exportBackup(),before);app.store.restoreBackup(before);assert.ok(app.store.screenTime.view().breakUntil,'rest is outside ordinary learning restore');
    assert.equal((await send('/api/screen-time',{clientId:'fixture-tab',active:true,usedMs:0})).status,400);
    const parent=await(await send('/api/parent-gate',{pin:'684219'})).json();assert.ok(parent.assessmentGrant?.token);
    const unlocked=await send('/api/screen-time/unlock',{},parent.assessmentGrant.token);assert.equal(unlocked.status,200);assert.equal((await unlocked.json()).breakUntil,undefined);assert.equal(app.store.screenTime.view().usedMs,0);
    assert.deepEqual(app.store.exportBackup(),before);
  }finally{await app.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));assert.ok(dir.includes('screen-rest-http-'));rmSync(dir,{recursive:true,force:true});}
});
