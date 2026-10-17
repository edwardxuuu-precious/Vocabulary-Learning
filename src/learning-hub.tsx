import { useRef, useState } from 'react';
import type { AppState, LearningStartRequest, Word } from '../shared/contracts';
import { dailyLearningPlan, selectedLearningTasks, supplementalLearningPlan, SECONDS_PER_LEARNING_TASK } from '../shared/learning';
import { learningEncounters } from '../shared/learning-history';
import { recommendedAssessmentItems } from '../shared/assessment';
import { Mascot } from './mascot';
import './learning-hub.css';

function HubSymbol({ kind }: {kind: 'play' | 'cards' | 'flag' | 'back' | 'check' | 'sound' | 'down'}) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'play' ? <path d="m12 7 14 9-14 9Z" fill="currentColor" stroke="none" /> : kind === 'cards' ? <><rect x="9" y="5" width="18" height="23" rx="4" /><path d="M5 24 3 8a4 4 0 0 1 4-4m8 10 3-4 4 4m-7 7h8" /></> : kind === 'flag' ? <><path d="M7 28V4m0 1c7-6 11 6 19 0v14c-8 6-12-6-19 0" /></> : kind === 'back' ? <path d="m14 7-9 9 9 9M5 16h23" /> : kind === 'sound' ? <><path d="M5 12h6l7-6v20l-7-6H5Z" /><path d="M23 11a8 8 0 0 1 0 10m4-14a14 14 0 0 1 0 18" /></> : kind === 'down' ? <path d="m8 12 8 8 8-8" /> : <path d="m7 17 6 6L26 9" />}
  </svg>;
}

interface Props { state: AppState; busy: boolean; onStart: (request: LearningStartRequest) => void; onHome: () => void; onTest: () => void; onSpeak: (word: Word) => void }

export function LearningHub({ state, busy, onStart, onHome, onTest, onSelect }: Props & {onSelect: () => void}) {
  const now = new Date(state.learningNow ?? Date.now()), plan = dailyLearningPlan(state, now);
  const extra = plan.tasks.length ? undefined : supplementalLearningPlan(state, now);
  const pending = state.resumableSessions ?? (state.activeSession ? [state.activeSession] : []);
  const pendingRecommended = pending.find(saved => (saved.mode ?? 'recommended') === 'recommended');
  const resume = pending[0];
  const recommendedPlan = plan.tasks.length ? plan : extra;
  const canRecommend = Boolean(pendingRecommended || recommendedPlan?.tasks.length);
  const recommendation = pendingRecommended
    ? `已完成 ${pendingRecommended.completedWordIds.length}/${pendingRecommended.wordIds.length} 词`
    : plan.tasks.length
      ? [plan.review.length ? `复习 ${plan.review.length} 个词` : '', plan.fresh.length ? `认识 ${plan.fresh.length} 个新词` : ''].filter(Boolean).join('，')
      : extra?.tasks.length ? `再练 ${extra.tasks.length} 个老朋友` : '暂时没有推荐，可以自己选词';
  const previewWords = (resume?.wordIds ?? recommendedPlan?.tasks.map(task => task.wordId) ?? [])
    .slice(0, 3).map(id => state.words.find(word => word.id === id)).filter((word): word is Word => Boolean(word));
  const showRecommendation = resume && resume.id !== pendingRecommended?.id;
  const testCount = new Set(recommendedAssessmentItems(state, now).map(item => item.wordId)).size;
  const [showAll, setShowAll] = useState(false);
  return <main className="learning-hub hub-home page-enter">
    <nav className="hub-nav" aria-label="页面导航"><button onClick={onHome}><HubSymbol kind="back" />回首页</button></nav>
    <header className="hub-heading"><h1>今天想怎么玩？</h1><Mascot small /></header>
    <section className="hub-feature" aria-label={resume ? '继续未完成的学习' : '推荐学习'}>
      <button className="hub-primary" disabled={busy || (!resume && !canRecommend)} onClick={() => onStart(resume ? {mode: 'resume', sessionId: resume.id} : {mode: 'recommended'})}>
        <span className="hub-primary-copy">
          <strong>{resume ? '继续上次' : '推荐学习'}</strong>
          <span className="hub-primary-detail">{resume ? `${resume.mode === 'relearn' ? '重新认识' : resume.practiceOnly ? '一起练习' : '推荐学习'} · 已完成 ${resume.completedWordIds.length}/${resume.wordIds.length} 词` : recommendation}</span>
          {resume && <span className="hub-primary-progress" aria-hidden="true"><span style={{width: `${resume.wordIds.length ? resume.completedWordIds.length / resume.wordIds.length * 100 : 0}%`}} /></span>}
          <span className="hub-primary-action"><HubSymbol kind="play" />{busy ? '准备中…' : resume ? '继续玩' : canRecommend ? '开始玩' : '等会儿再来'}</span>
        </span>
        <span className="hub-primary-pictures" aria-hidden="true">{previewWords.map(word => <span key={word.id}><img src={word.imageUrl} alt="" /></span>)}</span>
      </button>
      {pending.length > 1 && <button className="hub-more" aria-expanded={showAll} aria-controls="hub-other-sessions" onClick={() => setShowAll(!showAll)}>{showAll ? '收起其他进度' : `还有 ${pending.length - 1} 轮没玩完`}<span aria-hidden="true">{showAll ? '⌃' : '⌄'}</span></button>}
      {showAll && pending.length > 1 && <div className="hub-resume" id="hub-other-sessions">
        {pending.slice(1).map(saved => <button key={saved.id} className="hub-resume-button" disabled={busy} onClick={() => onStart({mode: 'resume', sessionId: saved.id})}>
          <span className="hub-resume-pictures">{saved.wordIds.slice(0, 3).map(id => <img key={id} src={state.words.find(word => word.id === id)?.imageUrl} alt="" />)}</span>
          <span><strong>{saved.mode === 'relearn' ? '重新认识' : saved.practiceOnly ? '一起练习' : '推荐学习'}</strong><small>{new Date(saved.startedAt).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'})} · 已完成 {saved.completedWordIds.length}/{saved.wordIds.length} 词</small></span><HubSymbol kind="play" />
        </button>)}
      </div>}
    </section>
    <section className={`hub-routes${showRecommendation ? ' hub-routes-three' : ''}`} aria-label="选择学习方式">
      {showRecommendation && <button className="hub-route hub-route-recommended" disabled={busy || !canRecommend} onClick={() => onStart(pendingRecommended ? {mode: 'resume', sessionId: pendingRecommended.id} : {mode: 'recommended'})}><span className="hub-route-icon"><HubSymbol kind="play" /></span><span className="hub-route-copy"><strong>推荐学习</strong><small>{recommendation}</small></span><span className="hub-route-arrow" aria-hidden="true">→</span></button>}
      <button className="hub-route hub-route-select" disabled={busy || !plan.available.length} onClick={onSelect}><span className="hub-route-icon"><HubSymbol kind="cards" /></span><span className="hub-route-copy"><strong>自己选词</strong><small>点图片，选想学的词</small></span><span className="hub-route-arrow" aria-hidden="true">→</span></button>
      <button className="hub-route hub-route-test" disabled={busy} onClick={onTest}><span className="hub-route-icon"><HubSymbol kind="flag" /></span><span className="hub-route-copy"><strong>挑战测试</strong><small>{testCount ? `${testCount} 个老朋友，等你来挑战` : '试试看，还记得吗？'}</small></span><span className="hub-route-arrow" aria-hidden="true">→</span></button>
    </section>
  </main>;
}

export function WordPicker({ state, busy, onStart, onHome, onSpeak }: Props) {
  const [selected, setSelected] = useState<string[]>([]), [mode, setMode] = useState<'practice' | 'relearn'>('practice');
  const [pack, setPack] = useState('all'), [filter, setFilter] = useState<'all' | 'new' | 'learned'>('all'), [page, setPage] = useState(0);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const plan = dailyLearningPlan(state, new Date(state.learningNow ?? Date.now()));
  const learned = new Set(learningEncounters(state).map(entry => entry.wordId));
  for (const row of state.progress) learned.add(row.wordId);
  const visible = plan.available.filter(word => (pack === 'all' || word.packId === pack) && (filter === 'all' || learned.has(word.id) === (filter === 'learned')));
  const selectedIds = new Set(selected), allVisibleSelected = visible.every(word => selectedIds.has(word.id));
  const visibleIds = new Set(visible.map(word => word.id));
  const hiddenSelected = selected.filter(id => !visibleIds.has(id)).length;
  const packs = state.packs.filter(item => item.enabled && plan.available.some(word => word.packId === item.id));
  const pages = Math.max(1, Math.ceil(visible.length / 12)), currentPage = Math.min(page, pages - 1);
  const tasks = selectedLearningTasks(state, selected, mode);
  const estimatedMinutes = Math.ceil(tasks.reduce((sum, task) => sum + task.steps.length, 0) * SECONDS_PER_LEARNING_TASK / 60);
  const toggle = (word: Word) => {
    setSelected(current => current.includes(word.id) ? current.filter(id => id !== word.id) : [...current, word.id]);
  };
  const resetFilters = () => { setPack('all'); setFilter('all'); setPage(0); };
  const closeOptions = () => { if (optionsRef.current) { optionsRef.current.open = false; optionsRef.current.querySelector('summary')?.focus(); } };
  const chooseMode = (next: 'practice' | 'relearn') => { setMode(next); closeOptions(); };
  return <main className="learning-hub word-picker page-enter">
    <nav className="hub-nav" aria-label="页面导航"><button onClick={onHome}><HubSymbol kind="back" />回大厅</button></nav>
    <header className="hub-heading"><h1>这次想学哪些？</h1><Mascot small /></header>
    <section className="picker-toolbar" aria-label="筛选和选择单词">
      <div className="picker-filter-row">
        <div className="picker-filters" role="group" aria-label="筛选学习状态">{([{id:'all', label:'全部'}, {id:'new', label:'还没学过'}, {id:'learned', label:'学过的'}] as const).map(item => <button key={item.id} disabled={busy} aria-pressed={filter === item.id} onClick={() => {setFilter(item.id); setPage(0);}}>{item.label}</button>)}</div>
        {packs.length > 1 && <div className="picker-pack-select"><select aria-label="筛选词书" disabled={busy} value={pack} onChange={event => {setPack(event.target.value); setPage(0);}}><option value="all">所有词书</option>{packs.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><HubSymbol kind="down" /></div>}
      </div>
      <div className="picker-bulk-actions" role="group" aria-label="批量选择单词">
        <span>共 {visible.length} 个词</span>
        <button disabled={busy || !visible.length || allVisibleSelected} onClick={() => setSelected(current => [...new Set([...current, ...visible.map(word => word.id)])])}>全选</button>
        <button disabled={busy || !selected.length} onClick={() => setSelected([])}>取消全选</button>
      </div>
      {hiddenSelected > 0 && <button className="picker-hidden-selection" disabled={busy} onClick={resetFilters}>另有 {hiddenSelected} 个已选词在其他筛选中 · 查看全部</button>}
    </section>
    <section className="picker-grid" aria-label="选择单词图片">{visible.slice(currentPage * 12, currentPage * 12 + 12).map(word => <article key={word.id} className={selected.includes(word.id) ? 'is-selected' : ''}>
      <button className="picker-card" aria-label={`选择${word.term}，${word.meaning}`} aria-pressed={selected.includes(word.id)} disabled={busy} onClick={() => toggle(word)}><span className="picker-check">{selected.includes(word.id) ? <HubSymbol kind="check" /> : '+'}</span><span className="picker-picture"><img src={word.imageUrl} alt="" loading="lazy" decoding="async" /></span><strong>{word.term}</strong><span className="picker-meaning">{word.meaning}</span><small className={learned.has(word.id) ? 'is-familiar' : 'is-new'}>{learned.has(word.id) ? '学过的' : '新朋友'}</small></button>
      <button className="picker-listen" aria-label={`听${word.term}的发音`} disabled={busy} onClick={() => onSpeak(word)}><HubSymbol kind="sound" /></button>
    </article>)}</section>
    {!visible.length && <div className="picker-empty"><HubSymbol kind="cards" /><strong>{plan.available.length ? '这里还没有这样的词' : '单词还在准备中'}</strong>{plan.available.length ? <button disabled={busy} onClick={resetFilters}>看看全部单词</button> : <p>请家长先准备好词书。</p>}</div>}
    {pages > 1 && <nav className="picker-pagination" aria-label="单词翻页"><button disabled={busy || !currentPage} onClick={() => setPage(currentPage - 1)}>← 上一页</button><span>{currentPage + 1} / {pages}</span><button disabled={busy || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页 →</button></nav>}
    <footer className="picker-footer">
      <div className="picker-selection">
        <div className="picker-selection-heading"><strong>已选 {selected.length} 词</strong>
          <details className="picker-options" ref={optionsRef} onKeyDown={event => {if (event.key === 'Escape') closeOptions();}}>
            <summary aria-label={`学习方式：${mode === 'practice' ? '直接练习' : '重新认识'}`}>{mode === 'practice' ? '直接练习' : '重新认识'}<HubSymbol kind="down" /></summary>
            <div className="picker-options-panel"><div className="picker-modes" role="group" aria-label="选择学法"><button disabled={busy} aria-pressed={mode === 'practice'} onClick={() => chooseMode('practice')}><HubSymbol kind="play" /><span>直接练习<small>旧词跳过讲解</small></span></button><button disabled={busy} aria-pressed={mode === 'relearn'} onClick={() => chooseMode('relearn')}><HubSymbol kind="cards" /><span>重新认识<small>从头完整学一遍</small></span></button></div><p>新朋友都会先认识，再一起练习。</p></div>
          </details>
        </div>
        <span className="picker-selection-status" role="status">{selected.length ? `约 ${estimatedMinutes} 分钟 · 没玩完，下次继续` : '点图片选词，选好了就出发'}</span>
      </div>
      <button className="picker-start" disabled={busy || !selected.length} onClick={() => onStart({mode, wordIds: selected})}><HubSymbol kind="play" />{busy ? '准备中…' : '出发'}</button>
    </footer>
  </main>;
}
