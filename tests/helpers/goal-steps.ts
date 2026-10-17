import type { LearningActivity, LearningSession } from '../../shared/contracts.ts';
import { Store } from '../../server/store.ts';
import { currentActivity } from '../../shared/game-plan.ts';

/** Existing mechanism tests explicitly skip the extra oral checkpoint. Dedicated goal tests record WAVs. */
export function finishGoalFixture(store:Store,session:LearningSession,a:LearningActivity){
  if(a.step!=='recognize'&&a.step!=='read')return false;
  const send=(action:string,selectedId?:string)=>store.activityEvent({sessionId:session.id,activityId:a.id,action,selectedId});
  if(a.step==='read')send('skip');
  else if(a.choices.length<2){send('reveal');send('finish');}
  else send('choose',a.kind==='gate'?(a.cueWord?.id===a.wordId?'yes':'no'):a.wordId);
  send('next');return true;
}
export function finishCurrentGoalFixture(store:Store){const s=store.read().sessions.at(-1);const a=s&&currentActivity(s);return !!s&&!!a&&finishGoalFixture(store,s,a);}
