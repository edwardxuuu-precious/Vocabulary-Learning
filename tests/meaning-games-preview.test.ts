import test from 'node:test';
import assert from 'node:assert/strict';
import {choose,gameAvailable,nextMission,newRun,target,validRun,wordsFor,type GameId,type PreviewContent} from '../scripts/meaning-games/model.ts';
const terms=['black','brown','red','blue','in','on','under','am','are','be'];
const content:PreviewContent={key:'explicit-engineering-fixture-v1',words:terms.map(term=>({id:'fixture-'+term,term,meaning:'独立工程词义',version:1,image:'/fixture/'+term+'.png',audio:'/fixture/'+term+'.mp3'})),lines:[],art:{home:'',hero:'',other:'',icon:''}};
test('color and position missions require a completed sound or explicit help; wrong choices do not move the task',()=>{
  for(const game of ['paint','place'] as GameId[]){let run=newRun(content,game,()=>.3);const word=target(content,run)!;
    assert.equal(choose(content,run,word.id),run);assert.equal(nextMission(run),run);
    run={...run,heard:true};const wrong=wordsFor(content,game).find(w=>w.id!==word.id)!;const retry=choose(content,run,wrong.id);
    assert.equal(retry.solved,false);assert.equal(retry.index,0);assert.equal(retry.answers.length,0);assert.equal(retry.firstChoice,wrong.id);assert.equal(nextMission(retry),retry);
    const fixed=choose(content,retry,word.id),next=nextMission(fixed);assert.equal(next.index,1);assert.equal(next.answers[0].firstChoice,wrong.id);assert.equal(next.answers[0].choice,word.id);assert.ok(validRun(content,next));
  }
});
test('help stays attached to the actual mission and a new mission requires its own sound',()=>{
  const run=newRun(content,'place',()=>.1),helped={...run,helped:true};const solved=choose(content,helped,target(content,run)!.id),next=nextMission(solved);
  assert.equal(next.answers[0].helped,true);assert.equal(next.heard,false);assert.equal(next.helped,false);assert.equal(choose(content,next,target(content,next)!.id),next);
});
test('each complete mission uses the intended vocabulary and restores exact progress without a mastery record',()=>{
  for(const game of ['paint','place','talk'] as GameId[]){let run=newRun(content,game,()=>.6);const frozen=structuredClone(run.missions);
    for(let i=0;i<frozen.length;i++){run={...run,heard:true};run=nextMission(choose(content,run,target(content,run)!.id));assert.ok(validRun(content,JSON.parse(JSON.stringify(run))));assert.deepEqual(run.missions,frozen);}
    assert.equal(run.answers.length,frozen.length);assert.equal(run.index,frozen.length);assert.equal(choose(content,run,'fixture-am'),run);const allowed=new Set(wordsFor(content,game).map(w=>w.id)),used=new Set(run.missions.map(m=>m.wordId));assert.ok([...used].every(id=>allowed.has(id)));assert.equal(used.size,Math.min(frozen.length,allowed.size));
    assert.ok(!Object.keys(run).some(key=>/score|master|stage|award/i.test(key)));
  }
});
test('a stale content version, a different game word and a forged solved state cannot be resumed',()=>{
  const run=newRun(content,'paint',()=>.8);assert.equal(validRun({...content,key:'changed'},run),false);
  assert.equal(validRun(content,{...run,missions:[{...run.missions[0],wordId:'fixture-am'},...run.missions.slice(1)]}),false);
  assert.equal(validRun(content,{...run,solved:true,selected:target(content,run)!.id}),false);
  assert.equal(choose(content,{...run,heard:true},'fixture-under').firstChoice,undefined);
});
test('specialist games take only the selected scope and cannot open a position task with missing words',()=>{
  const scope={...content,words:content.words.filter(w=>['black','brown','am','are','be'].includes(w.term))};
  assert.deepEqual(wordsFor(scope,'paint').map(w=>w.term),['black','brown']);assert.equal(gameAvailable(scope,'paint'),true);assert.equal(gameAvailable(scope,'place'),false);assert.equal(gameAvailable(scope,'talk'),false);
  const run=newRun(scope,'paint');assert.equal(run.missions.length,3);assert.ok(run.missions.every(m=>scope.words.some(w=>w.id===m.wordId)));
});
