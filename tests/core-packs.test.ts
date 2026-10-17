import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, parseImport, validateBackup } from '../server/store.ts';
import type { IntegrationStatus, LearningSession } from '../shared/contracts.ts';
import { visualTheme } from '../shared/visual-theme.ts';

const services:IntegrationStatus={speech:{configured:false,available:false,status:'unconfigured',detail:'no cloud'},codex:{configured:false,available:false,status:'unconfigured',detail:'no cloud'}};
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'word-packs-')),clock=()=>new Date('2026-10-16T10:00:00Z');
  let store=new Store(directory,clock);
  return{get store(){return store;},clock,reopen(){store.close();store=new Store(directory,clock);return store;},close(){store.close();if(directory.startsWith(join(tmpdir(),'word-packs-')))rmSync(directory,{recursive:true,force:true});}};
}
function completeWord(store:Store,session:LearningSession,wordId:string){
  for(const step of session.tasks!.find(task=>task.wordId===wordId)!.steps){
    if(step!=='learn')store.attempt({sessionId:session.id,wordId,step,skill:step==='sound'?'listen':step,correct:true,hinted:false,practiceOnly:step==='recall',source:'click'});
    store.updateSession({completedStep:{wordId,step}});
  }
}

test('themed imports never borrow an old sample picture; reuse requires approved exact theme, meaning, POS and scene', () => {
  const f=fixture();try{
    const before=f.store.read();
    const row={term:'apple',meaning:'苹果',partOfSpeech:'noun' as const,pictureHint:'一个大苹果，小型机械大黄蜂捧着'};
    const first=f.store.createPack('机甲词书',[row],visualTheme.id);
    const word=f.store.read().words.find(item=>item.packId===first.id)!;
    assert.equal(word.assetStatus,'draft');assert.equal(word.imageUrl,'/assets/placeholder.svg');
    assert.deepEqual(f.store.read().words.filter(item=>item.packId==='starter'),before.words);
    f.store.mutate(data=>{const item=data.words.find(item=>item.id===word.id)!;item.assetStatus='approved';item.imageSource='codex';item.imageTheme=visualTheme.id;item.imageUrl='/assets/words/apple.svg';});
    const second=f.store.createPack('复用同主题',[row],visualTheme.id);
    const copied=f.store.read().words.find(item=>item.packId===second.id)!;
    assert.equal(copied.imageTheme,visualTheme.id);assert.equal(copied.assetStatus,'approved');assert.equal(copied.imageSource,'codex');
    const changed=f.store.createPack('新场景',[{...row,pictureHint:'在桌上的苹果，大黄蜂指向它'}],visualTheme.id);
    assert.equal(f.store.read().words.find(item=>item.packId===changed.id)?.assetStatus,'draft');
    assert.equal(validateBackup(f.store.exportBackup()).data.words.find(item=>item.id===word.id)?.imageTheme,visualTheme.id);
    assert.equal(f.store.read().charges.length,0);
  }finally{f.close();}
});

test('fresh storage contains an explicitly disabled sample and never starts it without parent opt-in',()=>{
  const f=fixture();
  try{
    const pack=f.store.read().packs[0];assert.equal(pack.id,'starter');assert.equal(pack.isSample,true);assert.equal(pack.enabled,false);assert.match(pack.title,/示例/);
    assert.equal(f.store.state(services).activeSession,null);assert.deepEqual(f.store.startSession().wordIds,[]);assert.equal(f.store.read().sessions.length,0);
    f.store.enablePack('starter',true);const sample=f.store.startSession();assert.equal(sample.wordIds.length,3);
    f.reopen();assert.equal(f.store.read().packs[0].enabled,true,'an explicit sample opt-in survives process restarts');assert.equal(f.store.startSession().id,sample.id);
  }finally{f.close();}
});

test('one-time legacy starter migration suspends its unfinished session with all learning and billing history unchanged',()=>{
  const f=fixture();
  try{
    f.store.enablePack('starter',true);const session=f.store.startSession();completeWord(f.store,session,session.wordIds[0]);f.store.updateSession({completedStep:{wordId:session.wordIds[1],step:'learn'}});f.store.reserve('tts',0.2,20);
    const legacy=f.store.read();delete legacy.packs[0].isSample;legacy.packs[0].title='第一盒单词';
    f.store.db.prepare('UPDATE documents SET body=? WHERE id=1').run(JSON.stringify(legacy));
    f.reopen();const after=f.store.read(),suspended=after.sessions[0];
    assert.equal(after.packs[0].enabled,false);assert.equal(after.packs[0].isSample,true);
    assert.deepEqual(suspended,{...legacy.sessions[0],suspendedAt:f.clock().toISOString()});assert.equal(suspended.completedAt,undefined);assert.equal(suspended.rewardGranted,false);
    for(const key of ['attempts','progress','stickers','charges','words'] as const)assert.deepEqual(after[key],legacy[key],key);
    assert.equal(f.store.state(services).activeSession,null);assert.deepEqual(f.store.startSession().wordIds,[]);
    assert.throws(()=>f.store.updateSession({complete:true}),/没有进行/);assert.throws(()=>f.store.attempt({sessionId:session.id,wordId:session.wordIds[1],skill:'listen',correct:true,hinted:false,source:'click'}),/不在当前学习/);
    f.store.updateProfile({nickname:'保留历史'});assert.deepEqual(f.store.read().sessions[0],suspended,'unrelated mutations must not reconcile suspended words away');
    f.store.enablePack('starter',true);const replacement=f.store.startSession();assert.notEqual(replacement.id,session.id);assert.equal(f.store.read().sessions[0].suspendedAt,suspended.suspendedAt);
    f.reopen();assert.equal(f.store.read().packs[0].enabled,true);assert.equal(f.store.startSession().id,replacement.id);
  }finally{f.close();}
});

test('confirming creates a disabled formal pack; enabling it suspends the sample but never abandons an active formal session',()=>{
  const f=fixture();
  try{
    f.store.enablePack('starter',true);const sample=f.store.startSession();f.store.updateSession({completedStep:{wordId:sample.wordIds[0],step:'learn'}});const sampleBefore=f.store.read().sessions[0];
    const formal=f.store.createPack('孩子的正式词表',parseImport('apple 苹果\ncat，猫').rows);
    assert.equal(formal.isSample,false);assert.equal(formal.confirmedAt,f.clock().toISOString());assert.equal(formal.enabled,false);assert.equal(f.store.startSession().id,sample.id,'confirmation itself cannot replace the active sample');
    f.store.enablePack(formal.id,true);assert.equal(f.store.read().packs[0].enabled,false);assert.deepEqual(f.store.read().sessions[0],{...sampleBefore,suspendedAt:f.clock().toISOString()});
    const learning=f.store.startSession();assert.ok(learning.wordIds.every(id=>f.store.read().words.find(word=>word.id===id)!.packId===formal.id));assert.notEqual(learning.id,sample.id);
    f.store.updateSession({completedStep:{wordId:learning.wordIds[0],step:'learn'}});const formalBefore=f.store.read().sessions.find(s=>s.id===learning.id)!;
    const next=f.store.createPack('另一个正式词表',[{term:'dog',meaning:'狗'}]);f.store.enablePack(next.id,true);
    assert.equal(f.store.startSession().id,learning.id);assert.deepEqual(f.store.read().sessions.find(s=>s.id===learning.id),formalBefore);
    const oldStyle=f.store.read();delete oldStyle.packs.find(pack=>pack.id===formal.id)!.isSample;delete oldStyle.packs.find(pack=>pack.id===formal.id)!.confirmedAt;
    f.store.db.prepare('UPDATE documents SET body=? WHERE id=1').run(JSON.stringify(oldStyle));f.reopen();assert.equal(f.store.read().packs.find(pack=>pack.id===formal.id)!.isSample,undefined);assert.equal(f.store.startSession().id,learning.id);
  }finally{f.close();}
});

test('a completed sample today cannot block the first formally enabled learning session',()=>{
  const f=fixture();
  try{
    f.store.enablePack('starter',true);f.store.updateSettings({dailyNewWords:1});const sample=f.store.startSession();completeWord(f.store,sample,sample.wordIds[0]);f.store.updateSession({complete:true});assert.equal(f.store.state(services).lastCompletedSession!.id,sample.id);
    const formal=f.store.createPack('正式词表',[{term:'banana',meaning:'香蕉'}]);f.store.enablePack(formal.id,true);
    assert.equal(f.store.state(services).activeSession,null);const session=f.store.startSession();assert.notEqual(session.id,sample.id);assert.equal(f.store.read().sessions[0].completedAt,f.clock().toISOString());assert.equal(f.store.read().stickers.length,1);
  }finally{f.close();}
});

test('legacy migration leaves completed samples and unfinished formal sessions intact and never labels a user pack as a sample',()=>{
  const f=fixture();
  try{
    f.store.enablePack('starter',true);f.store.updateSettings({dailyNewWords:1});const sample=f.store.startSession();completeWord(f.store,sample,sample.wordIds[0]);f.store.updateSession({complete:true});
    const formal=f.store.createPack('家长以前导入的词表',[{term:'cat',meaning:'猫'}]);f.store.enablePack(formal.id,true);const session=f.store.startSession();f.store.updateSession({completedStep:{wordId:session.wordIds[0],step:'learn'}});
    const old=f.store.read();delete old.packs[0].isSample;old.packs[0].enabled=true;const imported=old.packs.find(pack=>pack.id===formal.id)!;delete imported.isSample;delete imported.confirmedAt;
    f.store.db.prepare('UPDATE documents SET body=? WHERE id=1').run(JSON.stringify(old));f.reopen();const current=f.store.read();
    assert.deepEqual(current.sessions,old.sessions);assert.equal(current.sessions[0].suspendedAt,undefined);assert.equal(current.sessions[0].completedAt,old.sessions[0].completedAt);assert.equal(current.packs.find(pack=>pack.id===formal.id)!.isSample,undefined);assert.equal(current.packs.find(pack=>pack.id===formal.id)!.enabled,true);assert.equal(f.store.startSession().id,session.id);
  }finally{f.close();}
});

test('backup round-trips sample confirmation and suspended history; legacy restore migrates before reconciliation',()=>{
  const f=fixture();
  try{
    f.store.enablePack('starter',true);const sample=f.store.startSession();f.store.updateSession({completedStep:{wordId:sample.wordIds[0],step:'learn'}});
    const legacy=f.store.exportBackup();delete legacy.data.packs[0].isSample;
    f.store.restoreBackup(legacy);let current=f.store.read();assert.equal(current.packs[0].enabled,false);assert.deepEqual(current.sessions[0].wordIds,sample.wordIds);assert.equal(current.sessions[0].suspendedAt,f.clock().toISOString());
    const formal=f.store.createPack('正式导入',[{term:'apple',meaning:'苹果'}]);const backup=f.store.exportBackup();f.store.restoreBackup(backup);current=f.store.read();
    assert.deepEqual(current.sessions,backup.data.sessions);assert.equal(current.packs.find(pack=>pack.id===formal.id)!.confirmedAt,formal.confirmedAt);assert.equal(current.packs.find(pack=>pack.id===formal.id)!.isSample,false);
    for(const mutate of [(copy:any)=>{copy.data.packs[0].isSample='true';},(copy:any)=>{copy.data.packs[1].confirmedAt='yesterday';},(copy:any)=>{copy.data.sessions[0].suspendedAt='yesterday';},(copy:any)=>{copy.data.sessions[0].completedAt=f.clock().toISOString();}]){const copy=structuredClone(backup);mutate(copy);assert.throws(()=>validateBackup(copy),/备份/);}
  }finally{f.close();}
});

test('mixed pasted formats preserve English phrases and quoted meanings while invalid columns, duplicates and competing senses fail',()=>{
  const parsed=parseImport('英文 中文\nred apple 红苹果\nlook up，查找\ncat\t猫\nrun,"跑步,奔跑"\nbook,书');
  assert.deepEqual(parsed.errors,[]);assert.deepEqual(parsed.rows,[{term:'red apple',meaning:'红苹果'},{term:'look up',meaning:'查找'},{term:'cat',meaning:'猫'},{term:'run',meaning:'跑步,奔跑'},{term:'book',meaning:'书'}]);
  assert.deepEqual(parseImport('ice cream    冰淇淋\nMother-in-law 岳母').rows,[{term:'ice cream',meaning:'冰淇淋'},{term:'Mother-in-law',meaning:'岳母'}]);
  for(const source of ['red apple','apple','apple,'])assert.deepEqual(parseImport(source).errors,[],source);
  for(const source of ['apple,苹果,其他','apple，苹果，其他'])assert.ok(parseImport(source).errors.length,source);
  assert.match(parseImport('red apple 红苹果\nRed Apple，红苹果').errors[0],/重复/);assert.match(parseImport('bank 银行\nbank，河岸').errors[0],/多个意思/);
  assert.match(parseImport('apple,"苹果').errors[0],/引号/);assert.match(parseImport('apple,"苹果"x').errors[0],/引号/);
  assert.deepEqual(parseImport('run,"说""跑""这个动作"').rows,[{term:'run',meaning:'说"跑"这个动作'}]);
});
