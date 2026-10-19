import type { GameKind, LearningActivity, LearningTask, PackGameCatalogue, Word } from './contracts.ts';
import { buildActivities } from './game-plan.ts';
import { gameRegistry, type GamePlanOptions } from './game-registry.ts';
import { pairedGame } from './game-boards.ts';

const distinct = (a:Word,b:Word) => a.id!==b.id && a.term.toLowerCase()!==b.term.toLowerCase() && a.meaning.trim()!==b.meaning.trim() && a.imageUrl!==b.imageUrl;

/** A chosen game never silently turns into a different game or an introduction. */
export function fixedPackGame(words:Word[], kind:GameKind, options:GamePlanOptions={}, random:()=>number=Math.random):LearningActivity[] {
  const definition=gameRegistry.find(game=>game.kind===kind);
  if(!definition)return [];
  const pool=words.filter(word=>(!definition.nounOnly||word.partOfSpeech==='noun')&&(!definition.verbOnly||word.partOfSpeech==='verb'));
  const remaining=[...pool],result:LearningActivity[]=[];
  let batch=0;
  while(remaining.length){
    const targets=[remaining.shift()!],size=pairedGame(kind)?2:3;
    while(targets.length<size){const index=remaining.findIndex(word=>targets.every(other=>distinct(word,other)));if(index<0)break;targets.push(remaining.splice(index,1)[0]);}
    if(pairedGame(kind)&&targets.length!==2)continue;
    const members=[...targets];
    for(const word of pool){if(members.length>=Math.max(size,definition.minWords))break;if(members.every(other=>distinct(word,other)))members.push(word);}
    const tasks:LearningTask[]=members.map(word=>({wordId:word.id,mode:'review',steps:[definition.step]}));
    const targetIds=new Set(targets.map(word=>word.id));
    const activities=buildActivities(tasks,members,random,{...options,forcedKind:kind,practiceRounds:true,randomize:true,wordBatchSize:3});
    const chosen=activities.filter(activity=>activity.kind===kind&&targetIds.has(activity.wordId));
    if(pairedGame(kind)&&chosen.length!==2)continue;
    for(const activity of chosen)result.push({...activity,...(activity.groupId?{groupId:`pack-${kind}-${batch}-${activity.groupId}`}:{})});
    batch++;
  }
  return result;
}

export function packGamePlans(words:Word[], options:GamePlanOptions={}, random:()=>number=Math.random) {
  return gameRegistry.map(definition=>({definition,activities:fixedPackGame(words,definition.kind,options,random)}));
}

/** Randomness is used once at creation. The resulting activities are persisted verbatim. */
export function randomPackGame(words:Word[], options:GamePlanOptions={}, random:()=>number=Math.random):LearningActivity[] {
  const plans=packGamePlans(words,options,random),used=new Set<string>(),result:LearningActivity[]=[];
  for(const word of words){
    if(used.has(word.id))continue;
    const candidates:LearningActivity[][]=[];
    for(const {activities} of plans){
      const current=activities.find(activity=>activity.wordId===word.id);if(!current)continue;
      const group=current.groupId?activities.filter(activity=>activity.groupId===current.groupId):[current];
      if(pairedGame(current.kind)&&group.some(activity=>used.has(activity.wordId)))continue;
      const fresh=group.filter(activity=>!used.has(activity.wordId));if(fresh.length)candidates.push(fresh);
    }
    if(!candidates.length)continue;
    const chosen=candidates[Math.min(candidates.length-1,Math.floor(random()*candidates.length))];
    for(const activity of chosen){result.push(activity);used.add(activity.wordId);}
  }
  return result;
}

export function packGameCatalogue(words:Word[], options:GamePlanOptions={}):PackGameCatalogue {
  const plans=packGamePlans(words,options,()=>.37);
  const playable=new Set(plans.flatMap(plan=>plan.activities.map(activity=>activity.wordId)));
  return {wordCount:words.length,randomWordCount:playable.size,games:plans.map(({definition,activities})=>({kind:definition.kind,title:definition.title,step:definition.step,wordCount:new Set(activities.map(activity=>activity.wordId)).size}))};
}
