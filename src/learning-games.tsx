import { useState } from 'react';
import { LearningTopbar } from './learning-topbar';
import type { ActivityAction, LearningActivity, LearningSession } from '../shared/contracts';
import { activityDone, activityTitles } from '../shared/game-plan';
import { Mascot } from './mascot';
import { companionFor } from '../shared/companions';
import { ExpandedLearningGame } from './expanded-learning-games';
import { GameActionBar } from './game-action-bar';
import { OralPractice } from './oral-practice';
import './learning-games.css';

interface Props {
  activity: LearningActivity; session: LearningSession; busy: boolean; playing: boolean;
  onAction: (action: ActivityAction, selectedId?: string) => void;
  onHome: () => void; onPause: () => void; stopAudio: () => void;
}
export function LearningGame({ activity, session, busy: appBusy, playing, onAction, onHome, onPause, stopAudio }: Props) {
  const [oralBusy,setOralBusy]=useState(false),[oralReady,setOralReady]=useState(false),[oralSkipped,setOralSkipped]=useState(false);
  const busy=appBusy||oralBusy;
  if (!['flip','supply','portal'].includes(activity.kind)) return <ExpandedLearningGame activity={activity} session={session} busy={busy} playing={playing} onAction={onAction} onHome={onHome} onPause={onPause} stopAudio={stopAudio} />;
  const saved = session.activityStates?.[activity.id] ?? {};
  const accepted = saved.outcome === 'correct' || saved.outcome === 'practice';
  const flipGroup = session.activities?.filter(item => item.kind === 'flip' && item.groupId === activity.groupId) ?? [];
  const finishedCount = flipGroup.filter(item => activityDone(session, item)).length;
  const matched = new Set(flipGroup.filter(item => activityDone(session, item) && session.activityStates?.[item.id]?.outcome === 'correct').map(item => item.wordId));
  const isFlip = activity.kind === 'flip', isSupply = activity.kind === 'supply', isPortal = activity.kind === 'portal';
  const prompt = isFlip ? saved.heard ? '听到的是哪一张？' : '点亮声音卡，找它的图片' : isSupply ? '听一听，把需要的物品送上车' : saved.revealed ? '听一听，和自己说的比一比' : '这个老朋友，英语怎么说？';
  return <main className={`lesson-page game-page game-${activity.kind}`}>
<LearningTopbar session={session} onHome={onHome} onPause={onPause} />
    <div className="lesson-guide"><Mascot small character={companionFor(session.id, Math.max(0, session.activities?.findIndex(item => item.id === activity.id) ?? 0))} /><h1>{activityTitles[activity.kind]}</h1>{!session.packGame && session.tasks?.find(task => task.wordId === activity.wordId)?.mode === 'review' && <span className="lesson-review">复习</span>}</div>
    <section className="game-stage" aria-label={activityTitles[activity.kind]}>
      <p className="game-prompt">{prompt}</p>
      {isPortal ? <>
        <div className="game-portal-subject"><div className={`game-portal-window ${saved.revealed ? 'is-open' : ''}`}><div className="game-portal-ring" aria-hidden="true" /><img src={activity.word.imageUrl} alt={activity.word.meaning} /></div>
        {saved.revealed && <p className="game-revealed-word">{activity.word.term}</p>}</div>
        <OralPractice target={{sessionId:session.id,planVersion:session.learningPolicy?.version??1,activityId:activity.id}} active={!appBusy} busy={appBusy} stopAudio={stopAudio} onReady={setOralReady} onBusy={setOralBusy} onSkip={()=>setOralSkipped(true)} compact={!!saved.revealed}/>
        <button className="game-audio game-reveal" disabled={busy || !saved.revealed&&(accepted || !oralReady&&!oralSkipped)} onClick={() => onAction('reveal')} aria-label={saved.revealed ? '再听答案' : '揭晓并听答案'}><span aria-hidden="true">{playing ? '♫' : saved.revealed ? '♪' : '✦'}</span>{playing ? '播放中' : saved.revealed ? '再听一听' : '揭晓 · 听一听'}</button>
      </> : <>
        {isFlip && <div className="game-flip-track" aria-label={`已完成${finishedCount}轮，配对${matched.size}张，共${flipGroup.length}张`}>
          {flipGroup.map(item => <div key={item.id} className={`game-mini-card ${matched.has(item.wordId) ? 'is-paired' : activityDone(session, item) ? 'is-skipped' : item.id === activity.id ? 'is-current' : ''}`} aria-hidden="true">{matched.has(item.wordId) ? '✓' : activityDone(session, item) ? '↷' : '♫'}</div>)}
        </div>}
        {isSupply && <div className={`game-delivery ${accepted ? 'is-loaded' : ''}`} aria-hidden="true"><span className="game-base">⌂</span><span className="game-road" /><div className="game-truck">{accepted && saved.outcome === 'correct' ? <img src={activity.word.imageUrl} alt="" /> : <span>?</span>}<div className="game-truck-cab" /><i /><i /></div><span className="game-base">⚑</span></div>}
        <button className={`game-audio ${isFlip ? 'game-flip-card' : ''} ${saved.heard ? 'is-heard' : ''} ${playing ? 'is-playing' : ''}`} disabled={busy || accepted} onClick={() => onAction('listen')} aria-label={isFlip ? '翻开声音卡听英文' : '听补给任务的英文单词'}><span aria-hidden="true">♫</span>{playing ? '播放中' : saved.heard ? '再听一遍' : isFlip ? '翻开听一听' : '听一听'}{!saved.heard && <b className="game-hand" aria-hidden="true">☝</b>}</button>
        <div className="game-picture-choices" role="group" aria-label="选择对应图片">
          {activity.choices.map(choice => {
            const paired = isFlip && matched.has(choice.id);
            const selected = saved.selectedId === choice.id;
            return <button key={choice.id} className={`game-picture ${paired ? 'is-paired' : ''} ${selected ? saved.outcome === 'correct' ? 'is-correct' : 'is-retry' : ''}`} disabled={busy || accepted || paired || !saved.heard} onClick={() => onAction('choose', choice.id)} aria-label={`选择${choice.meaning}`}><img src={choice.imageUrl} alt={choice.meaning} />{(paired || selected) && <span className="game-picture-mark" aria-hidden="true">{paired || saved.outcome === 'correct' ? '✓' : '↻'}</span>}</button>;
          })}
        </div>
      </>}
      <div className={`game-feedback ${saved.outcome?'has-feedback':''}`} role="status" aria-live="polite">{accepted ? saved.outcome === 'practice' ? '练习记好啦' : isSupply ? '补给找到了！' : '配成一对啦！' : saved.outcome === 'try' ? '再听听，慢慢找' : ''}</div>
      <GameActionBar busy={busy} accepted={accepted} onSkip={()=>onAction('skip')} primary={accepted?{label:isSupply&&saved.outcome==='correct'?'送上车，出发':isPortal?'穿过传送门':isFlip&&finishedCount+1!==flipGroup.length?'翻下一张':'继续冒险',action:()=>onAction('next')}:isPortal&&saved.revealed?{label:'我试过啦，开门',action:()=>onAction('skip')}:undefined}/>
    </section>
  </main>;
}
