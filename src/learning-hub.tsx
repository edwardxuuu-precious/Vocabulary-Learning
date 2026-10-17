import { useState } from 'react';
import type { AppState, LearningStartRequest, Word } from '../shared/contracts';
import { dailyLearningPlan, selectedLearningTasks, supplementalLearningPlan } from '../shared/learning';
import { learningEncounters } from '../shared/learning-history';
import { recommendedAssessmentItems } from '../shared/assessment';
import { Mascot } from './mascot';
import './learning-hub.css';

function HubSymbol({ kind }: {kind: 'play' | 'cards' | 'flag' | 'back' | 'check'}) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'play' ? <path d="m12 7 14 9-14 9Z" fill="currentColor" stroke="none" /> : kind === 'cards' ? <><rect x="9" y="5" width="18" height="23" rx="4" /><path d="M5 24 3 8a4 4 0 0 1 4-4m8 10 3-4 4 4m-7 7h8" /></> : kind === 'flag' ? <><path d="M7 28V4m0 1c7-6 11 6 19 0v14c-8 6-12-6-19 0" /></> : kind === 'back' ? <path d="m14 7-9 9 9 9M5 16h23" /> : <path d="m7 17 6 6L26 9" />}
  </svg>;
}

interface Props { state: AppState; busy: boolean; onStart: (request: LearningStartRequest) => void; onHome: () => void; onTest: () => void; onSpeak: (word: Word) => void }

export function LearningHub({ state, busy, onStart, onHome, onTest, onSelect }: Props & {onSelect: () => void}) {
  const now = new Date(state.learningNow ?? Date.now()), plan = dailyLearningPlan(state, now);
  const extra = plan.tasks.length ? undefined : supplementalLearningPlan(state, now);
  const pending = state.resumableSessions ?? (state.activeSession ? [state.activeSession] : []);
  const pendingRecommended = pending.find(saved => (saved.mode ?? 'recommended') === 'recommended');
  const testCount = new Set(recommendedAssessmentItems(state, now).map(item => item.wordId)).size;
  const [showAll, setShowAll] = useState(false);
  return <main className="learning-hub page-enter">
    <nav className="hub-nav"><button onClick={onHome}><HubSymbol kind="back" />回首页</button><span>学习大厅</span></nav>
    <header className="hub-heading"><div><span className="hub-eyebrow">单词游乐园</span><h1>今天想怎么玩？</h1><p>选一条路，和单词朋友出发吧。</p></div><Mascot small /></header>
    {pending.length > 0 && <section className="hub-resume" aria-label="还没玩完的学习">
      {(showAll ? pending : pending.slice(0, 1)).map(saved => <button key={saved.id} className="hub-resume-button" disabled={busy} onClick={() => onStart({mode: 'resume', sessionId: saved.id})}>
        <span className="hub-resume-pictures">{saved.wordIds.slice(0, 3).map(id => <img key={id} src={state.words.find(word => word.id === id)?.imageUrl} alt="" />)}</span>
        <span><strong>继续上次</strong><small>{saved.mode === 'relearn' ? '重新认识' : saved.practiceOnly ? '一起练习' : '推荐学习'} · 已完成{saved.completedWordIds.length}/{saved.wordIds.length}词</small></span><HubSymbol kind="play" />
      </button>)}
      {pending.length > 1 && <button className="hub-more" onClick={() => setShowAll(!showAll)}>{showAll ? '收起来' : `还有${pending.length - 1}轮没玩完`}</button>}
    </section>}
    <section className="hub-routes" aria-label="选择学习方式">
      <button className="hub-route hub-route-recommended" disabled={busy || !(pendingRecommended || plan.tasks.length || extra?.tasks.length)} onClick={() => onStart({mode: 'recommended'})}><span className="hub-route-icon"><HubSymbol kind="play" /></span><strong>推荐学习</strong><small>{pendingRecommended ? '接着玩没完成的推荐' : plan.tasks.length ? `${plan.review.length ? `复习${plan.review.length}词` : ''}${plan.review.length && plan.fresh.length ? '，再' : ''}${plan.fresh.length ? `认识${plan.fresh.length}个新朋友` : ''}` : extra?.tasks.length ? '换一组，练练老朋友' : '先选几个新朋友吧'}</small><span className="hub-route-arrow" aria-hidden="true">→</span></button>
      <button className="hub-route hub-route-select" disabled={busy || !plan.available.length} onClick={onSelect}><span className="hub-route-icon"><HubSymbol kind="cards" /></span><strong>自己选词</strong><small>想学哪个，就点哪个</small><span className="hub-route-arrow" aria-hidden="true">→</span></button>
      <button className="hub-route hub-route-test" disabled={busy} onClick={onTest}><span className="hub-route-icon"><HubSymbol kind="flag" /></span><strong>挑战测试</strong><small>{testCount ? `${testCount}个老朋友，等你来挑战` : '自己试一试，还记得吗？'}</small><span className="hub-route-arrow" aria-hidden="true">→</span></button>
    </section>
  </main>;
}

export function WordPicker({ state, busy, onStart, onHome, onSpeak }: Props) {
  const [selected, setSelected] = useState<string[]>([]), [mode, setMode] = useState<'practice' | 'relearn'>('practice');
  const [pack, setPack] = useState('all'), [filter, setFilter] = useState<'all' | 'new' | 'learned'>('all'), [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  const plan = dailyLearningPlan(state, new Date(state.learningNow ?? Date.now()));
  const learned = new Set(learningEncounters(state).map(entry => entry.wordId));
  for (const row of state.progress) learned.add(row.wordId);
  const visible = plan.available.filter(word => (pack === 'all' || word.packId === pack) && (filter === 'all' || learned.has(word.id) === (filter === 'learned')));
  const pages = Math.max(1, Math.ceil(visible.length / 12)), currentPage = Math.min(page, pages - 1);
  const tasks = selectedLearningTasks(state, selected, mode), cost = tasks.reduce((sum, task) => sum + task.steps.length, 0);
  const candidateCosts = selectedLearningTasks(state, visible.filter(word => !selected.includes(word.id)).map(word => word.id), mode).map(task => task.steps.length).sort((a, b) => a - b);
  let remaining = Math.max(0, plan.taskLimit - cost), selectionLimit = selected.length;
  for (const item of candidateCosts) { if (selectionLimit >= 5 || item > remaining) break; selectionLimit++; remaining -= item; }
  const full = selected.length >= 5 || cost >= plan.taskLimit;
  const toggle = (word: Word) => {
    if (selected.includes(word.id)) { setSelected(selected.filter(id => id !== word.id)); setMessage(''); return; }
    const next = [...selected, word.id], nextCost = selectedLearningTasks(state, next, mode).reduce((sum, task) => sum + task.steps.length, 0);
    if (next.length > 5 || nextCost > plan.taskLimit) { setMessage('这一轮装满啦，先玩这些，再回来选。'); return; }
    setSelected(next); setMessage('');
  };
  return <main className="learning-hub word-picker page-enter">
    <nav className="hub-nav"><button onClick={onHome}><HubSymbol kind="back" />回大厅</button><span>自己选词</span></nav>
    <header className="hub-heading"><div><span className="hub-eyebrow">点图片，选朋友</span><h1>这次想学哪些？</h1><p>这轮最多{selectionLimit}词，约{state.settings.sessionMinutes}分钟。</p></div><Mascot small /></header>
    <div className="picker-modes" role="group" aria-label="选择学法"><button aria-pressed={mode === 'practice'} onClick={() => {setMode('practice'); setMessage('');}}><HubSymbol kind="play" /><span>直接练习<small>旧词跳过讲解</small></span></button><button aria-pressed={mode === 'relearn'} onClick={() => {setMode('relearn'); setMessage('');}}><HubSymbol kind="cards" /><span>重新认识<small>从头完整学一遍</small></span></button></div>
    <div className="picker-filters" role="group" aria-label="筛选学习状态">{([{id:'all', label:'全部'}, {id:'new', label:'还没学过'}, {id:'learned', label:'学过的'}] as const).map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => {setFilter(item.id); setPage(0);}}>{item.label}</button>)}</div>
    <div className="picker-packs" role="group" aria-label="筛选词书"><button aria-pressed={pack === 'all'} onClick={() => {setPack('all'); setPage(0);}}>所有词书</button>{state.packs.filter(item => item.enabled && plan.available.some(word => word.packId === item.id)).map(item => <button key={item.id} aria-pressed={pack === item.id} onClick={() => {setPack(item.id); setPage(0);}}>{item.title}</button>)}</div>
    <section className="picker-grid" aria-label="选择单词图片">{visible.slice(currentPage * 12, currentPage * 12 + 12).map(word => <article key={word.id} className={selected.includes(word.id) ? 'is-selected' : ''}>
      <button className="picker-card" aria-label={`选择${word.term}，${word.meaning}`} aria-pressed={selected.includes(word.id)} disabled={busy} onClick={() => toggle(word)}><span className="picker-check">{selected.includes(word.id) ? <HubSymbol kind="check" /> : '+'}</span><img src={word.imageUrl} alt={word.meaning} /><strong>{word.term}</strong><span>{word.meaning}</span><small>{learned.has(word.id) ? '学过的朋友' : '新朋友'}</small></button>
      <button className="picker-listen" aria-label={`听${word.term}的发音`} onClick={() => onSpeak(word)}>♫</button>
    </article>)}</section>
    {!visible.length && <p className="picker-empty">这里还没有单词，换一本词书看看吧。</p>}
    {pages > 1 && <nav className="picker-pagination" aria-label="单词翻页"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>← 上一页</button><span>{currentPage + 1} / {pages}</span><button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页 →</button></nav>}
    <footer className="picker-footer"><div><strong>选好 {selected.length} 个词</strong><span role="status">{cost > plan.taskLimit ? '重新认识需要更久，请少选几个词。' : message || (selected.some(id => !learned.has(id)) ? '新朋友会先认识，再一起玩。' : full ? '这一轮装满啦，随时可以出发。' : '点一下已选图片，可以取消。')}</span></div><button disabled={busy || !selected.length || cost > plan.taskLimit} onClick={() => onStart({mode, wordIds: selected})}><HubSymbol kind="play" />{busy ? '准备中…' : '出发'}</button></footer>
  </main>;
}
