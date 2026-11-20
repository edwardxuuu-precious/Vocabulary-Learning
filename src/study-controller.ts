import {testModeActive} from './test-mode-context';
import type {AppState} from '../shared/contracts';
import {sentenceKey} from '../shared/sentence-study';
import type {StudyStartRequest,StudyStartResponse} from '../shared/study-execution';
import {post,ApiRequestError} from './api';

export type StudyIntent=Pick<StudyStartRequest,'purpose'|'action'|'sessionId'|'activityId'|'wordIds'|'assessmentId'>;
export async function startStudy(state:AppState,intent:StudyIntent,requestId:string,planId?:string){
  if(!state.study)throw new ApiRequestError('学习安排尚未准备好，请刷新重试。');
  const body:StudyStartRequest={...intent,version:1,mode:state.study.mode,planId:planId??state.study.plans[intent.purpose].planId,requestId};
  return post<StudyStartResponse&{state:AppState}>('/api/study/start',body);
}
export function studyScreen(hash:string){return hash.startsWith('#challenge/')?'assessment':hash==='#study-usage'?'study-usage':hash==='#play'?'play':hash==='#learn'?'hub':hash==='#review'?'review':'home';}
export function savedUsageWords(){try{const ids=JSON.parse(sessionStorage.getItem(`study-usage:${testModeActive?'test':'child'}`)??'[]');return Array.isArray(ids)&&ids.length<=40&&ids.every(id=>typeof id==='string')?ids:[];}catch{return [];}}
export function savedUsageFollowUp(){try{const ids=JSON.parse(sessionStorage.getItem(`study-usage-follow-up:${testModeActive?'test':'child'}`)??'[]');return Array.isArray(ids)&&ids.length<=40&&ids.every(id=>typeof id==='string')?ids:[];}catch{return [];}}
export function saveUsageWords(ids:string[],mode:'child'|'test',followUp=ids){try{sessionStorage.setItem(`study-usage:${mode}`,JSON.stringify(ids));sessionStorage.setItem(`study-usage-follow-up:${mode}`,JSON.stringify(followUp));}catch{}}
export interface UsageDestination {returnTo:'hub'|'review'|'reward';sessionId?:string;keys:Record<string,string>}
export function savedUsageDestination():UsageDestination{
  try{const value=JSON.parse(sessionStorage.getItem(`study-usage-destination:${testModeActive?'test':'child'}`)??'null');if(value&&['hub','review','reward'].includes(value.returnTo)&&(!value.sessionId||typeof value.sessionId==='string')&&value.keys&&typeof value.keys==='object'&&!Array.isArray(value.keys)&&Object.values(value.keys).every(key=>typeof key==='string'))return value;}catch{}
  return {returnTo:'review',keys:{}};
}
export function saveUsageDestination(state:AppState,ids:string[],returnTo:UsageDestination['returnTo'],sessionId?:string){
  const destination:UsageDestination={returnTo,sessionId,keys:Object.fromEntries(state.words.filter(word=>ids.includes(word.id)).map(word=>[word.id,sentenceKey(word)]))};
  try{sessionStorage.setItem(`study-usage-destination:${state.study?.mode??(testModeActive?'test':'child')}`,JSON.stringify(destination));}catch{}
  return destination;
}
export function usageScopeCurrent(state:AppState,ids:string[],destination:UsageDestination){return ids.length>0&&ids.every(id=>{const word=state.words.find(word=>word.id===id);return word&&(!destination.keys[id]||destination.keys[id]===sentenceKey(word));});}
export async function saveStudy(state:AppState,position:Record<string,unknown>,requestId:string){
  if(!state.study)return post<AppState>('/api/session/save-position',position);
  return (await post<{state:AppState}>('/api/study/save',{...position,mode:state.study.mode,requestId})).state;
}
