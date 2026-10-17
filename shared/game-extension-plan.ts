import type { LearningActivity, Word } from './contracts.ts';
import { automaticSpelling, extendedKinds, readyMaterial } from './game-materials.ts';

export function prepareExtendedActivity(a:LearningActivity,words:Word[],random:()=>number,readyKeys?:string[]) {
  if(!extendedKinds.has(a.kind))return;
  const word=words.find(w=>w.id===a.wordId)!;
  if(!automaticSpelling.has(a.kind)) {
    const material=readyMaterial(word,a.kind,words);
    if(!material||readyKeys&&!readyKeys.includes(`${word.id}:${a.kind}`)){a.kind='standard';a.choices=[];return;}
    if(['story','program','combine'].includes(a.kind)&&(!a.targets||new Set(material.answer.map(id=>material.tiles.find(t=>t.id===id)?.wordId)).size!==2||a.targets.some(w=>!material.answer.some(id=>material.tiles.find(t=>t.id===id)?.wordId===w.id)))){a.kind='standard';a.choices=[];delete a.targets;delete a.groupId;return;}
    if(a.kind==='quantity'&&(!a.targets||words.find(w=>w.id===a.targets![0].id)?.partOfSpeech!=='numeral'||material.tiles.find(t=>t.id===material.answer[0])?.wordId!==a.targets[1].id)){a.kind='standard';a.choices=[];delete a.targets;delete a.groupId;return;}
    a.material=structuredClone(material);
    if(a.kind==='chunks'&&material.chunks?.join('').toLowerCase()!==word.term.toLowerCase()||a.kind==='word-morph'&&!words.some(w=>w.term.toLowerCase()===material.source?.toLowerCase()&&material.wordIds.includes(w.id))){a.kind='standard';a.choices=[];delete a.material;return;}
  }
  const term=a.word.term.toLowerCase(),shuffle=(xs:string[])=>{for(let i=xs.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[xs[i],xs[j]]=[xs[j],xs[i]];}return xs;};
  if(a.kind==='letter-gap') {const at=Math.floor(random()*term.length);a.spellingBoard=[String(at),...shuffle([...new Set([term[at],...shuffle([...'abcdefghijklmnopqrstuvwxyz']).slice(0,6)])])];}
  if(a.kind==='chunks')a.spellingBoard=shuffle(a.material!.chunks!.map((_,i)=>String(i)));
  if(a.kind==='letter-extra') {const extra=[...'abcdefghijklmnopqrstuvwxyz'].find(c=>!term.includes(c))!;const at=Math.floor(random()*(term.length+1));a.spellingBoard=[term.slice(0,at)+extra+term.slice(at)];}
  if(a.kind==='letter-swap') {const xs=[...term],starts=xs.flatMap((c,i)=>xs.some((d,j)=>i!==j&&c!==d)?[i]:[]),first=starts[Math.floor(random()*starts.length)],ends=xs.flatMap((c,i)=>i!==first&&c!==xs[first]?[i]:[]),second=ends[Math.floor(random()*ends.length)];if(first===undefined){a.kind='standard';a.choices=[];return;}[xs[first],xs[second]]=[xs[second],xs[first]];a.spellingBoard=[xs.join('')];}
  if(a.kind==='letter-push')a.spellingBoard=shuffle([...term]);
  if(a.kind==='letter-sort')a.spellingBoard=shuffle(a.targets!.flatMap(w=>[...w.term.toLowerCase()]));
}
