import {useContext,useEffect,useRef,useState} from 'react';
import type {AppState,Word} from '../shared/contracts';
import {pendingSentenceWords,sentenceLesson,sentenceKey,sentenceChoices} from '../shared/sentence-study';
import {assessmentWords} from '../shared/assessment';
import {api,errorMessage} from './api';
import {useVoice} from './voice';
import {ScreenRestContext} from './screen-time';
import {Mascot} from './mascot';
import {ChallengeIcon} from './challenge-ui';
import './sentence-course.css';

export function SentenceCourse({state,words,reload,onExit,onStarted,onReady}:{state:AppState;words:Word[];reload:()=>Promise<AppState>;onExit:()=>void;onStarted:()=>void;onReady:()=>void}){
  const pending=pendingSentenceWords(state,words),word=pending[0],lesson=word&&sentenceLesson(word),row=state.sentenceStudies?.find(row=>word&&sentenceKey(row.word)===sentenceKey(word));
  const [opened,setOpened]=useState(!!row),[practicing,setPracticing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(false),[audioFailed,setAudioFailed]=useState(false);
  const blocked=useContext(ScreenRestContext),voice=useVoice(state.settings.voiceEnabled&&!blocked),locked=useRef(false),generation=useRef(0);
  useEffect(()=>{generation.current++;setPracticing(false);setRetry(false);setAudioFailed(false);setError('');},[word?.id]);
  useEffect(()=>{if(blocked){generation.current++;voice.stop();}},[blocked]);
  useEffect(()=>{const hide=()=>{if(document.hidden){generation.current++;voice.stop();}};document.addEventListener('visibilitychange',hide);return()=>{generation.current++;voice.stop();document.removeEventListener('visibilitychange',hide);};},[]);
  const action=async(action:string,extra={})=>{
    if(!word||locked.current||blocked)return;
    locked.current=true;setBusy(true);setError('');
    try{if(action!=='start'&&!row)await api('/api/sentence-study',{method:'POST',body:JSON.stringify({wordId:word.id,key:sentenceKey(word),action:'start'})});await api('/api/sentence-study',{method:'POST',body:JSON.stringify({wordId:word.id,key:sentenceKey(word),action,...extra})});await reload();return true;}
    catch(error){setError(errorMessage(error));return false;}finally{locked.current=false;setBusy(false);}
  };
  const hear=async()=>{
    if(!lesson||busy||blocked||voice.speaking)return;const version=generation.current;
    const heard=await voice.speakCached(lesson.full,'en-US');
    if(version!==generation.current)return;
    if(heard){setAudioFailed(false);await action('demonstrate',{source:'audio'});}else setAudioFailed(true);
  };
  if(!word||!lesson)return <main className="sentence-course"><div className="sentence-shell"><section className="sentence-intro"><Mascot character="optimus"/><h1>这组短句练过啦！</h1><p>接下来，自己试一试。</p><button className="sentence-primary" onClick={onReady}>进入本轮测试<ChallengeIcon name="arrow"/></button><button className="sentence-listen" onClick={onExit}>先休息</button></section></div></main>;
  const [before,after]=lesson.cue.sentence!.split('___'),progress=words.length-pending.length;
  return <main className="sentence-course"><div className="sentence-shell"><nav><button onClick={()=>{voice.stop();onExit();}}><ChallengeIcon name="back"/>先休息</button><span>学会怎么用</span><strong>{progress}/{words.length}</strong></nav>
    {!opened?<section className="sentence-intro"><Mascot character="optimus"/><h1>先学会怎么用，再来测试</h1><p>听一句，跟着说，再选一选。</p><p>每次学一句，休息后接着学。</p><button className="sentence-primary" disabled={busy||blocked} onClick={()=>{setOpened(true);onStarted();}}>{progress?'继续学短句':`开始学这 ${pending.length} 句`}<ChallengeIcon name="arrow"/></button></section>:<section className="sentence-lesson" aria-label="短句学习">
      <header><span>{practicing?'一起练一练':'认识这个用法'}</span><h1>{practicing?'把句子补完整':word.term}<small>{word.meaning}</small></h1></header>
      <div className="sentence-situation"><img src={word.imageUrl} alt={word.meaning}/><p>{lesson.cue.text}</p></div>
      <div className="sentence-model" lang="en">{before}<strong>{practicing&&!retry?'___':before.trim()?word.term:word.term[0].toUpperCase()+word.term.slice(1)}</strong>{after}</div>
      {!practicing&&<p className="sentence-note">{lesson.note}</p>}
      <button className="sentence-listen" disabled={busy||blocked||voice.speaking} onClick={()=>void hear()}><ChallengeIcon name="play"/>{voice.speaking?'正在听…':practicing?'再听一句':'听完整短句'}</button>
      {(audioFailed||!state.settings.voiceEnabled)&&<aside className="sentence-audio-fallback"><p>{!state.settings.voiceEnabled?'声音现在关着，可以请大人带着读。':'这句发音还没准备好，可以请大人带着读。'}</p><button disabled={busy||blocked} onClick={()=>void action('demonstrate',{source:'adult'})}>大人带我读过了</button></aside>}
      {!practicing?<button className="sentence-primary" disabled={busy||blocked||!row?.demonstratedAt} onClick={()=>{voice.stop();setPracticing(true);}}>一起练一练<ChallengeIcon name="arrow"/></button>:<><p className="sentence-practice-prompt">点一个词，把句子补完整</p><div className="sentence-choices">{sentenceChoices(word,assessmentWords(state)).map(term=><button key={term} disabled={busy||blocked||voice.speaking} onClick={()=>void action('choose',{term}).then(ok=>{if(ok&&term!==word.term)setRetry(true);})}>{term}</button>)}</div>{retry&&<p className="sentence-note" role="status">一起看看：{lesson.note} 再选一次。</p>}</>}
    </section>}
    {error&&<p className="sentence-error" role="alert">{error}</p>}
  </div></main>;
}
