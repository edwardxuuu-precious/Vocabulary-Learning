/** Offline maintenance only. No HTTP route; recordings and prepared assets stay in place. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { StoredData } from '../server/store.ts';

export function withoutLearningProgress(before: StoredData): StoredData {
  const after=structuredClone(before);
  Object.assign(after,{progress:[],attempts:[],sessions:[],stickers:[],badgeAwards:[],practiceRecordings:[],
    assessments:[],assessmentAttempts:[],assessmentProgress:[],assessmentPractices:[],activeLearningSessionId:null});
  delete after.lastCompletedLearningSessionId;
  if(after.lessonPlan)after.lessonPlan.completedWordIds=[];
  return after;
}

const countLearning=(data:StoredData)=>Object.fromEntries(
  ['progress','attempts','sessions','stickers','badgeAwards','practiceRecordings','assessments','assessmentAttempts','assessmentProgress','assessmentPractices']
    .map(key=>[key,((data as unknown as Record<string,unknown[]>)[key]??[]).length]));

/** Caller must stop this data directory's server before applying the reset. */
export async function resetLearningProgress(dataDir:string,apply=false) {
  const root=realpathSync(dataDir),database=join(root,'playroom.sqlite');
  assert.ok(existsSync(database),'找不到现有学习档案，未创建或修改任何档案。');
  const db=new DatabaseSync(database,{readOnly:!apply});
  try{
    const body=(db.prepare('SELECT body FROM documents WHERE id=1').get() as {body:string}).body;
    const before=JSON.parse(body) as StoredData,after=withoutLearningProgress(before);
    const summary={before:countLearning(before),after:countLearning(after),retained:{packs:before.packs.length,words:before.words.length,jobs:before.jobs.length,charges:before.charges.length},applied:false};
    if(!apply)return summary;
    assert.ok(!before.jobs.some(j=>['queued','running'].includes(j.status)),'先结束素材准备，再清零学习进度。');
    // Unknown future fields and every preparation/configuration field remain byte-equivalent as JSON.
    const cleared=new Set([...Object.keys(summary.before),'activeLearningSessionId','lastCompletedLearningSessionId','lessonPlan']);
    for(const key of Object.keys(before))if(!cleared.has(key))assert.deepEqual(after[key as keyof StoredData],before[key as keyof StoredData]);
    if(before.lessonPlan)assert.deepEqual({...after.lessonPlan,completedWordIds:before.lessonPlan.completedWordIds},before.lessonPlan);
    const snapshotDir=join(root,'maintenance',`before-learning-reset-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`);
    mkdirSync(snapshotDir,{recursive:true});const snapshot=join(snapshotDir,'playroom.sqlite');
    await backup(db,snapshot);
    const saved=new DatabaseSync(snapshot,{readOnly:true});
    try{
      assert.equal(saved.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
      assert.equal(saved.prepare('SELECT body FROM documents WHERE id=1').get()?.body,body,'快照与当前档案不一致，未清零。');
    }finally{saved.close();}
    const manifest={...summary,snapshot,createdAt:new Date().toISOString(),originalBodySha256:createHash('sha256').update(body).digest('hex'),
      recordings:'原音仍在原私有目录，快照保留关联元数据；未复制或删除原音。'};
    writeFileSync(join(snapshotDir,'manifest.json'),JSON.stringify(manifest,null,2));
    db.exec('BEGIN IMMEDIATE');
    try{
      const changed=db.prepare('UPDATE documents SET body=? WHERE id=1 AND body=?').run(JSON.stringify(after),body);
      assert.equal(changed.changes,1,'档案已变化，未清零，请停服后重试。');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    manifest.applied=true;writeFileSync(join(snapshotDir,'manifest.json'),JSON.stringify(manifest,null,2));
    return {...summary,applied:true,snapshot};
  }finally{db.close();}
}

async function assertLocalServerStopped(){
  const listening=await new Promise<boolean>((done)=>{
    const socket=connect({host:'127.0.0.1',port:8787});
    const finish=(value:boolean)=>{socket.destroy();done(value);};
    socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(2000,()=>finish(true));
  });
  assert.ok(!listening,'本机8787仍在运行。请先停止服务，再执行 --apply。');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert.ok(args.every(a=>a==='--apply'),'仅支持 --apply；不传参数只预览。');
  if(args.includes('--apply'))await assertLocalServerStopped();
  const dataDir=resolve(dirname(fileURLToPath(import.meta.url)),'../data');
  console.log(JSON.stringify(await resetLearningProgress(dataDir,args.includes('--apply')),null,2));
}
