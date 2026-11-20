import {ScreenRestContext} from './screen-time';
import {useLearningSave} from './learning-save';
import { reportLearningIssue } from './learning-observation';
import { modeFetch } from './test-mode-context';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PracticeRecording, PracticeRecordingTarget } from '../shared/contracts';
import { api, errorMessage } from './api';
import { prepareChallengeRecording } from './challenge-recording';
import type { PreparedRecording } from './follow-along';
import { playBrowserAudio } from './browser-speech';
import { PlaybackIcon } from './playback-icon';
import { playFeedbackCue } from './buffered-audio';
import { microphonePermission } from './microphone-access';
import {TaskActionBar,TaskIcon} from './learning-task-frame';
import './oral-practice.css';

export function RecordingIcon({stop=false}:{stop?:boolean}) {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">{stop?<rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/>:<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/></>}</svg>;
}
export function OralPractice({target,active,busy,rounds=1,demonstrate,stopAudio,onReady,onBusy,onSkip,complete,compact=false,readOnly=false,autoStart=false,completeLabel='完成跟读 →',variant='default',unified=false,secondaryControls}:{
  target:PracticeRecordingTarget;active:boolean;busy:boolean;rounds?:1|3;demonstrate?:()=>Promise<boolean>;stopAudio:()=>void;
  onReady?:(ready:boolean)=>void;onBusy?:(busy:boolean)=>void;onSkip?:()=>void;complete?:()=>void;compact?:boolean;readOnly?:boolean;autoStart?:boolean;completeLabel?:string;variant?:'default'|'memory'|'task';unified?:boolean;secondaryControls?:ReactNode;
}) {
  const [takes,setTakes]=useState<PracticeRecording[]>([]),[phase,setPhase]=useState<'loading'|'idle'|'preparing'|'demo'|'recording'|'saving'|'playing'>('loading'),[message,setMessage]=useState('');
  const [pending,setPendingState]=useState<{id:string;blob:Blob}>();
  const pendingRef=useRef<typeof pending>(undefined),inFlight=useRef<Promise<void>|undefined>(undefined),phaseRef=useRef(phase);phaseRef.current=phase;
  const setPending=(value:typeof pending)=>{pendingRef.current=value;setPendingState(value);};
  const [loaded,setLoaded]=useState(false);
  const [level,setLevel]=useState(0),[sessionConsent,setSessionConsent]=useState(false);
  const forcedRest=useContext(ScreenRestContext);
  const consentKey=`word-play-speaking:${target.sessionId}`;
  useEffect(()=>{try{setSessionConsent(sessionStorage.getItem(consentKey)==='1');}catch{}},[consentKey]);
  const owner=useRef<AbortController|undefined>(undefined),capture=useRef<PreparedRecording|undefined>(undefined),mounted=useRef(true),lock=useRef(false),autoStarted=useRef(false);
  const callbacks=useRef({stopAudio,onReady,onBusy,demonstrate});callbacks.current={stopAudio,onReady,onBusy,demonstrate};
  const query=new URLSearchParams(Object.fromEntries(Object.entries(target).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))).toString(),saved=takes.filter(t=>t.status==='ready'),ready=saved.length>=rounds;
  const cancel=()=>{owner.current?.abort();owner.current=undefined;capture.current?.cancel();capture.current=undefined;lock.current=false;callbacks.current.stopAudio();if(mounted.current)setPhase(previous=>previous==='loading'?'loading':'idle');};
  useEffect(()=>{mounted.current=true;const controller=new AbortController();void api<PracticeRecording[]>(`/api/practice-recordings?${query}`,{signal:controller.signal}).then(rows=>{if(mounted.current)setTakes(rows);}).catch(error=>{if(!controller.signal.aborted)setMessage(errorMessage(error));}).finally(()=>{if(!controller.signal.aborted&&mounted.current){setLoaded(true);setPhase('idle');}});return()=>{mounted.current=false;controller.abort();cancel();callbacks.current.onBusy?.(false);};},[target.sessionId,target.activityId]);
  useEffect(()=>{callbacks.current.onReady?.(ready);},[ready]);
  useEffect(()=>{callbacks.current.onBusy?.(phase!=='idle');},[phase]);
  useEffect(()=>{if(!active||forcedRest){if(forcedRest){autoStarted.current=true;callbacks.current.stopAudio();if(['recording','saving'].includes(phaseRef.current)){capture.current?.stop();return;}}cancel();if(variant==='task'&&!forcedRest)autoStarted.current=false;}},[active,forcedRest]);
  useEffect(()=>{const hide=()=>{if(document.hidden)cancel();};const leave=()=>cancel();document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};},[]);
  const save=async(take:{id:string;blob:Blob},controller:AbortController)=>{
    setPhase('saving');
    const rows=await api<PracticeRecording[]>(`/api/practice-recordings?${query}&takeId=${take.id}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:take.blob,signal:controller.signal});
    if(controller.signal.aborted||!mounted.current)return;
    setTakes(rows);setPending(undefined);setMessage('');
    void playFeedbackCue('saved',`recording:${take.id}`);
  };
  const performStart=async(retry=false)=>{
    if(lock.current||!loaded||busy||!active||readOnly||phase!=='idle')return;lock.current=true;setMessage('');
    const controller=new AbortController();owner.current=controller;let recording:PreparedRecording|undefined,operation:'microphone'|'recording-save'='microphone';
    try{
      if(retry&&pending){operation='recording-save';await save(pending,controller);return;}
      if(saved.length>=3)return;
      callbacks.current.stopAudio();setLevel(0);setPhase('preparing');recording=await prepareChallengeRecording(controller.signal,variant==='task'||unified?{finishOnSilence:true,onLevel:value=>{if(!controller.signal.aborted&&mounted.current)setLevel(Math.round(value*20)/20);},onFinishing:()=>{if(!controller.signal.aborted&&mounted.current)setPhase('saving');}}:undefined);capture.current=recording;
      if(controller.signal.aborted){recording.cancel();return;}
      if(callbacks.current.demonstrate){setPhase('demo');if(!await callbacks.current.demonstrate())throw new Error('示范声音没播完，可以再试或跳过。');}
      if(controller.signal.aborted)return;
      const result=recording.record();setPhase('recording');const blob=await result;
      if(controller.signal.aborted||!mounted.current)return;
      if(!blob?.size)throw new Error('这次没有录到声音，再试一次吧。');
      const take={id:crypto.randomUUID(),blob};setPending(take);operation='recording-save';await save(take,controller);
    }catch(error){if(!controller.signal.aborted&&mounted.current)reportLearningIssue(operation,target);if(!controller.signal.aborted&&mounted.current)setMessage(error instanceof DOMException&&error.name==='NotAllowedError'?'麦克风还没打开，可以请家长开启或先跳过。':errorMessage(error));}
    finally{recording?.cancel();if(owner.current===controller){owner.current=undefined;capture.current=undefined;lock.current=false;if(mounted.current)setPhase('idle');}}
  };
  const start=(retry=false)=>{const job=performStart(retry);inFlight.current=job;void job.finally(()=>{if(inFlight.current===job)inFlight.current=undefined;});return job;};
  useLearningSave(`${target.sessionId}:${target.activityId}`,async()=>{
    if(['preparing','demo'].includes(phaseRef.current)){cancel();await inFlight.current;return {ok:true};}
    if(phaseRef.current==='recording')capture.current?.stop();
    await inFlight.current;
    if(pendingRef.current){await start(true);if(pendingRef.current)return {ok:false,message:'录音还没保存好。可以重试；直接退出只保留此前已保存的进度。'};}
    return {ok:true};
  },()=>{cancel();setPending(undefined);});
  const replay=async(take:PracticeRecording)=>{
    if(lock.current||busy||!active)return;lock.current=true;callbacks.current.stopAudio();const controller=new AbortController();owner.current=controller;setPhase('playing');setMessage('');let url='';
    try{const response=await modeFetch(`/api/practice-recordings/${take.id}/audio?${query}`,{signal:controller.signal});if(!response.ok)throw new Error('录音暂时播不了，可以再试一次。');url=URL.createObjectURL(await response.blob());if(!controller.signal.aborted&&!await playBrowserAudio(url,{signal:controller.signal,onStart(){}},25000))throw new Error('录音暂时播不了，可以再试一次。');}
    catch(error){if(!controller.signal.aborted&&mounted.current)setMessage(errorMessage(error));}
    finally{if(url)URL.revokeObjectURL(url);if(owner.current===controller){owner.current=undefined;lock.current=false;if(mounted.current)setPhase('idle');}}
  };
  useEffect(()=>{if(autoStart&&!autoStarted.current&&loaded&&active&&!busy&&phase==='idle'&&!readOnly){autoStarted.current=true;if(!ready)void start();}},[autoStart,loaded,active,busy,phase,readOnly,ready]);
  useEffect(()=>{
    if(variant!=='task'||autoStarted.current||!sessionConsent||!loaded||!active||busy||phase!=='idle'||readOnly||ready||document.hidden)return;
    autoStarted.current=true;let current=true;
    void microphonePermission().then(permission=>{if(current&&permission==='granted'&&!document.hidden)void start();});
    return()=>{current=false;};
  },[variant,sessionConsent,loaded,active,busy,phase,readOnly,ready]);
  const recording=phase==='recording',idle=phase==='idle',label=recording?'说完啦':phase==='preparing'?'打开麦克风…':phase==='demo'?'先听一听…':phase==='saving'?'正在保存…':phase==='loading'?'正在找录音…':phase==='playing'?'正在回放…':pending?'重新保存录音':saved.length?'再录一遍':'开始录音';
  if(unified){
    const canContinue=(ready||readOnly)&&!pending;
    const begin=()=>{autoStarted.current=true;setSessionConsent(true);try{sessionStorage.setItem(consentKey,'1');}catch{}void start(!!pending);};
    const action=()=>{if(idle&&canContinue)complete?.();else if(recording){setPhase('saving');capture.current?.stop();}else begin();};
    const actionLabel=idle&&canContinue?'继续':recording?'说完了':phase==='loading'?'准备一下…':phase==='preparing'?'打开麦克风…':phase==='saving'?'正在保存…':phase==='playing'?'正在回放…':phase==='demo'?'听示范…':pending?'重新保存':message?'再试一次':variant==='task'&&!sessionConsent?'打开麦克风':'开始说';
    const actionDisabled=busy||!active||(!idle&&!recording);
    const status=message||(recording?'说完停一停，会自动保存；也可以点“说完了”':ready?'声音已保存，可以继续':readOnly?'这步已记录，可以继续':takes.some(t=>t.status==='missing')?'上次的录音找不到了，可以重新说一次':phase==='saving'?'正在保存你的声音，请稍等':phase==='playing'?'正在回放你的录音':phase==='preparing'?'麦克风准备中…':'');
    return <div className="task-speech" aria-label={variant==='task'?'读词录音':'口头练习录音'}>
      <button type="button" className="task-mic-action" disabled={actionDisabled} onClick={action}>
        <span className={`task-mic-disc${recording?' is-recording':canContinue?' is-saved':''}`}><TaskIcon kind={recording?'stop':canContinue?'arrow':'mic'}/></span>
        <span className="task-speech-title">{actionLabel}</span>
      </button>
      {recording&&<span className="task-voice-level" role="meter" aria-label="麦克风实时音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level*100)}><i style={{width:`${level*100}%`}}/></span>}
      <TaskActionBar status={status} tone={message?'error':ready?'success':'normal'}
        skip={!ready&&!readOnly&&onSkip?{action:()=>{cancel();onSkip();},disabled:!idle||busy||!active}:undefined}
        secondary={<>{ready&&<button disabled={!idle||busy||!active} onClick={()=>void replay(saved.at(-1)!)}><PlaybackIcon size={18}/>听听自己</button>}{ready&&!readOnly&&saved.length<3&&<button disabled={!idle||busy||!active} onClick={begin}><TaskIcon kind="retry"/>再说一遍</button>}{pending&&idle&&<button disabled={busy||!active} onClick={()=>{setPending(undefined);void start();}}>重新录音</button>}{secondaryControls}</>}/>
    </div>;
  }
  if(variant==='task'){
    const canContinue=(ready||readOnly)&&!pending;
    const begin=()=>{autoStarted.current=true;setSessionConsent(true);try{sessionStorage.setItem(consentKey,'1');}catch{}void start(!!pending);};
    const action=()=>{if(idle&&canContinue)complete?.();else if(recording){setPhase('saving');capture.current?.stop();}else begin();};
    const actionLabel=idle&&canContinue?'继续':recording?'读完了':phase==='loading'?'准备一下…':phase==='preparing'?'打开麦克风…':phase==='saving'?'声音保存中…':phase==='playing'?'正在回放…':phase==='demo'?'听示范…':pending?'再试一次保存':message?'再试一次':sessionConsent?'接着读':'打开麦克风';
    const status=message|| (recording?'直接读出来，说完会自动收好':ready?'声音收到了':takes.some(take=>take.status==='missing')?'上次的声音暂时找不到了':readOnly?'这步已记录':phase==='preparing'?'麦克风准备中…':phase==='saving'?'正在收好你的声音…':phase==='playing'?'听听你刚才怎么读的':phase==='loading'?'':sessionConsent?'准备好了就接着读':'这次打开后，后面的词直接读');
    return <div className={`speaking-task${recording?' is-recording':''}${canContinue?' is-ready':''}`} aria-label="读词录音">
      {recording&&<div className="reading-listener"><RecordingIcon/><strong>我在听</strong><span className="reading-level" role="meter" aria-label="麦克风实时音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level*100)}><i style={{width:`${level*100}%`}}/></span></div>}
      <p className={`speaking-status${message?' is-error':ready?' is-saved':''}`} role="status">{status}</p>
      <button className={`reading-turn-action${recording?' is-finish':''}`} disabled={busy||!active||(!idle&&!recording)} onClick={action} aria-label={actionLabel}>{!canContinue&&!recording&&idle&&<RecordingIcon/>}<span>{actionLabel}</span>{idle&&canContinue&&<span aria-hidden="true">→</span>}</button>
      <div className="speaking-secondary">
        {ready&&<button disabled={!idle||busy||!active} onClick={()=>void replay(saved.at(-1)!)}><PlaybackIcon size={18}/>听听自己</button>}
        {ready&&!readOnly&&saved.length<3&&<button disabled={!idle||busy||!active} onClick={begin}>再读一遍</button>}
        {pending&&idle&&<button disabled={busy||!active} onClick={()=>{setPending(undefined);void start();}}>重新录音</button>}
        {!ready&&!readOnly&&onSkip&&<button disabled={(!idle&&!recording)||busy||!active} onClick={()=>{cancel();onSkip();}}>这题先跳过</button>}
      </div>
    </div>;
  }
  if(variant==='memory'){
    const canContinue=(ready||readOnly)&&!pending;
    const record=()=>{if(recording){setPhase('saving');capture.current?.stop();}else void start(!!pending);};
    return <div className="memory-voice" aria-label="口头练习录音">
      <button className={`memory-primary ${recording?'is-recording':''}`} disabled={busy||!active||!idle&&!recording} onClick={idle&&canContinue?complete:record}>
        <span className="memory-icon-disc">{canContinue&&!recording?<PlaybackIcon/>:<RecordingIcon stop={recording}/>}</span>
        <span>{idle&&canContinue?'继续':label}</span>
      </button>
      <div className="memory-voice-footer">
        <p className={`memory-record-status ${message?'is-error':ready?'is-saved':''}`} role="status">{message|| (recording?'正在录音…':ready?'✓ 已保存':takes.some(t=>t.status==='missing')?'上次录音找不到了':'')}</p>
        <div className="memory-secondary">
          {pending&&idle?<>
            <button disabled={busy||!active} onClick={()=>{setPending(undefined);void start();}}>重新录音</button>
            {!ready&&onSkip&&<button disabled={busy||!active} onClick={()=>{cancel();onSkip();}}>这次先跳过</button>}
          </>:ready?<>
            <button disabled={!idle||busy||!active} onClick={()=>void replay(saved.at(-1)!)}><PlaybackIcon size={16}/>听听自己</button>
            {!readOnly&&saved.length<3&&<button disabled={!idle||busy||!active} onClick={()=>void start()}>再录一遍</button>}
          </>:onSkip&&<button disabled={!idle||busy||!active} onClick={()=>{cancel();onSkip();}}>这次先跳过</button>}
        </div>
      </div>
    </div>;
  }
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
