import type {PreviewContent,WordCard} from './model';
export interface PairRun {version:1;key:string;groups:string[][];group:number;audioOrder:string[];pictureOrder:string[];paired:string[];found:string[];seen:string[];phase:'intro'|'play'|'groupDone'|'complete';active?:string;heard:boolean;textHelp:boolean;picture?:string;result?:'miss'|'match';first:Record<string,string>;helped:string[]}
function shuffled<T>(values:T[],random:()=>number){const rows=[...values];for(let i=rows.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[rows[i],rows[j]]=[rows[j],rows[i]];}return rows;}
function round(run:PairRun,random:()=>number):PairRun{return {...run,audioOrder:shuffled(run.groups[run.group],random),pictureOrder:shuffled(run.groups[run.group],random),paired:[],seen:[],phase:'intro',active:undefined,heard:false,textHelp:false,picture:undefined,result:undefined};}
export function newPairs(content:PreviewContent,random:()=>number=Math.random):PairRun{
  if(content.words.length<2)throw Error('至少需要本次范围内两个词。');
  const remaining=[...content.words],groups:string[][]=[];
  while(remaining.length){const group:WordCard[]=[];for(let i=0;i<remaining.length&&group.length<3;){if(!group.some(w=>w.meaning.trim()===remaining[i].meaning.trim()))group.push(remaining.splice(i,1)[0]);else i++;}if(group.length===1&&remaining.length)group.push(remaining.shift()!);if(group.length===1){const review=content.words.find(w=>w.id!==group[0].id)!;group.push(review);}groups.push(group.map(w=>w.id));}
  return round({version:1,key:content.key,groups,group:0,audioOrder:[],pictureOrder:[],paired:[],found:[],seen:[],phase:'intro',heard:false,textHelp:false,first:{},helped:[]},random);
}
export function selectSound(run:PairRun,id:string):PairRun{return run.phase==='play'&&run.audioOrder.includes(id)&&!run.paired.includes(id)&&run.result!=='miss'?{...run,active:id,heard:false,textHelp:false,picture:undefined,result:undefined}:run;}
export function finishSound(run:PairRun,id:string):PairRun{return run.active===id&&run.phase==='play'?{...run,heard:true}:run;}
export function flipPicture(run:PairRun,id:string):PairRun{
  if(run.phase!=='play'||!run.active||run.paired.includes(run.active)||!run.heard&&!run.textHelp||run.result==='miss'||!run.pictureOrder.includes(id)||run.paired.includes(id))return run;
  const first={...run.first,[`${run.group}:${run.active}`]:run.first[`${run.group}:${run.active}`]??id};
  if(id!==run.active)return {...run,picture:id,result:'miss',first};
  const paired=[...new Set([...run.paired,id])],found=[...new Set([...run.found,id])];
  return {...run,picture:id,result:'match',paired,found,first,phase:paired.length===run.groups[run.group].length?'groupDone':'play'};
}
export function coverPicture(run:PairRun):PairRun{return run.result==='miss'?{...run,picture:undefined,result:undefined}:run;}
export function helpSound(run:PairRun,textMode=false):PairRun{return run.active?{...run,textHelp:run.textHelp||textMode,helped:[...new Set([...run.helped,`${run.group}:${run.active}`])]}:run;}
export function nextPairGroup(run:PairRun,random:()=>number=Math.random):PairRun{
  if(run.phase!=='groupDone')return run;
  return run.group===run.groups.length-1?{...run,phase:'complete'}:round({...run,group:run.group+1},random);
}
export function validPairs(content:PreviewContent,value:unknown):value is PairRun{
  if(!value||typeof value!=='object')return false;const r=value as PairRun,ids=new Set(content.words.map(w=>w.id));
  const list=(a:unknown)=>Array.isArray(a)&&new Set(a).size===a.length&&a.every(id=>typeof id==='string'&&ids.has(id));
  if(r.version!==1||r.key!==content.key||!Array.isArray(r.groups)||!r.groups.length||r.groups.some(g=>!list(g)||g.length<2||g.length>3)||!Number.isInteger(r.group)||r.group<0||r.group>=r.groups.length||!list(r.audioOrder)||!list(r.pictureOrder)||!list(r.paired)||!list(r.found)||!list(r.seen)||typeof r.heard!=='boolean'||typeof r.textHelp!=='boolean'||!['intro','play','groupDone','complete'].includes(r.phase))return false;
  const current=r.groups[r.group];if(r.audioOrder.length!==current.length||r.pictureOrder.length!==current.length||[...r.audioOrder,...r.pictureOrder,...r.paired,...r.seen].some(id=>!current.includes(id))||[...ids].some(id=>!r.groups.some(g=>g.includes(id))))return false;
  return (!r.active||current.includes(r.active))&&(!r.picture||current.includes(r.picture))&&r.paired.every(id=>r.found.includes(id))&&(!['groupDone','complete'].includes(r.phase)||r.paired.length===current.length)&& (r.phase!=='complete'||r.group===r.groups.length-1&&r.found.length===ids.size)&&!!r.first&&typeof r.first==='object'&&Array.isArray(r.helped);
}
