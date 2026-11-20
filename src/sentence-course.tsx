import {useContext,useEffect,useRef,useState} from 'react';
import type {AppState,Word,SentenceStudyRequest} from '../shared/contracts';
import {pendingSentenceWords,sentenceLesson,sentenceKey,sentenceChoices} from '../shared/sentence-study';
import {sentenceIllustration} from '../shared/sentence-illustrations';
import {api,errorMessage} from './api';
import {useVoice} from './voice';
import {ScreenRestContext} from './screen-time';
import {Mascot} from './mascot';
import {ChallengeIcon} from './challenge-ui';
import {TaskIcon} from './learning-task-frame';
import {LearningStages} from './learning-stages';
import {ActionBar,ActivityNavigation,BackButton,TaskHeading} from './ui-layout';
import {SentenceDemonstrationController,type SentenceDemonstrationState} from './sentence-demonstration';
import './sentence-course.css';

export function SentenceCourse({state,words,reload,onExit,onStarted,onReady}:{state:AppState;words:Word[];reload:()=>Promise<AppState>;onExit:()=>void;onStarted:()=>void;onReady:()=>void}){
  const lessonWords=words.filter(word=>sentenceLesson(word)),pending=pendingSentenceWords(state,lessonWords),word=pending[0],lesson=word&&sentenceLesson(word),row=state.sentenceStudies?.find(row=>word&&sentenceKey(row.word)===sentenceKey(word));
  const [opened,setOpened]=useState(!!row),[practicing,setPracticing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(false),[audioFailed,setAudioFailed]=useState(false);
  const [visible,setVisible]=useState(()=>typeof document==='undefined'||!document.hidden),[adultReady,setAdultReady]=useState(false);
  const [demonstration,setDemonstration]=useState<SentenceDemonstrationState>({phase:'idle',round:0,completed:0});
  const [replaying,setReplaying]=useState(false),replayLock=useRef(false);
  const demonstrationRef=useRef<SentenceDemonstrationController|null>(null),wordKey=word&&sentenceKey(word);
  const blocked=useContext(ScreenRestContext),voice=useVoice(state.settings.voiceEnabled&&!blocked),locked=useRef(false),generation=useRef(0);
  useEffect(()=>{generation.current++;setPracticing(false);setRetry(false);setAudioFailed(false);setAdultReady(false);setReplaying(false);replayLock.current=false;setError('');setDemonstration({phase:'idle',round:0,completed:0});},[wordKey]);
  useEffect(()=>{if(blocked){generation.current++;replayLock.current=false;setReplaying(false);demonstrationRef.current?.cancel();voice.stop();}},[blocked]);
  useEffect(()=>{const hide=()=>{setVisible(!document.hidden);if(document.hidden){generation.current++;replayLock.current=false;setReplaying(false);demonstrationRef.current?.cancel();voice.stop();}};document.addEventListener('visibilitychange',hide);return()=>{generation.current++;voice.stop();document.removeEventListener('visibilitychange',hide);};},[]);
  const action=async(action:SentenceStudyRequest['action'],extra:Pick<SentenceStudyRequest,'source'|'term'|'choiceTerms'>={})=>{
    if(!word||locked.current||blocked)return;
    locked.current=true;setBusy(true);setError('');
    try{if(action!=='start'&&!row)await api('/api/sentence-study',{method:'POST',body:JSON.stringify({wordId:word.id,key:sentenceKey(word),action:'start'} satisfies SentenceStudyRequest)});await api('/api/sentence-study',{method:'POST',body:JSON.stringify({wordId:word.id,key:sentenceKey(word),action,...extra} satisfies SentenceStudyRequest)});await reload();return true;}
    catch(error){setError(errorMessage(error));return false;}finally{locked.current=false;setBusy(false);}
  };
  const hear=async()=>{
    if(!lesson||busy||blocked||voice.speaking||replayLock.current)return;
    if(!practicing&&!adultReady&&demonstration.completed<2){void demonstrationRef.current?.start();return;}
    const version=generation.current;replayLock.current=true;setReplaying(true);
    try{const heard=await voice.speakCached(lesson.full,'en-US');if(version===generation.current)setAudioFailed(!heard);}
    catch{if(version===generation.current)setAudioFailed(true);}
    finally{if(version===generation.current){replayLock.current=false;setReplaying(false);}}
  };
  useEffect(()=>{
    if(!opened||!lesson||practicing||blocked||!visible||!state.settings.voiceEnabled)return;
    let active=true;
    const controller=new SentenceDemonstrationController({play:()=>voice.speakCached(lesson.full,'en-US'),confirm:async()=>!!await action('demonstrate',{source:'audio'}),stop:voice.stop,update:next=>{if(active)setDemonstration(next);}});
    demonstrationRef.current=controller;void controller.start();
    return()=>{active=false;controller.cancel();if(demonstrationRef.current===controller)demonstrationRef.current=null;};
  },[wordKey,opened,practicing,blocked,visible,state.settings.voiceEnabled,voice.speakCached,voice.stop]);
  const demoRunning=state.settings.voiceEnabled&&['playing','gap','saving'].includes(demonstration.phase);
  const [failedScene,setFailedScene]=useState<string>();
  const scene=word&&lesson?sentenceIllustration(word,lesson.cue):undefined;
  const illustration=scene?.src===failedScene?undefined:scene;
  const progress=lessonWords.length-pending.length;
  const leave=()=>{generation.current++;demonstrationRef.current?.cancel();voice.stop();onExit();};
  if(!word||!lesson)return <main className="sentence-course"><div className="sentence-shell">
    <SentenceProgress completed={progress} total={lessonWords.length} onExit={leave}/>
    <LearningStages stage="complete"/>
    <section className="sentence-intro sentence-complete"><Mascot character="optimus"/><h1>短句也练完啦！</h1><button className="sentence-primary" disabled={busy||blocked} onClick={onReady}>完成学习<ChallengeIcon name="arrow"/></button></section>
  </div></main>;
  const [before,after]=lesson.cue.sentence!.split('___');
  return <main className="sentence-course"><div className="sentence-shell">
    <SentenceProgress completed={progress} total={lessonWords.length} onExit={leave}/>
    <LearningStages stage="usage"/>
    {!opened?<section className="sentence-intro"><Mascot character="optimus"/><h1>把单词用进句子</h1><p>先听一句怎么说，再一起补完整。</p><button className="sentence-primary" disabled={busy||blocked} onClick={()=>{setOpened(true);onStarted();}}>{progress?'继续学短句':`开始学这 ${pending.length} 句`}<ChallengeIcon name="arrow"/></button></section>:<section className={`sentence-lesson${practicing?' is-practicing':''}`} aria-label="短句学习">
      <TaskHeading title={practicing?'选词，把句子补完整':'听一听，学会这句话'}/>
      <div className={`sentence-learning-grid${illustration?'':' is-text-only'}`}>
        {illustration&&<div className="sentence-scene"><img src={illustration.src} alt={illustration.alt} onError={()=>setFailedScene(illustration.src)}/></div>}
        <div className="sentence-language">
          <div className="sentence-example">
            <div className="sentence-model"><span lang="en">{before}<strong>{practicing&&!retry?'___':before.trim()?word.term:word.term[0].toUpperCase()+word.term.slice(1)}</strong>{after}</span><button className="sentence-replay" aria-label={demonstration.phase==='audio-error'&&!practicing?'重试两遍示范':'再听一遍完整短句'} title="再听一遍" disabled={busy||blocked||replaying||voice.speaking||demoRunning||!state.settings.voiceEnabled||demonstration.phase==='idle'&&!practicing&&!adultReady} onClick={()=>void hear()}><TaskIcon kind="sound"/></button></div>
            <p className="sentence-translation">{lesson.cue.text}</p>
            {(!practicing||retry)&&<SentenceUsage usage={lesson.usage} retry={practicing&&retry}/>}
          </div>
          {(audioFailed||demonstration.phase==='audio-error'||!state.settings.voiceEnabled)&&<aside className="sentence-audio-fallback"><p>{!state.settings.voiceEnabled?'声音现在关着，可以请大人带着读。':voice.message||'声音没有播完，可以重试或请大人带着读。'}</p><button disabled={busy||blocked||voice.speaking} onClick={()=>{const version=generation.current;demonstrationRef.current?.cancel();setDemonstration({phase:'idle',round:0,completed:0});void action('demonstrate',{source:'adult'}).then(ok=>{if(ok&&version===generation.current)setAdultReady(true);});}}>大人带我读过了</button></aside>}
          {practicing&&<div className="sentence-choices" role="group" aria-label="选词补句">{sentenceChoices(word,words).map(term=><button key={term} disabled={busy||blocked||voice.speaking||replaying} onClick={()=>void action('choose',{term,choiceTerms:sentenceChoices(word,words)}).then(ok=>{if(ok&&term!==word.term)setRetry(true);})}>{term}</button>)}</div>}
        </div>
      </div>
      {!practicing&&<ActionBar className="sentence-study-footer" context={<div className="sentence-demo-controls">
          <div className="sentence-demo-progress" role="status" aria-live="polite"><span className="sentence-demo-marker" aria-hidden="true"/><span>{adultReady?'大人已带读':demonstration.phase==='ready'||demonstration.phase==='saving'||demonstration.phase==='save-error'?'已听 2 遍':demonstration.phase==='audio-error'?'声音未播完':!state.settings.voiceEnabled?'声音已关闭':`第 ${demonstration.phase==='gap'?2:demonstration.round||1} 遍，听一听`}</span></div>
          {demonstration.phase==='save-error'&&<button className="sentence-listen" disabled={busy||blocked||voice.speaking||replaying} onClick={()=>void demonstrationRef.current?.start()}>重试继续</button>}
        </div>} primary={<button className="sentence-primary" disabled={busy||blocked||voice.speaking||replaying||demoRunning||!(demonstration.phase==='ready'||adultReady)} onClick={()=>{demonstrationRef.current?.cancel();voice.stop();setPracticing(true);}}>一起练一练<ChallengeIcon name="arrow"/></button>}/>}
    </section>}
    {error&&<p className="sentence-error" role="alert">{error}</p>}
  </div></main>;
}

function SentenceProgress({completed,total,onExit}:{completed:number;total:number;onExit:()=>void}){
  return <ActivityNavigation
    label="短句学习导航"
    back={<BackButton onClick={onExit}>先休息</BackButton>}
    progress={{label:'学会怎么用',name:'短句学习进度',completed,total,unit:'句'}}
  />;
}

function SentenceUsage({usage,retry}:{usage:{meaning:string;phrase:string};retry:boolean}){
  return <aside className="sentence-usage" aria-label={retry?'再看看搭配':'中英搭配'}>{retry&&<span className="sentence-usage-retry" role="status">看看搭配，再选一次</span>}<span className="sentence-usage-meaning">{usage.meaning}</span><span className="sentence-usage-arrow" aria-hidden="true">→</span><strong lang="en">{usage.phrase}</strong></aside>;
}
