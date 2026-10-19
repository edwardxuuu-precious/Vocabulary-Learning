import { useState } from 'react';
import type { ActivityAction, LearningActivity, LearningSession } from '../shared/contracts';
import { learningSegmentProgress } from '../shared/learning-policy';
import { LearningSymbol, LearningTopbar } from './learning-topbar';
import { OralPractice } from './oral-practice';
import { Mascot } from './mascot';
import { companionFor } from '../shared/companions';
import './memory-recall.css';

export function MemoryRecall({session,activity,busy,playing,audioProgress,onAction,onHome,onPause,stopAudio}:{session:LearningSession;activity:LearningActivity;busy:boolean;playing:boolean;audioProgress?:number;onAction:(action:ActivityAction,selectedId?:string,advance?:boolean)=>Promise<boolean|undefined>|void;onHome:()=>void;onPause:()=>void;stopAudio:()=>void}) {
  const [recording,setRecording]=useState(false),[demonstrating,setDemonstrating]=useState(false),[demoFinished,setDemoFinished]=useState<boolean>();
  const state=session.activityStates?.[activity.id]??{},accepted=state.outcome==='practice',blocked=busy||playing||recording;
  const listen=async()=>{setDemonstrating(true);try{setDemoFinished(await onAction('reveal')??undefined);}finally{setDemonstrating(false);}};
  const demoPhase=demonstrating?(playing?'playing':'loading'):demoFinished===false||state.audioUnavailable&&demoFinished!==true?'error':state.revealed?'replay':'idle';
  const demoLabel=demoPhase==='playing'?'正在播放':demoPhase==='loading'?'加载中':demoPhase==='error'?'重试发音':demoPhase==='replay'?'再听一次':'听示范';
  const word=state.revealed?activity.word.term:activity.word.meaning;
  return <main className="memory-page memory-recall page-enter">
    <LearningTopbar session={session} onHome={onHome} onPause={onPause}/>
    <section className="memory-recall-grid" aria-label="先回忆，再按需听示范">
      <p className="memory-instruction">用英语说一说</p>
      <div className="memory-picture-stage"><div className="memory-picture-frame"><img src={activity.word.imageUrl} alt={activity.word.meaning}/></div></div>
      <div className={`memory-cue ${state.revealed?'is-revealed':''}`}>
        <div className="memory-word-cue" style={{'--word-length':Math.max(1,[...word].length)} as React.CSSProperties}>
          <h1 className={state.revealed?'is-english':''}>{word}</h1>
          {state.revealed&&<p>{activity.word.meaning}</p>}
        </div>
        <button className="memory-demo" data-phase={demoPhase} disabled={blocked||accepted||demonstrating} onClick={()=>void listen()}>
          <span className="memory-demo-icon"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m11 4-6 5H2v6h3l6 5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg></span>
          <span className="memory-demo-copy"><span>{demoLabel}</span>{demoPhase==='playing'&&audioProgress!==undefined&&<span className="memory-audio-progress" aria-hidden="true"><i style={{width:`${audioProgress*100}%`}}/></span>}</span>
        </button>
      </div>
      <OralPractice target={{sessionId:session.id,activityId:activity.id}} active={!busy&&!playing&&!demonstrating} busy={busy} stopAudio={stopAudio} onBusy={setRecording} readOnly={accepted} variant="memory" complete={()=>void onAction(accepted?'next':'finish',undefined,!accepted)} onSkip={accepted?undefined:()=>void onAction('skip')}/>
      {demoPhase==='error'&&<p className="memory-audio-error" role="status">示范暂时播不了，可以重试或先自己说。</p>}
    </section>
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
