import type {LearningActivity,LearningSession,LearningStep} from './contracts.ts';
import {currentActivity} from './game-plan.ts';
export interface ReviewSupportEntry {helpedAt:string;first:'answered'|'recorded'|'declined';retryHinted?:true;evidenceId?:string;retry?:{at:string;status:'tried'|'skipped';hinted:boolean}}
export interface ReviewSupport {version:1;entries:Record<string,ReviewSupportEntry>}
export const reviewDirection=(step:LearningStep)=>step==='recall'||step==='practice-zh-en'?'recall':step==='read'||step==='practice-read'?'read':step==='recognize'||step==='practice-look'||step==='practice-en-zh'?'recognize':step==='listen'||step==='sound'?'listen':undefined;
const order=(step:LearningStep)=>{const direction=reviewDirection(step);return direction==='recall'?0:direction==='read'?1:direction==='recognize'?2:3;};
export const orderReviewSteps=(steps:LearningStep[])=>steps.slice().sort((a,b)=>order(a)-order(b));
export const orderReviewActivities=(activities:LearningActivity[])=>activities.slice().sort((a,b)=>order(a.step)-order(b.step));
/** Only the frozen scope supplies choices. No new material, word, goal or answer-bearing game. */
export function reviewActivitySkins(activities:LearningActivity[],start=0){const choices:LearningActivity['choices']=[];for(const a of activities)if(!choices.some(w=>w.id===a.wordId||w.term.toLowerCase()===a.word.term.toLowerCase()||w.meaning===a.word.meaning||w.imageUrl===a.word.imageUrl))choices.push(a.word);
  return activities.map((a,index)=>index<start?a:{id:a.id,wordId:a.wordId,word:a.word,step:a.step,kind:(a.step==='read'||a.step==='recall'?'portal':'standard') as LearningActivity['kind'],choices:['read','recall'].includes(a.step)?[]:[a.word,...choices.filter(w=>w.id!==a.wordId&&w.term.toLowerCase()!==a.word.term.toLowerCase()&&w.meaning!==a.word.meaning&&w.imageUrl!==a.word.imageUrl)].slice(0,3).sort((x,y)=>x.id.localeCompare(y.id))});
}
export function reviewRetryPlan(session:LearningSession){const activities=session.activities??[],words=new Set<string>(),plan:LearningActivity[]=[];if(!session.reviewSupport)return plan;
  for(const [index,a] of activities.entries())if(plan.length<2&&!words.has(a.wordId)&&reviewDirection(a.step)&&session.reviewSupport.entries[a.id]&&activities.slice(index+1).some(other=>other.wordId!==a.wordId)){words.add(a.wordId);plan.push(a);}return plan;
}
export function currentReviewRetry(session:LearningSession|null|undefined){if(!session?.reviewSupport||session.completedAt||session.suspendedAt||currentActivity(session))return;return reviewRetryPlan(session).find(a=>!session.reviewSupport!.entries[a.id].retry);}
export function validReviewSupport(session:LearningSession){const value=session.reviewSupport;if(value===undefined)return true;if(session.entrySource?.entry!=='review'||session.learningPolicy?.reviewSequence!==1||!value||value.version!==1||Object.keys(value).some(k=>!['version','entries'].includes(k))||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))return false;
  return Object.entries(value.entries).every(([id,row])=>session.activities?.some(a=>a.id===id&&!!reviewDirection(a.step))&&row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).every(k=>['helpedAt','first','evidenceId','retry','retryHinted'].includes(k))&&Number.isFinite(Date.parse(row.helpedAt))&&['answered','recorded','declined'].includes(row.first)&&(row.retryHinted===undefined||row.retryHinted===true)&&(row.evidenceId===undefined||typeof row.evidenceId==='string'&&row.evidenceId.length<=200)&&(!row.retry||typeof row.retry==='object'&&Object.keys(row.retry).every(k=>['at','status','hinted'].includes(k))&&Number.isFinite(Date.parse(row.retry.at))&&['tried','skipped'].includes(row.retry.status)&&typeof row.retry.hinted==='boolean'));
}
