import type { LearningExposure, Word, WordPack } from './contracts.ts';
import { entryPools,entryResume,entryScopeIssue,type EntryIntent,type EntryOrigin,type EntrySessionScope } from './entry-rules.ts';

export const prototypeStorageKey='playroom:entry-prototype:v1';
export const prototypeScenarios={normal:'正常开始','both-pending':'两边都有进度',legacy:'保留旧综合轮次','no-new':'没有新词','no-due':'今天没有到期','no-content':'没有就绪内容',updated:'义项已经更新','audio-failure':'播放失败','mic-denied':'麦克风不可用'} as const;
export type PrototypeScenario=keyof typeof prototypeScenarios;
export type PrototypeStep='introduce'|'recognize'|'listen'|'read'|'recall';
export interface PrototypeWord extends Word {symbol:string}
export interface PrototypeItem {id:string;step:PrototypeStep;word:PrototypeWord}
export interface PrototypeAnswer {heard?:boolean;hinted?:boolean;wrong?:number;firstChoice?:boolean;oral?:'recording'|'ready';device?:'audio'|'mic';recovered?:boolean;feedback?:'correct'|'helped'|'demonstrated'|'skipped'}
export interface PrototypeSession extends EntrySessionScope {items:PrototypeItem[];cursor:number;states:Record<string,PrototypeAnswer>;atBreak:boolean;checkpoint?:number}
export interface EntryPrototype {
  schema:1;scenario:PrototypeScenario;serial:number;screen:'home'|'landing'|'play'|'done'|'blocked';entry:EntryIntent;packId?:string;
  activeId?:string;introductions:LearningExposure[];reviewedToday:string[];sessions:PrototypeSession[];
}
const moment=new Date('2026-10-25T04:00:00Z'); // Frozen example condition, never a real observation.
export function prototypeContent(scenario:PrototypeScenario) {
  const packs:WordPack[]=[{id:'garden',title:'身边的小伙伴',enabled:scenario!=='no-content',createdAt:'2026-10-01T00:00:00Z'},
    {id:'picnic',title:'一起去野餐',enabled:scenario!=='no-content',createdAt:'2026-10-02T00:00:00Z'}];
  const words:PrototypeWord[]=[['apple','苹果','🍎','garden'],['cat','小猫','🐱','picnic'],['banana','香蕉','🍌','garden'],['dog','小狗','🐶','picnic']].map(([id,meaning,symbol,packId])=>({
    id,term:id,meaning,symbol,packId,learningVersion:scenario==='updated'&&id==='banana'?1:0,imageUrl:`/example-only/${id}.svg`,assetStatus:'approved',imageSource:'upload',
  }));
  return {packs,words,audioReadyWordIds:words.map(word=>word.id)};
}
export function prototypePools(state:EntryPrototype){return entryPools({...prototypeContent(state.scenario),introductions:state.introductions},moment);}
export function prototypeSession(state:EntryPrototype){return state.sessions.find(session=>session.id===state.activeId);}
export function prototypeCurrent(state:EntryPrototype){const session=prototypeSession(state);return session?.items[session.cursor];}
export function prototypeLanding(state:EntryPrototype){
  const pools=prototypePools(state),resume=entryResume(state.sessions,state.entry,state.packId);
  const all=(state.entry==='learn'?pools.learn:pools.review).filter(word=>!state.packId||word.packId===state.packId);
  const candidates=state.entry==='review'&&!state.packId?all.filter(word=>['banana','dog'].includes(word.id)&&!state.reviewedToday.includes(word.id)):all;
  return {pools,resume,candidates:candidates.slice(0,state.packId?all.length:2),all,issue:resume?entryScopeIssue(resume,pools.ready):undefined};
}
function begin(state:EntryPrototype,intent:EntryOrigin,words:PrototypeWord[],packId?:string){
  const id=`preview-${++state.serial}`,steps:PrototypeStep[]=intent==='learn'?['introduce','listen','recognize','recall','read']:['recall','listen','recognize','read'];
  const item=(word:PrototypeWord,step:PrototypeStep)=>({id:`${id}:${word.id}:${step}`,step,word:{...word}});
  const items=intent==='learn'?steps.flatMap(step=>words.map(word=>item(word,step))):words.flatMap(word=>steps.map(step=>item(word,step)));
  const session:PrototypeSession={id,intent,source:intent==='legacy'?'legacy':packId?'book':'recommended',packId,status:'active',words:words.map(word=>({...word})),
    items,cursor:0,states:{},atBreak:false,checkpoint:words.length>1?(intent==='learn'?words.length*3:4):undefined};
  state.sessions.push(session);state.activeId=id;state.screen='play';return session;
}
export function createEntryPrototype(scenario:PrototypeScenario='normal'):EntryPrototype {
  const state:EntryPrototype={schema:1,scenario,serial:0,screen:'home',entry:'learn',introductions:['banana','dog'].map(wordId=>({wordId,learningVersion:0,introducedAt:'2026-10-23T04:00:00Z'})),reviewedToday:[],sessions:[]};
  const words=prototypeContent(scenario).words;
  if(scenario==='no-new')state.introductions=words.map(word=>({wordId:word.id,learningVersion:word.learningVersion??0,introducedAt:'2026-10-23T04:00:00Z'}));
  if(scenario==='no-due')state.reviewedToday=['banana','dog'];
  if(scenario==='both-pending'){
    const learning=begin(state,'learn',words.slice(0,2));learning.cursor=1;learning.status='paused';
    state.introductions.push({wordId:'apple',learningVersion:0,introducedAt:'2026-10-25T03:00:00Z'});
    const review=begin(state,'review',words.slice(2));review.status='paused';
  }
  if(scenario==='legacy'){const legacy=begin(state,'legacy',[words[0],words[2]]);legacy.status='paused';}
  if(scenario==='updated'){const review=begin(state,'review',[{...words[2],learningVersion:0}]);review.status='paused';}
  state.activeId=undefined;state.screen='home';return state;
}
export type PrototypeAction={type:'open';entry:EntryIntent;packId?:string}|{type:'home'}|{type:'start'}|{type:'legacy';id:string}|{type:'pause'}|{type:'continue-segment'}
  |{type:'activity';sessionId:string;itemId:string;action:'help'|'listen'|'retry'|'choose'|'record'|'finish-recording'|'skip'|'next';choice?:string};
/** Frozen activity IDs reject stale/double clicks; all results remain example-only. */
export function prototypeTransition(current:EntryPrototype,action:PrototypeAction):EntryPrototype {
  const state=structuredClone(current);
  if(action.type==='open'){state.entry=action.entry;state.packId=action.packId;state.screen='landing';state.activeId=undefined;return state;}
  if(action.type==='home'||action.type==='pause'){
    const session=prototypeSession(state);if(session?.status==='active')session.status='paused';
    state.screen=action.type==='home'||session?.intent==='legacy'?'home':'landing';return state;
  }
  if(action.type==='legacy'){
    const session=state.sessions.find(session=>session.id===action.id&&session.intent==='legacy'&&session.status!=='completed');
    if(session){state.activeId=session.id;state.screen=entryScopeIssue(session,prototypePools(state).ready)?'blocked':'play';session.status='active';}
    return state;
  }
  if(action.type==='start'){
    if(state.screen!=='landing')return state;
    const landing=prototypeLanding(state);
    if(landing.resume){state.activeId=landing.resume.id;state.screen=landing.issue?'blocked':'play';if(!landing.issue){landing.resume.status='active';landing.resume.atBreak=false;}}
    else if(landing.candidates.length)begin(state,state.entry,landing.candidates as PrototypeWord[],state.packId);
    return state;
  }
  const session=prototypeSession(state);
  if(!session||state.screen!=='play'||session.status!=='active')return state;
  if(action.type==='continue-segment'){session.atBreak=false;return state;}
  if(session.atBreak||action.sessionId!==session.id)return state;
  const item=session.items[session.cursor];if(!item||action.itemId!==item.id)return state;
  const answer=session.states[item.id]??={};
  if(action.action==='next'){
    if(!answer.feedback)return state;
    if(item.step==='introduce'&&!state.introductions.some(fact=>fact.wordId===item.word.id&&fact.learningVersion===(item.word.learningVersion??0)))
      state.introductions.push({wordId:item.word.id,learningVersion:item.word.learningVersion??0,introducedAt:moment.toISOString()});
    session.cursor++;
    if(session.cursor===session.items.length){session.status='completed';state.screen='done';
      if(session.intent==='review'&&session.source==='recommended')state.reviewedToday=[...new Set([...state.reviewedToday,...session.words.map(word=>word.id)])];
    }else if(session.cursor===session.checkpoint)session.atBreak=true;
    return state;
  }
  if(answer.feedback)return state;
  if(action.action==='help'){answer.hinted=true;return state;}
  if(action.action==='retry'){answer.device=undefined;answer.recovered=true;return state;}
  if(action.action==='skip'){answer.feedback='skipped';answer.oral=undefined;return state;}
  if(item.step==='introduce'){
    if(action.action==='listen')answer.heard=true;
    if(action.action==='choose')answer.feedback='demonstrated';
  }else if(item.step==='listen'||item.step==='recognize'){
    if(action.action==='listen'&&item.step==='listen'){
      if(state.scenario==='audio-failure'&&!answer.recovered)answer.device='audio';else answer.heard=true;
    }
    if(action.action==='choose'&&(!answer.device)&&(item.step!=='listen'||answer.heard)){
      const correct=action.choice===item.word.id;
      answer.firstChoice??=correct;
      if(correct)answer.feedback=answer.hinted||answer.firstChoice===false?'helped':'correct';else answer.wrong=(answer.wrong??0)+1;
    }
  }else{
    if(action.action==='listen'){if(state.scenario==='audio-failure'&&!answer.recovered)answer.device='audio';else{answer.hinted=true;answer.heard=true;}}
    if(action.action==='record'){
      if(state.scenario==='mic-denied'&&!answer.recovered)answer.device='mic';else answer.oral='recording';
    }
    if(action.action==='finish-recording'&&answer.oral==='recording'&&!answer.device){answer.oral='ready';answer.feedback='demonstrated';}
  }
  return state;
}

export function restoreEntryPrototype(raw:string|null):EntryPrototype|null {
  if(!raw||raw.length>200_000)return null;
  try{
    const state=JSON.parse(raw) as EntryPrototype;
    if(state.schema!==1||!Object.hasOwn(prototypeScenarios,state.scenario)||!Number.isInteger(state.serial)||state.serial<0
      ||!['home','landing','play','done','blocked'].includes(state.screen)||!['learn','review'].includes(state.entry)
      ||!Array.isArray(state.sessions)||state.sessions.length>30||!Array.isArray(state.introductions)||!Array.isArray(state.reviewedToday))return null;
    if(state.introductions.some(fact=>!fact||typeof fact.wordId!=='string'||!Number.isInteger(fact.learningVersion)||!Number.isFinite(Date.parse(fact.introducedAt))))return null;
    if(state.reviewedToday.some(id=>typeof id!=='string')||new Set(state.sessions.map(session=>session.id)).size!==state.sessions.length)return null;
    for(const session of state.sessions){
      if(!session||typeof session.id!=='string'||!['learn','review','legacy'].includes(session.intent)||!['recommended','book','legacy'].includes(session.source)
        ||!['active','paused','completed'].includes(session.status)||!Array.isArray(session.items)||!session.items.length||session.items.length>40
        ||!Array.isArray(session.words)||!session.words.length||!session.states||typeof session.states!=='object'
        ||!Number.isInteger(session.cursor)||session.cursor<0||session.cursor>session.items.length
        ||session.status==='completed'&&session.cursor!==session.items.length||session.status!=='completed'&&session.cursor===session.items.length)return null;
      if(session.items.some(item=>!item||typeof item.id!=='string'||!['introduce','recognize','listen','read','recall'].includes(item.step)
        ||!item.word||!['apple','cat','banana','dog'].includes(item.word.id)||typeof item.word.term!=='string'||typeof item.word.meaning!=='string'))return null;
      if(session.items.some(item=>typeof item.word.symbol!=='string'||!Number.isInteger(item.word.learningVersion)))return null;
      if(session.words.some(word=>!word||typeof word.id!=='string'||typeof word.term!=='string'||typeof word.meaning!=='string'))return null;
      if(session.source==='book'&&!['garden','picnic'].includes(session.packId??'')||session.intent==='legacy'&&session.source!=='legacy'||session.source==='legacy'&&session.intent!=='legacy')return null;
      if(Object.values(session.states).some(answer=>!answer||typeof answer!=='object'
        ||['heard','hinted','firstChoice','recovered'].some(key=>Object.hasOwn(answer,key)&&typeof answer[key as keyof PrototypeAnswer]!=='boolean')
        ||answer.feedback&&!['correct','helped','demonstrated','skipped'].includes(answer.feedback)
        ||answer.device&&!['audio','mic'].includes(answer.device)||answer.oral&&!['recording','ready'].includes(answer.oral)))return null;
    }
    if(['play','done','blocked'].includes(state.screen)&&!state.sessions.some(session=>session.id===state.activeId))return null;
    return state;
  }catch{return null;}
}
