import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, parseImport, safeRelative, validateBackup } from '../server/store.ts';

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'word-core-'));
  let time = new Date('2026-10-15T02:00:00Z');
  const store = new Store(directory, () => time);
  store.enablePack('starter',true); // Tests explicitly opt in to the non-formal sample vocabulary.
  return { store, directory, advance: (days: number) => { time = new Date(time.getTime() + days * 86_400_000); }, close: () => { store.close(); if (directory.startsWith(path.join(os.tmpdir(), 'word-core-'))) rmSync(directory, { recursive: true, force: true }); } };
}
const attempt = (sessionId: string, wordId: string, skill = 'listen', extra = {}) => ({ sessionId, wordId, skill, correct: true, hinted: false, source: 'click', ...extra });
function completePlannedWords(store:Store) {
  const session = store.startSession();
  for (const task of session.tasks!) for (const step of task.steps) {
    if ((store.read().sessions.find(s => s.id === session.id)?.completedSteps?.[task.wordId] ?? []).includes(step)) continue;
    if (step !== 'learn' && !store.read().attempts.some(a => a.sessionId === session.id && a.wordId === task.wordId && a.step === step && (a.correct || a.practiceOnly))) store.attempt(attempt(session.id,task.wordId,step === 'sound' ? 'listen' : step,{step,practiceOnly:step === 'recall'}));
    store.updateSession({completedStep:{wordId:task.wordId,step}});
  }
}

test('CSV and Excel import give actionable validation and preserve a quoted meaning', () => {
  assert.deepEqual(parseImport('英文\t中文\napple\t苹果\ncat\t猫').rows, [{ term:'apple', meaning:'苹果' }, { term:'cat', meaning:'猫' }]);
  assert.deepEqual(parseImport('term,meaning\nrun,"跑步,奔跑"').rows, [{ term:'run', meaning:'跑步,奔跑' }]);
  assert.match(parseImport('cat,猫\nCat,猫').errors[0], /重复/);
  assert.match(parseImport('run,跑步\nrun,经营').errors[0], /多个意思/);
  assert.match(parseImport('apple,"苹果').errors[0], /引号/);
  assert.match(parseImport('').errors[0], /粘贴/);
  assert.match(parseImport('apple,苹果,其他').errors[0], /两列/);
});

test('seeds are approved; imports remain outside child learning until asset approval', () => {
  const f = fixture();
  try {
    assert.equal(f.store.read().words.length, 12);
    assert.ok(f.store.read().words.every(w => w.assetStatus === 'approved'));
    const pack = f.store.createPack('测试词表', [{ term:'book', meaning:'书' }]);
    f.store.enablePack(pack.id, true);
    const word = f.store.read().words.find(w => w.packId === pack.id)!;
    assert.equal(word.assetStatus, 'draft');
    assert.throws(() => f.store.updateWord(word.id, { assetStatus:'approved' }, () => false), /图片/);
    assert.ok(!f.store.startSession().wordIds.includes(word.id));
    const cachedPack = f.store.createPack('相同词义', [{ term:'apple',meaning:'苹果' }, { term:'car',meaning:'车厢' }]);
    const cachedWords = f.store.read().words.filter(w => w.packId === cachedPack.id);
    assert.equal(cachedWords[0].assetStatus,'approved'); assert.equal(cachedWords[1].assetStatus,'draft');
    assert.equal(cachedPack.enabled,false);
  } finally { f.close(); }
});

test('skill tracks advance only once per local day, hints and practice do not advance, errors shorten due time', () => {
  const f = fixture();
  try {
    const session = f.store.startSession(), wordId = session.wordIds[0];
    f.store.attempt(attempt(session.id, wordId));
    f.store.attempt(attempt(session.id, wordId));
    let progress = f.store.read().progress.find(p => p.skill === 'listen')!;
    assert.equal(progress.stage, 1);
    assert.equal(progress.dueAt, '2026-10-16T02:00:00.000Z');
    f.store.attempt(attempt(session.id, wordId, 'recall', { hinted:true }));
    f.store.attempt(attempt(session.id, wordId, 'spell', { practiceOnly:true }));
    assert.equal(f.store.read().progress.find(p => p.skill === 'recall')!.stage, 0);
    assert.equal(f.store.read().progress.find(p => p.skill === 'spell'), undefined);
    assert.equal(f.store.read().attempts.find(a => a.skill === 'spell')!.practiceOnly, true);
    f.advance(1); f.store.attempt(attempt(session.id, wordId));
    progress = f.store.read().progress.find(p => p.skill === 'listen')!;
    assert.equal(progress.stage, 2);
    assert.equal(progress.dueAt, '2026-10-19T02:00:00.000Z');
    f.store.attempt(attempt(session.id, wordId, 'listen', { correct:false }));
    assert.equal(f.store.read().progress.find(p => p.skill === 'listen')!.dueAt, '2026-10-16T02:10:00.000Z');
  } finally { f.close(); }
});

test('session resumes, retries are idempotent, completion grants exactly one sticker, state persists', () => {
  const f = fixture();
  try {
    const session = f.store.startSession(); assert.equal(session.wordIds.length, 3);
    assert.equal(f.store.startSession().id, session.id);
    const body = attempt(session.id, session.wordIds[0], 'listen', { id:'stable-attempt-id' });
    f.store.attempt(body); f.store.attempt(body); assert.equal(f.store.read().attempts.length, 1);
    assert.throws(() => f.store.updateSession({ complete:true }), /完成/);
    assert.throws(() => f.store.updateSession({ completedWordId:session.wordIds[0] }), /步骤/);
    completePlannedWords(f.store);
    f.store.updateSession({ complete:true }); f.store.updateSession({ complete:true });
    assert.equal(f.store.read().stickers.length, 1);
    assert.equal(f.store.read().sessions[0].completedAt !== undefined, true);
    const second = new Store(f.directory); try { assert.equal(second.read().stickers.length, 1); } finally { second.close(); }
    f.advance(1); const next = f.store.startSession(); assert.notEqual(next.id, session.id);
    assert.ok(next.wordIds.includes(session.wordIds[0]));
  } finally { f.close(); }
});

test('changing approval or disabling a pack removes pending words from an active child session', () => {
  const f = fixture();
  try {
    const session = f.store.startSession();
    f.store.updateWord(session.wordIds[0],{assetStatus:'review'},()=>true);
    assert.ok(!f.store.startSession().wordIds.includes(session.wordIds[0]));
    f.store.enablePack('starter',false);
    assert.equal(f.store.read().sessions[0].wordIds.length,0);
    assert.equal(f.store.read().stickers.length,0);
    f.store.enablePack('starter',true);
    assert.ok(f.store.startSession().wordIds.length>0);
  } finally { f.close(); }
});

test('budget reserves atomically and retains unknown charges, settling releases unused reservation', () => {
  const f = fixture();
  try {
    f.store.updateSettings({ monthlyBudgetCny:1 });
    const id = f.store.reserve('tts',0.8,100);
    assert.throws(() => f.store.reserve('stt',0.3,2), /预算/);
    f.store.settle(id,0.1); f.store.reserve('stt',0.8,10);
    assert.throws(() => f.store.reserve('tts',0.11,10), /预算/);
    assert.throws(() => f.store.reserve('tts',NaN,10), /估算/);
    f.advance(31); assert.doesNotThrow(() => f.store.reserve('tts',0.9,10));
  } finally { f.close(); }
});

test('backup includes speech and generated images, rejects unsafe/duplicate paths and keeps a pre-restore snapshot', () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.directory,'speech'), { recursive:true });
    mkdirSync(path.join(f.directory,'images','job'), { recursive:true });
    writeFileSync(path.join(f.directory,'speech','cached.mp3'), Buffer.from('audio'));
    writeFileSync(path.join(f.directory,'images','job','image.png'), Buffer.from('image'));
    writeFileSync(path.join(f.directory,'.env'), 'AZURE_SPEECH_KEY=do-not-export');
    const backup = f.store.exportBackup();
    assert.equal(backup.files.length, 2); assert.ok(!JSON.stringify(backup).includes('do-not-export'));
    f.store.updateProfile({ nickname:'修改后' }); f.store.restoreBackup(backup);
    assert.equal(f.store.read().profile.nickname, '小探险家');
    assert.equal(readdirSync(path.join(f.directory,'backups')).length, 1);
    assert.throws(() => validateBackup({ ...backup, files:[{ path:'images/../../.env',content:'YQ==' }] }), /素材/);
    assert.throws(() => validateBackup({ ...backup, files:[backup.files[0],backup.files[0]] }), /重复/);
    assert.throws(() => validateBackup({ ...backup, data:{...backup.data, sessions:[{id:'bad',wordIds:[],completedWordIds:[],startedAt:'bad',rewardGranted:false}]} }), /会话/);
    assert.throws(() => validateBackup({ ...backup, data:{...backup.data, charges:[{id:'bad',month:'2026-10',reserved:-1,kind:'tts',units:1}]} }), /用量/);
    assert.equal(safeRelative('speech/a.mp3'), true); assert.equal(safeRelative('speech/../a.mp3'), false); assert.equal(safeRelative('speech\\a.mp3'), false);
  } finally { f.close(); }
});

test('restoring an old learning backup preserves current usage and unknown reservations, merges new ids and stays idempotent',()=>{
  const f=fixture(),other=fixture();
  try{
    f.store.updateSettings({monthlyBudgetCny:1});
    const oldId=f.store.reserve('tts',0.8,100),backup=f.store.exportBackup();
    f.store.settle(oldId,0.1,80);const pending=f.store.reserve('stt',0.4,10);
    f.store.updateProfile({nickname:'备份之后改名'});
    const imported=other.store.reserve('tts',0.2,20);other.store.settle(imported,0.15,20);
    backup.data.charges.push(other.store.read().charges[0]);
    for(let i=0;i<2;i++){
      f.store.restoreBackup(backup);const data=f.store.read();assert.equal(data.charges.length,3);
      assert.equal(data.profile.nickname,'小探险家');assert.equal(data.charges.find(c=>c.id===oldId)!.actual,0.1);assert.equal(data.charges.find(c=>c.id===oldId)!.units,80);
      assert.equal(data.charges.find(c=>c.id===pending)!.actual,undefined);assert.equal(data.charges.find(c=>c.id===pending)!.reserved,0.4);
      assert.equal(data.charges.find(c=>c.id===imported)!.actual,0.15);
    }
    assert.throws(()=>f.store.reserve('tts',0.36,1),/预算/);
  }finally{other.close();f.close();}
});
