import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPackImageManager } from '../server/pack-images.ts';
import { Store } from '../server/store.ts';
import type { IllustrationJob, Word } from '../shared/contracts.ts';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};};
const tick=()=>new Promise<void>(done=>setImmediate(done));
async function eventually(predicate:()=>boolean){for(let i=0;i<200;i++){if(predicate())return;await new Promise(done=>setTimeout(done,5));}assert.fail('mock image queue did not settle');}
function selection(word:Word){return{wordId:word.id,imageUrl:word.imageUrl,term:word.term,meaning:word.meaning,...(word.learningVersion===undefined?{}:{learningVersion:word.learningVersion})};}
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'word-images-')),store=new Store(directory,()=>new Date('2026-10-16T12:00:00Z'));
  const calls:string[]=[],cancels:string[]=[];
  const image=(wordId:string)=>{const url=`/media/images/${wordId}.png`,file=join(directory,'images',`${wordId}.png`);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'explicit mock image');return url;};
  const complete=(wordId:string,status:'review'|'error'='review'):IllustrationJob=>{
    const job:IllustrationJob={id:`mock-${wordId}`,wordId,status,createdAt:'2026-10-16T12:00:00Z',...(status==='review'?{imageUrl:image(wordId)}:{error:'mock image failure'})};
    store.mutate(data=>{const word=data.words.find(word=>word.id===wordId)!;word.assetStatus=status;if(job.imageUrl){word.imageUrl=job.imageUrl;word.imageSource='codex';}const old=data.jobs.find(item=>item.id===job.id);if(old)Object.assign(old,job);else data.jobs.push(job);});return job;
  };
  let runner=(wordId:string):Promise<IllustrationJob>=>Promise.resolve(complete(wordId)),cancelled=(wordId:string):void|Promise<void>=>{};
  const options={store,runWord:async(wordId:string)=>{calls.push(wordId);return runner(wordId);},cancelWord:(wordId:string)=>{cancels.push(wordId);return cancelled(wordId);}};
  const manager=createPackImageManager(options);
  const pack=(terms=['book','tree','chair'])=>{const pack=store.createPack('模拟图片词表',terms.map(term=>({term,meaning:`测试${term}`})));return{...pack,words:store.read().words.filter(word=>word.packId===pack.id)};};
  const available=(url:string)=>url.startsWith('/media/images/')&&existsSync(join(directory,'images',url.split('/').at(-1)!));
  return{directory,store,manager,options,calls,cancels,image,complete,pack,available,setRunner:(value:typeof runner)=>{runner=value;},setCancel:(value:typeof cancelled)=>{cancelled=value;},cleanup:async()=>{await manager.close();store.close();if(directory.startsWith(join(tmpdir(),'word-images-')))rmSync(directory,{recursive:true,force:true});}};
}

test('start queues immediately, globally serializes books, deduplicates repeat start and preserves existing approved/review pictures',async()=>{
  const f=fixture(),gate=deferred(),entered=deferred();let concurrency=0,maximum=0;
  try{
    const a=f.pack(['book','tree','chair','desk']),b=f.pack(['boat']);
    f.store.mutate(data=>{data.words.find(word=>word.id===a.words[0].id)!.assetStatus='approved';data.words.find(word=>word.id===a.words[0].id)!.imageUrl=f.image(a.words[0].id);data.words.find(word=>word.id===a.words[1].id)!.assetStatus='review';data.words.find(word=>word.id===a.words[1].id)!.imageUrl=f.image(a.words[1].id);});
    const existing=f.store.read().words.filter(word=>a.words.slice(0,2).some(old=>old.id===word.id));
    f.setRunner(async id=>{concurrency++;maximum=Math.max(maximum,concurrency);if(id===a.words[2].id){entered.resolve();await gate.promise;}const result=f.complete(id);concurrency--;return result;});
    assert.equal(f.manager.start(a.id).status,'queued');assert.equal(f.manager.start(a.id).status,'queued');assert.equal(f.manager.start(b.id).status,'queued');assert.deepEqual(f.calls,[]);assert.equal(f.manager.busy(),true);
    await entered.promise;assert.equal(f.manager.getStatus(a.id).status,'running');assert.equal(f.manager.getStatus(a.id).currentWordId,a.words[2].id);assert.equal(f.manager.getStatus(b.id).status,'queued');gate.resolve();await eventually(()=>!f.manager.busy());
    assert.equal(maximum,1);assert.deepEqual(f.calls,[a.words[2].id,a.words[3].id,b.words[0].id]);assert.deepEqual(f.store.read().words.filter(word=>a.words.slice(0,2).some(old=>old.id===word.id)),existing);
    assert.deepEqual(f.manager.getStatus(a.id),{packId:a.id,status:'review',total:4,approved:1,reviewing:3,pending:0,failed:0});
    f.manager.start(a.id);await tick();assert.equal(f.calls.length,3);assert.equal(f.store.read().packs.find(pack=>pack.id===a.id)!.enabled,false);
  }finally{gate.resolve();await f.cleanup();}
});

test('first error stops only its book, preserves success and the next queued book runs; retry fills only remaining gaps',async()=>{
  const f=fixture();let refuse=true;
  try{
    const a=f.pack(),b=f.pack(['boat']);f.setRunner(async id=>f.complete(id,id===a.words[1].id&&refuse?'error':'review'));
    f.manager.start(a.id);f.manager.start(b.id);await eventually(()=>!f.manager.busy());
    assert.deepEqual(f.calls,[a.words[0].id,a.words[1].id,b.words[0].id]);const failed=f.manager.getStatus(a.id);assert.equal(failed.status,'error');assert.equal(failed.reviewing,1);assert.equal(failed.failed,1);assert.equal(failed.pending,1);assert.equal(f.manager.getStatus(b.id).status,'review');
    f.manager.getStatus(a.id);await tick();assert.equal(f.calls.length,3,'polling never retries a cloud operation');
    refuse=false;f.manager.start(a.id);await eventually(()=>!f.manager.busy());assert.deepEqual(f.calls.slice(3),[a.words[1].id,a.words[2].id]);assert.equal(f.manager.getStatus(a.id).status,'review');
    f.store.reviewPackImages(a.id,f.store.read().words.filter(word=>word.packId===a.id).map(selection),f.available);assert.equal(f.manager.getStatus(a.id).status,'ready');
  }finally{await f.cleanup();}
});

test('an existing generating picture is joined without another run and its failure never triggers an automatic retry',async()=>{
  for(const success of [true,false]){
    const f=fixture();
    try{
      const pack=f.pack(['book','tree']);f.store.mutate(data=>{data.words.find(word=>word.id===pack.words[0].id)!.assetStatus='generating';});f.manager.start(pack.id);await tick();assert.deepEqual(f.calls,[]);assert.equal(f.manager.getStatus(pack.id).currentWordId,pack.words[0].id);
      f.complete(pack.words[0].id,success?'review':'error');await eventually(()=>!f.manager.busy());
      assert.deepEqual(f.calls,success?[pack.words[1].id]:[]);assert.equal(f.manager.getStatus(pack.id).status,success?'review':'error');
    }finally{await f.cleanup();}
  }
});

test('queued cancellation does not start a word; active cancel waits for the owned request and cannot cancel a newer book',async()=>{
  const f=fixture(),gate=deferred(),entered=deferred();
  try{
    const a=f.pack(['book','tree']),b=f.pack(['boat']),c=f.pack(['plane']);
    f.setRunner(async id=>{if(id===a.words[0].id){entered.resolve();await gate.promise;return{id:'cancelled',wordId:id,status:'cancelled',createdAt:'2026-10-16T12:00:00Z'};}return f.complete(id);});
    f.manager.start(a.id);f.manager.start(b.id);f.manager.start(c.id);await entered.promise;
    assert.equal((await f.manager.cancel(b.id)).status,'stopped');let stopped=false;const stopping=f.manager.cancel(a.id).then(status=>{stopped=true;return status;});await tick();assert.equal(stopped,false);assert.deepEqual(f.cancels,[a.words[0].id]);assert.deepEqual(f.calls,[a.words[0].id]);
    gate.resolve();assert.equal((await stopping).status,'stopped');await eventually(()=>!f.manager.busy());assert.deepEqual(f.calls,[a.words[0].id,c.words[0].id]);await f.manager.cancel(a.id);assert.deepEqual(f.cancels,[a.words[0].id]);
  }finally{gate.resolve();await f.cleanup();}
});

test('close drains one cancelled writer, removes queued books and restart only derives progress without generation',async()=>{
  const f=fixture(),entered=deferred(),gate=deferred();let restarted:ReturnType<typeof createPackImageManager>|undefined;
  try{
    const a=f.pack(['book','tree']),b=f.pack(['boat']);f.setRunner(async id=>{entered.resolve();await gate.promise;return{id:'cancelled',wordId:id,status:'cancelled',createdAt:'2026-10-16T12:00:00Z'};});
    f.manager.start(a.id);f.manager.start(b.id);await entered.promise;let closed=false;const closing=f.manager.close().then(()=>{closed=true;});await tick();assert.equal(closed,false);gate.resolve();await closing;assert.equal(f.manager.busy(),false);assert.deepEqual(f.calls,[a.words[0].id]);
    assert.throws(()=>f.manager.start(a.id),(error:any)=>error.code==='PACK_IMAGE_CLOSED');restarted=createPackImageManager(f.options);assert.equal(restarted.getStatus(a.id).status,'idle');assert.equal(restarted.getStatus(b.id).status,'idle');await tick();assert.deepEqual(f.calls,[a.words[0].id]);
  }finally{gate.resolve();await restarted?.close();await f.cleanup();}
});

test('a queued change or in-flight meaning, term, learning version or interest edit cannot continue or report a stale batch ready',async()=>{
  for(const change of ['term','meaning','version','interest','queued'] as const){
    const f=fixture(),entered=deferred(),gate=deferred();
    try{
      const pack=f.pack(['book','tree']);f.setRunner(async id=>{entered.resolve();await gate.promise;return f.complete(id);});f.manager.start(pack.id);
      if(change!=='queued')await entered.promise;
      f.store.mutate(data=>{const word=data.words.find(word=>word.id===pack.words[0].id)!;if(change==='term')word.term='new book';else if(change==='meaning'||change==='queued')word.meaning='新的义项';else if(change==='version')word.learningVersion=1;else{data.profile.interests=['机器人'];data.profile.interestVersion++;}});
      assert.equal(f.manager.getStatus(pack.id).status,'error');gate.resolve();await eventually(()=>!f.manager.busy());const status=f.manager.getStatus(pack.id);assert.equal(status.status,'error');assert.match(status.error!,/变化/);assert.equal(f.calls.length,change==='queued'?0:1);
    }finally{gate.resolve();await f.cleanup();}
  }
});

test('picture approvals, labels and enablement may proceed alongside the queue without invalidating image inputs',async()=>{
  const f=fixture(),entered=deferred(),gate=deferred();
  try{
    const pack=f.pack(['book','tree']);f.setRunner(async id=>{if(id===pack.words[0].id){entered.resolve();await gate.promise;}return f.complete(id);});f.manager.start(pack.id);await entered.promise;
    f.store.mutate(data=>{const item=data.packs.find(item=>item.id===pack.id)!;item.title='新标签';item.enabled=true;});gate.resolve();await eventually(()=>!f.manager.busy());
    assert.equal(f.manager.getStatus(pack.id).status,'review');assert.equal(f.calls.length,2);
    const selected=f.store.read().words.filter(word=>word.packId===pack.id).map(selection);f.store.reviewPackImages(pack.id,selected,f.available);assert.equal(f.manager.getStatus(pack.id).status,'ready');
  }finally{gate.resolve();await f.cleanup();}
});

test('invalid/missing packs and arbitrary provider failures never invent readiness or expose provider text',async()=>{
  const f=fixture();
  try{
    assert.throws(()=>f.manager.start('missing'),(error:any)=>error.code==='PACK_IMAGE_NOT_FOUND');assert.throws(()=>f.manager.getStatus('missing'),(error:any)=>error.code==='PACK_IMAGE_NOT_FOUND');
    const empty=f.pack(['book']);f.store.mutate(data=>{data.words=data.words.filter(word=>word.packId!==empty.id);});assert.equal(f.manager.start(empty.id).status,'error');assert.equal(f.manager.busy(),false);
    const pack=f.pack(['tree']);f.setRunner(async()=>{throw new Error('Bearer server-only-private-provider-details');});f.manager.start(pack.id);await eventually(()=>!f.manager.busy());const status=f.manager.getStatus(pack.id);assert.equal(status.status,'error');assert.ok(!JSON.stringify(status).includes('server-only-private'));assert.equal(status.pending,1);assert.equal(f.store.read().charges.length,0);
    for(const [code,expected] of [['CODEX_LOGIN_REQUIRED',/连接现有 Codex 账号/],['CODEX_RATE_LIMIT',/不会充值/]] as const){f.setRunner(async()=>{throw Object.assign(new Error('private provider body'),{code});});f.manager.start(pack.id);await eventually(()=>!f.manager.busy());const failure=f.manager.getStatus(pack.id);assert.equal(failure.status,'error');assert.match(failure.error!,expected);assert.ok(!failure.error!.includes('private provider body'));}
  }finally{await f.cleanup();}
});

test('bulk review is atomic, validates exact current snapshots and requires an actual available picture',async()=>{
  const f=fixture();
  try{
    const pack=f.pack(['book','tree']),other=f.pack(['boat']);for(const word of pack.words)f.complete(word.id);f.complete(other.words[0].id);
    const rows=f.store.read().words.filter(word=>word.packId===pack.id).map(selection),before=f.store.read();
    const cases:unknown[]=[[],null,Array.from({length:1001},()=>rows[0]),[rows[0],rows[0]],[{wordId:rows[0].wordId}],[rows[0],selection(f.store.read().words.find(word=>word.packId===other.id)!)],[rows[0],{...rows[1],meaning:'旧意思'}],[rows[0],{...rows[1],term:'old tree'}],[rows[0],{...rows[1],imageUrl:'/media/images/old.png'}],[rows[0],{...rows[1],learningVersion:1}]];
    for(const rows of cases){assert.throws(()=>f.store.reviewPackImages(pack.id,rows,f.available),/图片|选中/);assert.deepEqual(f.store.read(),before);}
    assert.throws(()=>f.store.reviewPackImages(pack.id,rows,url=>url!==rows[1].imageUrl&&f.available(url)),/图片尚不可用/);assert.deepEqual(f.store.read(),before);
    f.store.mutate(data=>{data.words.find(word=>word.id===rows[1].wordId)!.imageUrl='/assets/placeholder.svg';});const placeholder=f.store.read().words.filter(word=>word.packId===pack.id).map(selection);assert.throws(()=>f.store.reviewPackImages(pack.id,placeholder,()=>true),/图片尚不可用/);assert.equal(f.store.read().words.find(word=>word.id===rows[0].wordId)!.assetStatus,'review');
    f.complete(rows[1].wordId);const approved=f.store.reviewPackImages(pack.id,rows.map(row=>({...row,learningVersion:0})),f.available);assert.ok(approved.every(word=>word.assetStatus==='approved'));const after=f.store.read();f.store.reviewPackImages(pack.id,rows,f.available);assert.deepEqual(f.store.read(),after,'the exact approved snapshot is idempotent, including legacy version zero');assert.equal(after.packs.find(item=>item.id===pack.id)!.enabled,false);assert.deepEqual(after.jobs,before.jobs,'reviewing images does not rewrite generation job history');
  }finally{await f.cleanup();}
});

test('a meaning/version edit after preview cannot partially approve the old list; refreshed selections still require review state',async()=>{
  const f=fixture();
  try{
    const pack=f.pack(['book','tree']);for(const word of pack.words)f.complete(word.id);const rows=f.store.read().words.filter(word=>word.packId===pack.id).map(selection);
    f.store.updateWord(rows[1].wordId,{meaning:'新词义'},f.available);const before=f.store.read();assert.throws(()=>f.store.reviewPackImages(pack.id,rows,f.available),/已经变化/);assert.deepEqual(f.store.read(),before);
    const fresh=f.store.read().words.filter(word=>word.packId===pack.id).map(selection);assert.throws(()=>f.store.reviewPackImages(pack.id,fresh,f.available),/已经变化/);assert.equal(f.store.read().words.find(word=>word.id===rows[0].wordId)!.assetStatus,'review');
    f.complete(rows[1].wordId);const current=f.store.read().words.filter(word=>word.packId===pack.id).map(selection);assert.equal(current[1].learningVersion,1);assert.ok(f.store.reviewPackImages(pack.id,current,f.available).every(word=>word.assetStatus==='approved'));
  }finally{await f.cleanup();}
});
