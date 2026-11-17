import type {AppState,Word} from './contracts.ts';
export interface DailyLearningChoice {day:string;revision:number;goal:number;wordIds?:string[];wordVersions?:Record<string,number>}
export const choiceDay=(now:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function todayLearningChoice(data:{dailyLearningChoice?:DailyLearningChoice},now:Date){return data.dailyLearningChoice?.day===choiceDay(now)?data.dailyLearningChoice:undefined;}
export function validDailyLearningChoice(value:unknown,words:Word[]):value is DailyLearningChoice {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as DailyLearningChoice;
  return Object.keys(v).every(k=>['day','revision','goal','wordIds','wordVersions'].includes(k))&&/^\d{4}-\d{2}-\d{2}$/.test(v.day)&&Number.isFinite(Date.parse(v.day))&&Number.isSafeInteger(v.revision)&&v.revision>0&&Number.isInteger(v.goal)&&v.goal>=1&&v.goal<=20
    && (v.wordIds===undefined?v.wordVersions===undefined:Array.isArray(v.wordIds)&&v.wordIds.length>0&&v.wordIds.length<=500&&new Set(v.wordIds).size===v.wordIds.length&&v.wordIds.every(id=>typeof id==='string'&&words.some(w=>w.id===id))&&!!v.wordVersions&&Object.keys(v.wordVersions).length===v.wordIds.length&&v.wordIds.every(id=>Number.isSafeInteger(v.wordVersions![id])&&v.wordVersions![id]>=0));
}
export function learningChoiceSummary(data:Pick<AppState,'settings'|'dailyLearningChoice'>,now:Date){const choice=todayLearningChoice(data,now);return {choice,goal:choice?.goal??data.settings.dailyNewWords,revision:data.dailyLearningChoice?.revision??0,day:choiceDay(now)};}
