import { useEffect, useRef, useState } from 'react';
import { playBrowserAudio } from './browser-speech';
import { PlaybackIcon } from './playback-icon';

export function BufferedPlayer({src,autoPlay=false,label='回听录音',disabled=false}:{src:string;autoPlay?:boolean;label?:string;disabled?:boolean}) {
  const owner=useRef<AbortController|undefined>(undefined),[playing,setPlaying]=useState(false),[message,setMessage]=useState('');
  const stop=()=>{owner.current?.abort();owner.current=undefined;setPlaying(false);};
  const play=async()=>{stop();const controller=new AbortController();owner.current=controller;setPlaying(true);setMessage('');try{if(!await playBrowserAudio(src,{signal:controller.signal,onStart(){}},30000)&&!controller.signal.aborted)setMessage('没能播完，请重试。');}catch{if(!controller.signal.aborted)setMessage('点一下，再播放。');}finally{if(owner.current===controller){owner.current=undefined;setPlaying(false);}}};
  useEffect(()=>{if(autoPlay&&!disabled)void play();return()=>owner.current?.abort();},[src]);
  useEffect(()=>{if(disabled)stop();const hide=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[disabled]);
  return <span className="buffered-player"><button disabled={disabled} aria-label={playing?'停止回听':label} onClick={()=>playing?stop():void play()}><PlaybackIcon size={20}/>{playing?'停止回听':label}</button>{message&&<small role="status">{message}</small>}</span>;
}
