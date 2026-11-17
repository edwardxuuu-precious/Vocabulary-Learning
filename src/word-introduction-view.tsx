import { reportLearningIssue } from './learning-observation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Word,LearningSession } from '../shared/contracts';
import { partOfSpeechLabels } from '../shared/vocabulary';
import type { SpeechSegment } from './speech-controller';
import { introductionPhases, WordIntroductionController, type IntroductionState } from './word-introduction';
import {LearningTaskFrame,TaskPicture,TaskActionBar,TaskIcon} from './learning-task-frame';

const partOfSpeechShortLabels: Record<NonNullable<Word['partOfSpeech']>, string> = {
  noun: '名', verb: '动', adjective: '形', adverb: '副', pronoun: '代',
  preposition: '介', conjunction: '连', interjection: '叹', determiner: '限定',
  numeral: '数', phrase: '短语', other: '其他',
};

function IntroIcon({ sound = false }: { sound?: boolean }) {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{sound ? <><path d="m11 4-6 5H2v6h3l6 5Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></> : <path d="M4 12h15m-6-6 6 6-6 6" />}</svg>;
}

export function WordIntroduction({ word, active, busy, audioEnabled, speak, getPlaybackId, stopIfPlayback, onComplete, compact=false,unified=false,taskFrame }: {
  word: Word; active: boolean; busy: boolean; audioEnabled: boolean; speak: (segments: SpeechSegment[]) => Promise<boolean>;
  getPlaybackId: () => number; stopIfPlayback: (id: number) => void; onComplete: () => Promise<boolean>; compact?:boolean;unified?:boolean;taskFrame?:{session:LearningSession;onHome:()=>void;onPause:()=>void};
}) {
  const callbacks = useRef({ speak, getPlaybackId, stopIfPlayback, onComplete, audioEnabled, busy }); callbacks.current = { speak, getPlaybackId, stopIfPlayback, onComplete, audioEnabled, busy };
  const activeRef = useRef(active); activeRef.current = active;
  const startTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearStart = () => { clearTimeout(startTimer.current); startTimer.current = undefined; };
  const playback = useRef<number | undefined>(undefined);
  const [state, setState] = useState<IntroductionState>({ phase: 'english', waiting: false, audioFailed: false });
  const [controller] = useState(() => new WordIntroductionController(word.term, word.meaning, {
    compact,
    speak: segments => { const result = callbacks.current.speak(segments); playback.current = callbacks.current.getPlaybackId(); return result; },
    stop: () => { if (playback.current !== undefined) callbacks.current.stopIfPlayback(playback.current); playback.current = undefined; },
    update: next=>{setState(next);if(next.audioFailed&&callbacks.current.audioEnabled)reportLearningIssue('audio');},
    isAudioEnabled: () => callbacks.current.audioEnabled,
    complete: () => activeRef.current && !document.hidden && !callbacks.current.busy ? callbacks.current.onComplete() : false,
  }));
  useEffect(() => {
    const resume = () => { clearStart(); if (activeRef.current && !document.hidden) startTimer.current = setTimeout(() => void controller.resume(), 300); else controller.pause(); };
    const leave = () => { clearStart(); controller.pause(); };
    resume(); document.addEventListener('visibilitychange', resume); window.addEventListener('pagehide', leave);
    return () => { clearStart(); controller.cancel(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pagehide', leave); };
  }, [active, controller]);
  const index = introductionPhases.indexOf(state.phase), showMeaning = compact || index >= 1, showPicture = compact || index >= 3;
  const phaseLabels = { english: audioEnabled ? '听英文' : '看看英文', meaning: '看看意思', 'english-again': audioEnabled ? '再听英文' : '再看英文', picture: '看看图片', summary: '一起回顾', ready: '准备开始练习' };
  const unifiedContent=unified?<div className="task-word-information" data-phase={state.phase}>
    <h2>{word.term}</h2>{showMeaning&&<p>{word.partOfSpeech&&<span className="lesson-part-of-speech">[{partOfSpeechShortLabels[word.partOfSpeech]}]</span>}{word.meaning}</p>}
    <TaskActionBar status={state.transitionFailed?'下一题还没接上，可以重试':state.audioFailed?'声音暂时播不了，画面会继续':phaseLabels[state.phase]+' · 听完自动接着练习'} tone={state.transitionFailed?'error':'normal'} secondary={<button disabled={!active||busy} onClick={()=>{clearStart();void controller.replay();}} aria-label="从头再听一遍讲解"><TaskIcon kind="sound"/>再听一遍</button>} primary={state.transitionFailed?<button disabled={!active||busy} onClick={()=>{clearStart();void controller.resume();}}>重新连接<TaskIcon kind="arrow"/></button>:undefined} waiting="听完自动继续"/>
  </div>:null;
  if(unifiedContent)return taskFrame?<LearningTaskFrame session={taskFrame.session} kind="learn" title="认识新朋友" instruction="看看图片，听听这个词和它的意思。" onHome={taskFrame.onHome} onPause={taskFrame.onPause} cue={showPicture?<TaskPicture word={word}/>:<div className="task-audio-cue"><TaskIcon kind="sound"/><span>先听听这个词</span></div>}>{unifiedContent}</LearningTaskFrame>:unifiedContent;
  return <div className="word-introduction" data-phase={state.phase} data-waiting={state.waiting || undefined}>
    <div className="introduction-scene">
      <div className="lesson-word" data-phrase={/\s/.test(word.term.trim()) || undefined} style={{ '--intro-word-length': Math.max(1, ...word.term.trim().split(/\s+/).map(token => [...token].length)) } as CSSProperties}>
        <h2>{word.term}</h2>
        {showMeaning && <p className="lesson-definition">
          {word.partOfSpeech && <span className="lesson-part-of-speech" aria-label={`词性：${partOfSpeechLabels[word.partOfSpeech]}`} title={`词性：${partOfSpeechLabels[word.partOfSpeech]}`}>[{partOfSpeechShortLabels[word.partOfSpeech]}]</span>}
          <span className="lesson-meaning">{word.meaning}</span>
        </p>}
      </div>
      <div className={`lesson-picture introduction-picture${showPicture?' is-revealed':''}`}>
        {showPicture?<img src={word.imageUrl} alt={word.meaning}/>:<svg className="introduction-placeholder" viewBox="0 0 120 120" fill="none" aria-hidden="true"><rect x="24" y="21" width="72" height="78" rx="18" stroke="currentColor" strokeWidth="3"/><circle cx="48" cy="47" r="7" fill="currentColor" opacity=".5"/><path d="m31 82 20-21 14 14 9-9 15 16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
    </div>
    <div className="introduction-controls">
      <div className="introduction-status"><p className="introduction-phase" role="status"><span aria-hidden="true" />{phaseLabels[state.phase]}</p><small>{state.transitionFailed?'可以重新连接':'会自动接着玩'}</small></div>
      {state.audioFailed && <p className="introduction-message" role="status">{audioEnabled ? '声音暂时没能播放，画面会自动继续。' : '声音已关闭，画面会自动继续。'}</p>}
      {state.transitionFailed && <p className="introduction-message" role="status">小任务暂时没接上，请重新连接。</p>}
      <div className="introduction-actions">
        <button className="lesson-audio introduction-replay" disabled={!active || busy} onClick={() => { clearStart(); void controller.replay(); }} aria-label="从头再听一遍讲解"><IntroIcon sound /><span>再听一遍</span></button>
        {state.transitionFailed && <button className="lesson-next" disabled={!active || busy} onClick={() => { clearStart(); void controller.resume(); }}>重新连接<IntroIcon /></button>}
      </div>
    </div>
  </div>;
}
