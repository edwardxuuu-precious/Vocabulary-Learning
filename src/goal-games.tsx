import { useState } from 'react';
import type { ActivityAction, LearningActivity, LearningAttempt, LearningSession } from '../shared/contracts';
import { goalLabels, goalStep, learningGoals } from '../shared/learning-goals';
import { activityTitles } from '../shared/game-plan';
import { sessionTaskProgress } from './learning-session';
import { OralPractice } from './oral-practice';
import './goal-games.css';

function Icon({name,size=22}:{name:'home'|'pause'|'sound'|'arrow';size?:number}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{name==='home'?<path d="m3 10 9-7 9 7v11H3Zm5 11v-8h8v8"/>:name==='pause'?<path d="M8 5v14M16 5v14"/>:name==='arrow'?<path d="M4 12h15m-6-6 6 6-6 6"/>:<><path d="m11 4-6 5H2v6h3l6 5Z"/><path d="M15 8a6 6 0 0 1 0 8"/></>}</svg>;}

export function GoalTrail({session,wordId,attempts=[]}:{session:LearningSession;wordId:string;attempts?:LearningAttempt[]}){
  const task=session.tasks?.find(t=>t.wordId===wordId),done=session.completedSteps?.[wordId]??[];
  return <div className="goal-trail" aria-label="这个词的认听读目标">{learningGoals.map(goal=>{
    const steps=task?.steps.filter(s=>goalStep(s)===goal)??[],covered=steps.length>0&&steps.every(s=>done.includes(s)||['correct','practice'].includes(session.activityStates?.[`${wordId}:${s}`]?.outcome??''));
    const records=attempts.filter(a=>a.sessionId===session.id&&a.wordId===wordId&&a.skill===goal),latest=records.at(-1);
    const status=latest?.oralStatus==='skipped'?'已跳过':covered?(goal==='read'?'已录 · 待核验':latest?.practiceOnly||latest?.hinted?'练过':'已完成'):'待完成';
    return <span key={goal} className={covered?'is-covered':''} aria-label={`${goalLabels[goal]}：${status}`}><b>{goalLabels[goal]}</b><small>{status}</small></span>;
  })}</div>;
}

export function GoalGame({activity,session,busy,playing,attempts,onAction,onHome,onPause,stopAudio}:{activity:LearningActivity;session:LearningSession;busy:boolean;playing:boolean;attempts?:LearningAttempt[];onAction:(action:ActivityAction,selectedId?:string)=>void;onHome:()=>void;onPause:()=>void;stopAudio:()=>void}){
  const [ready,setReady]=useState(false),[oralBusy,setOralBusy]=useState(false);
  const state=session.activityStates?.[activity.id]??{},read=activity.step==='read',accepted=['correct','practice'].includes(state.outcome??''),blocked=busy||oralBusy||playing;
  const progress=sessionTaskProgress(session)!;
  const last=attempts?.filter(a=>a.sessionId===session.id&&a.activityId===activity.id).at(-1);
  const guided=activity.choices.length<2;
  return <main className={`goal-page ${read?'goal-read':'goal-recognize'} page-enter`}>
    <nav className="lesson-nav" aria-label="学习导航"><button className="lesson-nav-button" aria-label="回到单词游乐园首页" onClick={onHome}><Icon name="home" size={24}/></button><div className="lesson-progress-wrap"><div className="lesson-progress" role="progressbar" aria-label="本轮小任务进度" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}><span style={{width:`${100*progress.completed/Math.max(1,progress.total)}%`}}/></div><span>{progress.completed+1} / {progress.total}</span></div><button className="lesson-nav-button" aria-label="休息一下" onClick={onPause}><Icon name="pause" size={24}/></button></nav>
    <GoalTrail session={session} wordId={activity.wordId} attempts={attempts}/>
    <div className="goal-heading"><span>{read?'读 · 看英文自己读':'认 · 看英文认意思'}</span><small>{activity.kind==='standard'?'单词小任务':activityTitles[activity.kind]}</small></div>
    <section className="goal-stage" aria-label={read?'独立朗读任务':'英文认义任务'}>
      <h1>{read?'先自己读，再听示范':activity.kind==='gate'?'这个词和图片，是一对吗？':guided?'先试着认一认，再看看图':'这个词，藏在哪张图里？'}</h1>
      <div className={`goal-word ${read&&activity.kind==='portal'?'is-portal':''}`}>{activity.word.term}</div>
      {!read&&activity.kind==='gate'&&<img className="goal-main-picture" src={activity.cueWord!.imageUrl} alt="待判断的图片"/>}
      {!read&&activity.kind!=='gate'&&!guided&&<div className="goal-picture-choices">{activity.choices.map(w=><button key={w.id} aria-label={`选择${w.meaning}`} disabled={blocked||accepted} className={state.selectedId===w.id?state.outcome==='correct'?'is-correct':'is-retry':''} onClick={()=>onAction('choose',w.id)}><img src={w.imageUrl} alt={w.meaning}/></button>)}</div>}
      {!read&&activity.kind==='gate'&&<div className="goal-yes-no"><button aria-label="是一对" disabled={blocked||accepted} onClick={()=>onAction('choose','yes')}>✓</button><button aria-label="不是一对" disabled={blocked||accepted} onClick={()=>onAction('choose','no')}>✕</button></div>}
      {!read&&state.revealed&&<div className="goal-revealed"><img src={activity.word.imageUrl} alt={activity.word.meaning}/><p>{activity.word.meaning}</p></div>}
      {read&&<div className="goal-reading"><OralPractice target={{sessionId:session.id,activityId:activity.id}} active={!busy&&!playing} busy={busy} stopAudio={stopAudio} readOnly={accepted} onReady={setReady} onBusy={setOralBusy} onSkip={accepted?undefined:()=>onAction('skip')}/>{ready&&!accepted&&<button className="goal-demo" disabled={blocked} onClick={()=>onAction('reveal')}><Icon name="sound" size={24}/>{state.revealed?'再听示范':'听示范，对比一下'}</button>}{state.revealed&&<div className="goal-revealed"><img src={activity.word.imageUrl} alt={activity.word.meaning}/></div>}{activity.kind==='think-choice'&&state.revealed&&!accepted&&<div className="goal-compare-sounds" aria-label="读完后比较声音">{activity.choices.map((w,i)=><button aria-label={`比较声音${i+1}`} key={w.id} disabled={blocked} onClick={()=>onAction('listen-option',w.id)}>♫ {i+1}</button>)}</div>}<p className="goal-note">{accepted?(last?.oralStatus==='skipped'?'这次已跳过，之后再练':'录音已保存，等家长听一听'):'自己读的录音会保存在本机'}</p></div>}
      <p className="goal-feedback" role="status">{state.outcome==='try'?'再看一看，试一次':accepted?(read?'读词练习已记录':state.outcome==='correct'?'认出来啦！':'这次先练到这里'):''}</p>
    </section>
    <div className="goal-actions">{accepted?<button className="goal-primary" disabled={blocked} onClick={()=>onAction('next')}>继续冒险 <Icon name="arrow" size={22}/></button>:<>{!read&&<button className="goal-skip" disabled={blocked} onClick={()=>onAction('skip')}>这次先跳过</button>}{!read&&!state.revealed&&<button className="goal-help" disabled={blocked} onClick={()=>onAction('reveal')}>看看意思</button>}{!read&&guided&&state.revealed&&<button className="goal-primary" disabled={blocked} onClick={()=>onAction('finish')}>练习记好啦</button>}{read&&ready&&<button className="goal-primary" disabled={blocked} onClick={()=>onAction('finish')}>我读好啦 <Icon name="arrow" size={22}/></button>}</>}</div>
  </main>;
}
