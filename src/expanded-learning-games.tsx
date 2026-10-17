import { ExtendedLearningGame } from './extended-games';
import { LearningTopbar } from './learning-topbar';
import { extendedKinds } from '../shared/game-materials';
import { useState } from 'react';
import type { ActivityAction, LearningActivity, LearningSession } from '../shared/contracts';
import { activityDone, activityTitles } from '../shared/game-plan';
import { gameAccepted } from '../shared/game-rules';
import { companionFor } from '../shared/companions';
import { Mascot } from './mascot';
import { batchTwoKinds } from '../shared/game-boards';
import { BatchTwoLearningGame } from './batch-two-games';
import { GameActionBar, GameSoundIcon } from './game-action-bar';
import { OralPractice } from './oral-practice';
import './expanded-learning-games.css';

interface Props { activity: LearningActivity; session: LearningSession; busy: boolean; playing: boolean; onAction: (action: ActivityAction, selectedId?: string) => void; onHome: () => void; onPause: () => void; stopAudio: () => void }
export function ExpandedLearningGame({ activity: a, session, busy: appBusy, playing, onAction, onHome, onPause, stopAudio }: Props) {
  const [oralBusy,setOralBusy]=useState(false),[oralReady,setOralReady]=useState(false),[oralSkipped,setOralSkipped]=useState(false);
  const busy=appBusy||oralBusy;
  if(extendedKinds.has(a.kind))return <ExtendedLearningGame activity={a} session={session} busy={busy} playing={playing} onAction={onAction} onHome={onHome} onPause={onPause} stopAudio={stopAudio}/>;
  if(batchTwoKinds.has(a.kind))return <BatchTwoLearningGame activity={a} session={session} busy={busy} playing={playing} onAction={onAction} onHome={onHome} onPause={onPause} stopAudio={stopAudio}/>;
  const state = session.activityStates?.[a.id] ?? {}, accepted = gameAccepted(state);
  const group = session.activities?.filter(item => item.kind === a.kind && item.groupId === a.groupId) ?? [];
  const matched = new Set(group.filter(item => activityDone(session, item) && session.activityStates?.[item.id]?.outcome === 'correct').map(item => item.wordId));
  const picture = (image: typeof a.word, index: number, covered = false, markCompleted = false) => {
    const selected = state.selectedId === image.id, done = markCompleted && matched.has(image.id);
    const revealed = !covered || selected && !!state.outcome;
    return <button key={image.id} className={`game-picture extra-picture ${covered && !revealed ? 'is-covered' : ''} ${selected ? state.outcome === 'correct' ? 'is-correct' : 'is-retry' : ''} ${done ? 'is-collected' : ''}`} disabled={busy || accepted || done || !state.heard} onClick={() => onAction('choose', image.id)} aria-label={covered ? `选择第${index + 1}格` : `选择${image.meaning}`}>
      {revealed ? <img src={image.imageUrl} alt={image.meaning} /> : <span className="extra-question" aria-hidden="true">?</span>}
      {done && <span className="game-picture-mark" aria-hidden="true">✓</span>}
    </button>;
  };
  const audio = <button className={`game-audio ${playing?'is-playing':''}`} disabled={busy || accepted} onClick={() => onAction('listen')} aria-label={`${activityTitles[a.kind]}：听英文`}><GameSoundIcon/>{playing ? '播放中' : state.heard ? '再听一遍' : '听一听'}</button>;
  const hint = state.outcome === 'try' ? '再试试，慢慢来' : accepted ? state.outcome === 'practice' ? '练习记好啦' : a.kind === 'bingo' ? matched.size + 1 === a.choices.length ? '宾果！全部点亮啦！' : '这一格点亮啦！' : a.kind === 'repair' ? '连接修好啦！' : a.kind === 'gate' ? '检查完成，开门啦！' : a.kind === 'treasure' ? '找到藏起来的伙伴啦！' : '选对啦！' : '';
  return <main className={`lesson-page game-page game-extra-${a.kind}`}>
<LearningTopbar session={session} onHome={onHome} onPause={onPause} />
    <div className="lesson-guide"><Mascot small character={companionFor(session.id, Math.max(0, session.activities?.findIndex(item => item.id === a.id) ?? 0))} /><h1>{activityTitles[a.kind]}</h1>{session.tasks?.find(task => task.wordId === a.wordId)?.mode === 'review' && <span className="lesson-review">复习</span>}</div>
    <section className="game-stage extra-stage" aria-label={activityTitles[a.kind]}>
      {a.kind === 'bingo' && <>
        <p className="game-prompt">听到谁，就点亮它的小格子</p>{audio}
        <div className="extra-bingo-board" role="group" aria-label="宾果棋盘，点亮三个单词格">
          {a.choices.map((choice, index) => picture(choice, index, false, true))}<div className="extra-free-square" aria-label="起点星星，免费格">★<span>起点</span></div>
        </div>
        <div className="extra-stars" aria-label={`点亮${matched.size + (state.outcome === 'correct' ? 1 : 0)}格，共${a.choices.length}格`}>{a.choices.map((choice, index) => <span key={choice.id} className={index < matched.size + (state.outcome === 'correct' ? 1 : 0) ? 'is-lit' : ''} aria-hidden="true">★</span>)}</div>
      </>}
      {a.kind === 'repair' && <>
        <p className="game-prompt">声音接错图啦，帮它重新连好</p>
        <div className="extra-repair-board" aria-label="图音连接维修台">{a.choices.map((choice, index) => {
          const active = choice.id === a.wordId, repaired = matched.has(choice.id) || active && state.outcome === 'correct';
          const image = repaired ? choice : a.choices[(index + 1) % a.choices.length];
          return <div key={choice.id} className={`extra-wire-row ${active ? 'is-current' : ''} ${repaired ? 'is-fixed' : ''}`}><button disabled={busy || accepted || !active} onClick={() => onAction('listen')} aria-label={active ? '播放待修声音' : `声音${index + 1}，${repaired ? '已修好' : '稍后维修'}`}><span aria-hidden="true">♫</span>{index + 1}</button><span className="extra-wire" aria-hidden="true">{repaired ? '✓' : '×'}</span><img src={image.imageUrl} alt={image.meaning} /></div>;
        })}</div>
        <div className="game-picture-choices" role="group" aria-label="为当前声音选择正确图片">{a.choices.map((choice, index) => picture(choice, index, false, true))}</div>
      </>}
      {a.kind === 'gate' && <>
        <p className="game-prompt">听听来访的声音，是图里的它吗？</p>
        <div className={`extra-gate-scene ${state.outcome === 'correct' ? 'is-open' : ''}`}><span className="extra-gate-post" aria-hidden="true" /><img src={a.word.imageUrl} alt={a.word.meaning} /><span className="extra-gate-post" aria-hidden="true" /></div>{audio}
        <div className="extra-gate-actions" role="group" aria-label="判断声音与图片是否匹配"><button disabled={busy || accepted || !state.heard} onClick={() => onAction('choose','yes')} aria-label="声音和图片一样"><span aria-hidden="true">✓</span>是它</button><button disabled={busy || accepted || !state.heard} onClick={() => onAction('choose','no')} aria-label="声音和图片不一样"><span aria-hidden="true">↔</span>不是它</button></div>
      </>}
      {a.kind === 'treasure' && <>
        <p className="game-prompt">{state.concealed ? '听听声音，它藏在哪一格？' : '看看三个伙伴分别住在哪'}</p>
        <div className="game-picture-choices extra-treasure" role="group" aria-label="藏宝格">{a.choices.map((choice, index) => picture(choice, index, !!state.concealed))}</div>
        {state.concealed ? audio : <button className="game-audio" disabled={busy || accepted} onClick={() => onAction('conceal')}><span aria-hidden="true">▦</span>记好啦，合上格子</button>}
      </>}
      {a.kind === 'listen-first' && <>
        <p className="game-prompt">{state.optionsVisible ? '刚才听到的是谁？' : '先用小耳朵，记住这个单词'}</p>
        {!state.optionsVisible && <div className="extra-ear" aria-hidden="true">♫<span>···</span></div>}{audio}
        {state.optionsVisible ? <div className="game-picture-choices" role="group" aria-label="选择刚才听到的图片">{a.choices.map((choice, index) => picture(choice, index))}</div> : state.heard && <button className="game-audio extra-show" disabled={busy || accepted} onClick={() => onAction('show-options')}>准备好啦，看图片 →</button>}
      </>}
      {a.kind === 'missing' && <>
        <p className="game-prompt">{state.revealed ? '找回来啦，听听它的英文' : state.concealed ? '谁不见了？先说说它的英文' : '先看看，记住这几个伙伴'}</p>
        <div className="game-picture-choices extra-missing-board">{a.choices.map(choice => <div className={`extra-memory-picture ${state.concealed && !state.revealed && choice.id === a.wordId ? 'is-empty' : ''}`} key={choice.id}>{state.concealed && !state.revealed && choice.id === a.wordId ? <span aria-label="不见的伙伴">?</span> : <img src={choice.imageUrl} alt={choice.meaning} />}</div>)}</div>
        {state.revealed && <p className="game-revealed-word">{a.word.term}</p>}
        {state.concealed&&<OralPractice target={{sessionId:session.id,activityId:a.id}} active={!appBusy} busy={appBusy} stopAudio={stopAudio} onReady={setOralReady} onBusy={setOralBusy} onSkip={()=>setOralSkipped(true)} compact={!!state.revealed}/>}
        {state.concealed ? <button className="game-audio" disabled={busy || !state.revealed&&(accepted || !oralReady&&!oralSkipped)} onClick={() => onAction('reveal')} aria-label={state.revealed ? '再听答案' : '揭晓并听答案'}><span aria-hidden="true">✦</span>{playing ? '播放中' : state.revealed ? '再听听' : '揭晓 · 听一听'}</button> : <button className="game-audio" disabled={busy || accepted} onClick={() => onAction('conceal')}><span aria-hidden="true">◌</span>藏起一个伙伴</button>}
      </>}
      {a.kind === 'think-choice' && <>
        <p className="game-prompt">{state.optionsVisible ? '听几个声音，再选一个' : '先想想，这个词你会说吗？'}</p>
        <div className="extra-think-picture"><img src={a.word.imageUrl} alt={a.word.meaning} /></div>
        <OralPractice target={{sessionId:session.id,activityId:a.id}} active={!appBusy} busy={appBusy} stopAudio={stopAudio} onReady={setOralReady} onBusy={setOralBusy} onSkip={()=>setOralSkipped(true)} compact={!!state.optionsVisible}/>
        {state.optionsVisible ? <div className="extra-sound-options" role="group" aria-label="声音选项">{a.choices.map((choice, index) => <div className={`extra-sound-row ${state.selectedId === choice.id ? state.outcome === 'correct' ? 'is-correct' : 'is-retry' : ''}`} key={choice.id}><button disabled={busy || accepted} onClick={() => onAction('listen-option', choice.id)} aria-label={`听声音${index + 1}`}><span aria-hidden="true">♫</span>{playing && state.heardOptionIds?.at(-1) === choice.id ? '播放中' : `声音 ${index + 1}`}</button><button disabled={busy || accepted || !state.heardOptionIds?.includes(choice.id)} onClick={() => onAction('choose', choice.id)} aria-label={`选择声音${index + 1}`}>选这个</button></div>)}</div> : <button className="game-audio" disabled={busy || accepted || !oralReady&&!oralSkipped} onClick={() => onAction('show-options')}><span aria-hidden="true">♪</span>我想好啦，听选项</button>}
      </>}
      <div className={`game-feedback ${hint?'has-feedback':''}`} role="status" aria-live="polite">{hint}</div>
      <GameActionBar busy={busy} accepted={accepted} onSkip={()=>onAction('skip')} primary={accepted?{label:'继续冒险',action:()=>onAction('next')}:a.kind==='missing'&&state.revealed?{label:'我试过啦，继续',action:()=>onAction('skip')}:undefined}/>
    </section>
  </main>;
}
