import test from 'node:test';import assert from 'node:assert/strict';
import {coverPicture,finishSound,flipPicture,helpSound,newPairs,nextPairGroup,selectSound,validPairs,type PairRun} from '../scripts/meaning-games/pair-model.ts';
import type {PreviewContent} from '../scripts/meaning-games/model.ts';
const terms=['all','am','are','at','ate','be','black','brown','but','came'];
const content:PreviewContent={key:'ten-word-engineering-fixture',words:terms.map((term,i)=>({id:'w-'+term,term,meaning:['am','are','be'].includes(term)?'是':'独立词义'+i,version:0,image:'/fixture/'+term+'.png',audio:'/fixture/'+term+'.mp3'})),lines:[],art:{home:'',hero:'',other:'',icon:''}};
test('pair groups cover the exact learning scope; only a final singleton reuses an already scoped word',()=>{
  const run=newPairs(content,()=>.3),ids=content.words.map(w=>w.id);assert.deepEqual(new Set(run.groups.flat()),new Set(ids));assert.ok(run.groups.every(g=>g.length>=2&&g.length<=3));
  for(const group of run.groups)assert.equal(new Set(group.map(id=>content.words.find(w=>w.id===id)!.meaning)).size,group.length);
  assert.ok(validPairs(content,JSON.parse(JSON.stringify(run))));assert.deepEqual(JSON.parse(JSON.stringify(run)).pictureOrder,run.pictureOrder);
});
test('pictures wait for completed English; mistakes preserve first choice and the picture positions',()=>{
  let run:PairRun={...newPairs(content,()=>.3),phase:'play'};const id=run.audioOrder[0],wrong=run.pictureOrder.find(p=>p!==id)!;
  run=selectSound(run,id);assert.equal(flipPicture(run,id),run);assert.equal(finishSound(run,wrong),run);
  run=finishSound(run,id);const missed=flipPicture(run,wrong);assert.equal(missed.result,'miss');assert.equal(missed.paired.length,0);assert.equal(missed.found.length,0);assert.equal(selectSound(missed,wrong),missed);
  const covered=coverPicture(missed);assert.deepEqual(covered.pictureOrder,run.pictureOrder);const solved=flipPicture(covered,id);assert.equal(solved.first['0:'+id],wrong);assert.deepEqual(solved.found,[id]);
  assert.equal(flipPicture(solved,wrong),solved);
});
test('explicit text help recovers missing sound without inventing a heard event or formal grade',()=>{
  let run:PairRun={...newPairs(content,()=>.4),phase:'play'};const id=run.audioOrder[0];run=selectSound(run,id);run=helpSound(run,true);const solved=flipPicture(run,id);
  assert.equal(solved.heard,false);assert.equal(solved.result,'match');assert.deepEqual(solved.helped,['0:'+id]);assert.ok(!Object.keys(solved).some(key=>/score|master|award|stage/.test(key)));
});
test('all groups must really match before completion and resumed snapshots bind to this content version',()=>{
  let run=newPairs(content,()=>.7);assert.equal(nextPairGroup(run),run);
  for(let g=0;g<run.groups.length;g++){
    run={...run,phase:'play'};for(const id of run.audioOrder){run=selectSound(run,id);run=finishSound(run,id);run=flipPicture(run,id);assert.ok(validPairs(content,JSON.parse(JSON.stringify(run))));}
    assert.equal(run.phase,'groupDone');run=nextPairGroup(run,()=>.4);
  }
  assert.equal(run.phase,'complete');assert.equal(run.found.length,10);assert.equal(validPairs({...content,key:'revised-meaning'},run),false);assert.equal(validPairs(content,{...newPairs(content),phase:'complete',found:content.words.map(w=>w.id)}),false);
});
