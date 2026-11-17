import {useEffect,useRef,useState} from 'react';
import type {LearningActivity,LearningSession} from '../shared/contracts';
import {reviewDirection,reviewRetryPlan} from '../shared/review-support';
import {LearningTopbar} from './learning-topbar';
import {Mascot} from './mascot';
import {companionFor} from '../shared/companions';
import {reportLearningIssue} from './learning-observation';

export function ReviewHelpDialog({activity,audioEnabled,play,stopAudio,onFailed,onClose,onSkip,onRest}:{activity:LearningActivity;audioEnabled:boolean;play:(text:string)=>Promise<boolean>;stopAudio:()=>void;onFailed:()=>void;onClose:()=>void;onSkip:()=>void;onRest:()=>void}){
  const ref=useRef<HTMLDialogElement>(null),active=useRef(true),[playing,setPlaying]=useState(false),[message,setMessage]=useState('');
  const callbacks=useRef({play,stopAudio,onFailed});callbacks.current={play,stopAudio,onFailed};
  const hear=async()=>{setPlaying(true);setMessage('');try{const ok=await callbacks.current.play(activity.word.term);if(!active.current)return;if(!ok){setMessage(audioEnabled?'声音暂时播不了，可以重试或先跳过。':'声音已关闭，可以先看看词义。');if(audioEnabled)reportLearningIssue('audio');callbacks.current.onFailed();}}catch{if(active.current)setMessage('声音暂时播不了，可以重试或先跳过。');}finally{if(active.current)setPlaying(false);}};
  useEffect(()=>{active.current=true;ref.current!.showModal();void hear();return()=>{active.current=false;callbacks.current.stopAudio();ref.current?.close();};},[]);
  return <dialog className="learning-help-dialog review-help-dialog" ref={ref} aria-labelledby="review-help-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <h2 id="review-help-title">一起看看，再练一练</h2><div className="review-help-word"><img src={activity.word.imageUrl} alt={activity.word.meaning}/><strong>{activity.word.term}</strong><p>{activity.word.meaning}</p></div>
    <button className="goal-demo" disabled={playing} onClick={()=>void hear()}>{playing?'播放中…':'听示范'}</button>{message&&<p role="status">{message}</p>}
    <button className="lesson-next rule-primary" onClick={onClose}>回到这题，接着练 →</button><div className="rule-support-actions"><button onClick={onSkip}>这次先跳过</button><button onClick={onRest}>先休息，保存进度</button></div>
  </dialog>;
}

/** One bounded, ungraded re-encounter after other words; oral participation is self-reported, never a score. */
export function ReviewRetry({session,activity,busy,play,stopAudio,onHelp,onFinish,onHome,onPause}:{session:LearningSession;activity:LearningActivity;busy:boolean;play:(text:string)=>Promise<boolean>;stopAudio:()=>void;onHelp:()=>Promise<void>;onFinish:(status:'tried'|'skipped',hinted:boolean)=>void;onHome:()=>void;onPause:()=>void}){
  const direction=reviewDirection(activity.step),[revealed,setRevealed]=useState(session.reviewSupport?.entries[activity.id]?.retryHinted===true),[heard,setHeard]=useState(false),[playing,setPlaying]=useState(false),[message,setMessage]=useState('');
  const plan=reviewRetryPlan(session),position=plan.findIndex(row=>row.id===activity.id)+1;
  const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;stopAudio();};},[]);
  const hear=async()=>{setPlaying(true);try{const ok=await play(activity.word.term);if(active.current){setHeard(ok);if(!ok)setMessage('声音暂时播不了，可以先跳过。');}}catch{if(active.current)setMessage('声音暂时播不了，可以重试或先跳过。');}finally{if(active.current)setPlaying(false);}};
  const help=async()=>{try{await onHelp();if(active.current){setRevealed(true);void hear();}}catch{if(active.current)setMessage('帮助还没接上，可以重试或先放这里。');}};
  return <main className="memory-page review-retry page-enter"><LearningTopbar session={session} onHome={onHome} onPause={onPause}/><section className="checkpoint-card">
    <Mascot small character={companionFor(session.id,0)}/><h1>隔开后，再想一想</h1><p>再想一次 {position}/{plan.length} · 也可以先放这里。</p>
    {direction!=='recall'&&direction!=='listen'&&<h2>{activity.word.term}</h2>}
    {direction==='recall'&&<><img className="review-retry-picture" src={activity.word.imageUrl} alt={activity.word.meaning}/><h2>{activity.word.meaning}</h2></>}
    {direction==='listen'&&<button className="goal-demo" disabled={busy||playing} onClick={()=>void hear()}>{playing?'播放中…':'听一听'}</button>}
    {revealed&&<div className="review-help-word"><img src={activity.word.imageUrl} alt={activity.word.meaning}/><strong>{activity.word.term}</strong><p>{activity.word.meaning}</p></div>}
    {(direction==='recognize'||direction==='listen')&&!revealed&&activity.choices.length>=2?<div className="goal-picture-choices">{activity.choices.map(word=><button key={word.id} disabled={busy||playing||direction==='listen'&&!heard} aria-label={`再试选择${word.meaning}`} onClick={()=>onFinish('tried',false)}><img src={word.imageUrl} alt={word.meaning}/></button>)}</div>:<button className="lesson-next" disabled={busy||playing} onClick={()=>onFinish('tried',revealed)}>我又想过啦，继续 →</button>}
    <button className="memory-help" disabled={busy||playing} onClick={()=>void help()}>还不会，看看示范</button><button className="flow-rest" disabled={busy||playing} onClick={()=>onFinish('skipped',revealed)}>这次先放这里</button>{message&&<p role="status">{message}</p>}
  </section></main>;
}
