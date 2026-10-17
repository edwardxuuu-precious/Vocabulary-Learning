import { OralPractice } from './oral-practice';
import type { PracticeRecordingTarget } from '../shared/contracts';
import { useEffect, useRef, useState } from 'react';
import type { AppState, AssessmentDimension, AssessmentGrant, AssessmentResult, AssessmentSession, Word } from '../shared/contracts';
import { assessmentCurrent, assessmentDimensions, assessmentLabels, assessmentResultLabels, assessmentWords, dueAssessmentProgress } from '../shared/assessment';
import { api, errorMessage } from './api';
import { ParentGate } from './parent-gate';
import { useVoice } from './voice';
import { ChildChallenge } from './child-challenge';
import { AssessmentReviewCenter } from './assessment-review';
import './assessments.css';

const dateLabel = (date: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(new Date(date));
const headers = (grant: AssessmentGrant) => ({ Authorization: `Bearer ${grant.token}` });
const judgementLabel = (dimension: AssessmentDimension, result: AssessmentResult) => result === 'unconfirmed' ? '待家长确认' : result === 'skipped' ? '未作答' : result === 'unavailable' ? '素材不足' : dimension === 'look' ? '系统判题' : '家长确认';

export function AssessmentReport({ state }: { state: AppState }) {
  const finished = new Set(state.assessments?.filter(session => session.completedAt).map(session => session.id));
  const published = state.assessmentAttempts?.filter(attempt => finished.has(attempt.sessionId)) ?? [];
  const pending = (state.assessments ?? []).filter(session => session.workflow === 'recorded' && session.submittedAt).flatMap(session => session.items.filter(item => item.dimension !== 'look' && !item.reviews?.length));
  const rows = state.words.filter(word => published.some(attempt => attempt.wordId === word.id) || pending.some(item => item.word.id === word.id));
  if (!rows.length) return <p className="muted">还没有独立测试记录。测试会分别记录看、读和两个翻译方向。</p>;
  return <section className="assessment-report" aria-label="看读翻译逐词测试记录"><h3>看、读、翻译测试记录</h3><p className="muted">朗读和翻译由家长确认；练习完成不等于测试通过。</p><div className="learning-table-wrap"><table className="learning-table"><thead><tr><th>单词</th>{assessmentDimensions.map(dimension => <th key={dimension}>{assessmentLabels[dimension]}</th>)}</tr></thead><tbody>{rows.map(word => <tr key={word.id}><th>{word.term}<small>{word.meaning}</small></th>{assessmentDimensions.map(dimension => {
    const all = published.filter(attempt => attempt.wordId === word.id && attempt.dimension === dimension).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const current = all.filter(attempt => attempt.learningVersion === (word.learningVersion ?? 0)), latest = current.at(-1);
    const progress = state.assessmentProgress?.find(row => row.wordId === word.id && row.dimension === dimension && row.learningVersion === (word.learningVersion ?? 0));
    return <td key={dimension}><strong>{latest ? assessmentResultLabels[latest.result] : '尚未确认'}</strong>{latest && <small>{judgementLabel(dimension, latest.result)} · {dateLabel(latest.createdAt)}</small>}{pending.some(item => item.word.id === word.id && item.word.learningVersion === (word.learningVersion ?? 0) && item.dimension === dimension) && <small>有新挑战待家长核验</small>}<small>独立答对 {current.filter(attempt => attempt.result === 'correct').length} 次</small>{progress && <small>{Date.parse(progress.dueAt) <= Date.now() ? '到期待复测' : `${dateLabel(progress.dueAt)} 复测`}</small>}{all.length > current.length && <small>旧义项历史 {all.length - current.length} 次</small>}</td>;
  })}</tr>)}</tbody></table></div></section>;
}

type CenterProps = { state: AppState; grant?: AssessmentGrant; onGrant: (grant?: AssessmentGrant) => void; onExit: () => void; reload: () => Promise<AppState>; initialWordIds?: string[]; parentMode?: boolean };
export function AssessmentCenter(props: CenterProps) {
  const [tab, setTab] = useState<'review' | 'onsite'>('review');
  if (!props.parentMode) return <ChildChallenge {...props} />;
  return <main className="assessment-page"><nav className="assessment-nav"><button onClick={props.onExit}>← 返回家长空间</button><button aria-pressed={tab === 'review'} onClick={() => setTab('review')}>集中核验</button><button aria-pressed={tab === 'onsite'} onClick={() => setTab('onsite')}>现场测试与旧记录</button></nav>{tab === 'review' ? <AssessmentReviewCenter {...props} /> : <LegacyAssessmentCenter {...props} />}</main>;
}
function LegacyAssessmentCenter({ state, grant, onGrant, onExit, reload, initialWordIds }: {
  state: AppState; grant?: AssessmentGrant; onGrant: (grant?: AssessmentGrant) => void; onExit: () => void;
  reload: () => Promise<AppState>; initialWordIds?: string[];
}) {
  const available = assessmentWords(state), due = dueAssessmentProgress(state);
  const [selected, setSelected] = useState<string[]>(() => (initialWordIds ?? [...available].reverse().map(word => word.id)).filter(id => available.some(word => word.id === id)).slice(0, 5));
  const [mode, setMode] = useState<'full' | 'due'>('full');
  const [session, setSession] = useState<AssessmentSession>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [paused, setPaused] = useState(false);
  const [needsPin, setNeedsPin] = useState(!grant), lock = useRef(false);
  const voice = useVoice(state.settings.voiceEnabled);
  useEffect(() => () => voice.stop(), []);
  const request = async (path: string, body?: unknown) => {
    if (lock.current) return;
    if (!grant || Date.parse(grant.expiresAt) <= Date.now()) { setNeedsPin(true); return; }
    lock.current = true; setBusy(true); setError(''); voice.stop();
    try {
      const next = await api<AssessmentSession>(path, { headers: headers(grant), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
      setSession(next); await reload();
    } catch (error) { const message = errorMessage(error); setError(message); if (message.includes('家长验证已失效')) { onGrant(undefined); setNeedsPin(true); } if (message.includes('词义或素材已变化')) setPaused(true); }
    finally { lock.current = false; setBusy(false); }
  };
  const current = session && assessmentCurrent(session), resumes = [...(state.assessments ?? [])].reverse().filter(item => !item.completedAt && item.workflow !== 'recorded');
  const choices = mode === 'full' ? available : available.filter(word => due.some(row => row.wordId === word.id));
  const itemCount = mode === 'full' ? selected.length * 4 : due.filter(row => selected.includes(row.wordId)).length;
  const action = (action: string, extra = {}) => current && void request(`/api/assessments/${session!.id}/actions`, { itemId: current.id, action, ...extra });
  const exit = () => { voice.stop(); onExit(); };
  return <main className="assessment-page">
    <nav className="assessment-nav"><button onClick={exit}>← 返回</button><strong>和家长测一测</strong>{current && <button onClick={() => { voice.stop(); setPaused(true); }}>休息一下</button>}</nav>
    <p className="assessment-notice" role="alert">{error || voice.message}</p>
    {!session && <section className="assessment-card assessment-picker"><h1>这次测哪几个词？</h1><p>家长选好后，再让孩子看题。每次最多5个词，口头题请家长听后确认。</p>
      {resumes.length > 0 && <div className="assessment-resume"><h2>继续未完成的测试</h2>{resumes.slice(0, 3).map(item => <button key={item.id} disabled={busy} onClick={() => void request(`/api/assessments/${item.id}`)}>继续 {dateLabel(item.startedAt)} 的测试 · {item.items.filter(item => item.result !== undefined).length}/{item.items.length} 项</button>)}</div>}
      <div className="assessment-modes" role="group" aria-label="测试范围"><button aria-pressed={mode === 'full'} onClick={() => { setMode('full'); setSelected((initialWordIds ?? [...available].reverse().map(word => word.id)).filter(id => available.some(word => word.id === id)).slice(0, 5)); }}>完整测试</button><button aria-pressed={mode === 'due'} onClick={() => { setMode('due'); setSelected([...new Set(due.map(row => row.wordId))].slice(0, 5)); }}>到期复测</button></div>
      <div className="assessment-word-picker">{choices.map(word => <label key={word.id}><input type="checkbox" checked={selected.includes(word.id)} disabled={!selected.includes(word.id) && selected.length >= 5} onChange={event => setSelected(previous => event.target.checked ? [...previous, word.id] : previous.filter(id => id !== word.id))} /><span><strong>{word.term}</strong><small>{word.meaning}</small></span></label>)}</div>
      {!choices.length && <p>{mode === 'due' ? '目前没有到期的测试项。' : '还没有可测试的已学单词。先完成学习，再和家长来试试。'}</p>}
      <p>本轮 {selected.length} 个词 · {itemCount} 项。可以随时暂停。</p><button className="assessment-primary" disabled={busy || !selected.length || !itemCount} onClick={() => void request('/api/assessments', { wordIds: selected, mode, workflow: 'parent' })}>开始测试</button>
      <AssessmentReport state={state} />
    </section>}
    {session && current && <section className="assessment-card assessment-question" aria-label="当前测试题" key={current.id}>
      <div className="assessment-progress" role="progressbar" aria-label="测试进度" aria-valuemin={0} aria-valuemax={session.items.length} aria-valuenow={session.items.filter(item => item.result !== undefined).length}><span style={{ width: `${100 * session.items.filter(item => item.result !== undefined).length / session.items.length}%` }} /></div>
      <p>{session.items.filter(item => item.result !== undefined).length + 1} / {session.items.length} · {assessmentLabels[current.dimension]}</p>
      <h1>{current.dimension === 'zh-en' ? '请家长读中文，孩子说英语' : current.dimension === 'read' ? '试着自己读出来' : current.dimension === 'en-zh' ? '这个词，中文是什么意思？' : '看英文，找到它的图片'}</h1>
      <div className="assessment-cue">{current.dimension === 'zh-en' ? current.word.meaning : current.word.term}</div>
      {current.dimension === 'look' ? current.choices.length >= 2 ? <div className="assessment-picture-choices">{current.choices.map((choice, index) => <button key={choice.id} aria-label={`选择图片${index + 1}`} disabled={busy || paused || needsPin} onClick={() => action('choose', { selectedId: choice.id })}><img src={choice.imageUrl} alt={`图片选项${index + 1}`} onError={() => { setPaused(true); setError('图片暂不可用，已暂停测试。请家长检查素材后继续。'); }} /></button>)}</div> : <><p>可用图片选项不足，这一项暂无法测试。</p><button disabled={busy} onClick={() => action('unavailable')}>记为暂无法测试，继续</button></> : <div className="assessment-parent-judgement"><p>请家长听完再确认；先不示范、不揭晓答案。</p><div>{(['correct', 'incorrect', 'hinted', 'unconfirmed'] as const).map(result => <button key={result} disabled={busy || paused || needsPin} onClick={() => action('judge', { judgement: result })}>{assessmentResultLabels[result]}</button>)}</div><small>{current.dimension === 'read' ? '家长判断是否能独立读出目标词，不提供自动发音评分。' : current.dimension === 'en-zh' ? '表达符合这次学习的中文义项即可，不要求一字不差。' : '检查是否说出这次学习的目标英文词条。'}未确认的题目以后重新测试。</small></div>}
      <button className="assessment-skip" disabled={busy || paused || needsPin} onClick={() => action('skip')}>这题先跳过</button>
      <p className="muted">答案在整轮结束后一起核对。</p>
      {error && <button onClick={() => { setSession(undefined); setError(''); setPaused(false); }}>返回选词，按当前词表重新开始</button>}
    </section>}
    {session?.completedAt && <section className="assessment-card"><h1>测试记好啦</h1><p>{session.wordIds.length} 个单词 · {session.items.length} 项。下面一起核对，练习需要加强的地方。</p><div className="assessment-results">{session.items.map(item => <article key={item.id}><div><strong>{item.word.term}</strong><span>{item.word.meaning}</span><small>{assessmentLabels[item.dimension]} · {judgementLabel(item.dimension, item.result!)}</small></div><strong>{assessmentResultLabels[item.result!]}</strong><button aria-label={`听${item.word.term}的缓存发音`} disabled={busy} onClick={() => void voice.speakCached(item.word.term)}>♫ 听示范</button></article>)}</div><p>薄弱项会进入之后的练习；口头能力由家长复测确认。</p><button className="assessment-primary" onClick={exit}>完成</button><button onClick={() => { voice.stop(); setSession(undefined); }}>再选一批</button></section>}
    {paused && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="测试已暂停"><h2>休息一下</h2><p>已提交的结果和当前位置都已保存。</p><button className="assessment-primary" onClick={() => setPaused(false)}>继续测试</button><button onClick={exit}>保存并返回</button></section></div>}
    {needsPin && <ParentGate onClose={exit} onUnlock={next => { onGrant(next); setNeedsPin(false); setError(''); }} />}
  </main>;
}

export function AssessmentPracticeView({ word, dimension, choices, busy:appBusy, play, complete, target, stopAudio }: {
  word: Word; dimension: AssessmentDimension; choices: Word[]; busy: boolean; target:PracticeRecordingTarget;stopAudio:()=>void; play: (term: string) => Promise<boolean>; complete: () => void;
}) {
  const [oralBusy,setOralBusy]=useState(false),[oralReady,setOralReady]=useState(false),[oralSkipped,setOralSkipped]=useState(false);
  const busy=appBusy||oralBusy;
  const [revealed, setRevealed] = useState(false), [message, setMessage] = useState(''), [playing, setPlaying] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const hear = async () => { setPlaying(true); try { const ok = await play(word.term); if (active.current) setMessage(ok ? '' : '示范暂时播不了，可以继续练习或稍后再听。'); } finally { if (active.current) setPlaying(false); } };
  const reveal = () => { setRevealed(true); void hear(); };
  const pictureChoice = dimension === 'look' || dimension === 'en-zh';
  return <div className="assessment-practice">
    <p>{dimension === 'zh-en' ? '看图想一想，英语怎么说？' : dimension === 'read' ? '看看英文，先自己读一遍' : '看看英文，找到它的图片'}</p>
    {dimension !== 'zh-en' && <div className="assessment-cue">{word.term}</div>}
    {pictureChoice && !revealed && choices.length >= 2 ? <div className="assessment-picture-choices">{choices.map((choice, index) => <button disabled={busy} aria-label={`练习选择图片${index + 1}`} key={choice.id} onClick={() => { setMessage(choice.id === word.id ? '找到了，一起核对一下。' : '一起看看这个词的意思。'); setRevealed(true); }}><img src={choice.imageUrl} alt={`图片选项${index + 1}`} /></button>)}</div> : (dimension === 'zh-en' || revealed || pictureChoice) && <img className="assessment-practice-picture" src={word.imageUrl} alt={revealed ? word.meaning : '回想英文的图片'} />}
    {!pictureChoice&&<OralPractice target={target} active={!appBusy} busy={appBusy} stopAudio={stopAudio} onReady={setOralReady} onBusy={setOralBusy} onSkip={()=>setOralSkipped(true)} compact={revealed} readOnly={revealed}/>}
    {!revealed && <button className="assessment-primary" disabled={busy || playing || !pictureChoice&&!oralReady&&!oralSkipped} onClick={reveal}>{dimension === 'read' ? '我试过了，听示范' : '想好了，核对一下'}</button>}
    {revealed && <><p className="assessment-meaning">{word.term} · {word.meaning}</p><button disabled={busy || playing} onClick={() => void hear()}>{playing ? '播放中…' : '♫ 听示范'}</button><button className="assessment-primary" disabled={busy || playing} onClick={complete}>练习完成，继续</button></>}
    <p role="status">{message}</p><button disabled={busy || playing} onClick={complete}>这次先跳过</button>
  </div>;
}
