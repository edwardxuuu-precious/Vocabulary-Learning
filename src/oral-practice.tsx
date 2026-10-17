import { useEffect, useRef, useState } from 'react';
import type { PracticeRecording, PracticeRecordingTarget } from '../shared/contracts';
import { api, errorMessage } from './api';
import { prepareChallengeRecording } from './challenge-recording';
import type { PreparedRecording } from './follow-along';
import { playBrowserAudio } from './browser-speech';
import { PlaybackIcon } from './playback-icon';
import './oral-practice.css';

export function RecordingIcon({stop=false}:{stop?:boolean}) {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">{stop?<rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/>:<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/></>}</svg>;
}
export function OralPractice({target,active,busy,rounds=1,demonstrate,stopAudio,onReady,onBusy,onSkip,complete,compact=false,readOnly=false,autoStart=false,completeLabel='完成跟读 →'}:{
  target:PracticeRecordingTarget;active:boolean;busy:boolean;rounds?:1|3;demonstrate?:()=>Promise<boolean>;stopAudio:()=>void;
  onReady?:(ready:boolean)=>void;onBusy?:(busy:boolean)=>void;onSkip?:()=>void;complete?:()=>void;compact?:boolean;readOnly?:boolean;autoStart?:boolean;completeLabel?:string;
}) {
  const [takes,setTakes]=useState<PracticeRecording[]>([]),[phase,setPhase]=useState<'loading'|'idle'|'preparing'|'demo'|'recording'|'saving'|'playing'>('loading'),[message,setMessage]=useState('');
  const [pending,setPending]=useState<{id:string;blob:Blob}>();
  const [loaded,setLoaded]=useState(false);
  const owner=useRef<AbortController|undefined>(undefined),capture=useRef<PreparedRecording|undefined>(undefined),mounted=useRef(true),lock=useRef(false),autoStarted=useRef(false);
  const callbacks=useRef({stopAudio,onReady,onBusy,demonstrate});callbacks.current={stopAudio,onReady,onBusy,demonstrate};
  const query=new URLSearchParams({...target}).toString(),saved=takes.filter(t=>t.status==='ready'),ready=saved.length>=rounds;
  const cancel=()=>{owner.current?.abort();owner.current=undefined;capture.current?.cancel();capture.current=undefined;lock.current=false;callbacks.current.stopAudio();if(mounted.current)setPhase('idle');};
  useEffect(()=>{mounted.current=true;const controller=new AbortController();void api<PracticeRecording[]>(`/api/practice-recordings?${query}`,{signal:controller.signal}).then(rows=>{if(mounted.current)setTakes(rows);}).catch(error=>{if(!controller.signal.aborted)setMessage(errorMessage(error));}).finally(()=>{if(!controller.signal.aborted&&mounted.current){setLoaded(true);setPhase('idle');}});return()=>{mounted.current=false;controller.abort();cancel();callbacks.current.onBusy?.(false);};},[target.sessionId,target.activityId]);
  useEffect(()=>{callbacks.current.onReady?.(ready);},[ready]);
  useEffect(()=>{callbacks.current.onBusy?.(phase!=='idle');},[phase]);
  useEffect(()=>{if(!active)cancel();},[active]);
  useEffect(()=>{const hide=()=>{if(document.hidden)cancel();};const leave=()=>cancel();document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};},[]);
  const save=async(take:{id:string;blob:Blob},controller:AbortController)=>{
    setPhase('saving');
    const rows=await api<PracticeRecording[]>(`/api/practice-recordings?${query}&takeId=${take.id}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:take.blob,signal:controller.signal});
    if(controller.signal.aborted||!mounted.current)return;
    setTakes(rows);setPending(undefined);setMessage('');
  };
  const start=async(retry=false)=>{
    if(lock.current||busy||!active||readOnly||phase!=='idle')return;lock.current=true;setMessage('');
    const controller=new AbortController();owner.current=controller;let recording:PreparedRecording|undefined;
    try{
      if(retry&&pending){await save(pending,controller);return;}
      if(saved.length>=3)return;
      callbacks.current.stopAudio();setPhase('preparing');recording=await prepareChallengeRecording(controller.signal);capture.current=recording;
      if(controller.signal.aborted){recording.cancel();return;}
      if(callbacks.current.demonstrate){setPhase('demo');if(!await callbacks.current.demonstrate())throw new Error('示范声音没播完，可以再试或跳过。');}
      if(controller.signal.aborted)return;
      const result=recording.record();setPhase('recording');const blob=await result;
      if(controller.signal.aborted||!mounted.current)return;
      if(!blob?.size)throw new Error('这次没有录到声音，再试一次吧。');
      const take={id:crypto.randomUUID(),blob};setPending(take);await save(take,controller);
    }catch(error){if(!controller.signal.aborted&&mounted.current)setMessage(error instanceof DOMException&&error.name==='NotAllowedError'?'麦克风还没打开，可以请家长开启或先跳过。':errorMessage(error));}
    finally{recording?.cancel();if(owner.current===controller){owner.current=undefined;capture.current=undefined;lock.current=false;if(mounted.current)setPhase('idle');}}
  };
  const replay=async(take:PracticeRecording)=>{
    if(lock.current||busy||!active)return;lock.current=true;callbacks.current.stopAudio();const controller=new AbortController();owner.current=controller;setPhase('playing');setMessage('');let url='';
    try{const response=await fetch(`/api/practice-recordings/${take.id}/audio?${query}`,{signal:controller.signal});if(!response.ok)throw new Error('录音暂时播不了，可以再试一次。');url=URL.createObjectURL(await response.blob());if(!controller.signal.aborted&&!await playBrowserAudio(url,{signal:controller.signal,onStart(){}},25000))throw new Error('录音暂时播不了，可以再试一次。');}
    catch(error){if(!controller.signal.aborted&&mounted.current)setMessage(errorMessage(error));}
    finally{if(url)URL.revokeObjectURL(url);if(owner.current===controller){owner.current=undefined;lock.current=false;if(mounted.current)setPhase('idle');}}
  };
  useEffect(()=>{if(autoStart&&!autoStarted.current&&loaded&&active&&!busy&&phase==='idle'&&!readOnly){autoStarted.current=true;if(!ready)void start();}},[autoStart,loaded,active,busy,phase,readOnly,ready]);
  const recording=phase==='recording',idle=phase==='idle',label=recording?'说完啦':phase==='preparing'?'打开麦克风…':phase==='demo'?'先听一听…':phase==='saving'?'正在保存…':phase==='loading'?'正在找录音…':phase==='playing'?'正在回放…':pending?'重新保存录音':saved.length?'再录一遍':'开始录音';
  return <div className={`oral-practice ${compact?'is-compact':''}`} aria-label="口头练习录音">
    <div className="oral-practice-heading"><span>{recording?'正在听你说…':rounds===3?`一起读 3 遍 · 已录 ${saved.length} 遍`:saved.length?'录音已保存，点播放听自己':compact?'再说一遍':'先自己说一说'}</span>{!compact&&<small>每段最多20秒</small>}</div>
    <div className="oral-practice-actions">
      {!readOnly&&(saved.length<3||!idle)&&<button className={`oral-record ${recording?'is-recording':''}`} disabled={busy||!active||!idle&&!recording} onClick={()=>{if(recording){setPhase('saving');capture.current?.stop();}else void start(!!pending);}}><RecordingIcon stop={recording}/><span>{label}</span></button>}
      {pending&&idle&&<button className="oral-replay" disabled={busy||!active} onClick={()=>{setPending(undefined);setMessage('');}}>重录</button>}
      {saved.map((take,index)=><button key={take.id} className="oral-replay" disabled={!idle||busy||!active} onClick={()=>void replay(take)} aria-label={`回放第${index+1}遍录音`} title="播放我的录音"><PlaybackIcon/>{saved.length>1&&index+1}</button>)}
      {complete&&ready&&<button className="oral-complete" disabled={!idle||busy||!active} onClick={complete}>{completeLabel}</button>}
    </div>
    {message&&<p className="oral-message" role="status">{message}</p>}
    {onSkip&&!ready&&<button className="oral-skip" disabled={!idle||busy||!active} onClick={()=>{cancel();onSkip();}}>这次先跳过录音</button>}
  </div>;
}
