export type GameId = 'paint' | 'place' | 'talk';
export interface WordCard { id:string; term:string; meaning:string; version:number; image:string; audio:string; color?:string; context?:string }
export interface LineCard { wordId:string; full:string; gap:string; chinese:string; phrase:string; usage:string; audio:string }
export interface PreviewContent { key:string; words:WordCard[]; lines:LineCard[]; art:{home:string;hero:string;other:string;icon:string} }
export interface Mission { wordId:string; place:number }
export interface Answer { wordId:string; choice:string; firstChoice:string; helped:boolean }
export interface Run { version:1; contentKey:string; game:GameId; missions:Mission[]; index:number; answers:Answer[]; heard:boolean; helped:boolean; firstChoice?:string; selected?:string; solved:boolean }
export const gameTerms:Record<GameId,string[]>={paint:['black','brown','red','blue'],place:['in','on','under'],talk:['am','are','be']};
export const gameInfo:Record<GameId,{title:string;goal:string;description:string}>={
  paint:{title:'机甲涂装间',goal:'听颜色，完成一辆小车的涂装',description:'英文颜色决定车子真正变成什么样。'},
  place:{title:'能量收纳站',goal:'听位置，把能量块放到正确的地方',description:'把 in、on、under 变成看得见的位置关系。'},
  talk:{title:'伙伴对讲机',goal:'把话说完整，和伙伴接通通话',description:'在 I am、You are、want to be 中选对词。'},
};
export function wordsFor(content:PreviewContent,game:GameId){return gameTerms[game].flatMap(term=>{const w=content.words.find(w=>w.term===term);return w?[w]:[];});}
export function gameAvailable(content:PreviewContent,game:GameId){const words=wordsFor(content,game);return game==='place'?words.length===3:game==='talk'?words.length>=2&&words.every(w=>content.lines.some(l=>l.wordId===w.id)):words.length>=2;}
export const missionCount=(game:GameId)=>game==='paint'?3:6;
function shuffle<T>(input:T[],random:()=>number){const a=[...input];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function newRun(content:PreviewContent,game:GameId,random:()=>number=Math.random):Run{
  const words=wordsFor(content,game);if(words.length<2)throw Error('当前词组不足以安排这个专项。');
  const sequence:WordCard[]=[];while(sequence.length<missionCount(game)){const batch=shuffle(words,random);if(batch[0].id===sequence.at(-1)?.id)batch.push(batch.shift()!);sequence.push(...batch);}
  sequence.length=missionCount(game);
  return {version:1,contentKey:content.key,game,missions:sequence.map((w,i)=>({wordId:w.id,place:i})),index:0,answers:[],heard:false,helped:false,solved:false};
}
export function target(content:PreviewContent,run:Run){return content.words.find(w=>w.id===run.missions[run.index]?.wordId);}
/** A wrong/unsupported action never completes a mission. All records stay inside the prototype. */
export function choose(content:PreviewContent,run:Run,choice:string):Run{
  if(run.solved||!target(content,run)||run.game!=='talk'&&!run.heard&&!run.helped||!wordsFor(content,run.game).some(w=>w.id===choice))return run;
  return {...run,firstChoice:run.firstChoice??choice,selected:choice,solved:choice===run.missions[run.index].wordId};
}
export function nextMission(run:Run):Run{
  if(!run.solved)return run;
  return {...run,index:run.index+1,answers:[...run.answers,{wordId:run.missions[run.index].wordId,choice:run.selected!,firstChoice:run.firstChoice!,helped:run.helped}],heard:false,helped:false,firstChoice:undefined,selected:undefined,solved:false};
}
export function validRun(content:PreviewContent,value:unknown):value is Run{
  if(!value||typeof value!=='object')return false;const r=value as Run;
  if(r.version!==1||r.contentKey!==content.key||!Object.keys(gameTerms).includes(r.game)||!Array.isArray(r.missions)||r.missions.length!==missionCount(r.game)||!Number.isInteger(r.index)||r.index<0||r.index>r.missions.length||!Array.isArray(r.answers)||r.answers.length!==r.index)return false;
  const ids=new Set(wordsFor(content,r.game).map(w=>w.id));
  return r.missions.every((m,i)=>ids.has(m.wordId)&&m.place===i)&&r.answers.every((a,i)=>a.wordId===r.missions[i].wordId&&a.choice===a.wordId&&ids.has(a.firstChoice)&&typeof a.helped==='boolean')&&typeof r.heard==='boolean'&&typeof r.helped==='boolean'&&typeof r.solved==='boolean'&&(!r.selected||ids.has(r.selected))&&(!r.firstChoice||ids.has(r.firstChoice))&&(!r.solved||r.index<r.missions.length&&r.selected===r.missions[r.index].wordId&&!!r.firstChoice&&ids.has(r.firstChoice));
}
