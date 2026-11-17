import { useEffect,useRef } from 'react';
import { api } from './api';
import type { BusinessEvent } from '../shared/contracts';
import type { ObservationIssue, ObservationPhase } from '../shared/business-observations';

type ClientEvent=Omit<BusinessEvent,'receivedAt'|'audience'>;
let clientId:string|undefined,sending=false;
const pending:ClientEvent[]=[];
function enqueue(event:Omit<ClientEvent,'id'|'clientId'|'at'>){
  clientId??=crypto.randomUUID();if(pending.length>=64)pending.shift();
  pending.push({...event,id:crypto.randomUUID(),clientId,at:new Date().toISOString()});void send();
}
async function send(){
  if(sending||!pending.length)return;sending=true;const batch=pending.slice(0,20);
  let delivered=false;
  try{await api('/api/business/events',{method:'POST',keepalive:true,signal:AbortSignal.timeout(4000),headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch})});delivered=true;for(const event of batch){const i=pending.findIndex(row=>row.id===event.id);if(i>=0)pending.splice(i,1);}}
  catch{/* Observation delivery never blocks a learning action. Coverage is reported as partial. */}
  finally{sending=false;if(delivered&&pending.length)void send();}
}
export function reportLearningIssue(issue:ObservationIssue,target?:{sessionId:string;activityId:string}){
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('business-learning-issue',{detail:{issue,...target}}));
}
/** Foreground is an interface condition, not inferred attention, willingness or parent effort. */
export function useLearningObservation({sessionId,activityId,paused,waiting}:{sessionId?:string;activityId?:string;paused:boolean;waiting:boolean}){
  const opened=useRef('');
  useEffect(()=>{const key=sessionId?`${sessionId}:${activityId??'checkpoint'}`:'';if(key&&opened.current!==key)enqueue({sessionId:sessionId!,activityId,kind:'opened'});opened.current=key;},[sessionId,activityId]);
  useEffect(()=>{
    if(!sessionId)return;
    const phase=():ObservationPhase=>document.hidden?'background':paused?'paused':waiting?'system-wait':'foreground';
    let current=phase(),since=performance.now();
    const flush=()=>{const now=performance.now(),durationMs=Math.min(15000,Math.max(0,Math.round(now-since)));since=now;if(durationMs)enqueue({sessionId,activityId,kind:'interval',phase:current,durationMs});};
    const changed=()=>{flush();current=phase();};
    const issue=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.sessionId&&detail.sessionId!==sessionId)return;
      if(['audio','microphone','recording-save','request'].includes(detail?.issue))enqueue({sessionId,activityId:detail.activityId??activityId,kind:'issue',issue:detail.issue});};
    const timer=setInterval(flush,10000);
    document.addEventListener('visibilitychange',changed);window.addEventListener('pagehide',flush);window.addEventListener('business-learning-issue',issue);
    return()=>{flush();clearInterval(timer);document.removeEventListener('visibilitychange',changed);window.removeEventListener('pagehide',flush);window.removeEventListener('business-learning-issue',issue);};
  },[sessionId,activityId,paused,waiting]);
}
