import { modeFetch } from './test-mode-context';
import { useEffect, useRef, useState } from 'react';
import type { AssessmentGrant, PracticeRecording } from '../shared/contracts';
import { activityTitles } from '../shared/game-plan';
import { api, errorMessage } from './api';
import { ParentGate } from './parent-gate';
import { PlaybackIcon } from './playback-icon';

export function PracticeRecordingHistory({grant,onGrant}:{grant?:AssessmentGrant;onGrant:(grant?:AssessmentGrant)=>void}) {
  const [rows,setRows]=useState<PracticeRecording[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[verify,setVerify]=useState(false),[limit,setLimit]=useState(20),[audio,setAudio]=useState<{id:string;url:string}>();
  const url=useRef(''),owner=useRef<AbortController|undefined>(undefined);
  const refresh=async()=>{setBusy(true);setError('');try{setRows(await api<PracticeRecording[]>('/api/practice-recordings',{headers:{Authorization:`Bearer ${grant?.token}`}}));}catch(error){setError(errorMessage(error));}finally{setBusy(false);}};
  useEffect(()=>{if(grant)void refresh();return()=>{owner.current?.abort();if(url.current)URL.revokeObjectURL(url.current);};},[grant?.token]);
  const hear=async(row:PracticeRecording)=>{owner.current?.abort();const controller=new AbortController();owner.current=controller;setError('');setBusy(true);try{const response=await modeFetch(`/api/practice-recordings/${row.id}/audio`,{headers:{Authorization:`Bearer ${grant?.token}`},signal:controller.signal});if(!response.ok)throw new Error((await response.json()).error||'录音暂不可用。');const blob=await response.blob();if(controller.signal.aborted)return;if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);setAudio({id:row.id,url:url.current});}catch(error){if(!controller.signal.aborted)setError(errorMessage(error));}finally{if(!controller.signal.aborted)setBusy(false);}};
  return <section className="parent-panel"><div className="panel-heading"><h2>听听孩子说的单词</h2><span>口头练习录音</span></div><p className="muted">按时间保存的本机原音，区分回想与跟练；录音不自动判对，也不计入掌握。</p><div className="backup-actions"><button className="button secondary compact-button" disabled={busy} onClick={()=>{if(!grant||Date.parse(grant.expiresAt)<=Date.now())setVerify(true);else void refresh();}}>{grant?'刷新录音记录':'验证家长身份后回听'}</button>{error&&<button className="button secondary compact-button" onClick={()=>setVerify(true)}>重新验证</button>}</div>{error&&<p role="alert">{error}</p>}
    <div className="practice-history-list">{[...rows].reverse().slice(0,limit).map(row=><article key={row.id}><div><strong>{row.word.term} · {row.word.meaning}</strong><small>{new Date(row.createdAt).toLocaleString('zh-CN')} · {row.kind==='standard'?'口头练习':activityTitles[row.kind]} · {row.mode==='read'?'看英文独立朗读':row.mode==='recall'?'揭晓前回想':'跟练 / 提示已开放'} · 第{row.round}遍 · {row.seconds.toFixed(1)}秒</small></div>{row.status==='ready'?<button className="button secondary compact-button" disabled={busy} onClick={()=>void hear(row)} aria-label={`回听${row.word.term}第${row.round}遍`}><PlaybackIcon size={20}/>回听录音</button>:<small>原音未随备份恢复，需重新录音</small>}{audio?.id===row.id&&<audio src={audio.url} controls autoPlay aria-label={`${row.word.term}练习录音`}/>}</article>)}</div>{rows.length>limit&&<button className="button secondary compact-button" onClick={()=>setLimit(n=>n+20)}>查看更多录音</button>}{grant&&!rows.length&&!busy&&!error&&<p className="muted">还没有保存的口头练习录音。</p>}
    {verify&&<ParentGate onClose={()=>setVerify(false)} onUnlock={next=>{onGrant(next);setVerify(false);}}/>}
  </section>;
}
