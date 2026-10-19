import { useState } from 'react';
import type { ActivityAction, LearningActivity, LearningSession } from '../shared/contracts';
import { learningSegmentProgress } from '../shared/learning-policy';
import { LearningSymbol, LearningTopbar } from './learning-topbar';
import { OralPractice } from './oral-practice';
import { Mascot } from './mascot';
import { companionFor } from '../shared/companions';

export function MemoryRecall({session,activity,busy,playing,onAction,onHome,onPause,stopAudio}:{session:LearningSession;activity:LearningActivity;busy:boolean;playing:boolean;onAction:(action:ActivityAction,selectedId?:string,advance?:boolean)=>void;onHome:()=>void;onPause:()=>void;stopAudio:()=>void}) {
  const [ready,setReady]=useState(false),[recording,setRecording]=useState(false);
  const state=session.activityStates?.[activity.id]??{},accepted=state.outcome==='practice',blocked=busy||playing||recording;
  return <main className="memory-page page-enter">
    <LearningTopbar session={session} onHome={onHome} onPause={onPause}/>
    <header className="memory-heading"><h1>这个，英语怎么说？</h1><Mascot small character={companionFor(session.id,0)}/></header>
    <section className="memory-stage" aria-label="先回忆，再按需听示范">
      <img className="memory-picture" src={activity.word.imageUrl} alt={activity.word.meaning}/>
      <p className="memory-meaning">{activity.word.meaning}</p>
      <p className="memory-prompt">{accepted?'这次练习记好啦':state.revealed?'听一听，再试着说':'先自己想一想，说一说'}</p>
      {state.revealed&&<strong className="memory-answer">{activity.word.term}</strong>}
      <OralPractice target={{sessionId:session.id,activityId:activity.id}} active={!busy&&!playing} busy={busy} stopAudio={stopAudio} onReady={setReady} onBusy={setRecording} readOnly={accepted} onSkip={accepted?undefined:()=>onAction('skip')}/>
      {state.audioUnavailable&&<p role="status">示范暂时播不了，可以再试或先跳过。</p>}
    </section>
    <footer className="memory-actions">{accepted?<button className="lesson-next" disabled={blocked} onClick={()=>onAction('next')}>继续<LearningSymbol kind="arrow"/></button>:<>
      <button className="memory-help" disabled={blocked} onClick={()=>onAction('reveal')}>{state.revealed?'再听示范':'想不起来，听示范'}</button>
      {ready&&<button className="lesson-next" disabled={blocked} onClick={()=>onAction('finish',undefined,true)}>继续<LearningSymbol kind="arrow"/></button>}
    </>}</footer>
  </main>;
}

export function LearningCheckpoint({session,busy,onRest,onContinue}:{session:LearningSession;busy:boolean;onRest:()=>void;onContinue:()=>void}) {
  const segment=learningSegmentProgress(session)!;
  return <main className="memory-page memory-checkpoint page-enter"><section className="checkpoint-card">
    <div className="checkpoint-art"><Mascot character={companionFor(session.id,0)}/><span aria-hidden="true"><LearningSymbol kind="check"/></span></div>
    <h1>这一小段完成啦！</h1><p>进度存好啦，休息一下吧。</p>
    <div className="checkpoint-progress" aria-label={`本小段完成${segment.completed}个小任务`}><LearningSymbol kind="check"/> {segment.completed} 个小任务</div>
    <div className="memory-actions"><button className="lesson-next" disabled={busy} onClick={onRest}>先休息<LearningSymbol kind="check"/></button><button className="memory-help" disabled={busy} onClick={onContinue}>再玩一小段<LearningSymbol kind="arrow"/></button></div>
    <small>剩下的单词，下次接着玩</small></section>
  </main>;
}
