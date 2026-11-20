import { useState } from 'react';
import type { ActivityAction, LearningActivity, LearningSession } from '../shared/contracts';
import { OralPractice } from './oral-practice';
import './memory-recall.css';
import {LearningTaskFrame,TaskPicture,TaskActionBar,TaskIcon} from './learning-task-frame';

export function MemoryRecall({session,activity,busy,playing,audioProgress,onAction,onHome,onPause,stopAudio}:{session:LearningSession;activity:LearningActivity;busy:boolean;playing:boolean;audioProgress?:number;onAction:(action:ActivityAction,selectedId?:string,advance?:boolean)=>Promise<boolean|undefined>|void;onHome:()=>void;onPause:()=>void;stopAudio:()=>void}) {
  const [recording,setRecording]=useState(false),[demonstrating,setDemonstrating]=useState(false),[demoFinished,setDemoFinished]=useState<boolean>();
  const state=session.activityStates?.[activity.id]??{},accepted=state.outcome==='practice',blocked=busy||playing||recording;
  const listen=async()=>{setDemonstrating(true);try{setDemoFinished(await onAction('reveal')??undefined);}finally{setDemonstrating(false);}};
  const demoPhase=demonstrating?(playing?'playing':'loading'):demoFinished===false||state.audioUnavailable&&demoFinished!==true?'error':state.revealed?'replay':'idle';
  const demoLabel=demoPhase==='playing'?'正在播放':demoPhase==='loading'?'加载中':demoPhase==='error'?'重试发音':demoPhase==='replay'?'再听一次':'听示范';
  const word=state.revealed?activity.word.term:activity.word.meaning;
  return <LearningTaskFrame session={session} kind="recall" title="看图，说英文" instruction="想一想，用英语说出来。不会时可以听示范。" cue={<TaskPicture word={activity.word}/>} onHome={onHome} onPause={onPause}>
    <div className="task-recall-prompt"><h2>{state.revealed?activity.word.term:activity.word.meaning}</h2>{state.revealed&&<p>{activity.word.meaning}</p>}</div>
    <OralPractice unified target={{sessionId:session.id,activityId:activity.id,planVersion:session.learningPolicy?.version??1}} active={!busy&&!playing&&!demonstrating} busy={busy} stopAudio={stopAudio} onBusy={setRecording} readOnly={accepted} variant="memory" complete={()=>void onAction(accepted?'next':'finish',undefined,!accepted)} onSkip={accepted?undefined:()=>void onAction('skip')}
      secondaryControls={<button data-phase={demoPhase} disabled={blocked||accepted||demonstrating} onClick={()=>void listen()}><TaskIcon kind="sound"/>{demoLabel}</button>}/>
    {demoPhase==='error'&&<p className="task-inline-error" role="status">示范暂时播不了，可以重试或先自己说。</p>}
  </LearningTaskFrame>;
}
