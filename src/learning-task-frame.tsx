import {createContext,useContext,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {LearningSession,Word} from '../shared/contracts';
import {companionFor} from '../shared/companions';
import {LearningTopbar} from './learning-topbar';
import {Mascot} from './mascot';
import {TaskHeading} from './ui-layout';
import './learning-task-frame.css';

const ActionTarget=createContext<HTMLElement|null>(null);

export function TaskIcon({kind}:{kind:'sound'|'mic'|'check'|'arrow'|'retry'|'stop'}){
  return <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind==='sound'?<><path d="m10 4-5 5H2v6h3l5 5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>:kind==='mic'?<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/></>:kind==='check'?<path d="m5 12 4 4L20 5"/>:kind==='retry'?<><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></>:kind==='stop'?<rect x="6" y="6" width="12" height="12" rx="2"/>:<path d="M4 12h16m-6-6 6 6-6 6"/>}</svg>;
}

export function LearningTaskFrame({session,title,instruction,cue,children,wide=false,onHome,onPause,kind}:{
  session:LearningSession;title:string;instruction:string;cue?:ReactNode;children:ReactNode;wide?:boolean;onHome:()=>void;onPause:()=>void;kind:string;
}){
  const [actionTarget,setActionTarget]=useState<HTMLDivElement|null>(null);
  return <ActionTarget.Provider value={actionTarget}><main className={`unified-task unified-task-${kind} page-enter`}>
    <LearningTopbar session={session} onHome={onHome} onPause={onPause}/>
    <section className={`task-card${wide?' task-card-wide':''}`} aria-label={title}>
      <TaskHeading title={title} instruction={instruction}><Mascot small character={companionFor(session.id,0)}/></TaskHeading>
      {!wide&&<div className="task-cue">{cue}</div>}
      <div className="task-answer">{children}</div>
      <div className="task-action-row" ref={setActionTarget}/>
    </section>
  </main></ActionTarget.Provider>;
}

export function TaskPicture({word,meaning=false}:{word:Pick<Word,'imageUrl'|'meaning'>;meaning?:boolean}){
  return <figure className="task-picture"><img src={word.imageUrl} alt={word.meaning}/>{meaning&&<figcaption>{word.meaning}</figcaption>}</figure>;
}
export function TaskWord({children}:{children:ReactNode}){return <div className="task-word-cue"><strong>{children}</strong></div>;}

export function TaskActionBar({skip,secondary,primary,status,tone='normal',waiting}:{
  skip?:{action:()=>void;disabled?:boolean};secondary?:ReactNode;primary?:ReactNode;status?:ReactNode;tone?:'normal'|'success'|'error';waiting?:string;
}){
  const target=useContext(ActionTarget);
  if(!target)return null;
  return createPortal(<div className={`task-action-bar tone-${tone}`}>
    <div className="task-feedback" role="status" aria-live="polite">{status}</div>
    <div className="task-skip-slot">{skip&&<button className="task-skip" disabled={skip.disabled} onClick={skip.action}>先跳过<TaskIcon kind="arrow"/></button>}</div>
    <div className="task-secondary-slot">{secondary}</div>
    <div className="task-primary-slot">{primary??(waiting&&<span className="task-waiting">{waiting}</span>)}</div>
  </div>,target);
}
