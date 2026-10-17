import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import { buildActivities } from '../shared/game-plan.ts';
import { seededRandom } from '../shared/game-registry.ts';
import { derivedWordMaterial, buildGameMaterialProposals } from '../shared/game-material-builder.ts';
import { readyMaterial, validGameMaterial } from '../shared/game-materials.ts';
import { readyGameMaterialKeys } from '../server/game-material-readiness.ts';
import { prepareGameAudio } from '../server/game-audio-preparation.ts';
import { createApp } from '../server/index.ts';
import type { LearningTask, Word } from '../shared/contracts.ts';

const words:Word[]=['make','yellow','not','you','help'].map((term,i)=>({id:`word-${term}`,term,meaning:['制作','黄色的','不；没有','你；你们','帮助'][i],partOfSpeech:(['verb','adjective','adverb','pronoun','verb'] as const)[i],packId:'formal',imageUrl:`/media/images/formal/${term}.png`,assetStatus:'approved',imageSource:'upload',learningVersion:2}));
test('approved images become genuine four-piece puzzles; clues repeat the reviewed meaning, including abstract words',()=>{
  for(const word of words){
    for(const kind of ['assemble','clue']){const m=derivedWordMaterial(word,kind)!;assert.ok(validGameMaterial(kind,m));assert.equal(m.origin,'approved-word');assert.deepEqual(m.wordVersions,{[word.id]:2});assert.deepEqual(readyMaterial(word,kind,[word]),m);assert.equal(word.gameMaterials,undefined);}
    const puzzle=derivedWordMaterial(word,'assemble')!;assert.deepEqual(puzzle.tiles.map(t=>t.fragment),[0,1,2,3]);assert.ok(puzzle.tiles.every(t=>t.imageUrl===word.imageUrl));
    const clue=derivedWordMaterial(word,'clue')!;assert.ok(clue.prompt!.text.includes(word.meaning));
    assert.equal(derivedWordMaterial({...word,assetStatus:'review'},'assemble'),undefined);
    assert.equal(derivedWordMaterial({...word,imageUrl:'/assets/placeholder.svg'},'clue'),undefined);
  }
});
test('automatic semantic proposals are bounded drafts; new meanings and all source images stay unchanged',()=>{
  const before=structuredClone(words),proposals=buildGameMaterialProposals(words);
  assert.equal(proposals.length,9);assert.ok(proposals.some(p=>p.wordId==='word-yellow'&&p.kind==='paint'));
  assert.ok(proposals.some(p=>p.wordId==='word-help'&&p.kind==='cloze'));
  assert.ok(!proposals.some(p=>['variants','parts','opposites','pantomime'].includes(p.kind)));
  assert.ok(proposals.every(p=>validGameMaterial(p.kind,p.material)&&p.material.wordIds.every(id=>words.some(w=>w.id===id))));
  assert.ok(proposals.every(p=>p.material.origin==='proposal'&&p.material.approvedAt===undefined));
  for(const p of proposals){const word=words.find(w=>w.id===p.wordId)!;assert.equal(readyMaterial({...word,gameMaterials:{[p.kind]:p.material}},p.kind,words),undefined);}
  assert.deepEqual(words,before);
  const changed=buildGameMaterialProposals(words.map(w=>({...w,meaning:'另一种词义'})));
  assert.ok(!changed.some(p=>['paint','cloze'].includes(p.kind)));
});
test('chosen old words use the complete game pool; one new mechanism and objective checks survive each plan',()=>{
  const selected=words.slice(0,3),tasks=selected.map(w=>({wordId:w.id,mode:'review',steps:['recognize','listen','sound','read','recall']} as LearningTask));
  const seen=new Set<string>();
  for(let i=0;i<250;i++){
    const plan=buildActivities(tasks,selected,seededRandom(`review-${i}`),{randomize:true,practiceRounds:true});
    assert.equal(plan.length,15);const kinds=new Set(plan.filter(a=>a.kind!=='standard').map(a=>a.kind));assert.ok(kinds.size<=3);
    assert.ok([...kinds].filter(k=>!['flip','supply','portal'].includes(k)).length<=1);
    plan.forEach(a=>seen.add(a.kind));
    for(const word of selected)assert.ok(plan.some(a=>a.wordId===word.id&&a.step==='sound'&&(a.kind==='standard'||a.kind==='think-choice'))||plan.some(a=>a.wordId===word.id&&a.step==='listen'&&(a.kind==='standard'||a.kind==='gate')));
  }
  for(const kind of ['bingo','flip','queue','draw','associate','assemble','clue'])assert.ok(seen.has(kind),kind);
});
test('single chosen word can use its own puzzle or Chinese recall; missing narration excludes it without generation',async()=>{
  const selected=words.slice(0,1),tasks=[{wordId:selected[0].id,mode:'review',steps:['listen','sound','recall']} as LearningTask];
  assert.deepEqual(await readyGameMaterialKeys(selected,selected,()=>true,async()=>false),[]);
  const ready=await readyGameMaterialKeys(selected,selected,()=>true,async()=>true);assert.equal(ready.length,2);
  for(const kind of ['assemble','clue'] as const){
    const plan=buildActivities(tasks,selected,()=>.2,{practiceRounds:true,forcedKind:kind,randomize:true,readyMaterialKeys:ready});
    assert.ok(plan.some(a=>a.kind===kind));assert.ok(!buildActivities(tasks,selected,()=>.2,{practiceRounds:true,forcedKind:kind,randomize:true,readyMaterialKeys:[]}).some(a=>a.kind===kind));
  }
});
test('formal selected-review session includes a real puzzle and preserves its snapshot and practice-only status',()=>{
  const dir=mkdtempSync(join(tmpdir(),'automatic-game-')),store=new Store(dir);
  try{
    const pack=store.createPack('正式词书',[{term:'apple',meaning:'苹果',partOfSpeech:'noun'},{term:'cat',meaning:'猫',partOfSpeech:'noun'}]);store.enablePack(pack.id,true);
    const selected=store.read().words.filter(w=>w.packId===pack.id);
    store.mutate(data=>{for(const word of selected)data.progress.push({wordId:word.id,skill:'listen',stage:0,dueAt:'2099-01-01T00:00:00Z',attempts:1,successes:0});});
    const s=store.startSession('random',{forcedKind:'assemble'},{mode:'practice',wordIds:selected.map(w=>w.id)});
    assert.ok(s.tasks!.every(t=>t.mode==='review'));assert.equal(s.practiceOnly,true);assert.equal(s.activities!.filter(a=>a.kind==='assemble').length,2);
    assert.doesNotThrow(()=>validateBackup(store.exportBackup()));
    const snapshot=structuredClone(s.activities);
    assert.deepEqual(store.startSession('random',{forcedKind:'clue'},{mode:'resume',sessionId:s.id}).activities,snapshot);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('audio preparation uses only free quota, reuses exact cache, and stops on a failed request without approving facts',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'automatic-game-audio-')),store=new Store(dir),cached=new Set<string>(),calls:string[]=[];
  const word=words[0],m=derivedWordMaterial(word,'clue')!,signal=new AbortController().signal;
  const integration={ttsStatus:()=>({provider:'elevenlabs' as const,configured:true,available:true,status:'test',detail:'mock only'}),estimateTtsCost:()=>.001,getCachedSpeech:async(c:{text:string})=>cached.has(c.text)?'mock.mp3':undefined,synthesizeSpeech:async(input:any)=>{assert.equal(input.freeOnly,true);input.beforeRequest();calls.push(input.text);cached.add(input.text);return{mode:'api' as const,filePath:'mock.mp3',cached:false,costCny:.001};}};
  try{
    const before=store.read().words;
    await prepareGameAudio({word,kind:'clue',material:m,integration,store,dataDir:dir,signal});assert.equal(calls.length,2);
    await prepareGameAudio({word,kind:'clue',material:m,integration,store,dataDir:dir,signal});assert.equal(calls.length,2);assert.deepEqual(store.read().words,before);
    let tries=0;await assert.rejects(prepareGameAudio({word,kind:'clue',material:m,integration:{...integration,getCachedSpeech:async()=>undefined,synthesizeSpeech:async()=>{tries++;throw Error('network failed');}},store,dataDir:dir,signal}),/network failed/);assert.equal(tries,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('parent handoff starts bounded automatic preparation; child selection reads its cached game materials and never generates',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'automatic-game-http-')),cached=new Set<string>(),generated:string[]=[];
  mkdirSync(join(dir,'speech'));const mockAudio=join(dir,'speech','mock.mp3');writeFileSync(mockAudio,Buffer.concat([Buffer.from('ID3'),Buffer.alloc(64)]));
  const unavailable={configured:false,available:false,status:'test',detail:'unit mock'},tts={...unavailable,configured:true,provider:'elevenlabs' as const};
  const app=createApp({dataDir:dir,dialogue:{status:async()=>unavailable,turn:async()=>{throw Error('unused');},cancel(){},reset:async()=>{},close:async()=>{}},integrations:{probeIntegrations:async()=>({speech:unavailable,tts,codex:unavailable}),ttsStatus:()=>tts,getCachedSpeech:async input=>input.locale==='en-US'||cached.has(input.text)?mockAudio:undefined,synthesizeSpeech:async input=>{assert.equal(input.freeOnly,true);input.beforeRequest?.();cached.add(input.text);generated.push(input.text);return{mode:'api',cached:false,filePath:mockAudio,costCny:0};}}});
  try{
    const pack=app.store.createPack('家长正式词书',[{term:'apple',meaning:'苹果',partOfSpeech:'noun'},{term:'cat',meaning:'猫',partOfSpeech:'noun'}]);
    await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as any).port}`;
    const call=(url:string,body?:unknown,token?:string,method=body===undefined?'GET':'POST')=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal((await call(`/api/packs/${pack.id}/game-audio`,{})).status,403);
    assert.equal((await call(`/api/packs/${pack.id}`,{enabled:true,prepareGames:true},undefined,'PATCH')).status,403);assert.equal(app.store.read().packs.find(p=>p.id===pack.id)!.enabled,false);assert.equal(generated.length,0);
    const grant=await(await call('/api/parent-gate',{pin:'682419'})).json(),token=grant.assessmentGrant.token;
    const handoff=await call(`/api/packs/${pack.id}`,{enabled:true,prepareGames:true},token,'PATCH');assert.equal(handoff.status,200,await handoff.text());
    let status:any;for(let i=0;i<30;i++){status=await(await call(`/api/packs/${pack.id}/game-audio`)).json();if(status.status!=='running')break;}
    assert.equal(status.status,'ready');assert.equal(status.ready,4);assert.equal(generated.length,4);
    const before=generated.length,ids=app.store.read().words.filter(w=>w.packId===pack.id).map(w=>w.id);
    const response=await call('/api/session/start',{mode:'practice',wordIds:ids});assert.equal(response.status,200);const session=await response.json();assert.equal(session.wordIds.length,2);assert.equal(generated.length,before);assert.ok(session.activities.some((a:any)=>a.kind!=='standard'));
    assert.ok(app.store.read().words.filter(w=>w.packId===pack.id).every(w=>!w.gameMaterials));
    assert.doesNotThrow(()=>validateBackup(app.store.exportBackup()));
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
