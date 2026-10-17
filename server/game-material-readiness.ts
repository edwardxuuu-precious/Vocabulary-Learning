import type { GameCue, Word } from '../shared/contracts.ts';
import { materialCues,readyMaterial } from '../shared/game-materials.ts';

/** Read cache only. Missing narration never initiates synthesis from the child path. */
export async function readyGameMaterialKeys(words:Word[],candidates:Word[],imageAvailable:(url:string)=>boolean,cached:(cue:GameCue)=>Promise<boolean>) {
  const cache=new Map<string,Promise<boolean>>(),ready:string[]=[];
  const available=(cue:GameCue)=>{const key=cue.locale+':'+cue.text;if(!cache.has(key))cache.set(key,cached(cue).catch(()=>false));return cache.get(key)!;};
  for(const word of candidates)for(const kind of Object.keys(word.gameMaterials??{})) {
    const m=readyMaterial(word,kind,words);if(!m||m.tiles.some(t=>t.imageUrl&&!imageAvailable(t.imageUrl)))continue;
    const cues=materialCues(m);
    if(kind==='cloze'||kind==='sentence-repair')cues.push({text:m.sentence!.map((v,i)=>i===m.blank?word.term:v).join(' '),locale:'en-US'});
    if((await Promise.all(cues.map(available))).every(Boolean))ready.push(`${word.id}:${kind}`);
  }
  return ready;
}
