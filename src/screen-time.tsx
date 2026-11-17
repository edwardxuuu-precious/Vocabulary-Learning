import {createContext,useEffect,useRef,useState} from 'react';
import type {AssessmentGrant} from '../shared/contracts';
import {screenTimeView,type ScreenTimeStatus} from '../shared/screen-time';
import {api,errorMessage} from './api';
import {ParentGate} from './parent-gate';
import './screen-time.css';

export const ScreenRestContext=createContext(false);

export function useScreenTime(initial:ScreenTimeStatus|undefined,enabled:boolean) {
  const [stamp,setStamp]=useState<{status:ScreenTimeStatus;at:number}>(),[now,setNow]=useState(0),[visible,setVisible]=useState(()=>!document.hidden),[error,setError]=useState('');
  const id=useRef(crypto.randomUUID()),lock=useRef(false),live=useRef(true),activeSince=useRef(performance.now());
  const active=enabled&&visible,activeRef=useRef(active);activeRef.current=active;
  const accept=(status:ScreenTimeStatus)=>{if(!live.current)return;setStamp({status,at:performance.now()});setNow(performance.now());setError('');};
  const refresh=async()=>{
    if(lock.current)return;lock.current=true;
    try{accept(await api<ScreenTimeStatus>('/api/screen-time',{method:'POST',body:JSON.stringify({clientId:id.current,active:activeRef.current})}));}
    catch(e){if(live.current)setError(errorMessage(e));}finally{lock.current=false;}
  };
  const refreshRef=useRef(refresh);refreshRef.current=refresh;
  useEffect(()=>{live.current=true;const clock=setInterval(()=>setNow(performance.now()),250),pulse=setInterval(()=>void refreshRef.current(),5000);const visibility=()=>{activeSince.current=performance.now();setVisible(!document.hidden);};document.addEventListener('visibilitychange',visibility);return()=>{live.current=false;clearInterval(clock);clearInterval(pulse);document.removeEventListener('visibilitychange',visibility);void api('/api/screen-time',{method:'POST',keepalive:true,body:JSON.stringify({clientId:id.current,active:false})}).catch(()=>{});};},[]);
  useEffect(()=>{if(initial&&(!stamp||Date.parse(initial.serverNow)>Date.parse(stamp.status.serverNow)))accept(initial);},[initial?.serverNow]);
  useEffect(()=>{activeSince.current=performance.now();void refreshRef.current();},[active]);
  const view=stamp?screenTimeView(stamp.status,Math.max(0,now-(stamp.status.breakUntil?stamp.at:Math.max(stamp.at,activeSince.current))),active):undefined;
  // Rest countdown keeps running even when this tab is hidden or the parent gate is open.
  const restRemaining=stamp?.status.breakUntil?Math.max(0,Date.parse(stamp.status.breakUntil)-Date.parse(stamp.status.serverNow)-Math.max(0,now-stamp.at)):0;
  const expired=!!stamp?.status.breakUntil&&restRemaining===0;
  useEffect(()=>{if(expired||view?.blocked&&!stamp?.status.breakUntil)void refreshRef.current();},[expired,view?.blocked,stamp?.status.breakUntil]);
  const unlock=async(grant?:AssessmentGrant)=>{
    if(!grant)throw new Error('请先由家长验证。');
    try{await api<ScreenTimeStatus>('/api/screen-time/unlock',{method:'POST',headers:{Authorization:`Bearer ${grant.token}`}});accept(await api<ScreenTimeStatus>('/api/screen-time',{method:'POST',body:JSON.stringify({clientId:id.current,active:activeRef.current})}));}
    finally{void api('/api/parent-gate/assessment/revoke',{method:'POST',headers:{Authorization:`Bearer ${grant.token}`}}).catch(()=>{});}
  };
  return {blocked:enabled&&(!stamp||!!error||!!view?.blocked),restRemaining,status:stamp?.status,error,refresh,unlock};
}

export function ScreenRest({remaining,error,onRetry,onUnlock}:{remaining:number;error:string;onRetry:()=>void;onUnlock:(grant?:AssessmentGrant)=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null),[parent,setParent]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});return()=>dialog.current?.close();},[]);
  const seconds=Math.ceil(remaining/1000),time=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  return <dialog ref={dialog} className="screen-rest-dialog" aria-labelledby="screen-rest-title" onCancel={event=>event.preventDefault()}><div className="screen-rest-card"><span className="screen-rest-symbol" aria-hidden="true">☁</span><h1 id="screen-rest-title">{error?'计时服务暂时没接上':remaining?'眼睛休息一下吧':'正在确认休息时间'}</h1><p>{remaining?'已经连续用屏 15 分钟，离开屏幕活动一下。':'学习已暂停，接上计时服务后继续。'}</p>{remaining>0&&<><strong className="screen-rest-countdown" role="timer" aria-label={`休息剩余${Math.floor(seconds/60)}分${seconds%60}秒`}>{time}</strong><p>休息满 5 分钟自动解锁，不用一直看着倒计时。</p></>}<small>原来的题目和已保存进度都在；休息不记答错。</small>{(error||message)&&<p role="alert">{message||error}</p>}{error&&<button onClick={onRetry}>重试连接</button>}<button className="screen-rest-parent" disabled={busy} onClick={()=>setParent(true)}>请家长提前解锁</button>{parent&&<ParentGate confirmLabel="解锁并继续" onClose={()=>setParent(false)} onUnlock={grant=>{setBusy(true);void onUnlock(grant).catch(e=>setMessage(errorMessage(e))).finally(()=>{setBusy(false);setParent(false);});}}/>}</div></dialog>;
}
