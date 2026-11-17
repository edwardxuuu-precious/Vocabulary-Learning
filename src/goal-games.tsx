import { useState } from 'react';
import { LearningTopbar } from './learning-topbar';
import type { ActivityAction, LearningActivity, LearningAttempt, LearningSession, LearningStep } from '../shared/contracts';
import { goalLabels, goalStep, learningGoals } from '../shared/learning-goals';
import { activityTitles } from '../shared/game-plan';
import { Mascot } from './mascot';
import { companionFor } from '../shared/companions';
import { OralPractice } from './oral-practice';
import './goal-games.css';
import {LearningTaskFrame,TaskWord,TaskActionBar,TaskIcon} from './learning-task-frame';

function Icon({name,size=22}:{name:'home'|'pause'|'sound'|'arrow';size?:number}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{name==='home'?<path d="m3 10 9-7 9 7v11H3Zm5 11v-8h8v8"/>:name==='pause'?<path d="M8 5v14M16 5v14"/>:name==='arrow'?<path d="M4 12h15m-6-6 6 6-6 6"/>:<><path d="m11 4-6 5H2v6h3l6 5Z"/><path d="M15 8a6 6 0 0 1 0 8"/></>}</svg>;}

export function GoalTrail({session,wordId,attempts=[],step}:{session:LearningSession;wordId:string;attempts?:LearningAttempt[];step?:LearningStep}){
  const task=session.tasks?.find(t=>t.wordId===wordId),done=session.completedSteps?.[wordId]??[];
  return <div className="goal-trail" aria-label="这个词的认听读目标">{learningGoals.map(goal=>{
    const steps=task?.steps.filter(s=>goalStep(s)===goal)??[],covered=steps.length>0&&steps.every(s=>done.includes(s)||['correct','practice'].includes(session.activityStates?.[`${wordId}:${s}`]?.outcome??''));
    const records=attempts.filter(a=>a.sessionId===session.id&&a.wordId===wordId&&a.skill===goal),latest=records.at(-1);
    const status=latest?.oralStatus==='skipped'?'已跳过':covered?(goal==='read'?'已录 · 待核验':latest?.practiceOnly||latest?.hinted?'练过':'已完成'):'待完成';
    return <span key={goal} className={`${covered?'is-covered':''} ${step && goalStep(step)===goal && !covered?'is-current':''}`} aria-label={`${goalLabels[goal]}：${status}`}><b>{goalLabels[goal]}</b><small>{status==='待完成'?'待练':status}</small></span>;
  })}</div>;
}

export function GoalGame({activity,session,busy,playing,attempts,onAction,onHome,onPause,stopAudio}:{activity:LearningActivity;session:LearningSession;busy:boolean;playing:boolean;attempts?:LearningAttempt[];onAction:(action:ActivityAction,selectedId?:string,advance?:boolean)=>void;onHome:()=>void;onPause:()=>void;stopAudio:()=>void}){
  const [ready,setReady]=useState(false),[oralBusy,setOralBusy]=useState(false);
  const state=session.activityStates?.[activity.id]??{},read=activity.step==='read',accepted=['correct','practice'].includes(state.outcome??''),blocked=busy||oralBusy||playing;
  const last=attempts?.filter(a=>a.sessionId===session.id&&a.activityId===activity.id).at(-1);
  const guided=activity.choices.length<2;
  const helpedWord=!!session.reviewSupport&&session.activities?.some(row=>row.wordId===activity.wordId&&session.reviewSupport!.entries[row.id]);
  return <LearningTaskFrame session={session} kind={read?'read':'recognize'} title={read?'看英文，读一读':'看英文，选图片'} instruction={read?'自己读出这个词，保存声音后继续。':activity.kind==='gate'?'看一看，英文和图片是一对吗？':'点一张图片，选出这个词的意思。'} cue={<TaskWord>{activity.word.term}</TaskWord>} onHome={onHome} onPause={onPause}>
    {!read&&activity.kind==='gate'&&<><div className="task-guided-picture"><img src={activity.cueWord!.imageUrl} alt="待判断的图片"/></div><div className="task-yes-no"><button aria-label="是一对" disabled={blocked||accepted} onClick={()=>onAction('choose','yes')}>✓ 是一对</button><button aria-label="不是一对" disabled={blocked||accepted} onClick={()=>onAction('choose','no')}>× 不是一对</button></div></>}
    {!read&&activity.kind!=='gate'&&!guided&&<div className="task-picture-choices">{activity.choices.map(w=><button key={w.id} aria-label={`选择${w.meaning}`} disabled={blocked||accepted} className={state.selectedId===w.id?state.outcome==='correct'?'is-correct':'is-retry':''} onClick={()=>onAction('choose',w.id)}><img src={w.imageUrl} alt={w.meaning}/>{state.selectedId===w.id&&accepted&&<span className="task-choice-mark">✓</span>}</button>)}</div>}
    {!read&&guided&&!state.revealed&&<p className="task-speech-title">先想一想，需要时点“看看意思”</p>}
    {state.revealed&&<div className="task-guided-picture"><img src={activity.word.imageUrl} alt={activity.word.meaning}/></div>}
    {read&&<OralPractice unified variant="task" target={{sessionId:session.id,activityId:activity.id,planVersion:session.learningPolicy?.version??1}} active={!busy&&!playing} busy={busy} stopAudio={stopAudio} readOnly={accepted} complete={()=>onAction(accepted?'next':'finish',undefined,!accepted)} onReady={setReady} onBusy={setOralBusy} onSkip={accepted?undefined:()=>onAction('skip')} secondaryControls={!accepted&&(ready||session.reviewSupport)?<button disabled={blocked} onClick={()=>onAction('reveal')}><TaskIcon kind="sound"/>{state.revealed?'再听示范':ready?'听示范，对比一下':'还不会读，听一听'}</button>:undefined}/>}
    {!read&&<TaskActionBar status={state.outcome==='try'?'再看一看，换一张试试':accepted?(state.outcome==='correct'?'认出来啦！':'这步练过了'):state.revealed?activity.word.meaning:'直接点图片作答'} tone={accepted?'success':state.outcome==='try'?'error':'normal'} skip={!accepted?{action:()=>onAction('skip'),disabled:blocked}:undefined} secondary={!accepted&&!state.revealed?<button disabled={blocked} onClick={()=>onAction('reveal')}><TaskIcon kind="sound"/>看看意思</button>:undefined} primary={accepted?<button disabled={blocked} onClick={()=>onAction('next')}>继续<TaskIcon kind="arrow"/></button>:guided&&state.revealed?<button disabled={blocked} onClick={()=>onAction('finish',undefined,true)}>继续<TaskIcon kind="arrow"/></button>:undefined} waiting="选一张图片作答"/>}
  </LearningTaskFrame>;
}
