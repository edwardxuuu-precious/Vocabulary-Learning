import { useEffect, useRef, useState } from 'react';
import type { SpeechResponse, Word } from '../shared/contracts';
import { api, errorMessage } from './api';
import { audioEngine, browserAudioAvailable } from './buffered-audio';
import { playBrowserAudio, playOriginalBrowserAudio } from './browser-speech';
import './audio-check.css';

/** Read-only A/B check: existing voice cache only, never an exposure or an answer. */
export function AudioCheck({words}:{words:Word[]}) {
  const [open,setOpen]=useState(false),[term,setTerm]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const owner=useRef<AbortController|undefined>(undefined);
  const available=words.filter(w=>w.assetStatus==='approved').sort((a,b)=>Number(['here','funny','yellow'].includes(b.term))-Number(['here','funny','yellow'].includes(a.term)));
  const stop=()=>{owner.current?.abort();owner.current=undefined;setBusy(false);};
  useEffect(()=>()=>owner.current?.abort(),[]);
  useEffect(()=>{const hide=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[]);
  const play=async(original:boolean)=>{
    stop();const controller=new AbortController();owner.current=controller;setBusy(true);setStatus('正在读取已有发音…');
    try{
      const asset=await api<SpeechResponse>('/api/speech/tts',{method:'POST',body:JSON.stringify({text:term||available[0]?.term,locale:'en-US',tone:'clear',cacheOnly:true}),signal:controller.signal});
      if(!asset.audioUrl)throw Error('这个词还没有可用的缓存发音。');
      const completed=await (original?playOriginalBrowserAudio:playBrowserAudio)(asset.audioUrl,{signal:controller.signal,onStart:()=>setStatus(original?'正在播放原始音频…':'正在播放新版缓冲音频…')},25000);
      if(controller.signal.aborted)return;
      const trace=browserAudioAvailable()?audioEngine().lastTrace:undefined;
      setStatus(completed?original?'原始播放结束，请判断开头是否完整。':`新版播放结束${trace?` · 完整解码 ${(trace.durationMs/1000).toFixed(2)} 秒 · 预热 ${trace.warmupMs}ms`:''}。请判断开头是否完整。`:'没有完整播放，请重试。');
    }catch(error){if(!controller.signal.aborted)setStatus(errorMessage(error));}
    finally{if(owner.current===controller){owner.current=undefined;setBusy(false);}}
  };
  return <div className="audio-check"><button className="button secondary compact-button" onClick={()=>{setOpen(true);setStatus('');}}>声音检查</button>{open&&<div className="modal-backdrop"><section className="modal audio-check-dialog" role="dialog" aria-modal="true" aria-labelledby="audio-check-title"><h2 id="audio-check-title">检查首音是否完整</h2><p>使用原蓝牙设备，对比同一份本机发音；再切换扬声器试听。此处不记录学习成绩。</p><label>选择单词<select value={term||available[0]?.term||''} onChange={e=>{stop();setTerm(e.target.value);setStatus('');}}>{available.map(w=><option key={w.id} value={w.term}>{w.term} · {w.meaning}</option>)}</select></label><div className="audio-check-actions"><button disabled={!available.length} onClick={()=>void play(true)}>A · 原始播放</button><button disabled={!available.length} onClick={()=>void play(false)}>B · 新版播放</button>{busy&&<button onClick={stop}>停止</button>}</div><p role="status">{status}</p><small>首次、静置至少 5 秒后、录音结束后各试一次。自动化不能代替实际听感。</small><button className="button primary" onClick={()=>{stop();setOpen(false);}}>检查完成</button></section></div>}</div>;
}
