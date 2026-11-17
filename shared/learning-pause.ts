import type {LearningSession} from './contracts.ts';
export interface LearningPauseState {version:1;at:string;reason:'pause'|'rest'|'leave';activityId?:string;checkpointId?:string;draft?:{selectedId?:string;spelling?:number[]}}
export function validLearningPause(session:LearningSession){const value=session.pauseState;if(value===undefined)return true;
  if(!value||value.version!==1||!Number.isFinite(Date.parse(value.at))||!['pause','rest','leave'].includes(value.reason)||Object.keys(value).some(key=>!['version','at','reason','activityId','checkpointId','draft'].includes(key)))return false;
  const activity=session.activities?.find(row=>row.id===value.activityId);
  if(value.activityId!==undefined&&!activity||value.checkpointId!==undefined&&!session.learningPolicy?.checkpoints.includes(value.checkpointId))return false;
  const draft=value.draft;if(draft===undefined)return true;
  if(!activity||activity.kind!=='standard'||!draft||typeof draft!=='object'||Array.isArray(draft)||Object.keys(draft).some(key=>!['selectedId','spelling'].includes(key)))return false;
  return (draft.selectedId===undefined||['listen','sound'].includes(activity.step)&&activity.choices.some(word=>word.id===draft.selectedId))&&(draft.spelling===undefined||activity.step==='spell'&&Array.isArray(draft.spelling)&&draft.spelling.length<=activity.word.term.length&&new Set(draft.spelling).size===draft.spelling.length&&draft.spelling.every(index=>Number.isInteger(index)&&index>=0&&index<activity.word.term.length));
}
