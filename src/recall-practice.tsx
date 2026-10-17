import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PracticeRecordingTarget } from '../shared/contracts';
import { OralPractice, RecordingIcon } from './oral-practice';
import { RecallDemonstrationController, RECALL_DEMONSTRATIONS, type RecallDemonstrationState } from './recall-demonstration';

function ListenIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m11 4-6 5H2v6h3l6 5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>;
}

export function RecallPractice({ target, term, playing, demonstrate, stopAudio, active, completed, busy, onComplete, onBusy }: {
  target:PracticeRecordingTarget; term:string; playing:boolean; demonstrate: () => Promise<boolean>; stopAudio: () => void; active: boolean; completed: boolean; busy: boolean;
  onComplete: (source: 'click' | 'speech') => void;onBusy?:(busy:boolean)=>void;
}) {
  const callbacks=useRef({demonstrate,stopAudio,onBusy});callbacks.current={demonstrate,stopAudio,onBusy};
  const [state,setState]=useState<RecallDemonstrationState>({phase:completed?'ready':'idle',round:0,completed:0});
  const [oralBusy,setOralBusy]=useState(false);
  const [oralReady,setOralReady]=useState(false);
  const [controller]=useState(()=>new RecallDemonstrationController({
    demonstrate:()=>callbacks.current.demonstrate(),stopAudio:()=>callbacks.current.stopAudio(),update:setState,
  }));
  useEffect(()=>{
    const resume=()=>{if(active&&!document.hidden){if(!completed)void controller.start();}else controller.pause();};
    resume();document.addEventListener('visibilitychange',resume);
    const leave=()=>controller.pause();
    window.addEventListener('pagehide',leave);
    return()=>{controller.pause();document.removeEventListener('visibilitychange',resume);window.removeEventListener('pagehide',leave);};
  },[active,completed,controller]);
  const ready=completed||state.phase==='ready',listening=!ready&&(state.phase==='demo'||state.phase==='gap');
  useEffect(()=>{callbacks.current.onBusy?.(listening||oralBusy);return()=>callbacks.current.onBusy?.(false);},[listening,oralBusy]);
  const flashing=state.phase==='demo'&&playing;
  return <div className="recall-practice" data-phase={ready?'ready':state.phase}>
    <div className="recall-stage-label">{ready?<RecordingIcon/>:<ListenIcon/>}<span>{ready?'轮到你啦，自己读一遍':`先听 ${RECALL_DEMONSTRATIONS} 遍`}</span></div>
    <h2 className={`recall-word ${flashing?'is-speaking':''}`} lang="en" style={{'--recall-word-length':Math.max(1,...term.trim().split(/\s+/).map(token=>[...token].length))} as CSSProperties}>{term}</h2>
    <div className="recall-demo-rounds" aria-label={`示范已播放${state.completed}遍，共3遍`}>{[1,2,3].map(round=><span key={round} className={`${round<=state.completed?'is-done':''} ${!ready&&round===state.round?'is-current':''}`} aria-current={!ready&&round===state.round?'step':undefined}><ListenIcon/><b>{round}</b></span>)}</div>
    {ready?<>
      <OralPractice target={target} active={active} busy={busy} stopAudio={stopAudio} onBusy={setOralBusy} onReady={setOralReady} autoStart={!completed} completeLabel="录好啦，继续 →" complete={completed?undefined:()=>onComplete('speech')} onSkip={completed?undefined:()=>onComplete('click')}/>
      {!completed&&oralReady&&<button className="recall-listen-again" disabled={!active||busy||oralBusy} onClick={()=>void controller.start(true)}><ListenIcon/>再听三遍</button>}
    </>:<>
      <p className="recall-demo-status" role="status">{state.phase==='error'?'示范声音没播完，可以重听或先自己读。':state.phase==='idle'?'准备好小耳朵':`第 ${state.round} 遍 · ${flashing?'听一听':'准备播放'}`}</p>
      {state.phase==='error'&&<button className="lesson-audio" disabled={!active||busy} onClick={()=>void controller.start()}><ListenIcon/>重新听三遍</button>}
      <button className="recall-listen-again" disabled={!active||busy} onClick={()=>controller.skip()}>跳过示范，自己读</button>
      <button className="oral-skip recall-skip" disabled={!active||busy} onClick={()=>{controller.pause();onComplete('click');}}>这次先跳过录音</button>
    </>}
  </div>;
}
