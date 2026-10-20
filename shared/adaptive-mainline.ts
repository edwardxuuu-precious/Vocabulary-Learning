import type { GameKind, LearningActivity, Word } from './contracts.ts';
import { mainlineActivities } from './mainline-experience.ts';
import { fixedPackGame } from './pack-games.ts';
import { buildActivities } from './game-plan.ts';
import { gameDefinition, seededRandom, type GamePlanOptions } from './game-registry.ts';
import { pairedGame } from './game-boards.ts';

/** Independent recall stays recall-first; longer free drawing and parent-led games stay optional. */
export const adaptiveMainlineKinds:GameKind[] = [
  'listen-first','gate','treasure','supply','bingo','queue','collect','route','mimic',
  'flip','repair','switch','peek','assemble','variants','detective','opposites',
  'sort','odd','parts','paint','position','story','program','combine',
  'sentence-repair','negative','intersection','assign','quantity',
  'letter-path','letter-gap','chunks','letter-sort','letter-extra','letter-swap',
  'dictation','cover-spell','letter-push','word-morph',
];
const distinct=(a:Word,b:Word)=>a.id!==b.id&&a.term.toLowerCase()!==b.term.toLowerCase()&&a.meaning.trim()!==b.meaning.trim()&&a.imageUrl!==b.imageUrl;
const gestureWords=new Set(['run','jump','wave','turn','sit','stand','walk','hop','clap','point','kick','throw','catch','help','find','open','close','look','smile','laugh']);
const suitable=(kind:GameKind,word:Word)=>kind==='mimic'?word.partOfSpeech==='verb'&&gestureWords.has(word.term.toLowerCase())
  :kind==='paint'?['noun','adjective'].includes(word.partOfSpeech??'')
  :['parts','sort'].includes(kind)?word.partOfSpeech==='noun'
  :['program','assign'].includes(kind)?word.partOfSpeech==='verb'
  :kind==='position'?['preposition','adverb'].includes(word.partOfSpeech??''):true;

/** Reuse the proven game builders. A new skin cannot add/reorder goals or cross a saved rest. */
export function adaptiveMainlineActivities(activities:LearningActivity[],words:Word[],seed:string,startIndex=0,checkpoints:string[]=[],options:GamePlanOptions={}):LearningActivity[] {
  const rows=mainlineActivities(activities,words,seed,startIndex,checkpoints),random=seededRandom(seed+':adaptive-v3');
  const byId=new Map(words.map(w=>[w.id,w])),introduced=new Set(rows.filter(a=>!rows.some(b=>b.wordId===a.wordId&&b.step==='learn')).map(a=>a.wordId));
  const counts=new Map<string,number>(),lastByStep=new Map<string,string>(),assigned=new Set<number>();
  let segment=0,listenPhase=-1;const segmentKinds=new Set<string>();
  for(let index=0;index<rows.length;index++){
    if(index&&checkpoints.includes(rows[index-1].id)){segment++;segmentKinds.clear();}
    let a=rows[index];if(a.step==='learn')introduced.add(a.wordId);
    if(a.step==='listen'&&rows[index-1]?.step!=='listen')listenPhase++;
    const remember=(kind:string,count=1)=>{counts.set(kind,(counts.get(kind)??0)+count);lastByStep.set(a.step,kind);if(['listen','sound','spell'].includes(a.step))segmentKinds.add(kind);};
    if(assigned.has(index))continue;
    if(index<startIndex||!['listen','sound','spell'].includes(a.step)){if(a.kind!=='standard')remember(a.kind);continue;}
    if(options.allowedKinds&&a.kind!=='standard'&&!options.allowedKinds.includes(a.kind))a=rows[index]={id:a.id,wordId:a.wordId,word:a.word,step:a.step,kind:'standard',choices:a.choices};
    // A practice-only listening game must still be followed by an objective sound check.
    const listened=rows.find(other=>other.wordId===a.wordId&&other.step==='listen');
    if(a.step==='sound'&&listened&&gameDefinition(listened.kind)?.practiceOnly){rows[index]={id:a.id,wordId:a.wordId,word:a.word,step:a.step,kind:'standard',choices:a.choices.length?a.choices:mainlineActivities(activities,words,seed,0,checkpoints)[index].choices};continue;}
    const target=byId.get(a.wordId);if(!target)continue;
    const next=rows[index+1],canPair=!!next&&next.step===a.step&&!checkpoints.includes(a.id)&&index+1>=startIndex;
    const candidates:{activities:LearningActivity[];score:number}[]=[];
    const hasSound=rows.some(other=>other.wordId===a.wordId&&other.step==='sound');
    const objectiveListen=a.step==='listen'&&(listenPhase%2===1||!hasSound);
    for(const kind of adaptiveMainlineKinds){
      const definition=gameDefinition(kind)!;
      if(definition.step!==a.step&&!(kind==='mimic'&&a.step==='listen')||!suitable(kind,target)||options.allowedKinds&&!options.allowedKinds.includes(kind)||pairedGame(kind)&&!canPair)continue;
      const semanticReady=!!target.gameMaterials?.[kind]&&options.readyMaterialKeys?.includes(`${target.id}:${kind}`);
      if(objectiveListen&&definition.practiceOnly&&!(hasSound&&semanticReady))continue;
      if(segment===0&&a.step==='listen'&&kind==='gate'&&hasSound)continue;
      const pool:Word[]=[];
      const add=(word:Word|undefined)=>{if(word&&introduced.has(word.id)&&word.assetStatus==='approved'&&word.imageUrl!=='/assets/placeholder.svg'&&(!definition.nounOnly||word.partOfSpeech==='noun')&&(!definition.verbOnly||word.partOfSpeech==='verb')&&pool.every(other=>distinct(other,word)))pool.push(word);};
      add(target);if(!pool.length)continue;
      if(canPair)add(byId.get(next.wordId));
      // Material references take priority over unrelated distractors, and must already be introduced.
      for(const id of target.gameMaterials?.[kind]?.wordIds??[])if(pool.length<3)add(byId.get(id));
      for(const prior of rows.slice(0,index).reverse())if(pool.length<3)add(byId.get(prior.wordId));
      for(const word of words)if(pool.length<3)add(word);
      if(pairedGame(kind)&&(pool.length<2||pool[1].id!==next.wordId))continue;
      // Missing readiness is a closed gate for any material-dependent game.
      const readyOptions={...options,readyMaterialKeys:options.readyMaterialKeys??[]};
      const plans=pairedGame(kind)?buildActivities(pool.map(w=>({wordId:w.id,mode:'review',steps:[a.step]})),pool,random,{...readyOptions,forcedKind:kind,allowedKinds:[kind],practiceRounds:true,randomize:true,wordBatchSize:3})
        :fixedPackGame(pool,kind,readyOptions,random);
      const plan=plans.find(item=>item.wordId===a.wordId&&item.kind===kind);if(!plan)continue;
      const members=pairedGame(kind)?plans.filter(item=>item.groupId===plan.groupId):[plan];
      if(pairedGame(kind)&&(members.length!==2||members[1].wordId!==next.wordId))continue;
      if(members.some(item=>item.material?.wordIds.some(id=>!introduced.has(id))))continue;
      // Prefer fresh mechanisms, avoid consecutive repeats and cap each segment at three games.
      if(segmentKinds.size>=3&&!segmentKinds.has(kind))continue;
      const score=(counts.get(kind)??0)*10+(lastByStep.get(a.step)===kind?6:0)+(segmentKinds.has(kind)?2:0)-(semanticReady?4:0)-(kind==='mimic'?3:0)+random();
      candidates.push({activities:members,score});
    }
    candidates.sort((a,b)=>a.score-b.score);
    const chosen=candidates[0]?.activities;if(!chosen){
      if(a.kind!=='standard'&&segmentKinds.size>=3&&!segmentKinds.has(a.kind))rows[index]={id:a.id,wordId:a.wordId,word:a.word,step:a.step,kind:'standard',choices:a.choices};
      else if(a.kind!=='standard')remember(a.kind);
      continue;
    }
    for(let offset=0;offset<chosen.length;offset++){
      const original=rows[index+offset],skin=structuredClone(chosen[offset]);
      if(skin.groupId)skin.groupId=`adaptive-${index}-${skin.groupId}`;
      rows[index+offset]={...skin,id:original.id,wordId:original.wordId,step:original.step,word:original.word};assigned.add(index+offset);
    }
    remember(chosen[0].kind,chosen.length);
  }
  return rows;
}
