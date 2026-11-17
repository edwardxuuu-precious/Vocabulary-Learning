import {testModeActive} from './test-mode-context';
import type {AppState} from '../shared/contracts';
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
export async function saveStudy(state:AppState,position:Record<string,unknown>,requestId:string){
  if(!state.study)return post<AppState>('/api/session/save-position',position);
  return (await post<{state:AppState}>('/api/study/save',{...position,mode:state.study.mode,requestId})).state;
}
