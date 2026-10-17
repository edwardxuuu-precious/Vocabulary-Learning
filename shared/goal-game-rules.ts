import type { ActivityAction, ActivityState, LearningActivity } from './contracts.ts';
import type { GameTransition } from './game-rules.ts';

export function transitionGoal(activity: LearningActivity, previous: ActivityState, action: ActivityAction, selectedId?: string): GameTransition {
  const state={...previous}, result:GameTransition={state};
  if(state.outcome==='correct'||state.outcome==='practice'){if(action==='next')result.complete=true;return result;}
  if(action==='audio-failed'){state.audioUnavailable=true;return result;}
  if(action==='skip'){state.outcome='practice';state.hinted=true;delete state.selectedId;result.attempt={correct:false,hinted:true,practiceOnly:true,key:'goal-skipped'};return result;}
  if(activity.step==='read'){
    if(action==='reveal'){state.revealed=true;state.heard=true;return result;}
    if(action==='listen-option'&&activity.kind==='think-choice'&&state.revealed&&activity.choices.some(w=>w.id===selectedId)){state.heardOptionIds=[...new Set([...(state.heardOptionIds??[]),selectedId!])];return result;}
    if(action==='finish'){state.outcome='practice';result.attempt={correct:false,hinted:!!state.revealed,practiceOnly:true,key:'goal-recorded'};return result;}
    throw Error('先自己读并保存录音，再听示范对比。');
  }
  if(action==='reveal'){state.revealed=true;state.hinted=true;return result;}
  if(action==='finish'&&activity.choices.length<2&&state.revealed){state.outcome='practice';result.attempt={correct:false,hinted:true,practiceOnly:true,key:'goal-guided'};return result;}
  if(action==='choose'){
    const valid=activity.kind==='gate'?['yes','no'].includes(selectedId??''):activity.choices.some(w=>w.id===selectedId);
    if(!valid)throw Error('请选择这道题里的图片。');
    const correct=activity.kind==='gate'?selectedId===(activity.cueWord?.id===activity.wordId?'yes':'no'):selectedId===activity.wordId;
    state.selectedId=selectedId;state.outcome=correct?'correct':'try';
    result.attempt={correct,hinted:!!state.hinted,practiceOnly:false,key:`goal-${selectedId}`};
    if(!correct)state.hinted=true;
    return result;
  }
  throw Error('先看英文，试着找出意思。');
}

export function validGoalState(activity: LearningActivity, state: ActivityState) {
  if(!state||typeof state!=='object'||Array.isArray(state))return false;
  if(['revealed','heard','hinted','audioUnavailable'].some(k=>(state as any)[k]!==undefined&&typeof (state as any)[k]!=='boolean'))return false;
  if(state.outcome!==undefined&&!['correct','try','practice'].includes(state.outcome))return false;
  if(state.heardOptionIds!==undefined&&(!Array.isArray(state.heardOptionIds)||state.heardOptionIds.length>3||new Set(state.heardOptionIds).size!==state.heardOptionIds.length))return false;
  if(Object.keys(state).some(k=>!['revealed','heard','hinted','audioUnavailable','selectedId','outcome','heardOptionIds'].includes(k)))return false;
  if(activity.step==='read')return state.selectedId===undefined && state.outcome!=='correct' && state.outcome!=='try' && (!state.heard||!!state.revealed) && (!state.heardOptionIds?.length||activity.kind==='think-choice'&&state.revealed&&state.heardOptionIds.every(id=>activity.choices.some(w=>w.id===id)));
  if(state.heard!==undefined||state.heardOptionIds!==undefined)return false;
  if(state.outcome==='correct'||state.outcome==='try'){
    const valid=activity.kind==='gate'?['yes','no'].includes(state.selectedId??''):activity.choices.some(w=>w.id===state.selectedId);
    const correct=activity.kind==='gate'?state.selectedId===(activity.cueWord?.id===activity.wordId?'yes':'no'):state.selectedId===activity.wordId;
    return valid && (state.outcome==='correct')===correct && (state.outcome!=='try'||!!state.hinted);
  }
  return state.selectedId===undefined;
}
