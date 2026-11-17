import {useEffect,useRef,useState} from 'react';
import type {Word} from '../shared/contracts';
import {LearningSymbol} from './learning-topbar';
import {TaskActionBar,TaskIcon} from './learning-task-frame';

function Speaker(){return <svg viewBox="0 0 32 32" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m14 5-7 6H3v10h4l7 6Z"/><path d="M20 11a7 7 0 0 1 0 10m5-15a14 14 0 0 1 0 20"/></svg>;}

/** Present the actual sounds first. An enabled option always means "answer". */
export function SoundChoice({word,options,busy,playingId,heardIds,audioUnavailable,outcome,selectedId,practiceOnly,onListen,onAnswer,onNext,onSkip,onHelp,onStop,unified=false}:{
  word:Word;options:Word[];busy:boolean;playingId?:string;heardIds:string[];audioUnavailable:boolean;
  outcome:'correct'|'try'|null;selectedId:string;practiceOnly:boolean;onListen:(word:Word)=>Promise<boolean>;onAnswer:(id:string)=>void;onNext:()=>void;onSkip:()=>void;onHelp?:()=>void;onStop:()=>void;unified?:boolean;
}){
  const [phase,setPhase]=useState<'listening'|'choose'|'failed'>('listening'),[cursor,setCursor]=useState(0);
  const generation=useRef(0),lock=useRef(false),introduced=useRef(false),callbacks=useRef({onListen,onStop});callbacks.current={onListen,onStop};
  const accepted=outcome==='correct',heard=options.length>0&&options.every(option=>heardIds.includes(option.id));
  const listen=async(restart=false)=>{
    if(busy||accepted||lock.current&&!restart)return;
    if(restart){generation.current++;lock.current=false;callbacks.current.onStop();}
    lock.current=true;const token=++generation.current;setPhase('listening');setCursor(0);
    try{
      for(let i=0;i<options.length;i++){
        if(token!==generation.current)return;setCursor(i);
        const played=await callbacks.current.onListen(options[i]);
        if(token!==generation.current)return;
        if(!played){setPhase('failed');return;}
        if(i<options.length-1)await new Promise(resolve=>setTimeout(resolve,650));
      }
      if(token===generation.current)setPhase('choose');
    }catch{if(token===generation.current)setPhase('failed');}
    finally{if(token===generation.current)lock.current=false;}
  };
  useEffect(()=>{
    if(busy||accepted||introduced.current)return;
    // Let the restored position and the page transition settle before owning audio.
    const timer=setTimeout(()=>{introduced.current=true;void listen();},250);
    return()=>clearTimeout(timer);
  },[busy,accepted]);
  useEffect(()=>{if(busy&&lock.current){generation.current++;lock.current=false;introduced.current=false;callbacks.current.onStop();setPhase('failed');}},[busy]);
  useEffect(()=>()=>{generation.current++;lock.current=false;introduced.current=false;callbacks.current.onStop();},[]);
  const choosing=phase==='choose'&&heard&&!busy&&!playingId&&!accepted;
  const status=accepted?practiceOnly?'这步记好啦':'选对啦！':phase==='failed'?'声音没播出来，再试一次':phase==='listening'?playingId?`正在听第 ${options.findIndex(option=>option.id===playingId)+1} 个声音`:`准备听第 ${cursor+1} 个声音`:outcome==='try'?'再想一想，可以重听':'轮到你选了';
  if(unified)return <>
    <div className="task-sound-options" role="group" aria-label="声音答案">{options.map((option,i)=>{
      const playing=playingId===option.id,selected=selectedId===option.id;
      return <button key={option.id} className={`task-sound-option${playing?' is-playing':''}${selected&&outcome==='try'?' is-retry':''}${selected&&accepted?practiceOnly?' is-chosen':' is-correct':''}`} aria-label={`选声音${i+1}`} disabled={!choosing} onClick={()=>onAnswer(option.id)}><span className="task-sound-number">{i+1}</span><TaskIcon kind="sound"/><strong>声音 {i+1}</strong><small>{accepted?selected?'已选择':'':phase==='choose'?'选这个':playing?'正在听…':i<cursor?'听过了':'等一等'}</small></button>;
    })}</div>
    <TaskActionBar status={status} tone={accepted&&!practiceOnly?'success':phase==='failed'||outcome==='try'?'error':'normal'} skip={!accepted?{action:onSkip,disabled:busy}:undefined} secondary={<><button disabled={busy||!!playingId||accepted} onClick={()=>void listen(true)}><TaskIcon kind="sound"/>{phase==='failed'?'重试声音':phase==='listening'&&!playingId?'开始听声音':'再听一遍'}</button>{onHelp&&!accepted&&<button disabled={busy} onClick={onHelp}>帮我一下</button>}</>} primary={accepted?<button disabled={busy} onClick={onNext}>继续<TaskIcon kind="arrow"/></button>:undefined} waiting={phase==='listening'?'先听完声音':'直接点一个声音作答'}/>
  </>;
  return <div className="lesson-match task-sound sound-turn">
    <figure className="sound-turn-picture"><img src={word.imageUrl} alt={word.meaning}/><figcaption>{word.meaning}</figcaption></figure>
    <section className="sound-turn-answer" aria-label="先听声音，再点选答案">
      <p className={`sound-turn-status${accepted?' is-saved':''}`} role="status">{status}</p>
      <div className="sound-turn-options" role="group" aria-label="声音答案">{options.map((option,i)=>{
        const playing=playingId===option.id,selected=selectedId===option.id;
        return <button key={option.id} className={`sound-turn-option${playing?' is-playing':''}${selected&&outcome==='try'?' is-retry':''}${selected&&accepted&&!practiceOnly?' is-correct':''}`} aria-label={`选声音${i+1}`} disabled={!choosing} onClick={()=>onAnswer(option.id)}>
          <span className="sound-turn-orb"><b>{i+1}</b><Speaker/>{selected&&accepted&&!practiceOnly&&<LearningSymbol kind="check"/>}</span>
          <span className="sound-turn-option-label">{accepted?selected?'选了这个':'':phase==='choose'?'选这个':playing?'正在说…':phase==='failed'?'还没听清':i<cursor?'听过了':'听一听'}</span>
        </button>;
      })}</div>
      {accepted?<button className="task-confirm" disabled={busy} onClick={onNext}>继续<LearningSymbol kind="arrow"/></button>:<div className="sound-turn-actions">
        <button className={`sound-turn-replay${phase==='failed'?' is-primary':''}`} disabled={busy||phase==='listening'} onClick={()=>void listen()}><Speaker/>{phase==='failed'?'听一听':'再听一遍'}</button>
        <button className="task-skip" disabled={busy} onClick={onSkip}>这题先跳过</button>
        {onHelp&&<button className="task-skip" disabled={busy} onClick={onHelp}>还没听懂，帮帮我</button>}
      </div>}
      {audioUnavailable&&phase==='failed'&&<small className="sound-turn-failure">可以重试，也可以先跳过</small>}
    </section>
  </div>;
}
