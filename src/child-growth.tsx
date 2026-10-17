import { useEffect, useRef, useState } from 'react';
import type { GrowthSummary, LearningSession, Word } from '../shared/contracts';
import { assessmentDay, assessmentLabels, assessmentResultLabels } from '../shared/assessment';
import { shiftGrowthDay } from '../shared/growth';
import { companionFor } from '../shared/companions';
import { Mascot } from './mascot';
import { LearningSymbol } from './learning-topbar';
import { BadgeArt, BadgeCollection } from './badge-collection';
import './child-growth.css';

export function Medal({ locked = false, kind = 'skill' }: { locked?: boolean; kind?: 'practice' | 'skill' }) {
  return <span className={`growth-medal ${locked ? 'is-locked' : ''} medal-${kind}`} aria-hidden="true"><svg viewBox="0 0 88 100" fill="none"><path d="m23 57-7 37 28-13 28 13-7-37" fill="currentColor" opacity=".65" /><circle cx="44" cy="40" r="33" fill="currentColor" /><circle cx="44" cy="40" r="26" stroke="white" strokeWidth="3" opacity=".65" /><path d="m44 20 6 13 15 2-11 11 3 15-13-7-13 7 3-15-11-11 15-2Z" fill="white" /></svg></span>;
}

export function LearningReward({ growth, session, onGrowth, onTest, onHome, onAgain, onSelect }: { growth?: GrowthSummary; session: LearningSession | null; onGrowth: () => void; onTest: () => void; onHome: () => void; onAgain?: () => void; onSelect?: () => void }) {
  const completedWords = (session?.completedWordIds ?? []).map(id => session?.activities?.find(activity => activity.wordId === id)?.word).filter(word => word !== undefined).slice(0, 3);
  return <main className="growth-reward flow-reward page-enter">
    <section className="reward-main-card" aria-labelledby="reward-title">
      <div className="reward-companion"><Mascot character={companionFor(session?.id ?? 'reward', 19)} /></div>
      <h1 id="reward-title">这一轮完成啦！</h1>
      <p className="reward-round-count">完成了 <strong>{session?.completedWordIds.length ?? 0}</strong> 个词的练习</p>
      {completedWords.length > 0 && <div className="reward-word-pictures" aria-label="本轮练习过的单词">{completedWords.map(word => <span key={word.id}><img src={word.imageUrl} alt={word.meaning} /></span>)}</div>}
      {growth ? <div className="reward-saved-status"><span className="reward-check"><LearningSymbol kind="check" /></span><div><strong>{growth.todayCheckedIn ? '今天已打卡' : '本轮练习已保存'}</strong><small>累计学习 {growth.totalDays} 天</small></div></div> : <p className="reward-unavailable" role="status">成长记录暂未载入，请重新连接本机服务。</p>}
    </section>
    <div className="reward-main-actions"><button className="growth-primary" onClick={onHome}>回学习大厅<LearningSymbol kind="arrow" /></button><button className="growth-secondary" onClick={onGrowth}>看看我的成长</button></div>
    <details className="reward-more"><summary>还想继续玩<LearningSymbol kind="down" /></summary><div>{onAgain && <button onClick={onAgain}><LearningSymbol kind="play" />再练一轮</button>}{onSelect && <button onClick={onSelect}>自己选词<LearningSymbol kind="arrow" /></button>}<button onClick={onTest}>挑战本轮<LearningSymbol kind="arrow" /></button></div></details>
  </main>;
}

type GrowthModule = 'overview' | 'calendar' | 'skills' | 'words';
type WordFilter = 'verified' | 'practiced' | 'due';
function GrowthSymbol({ kind }: {kind: 'back' | 'play' | 'down' | 'check' | 'search' | 'book'}) {
  return <svg className="growth-symbol" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'back' ? <path d="M19 12H5m6-6-6 6 6 6" /> : kind === 'play' ? <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" /> : kind === 'down' ? <path d="m6 9 6 6 6-6" /> : kind === 'check' ? <path d="m5 12 4 4L19 6" /> : kind === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></> : <path d="M12 5v15m0-15C8 2 4 3 3 4v14c4-2 7-1 9 2m0-15c4-3 8-2 9-1v14c-4-2-7-1-9 2" />}</svg>;
}
const growthModules: { id: GrowthModule; title: string; short: string; path: string }[] = [
  { id: 'overview', title: '成长总览', short: '总览', path: 'm8 3 4 3 4-3 1 8-5 4-5-4Z M9 15l-2 6 5-2 5 2-2-6' },
  { id: 'calendar', title: '学习打卡', short: '打卡', path: 'M5 5h14v15H5Z M8 3v4m8-4v4M5 10h14m-11 5 3 3 5-5' },
  { id: 'skills', title: '能力进展', short: '能力', path: 'M5 20v-6h3v6m3 0V9h3v11m3 0V4h3v16' },
  { id: 'words', title: '单词记录', short: '单词', path: 'M12 5v15m0-15C8 2 4 3 3 4v14c4-2 7-1 9 2m0-15c4-3 8-2 9-1v14c-4-2-7-1-9 2' },
];

function GrowthCalendar({ growth }: { growth: GrowthSummary }) {
  const today = assessmentDay(new Date(growth.asOf)), daySet = new Set(growth.days);
  const start = shiftGrowthDay(today, -34), weekday = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  return <div className="growth-module-content growth-calendar-module">
    <div className="growth-stats"><div><strong>{growth.totalDays}<small>天</small></strong><span>累计学习</span></div><div><strong>{growth.currentStreak}<small>天</small></strong><span>当前连续</span></div><div><strong>{growth.longestStreak}<small>天</small></strong><span>最长连续</span></div></div>
    <section className="growth-panel growth-calendar" aria-labelledby="growth-calendar-title">
      <div className="growth-section-heading"><h2 id="growth-calendar-title">我的学习足迹</h2><span className={growth.todayCheckedIn ? 'growth-today-done' : ''}>{growth.todayCheckedIn ? '✓ 今天已打卡' : '今天还没开始'}</span></div>
      <p>最近35天，每一份努力都记在这里。</p>
      <div className="growth-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
      <div className="growth-days" role="list" aria-label="最近35天学习打卡">
        {Array.from({ length: weekday }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
        {Array.from({ length: 35 }, (_, index) => {
          const day = shiftGrowthDay(start, index), done = daySet.has(day);
          return <span role="listitem" key={day} className={`${done ? 'is-done' : ''} ${day === today ? 'is-today' : ''}`} aria-label={`${day}${done ? '已打卡' : '未打卡'}`} title={`${day}${done ? ' 已学习' : ' 未学习'}`}><small>{day.slice(5).replace('-', '/')}</small><strong aria-hidden="true">{done ? '✓' : '·'}</strong></span>;
        })}
      </div>
      <small>有学习记录就自动打卡，每天记一次。休息一天也不会失去累计天数。</small>
    </section>
  </div>;
}

function GrowthSkills({ growth, onTest }: { growth: GrowthSummary; onTest: () => void }) {
  return <section className="growth-panel growth-module-content growth-skills-module" aria-labelledby="growth-skills-title">
    <h2 id="growth-skills-title">四项挑战记录</h2>
    <p className="growth-panel-caption">每一项独立通过的单词数。</p>
    <div className="growth-skill-counts">{Object.entries(growth.skills).map(([dimension, value]) => <div key={dimension}><span>{assessmentLabels[dimension as keyof typeof assessmentLabels]}</span><strong>{value}<small>词</small></strong></div>)}</div>
    <p className="growth-evidence-note">{growth.stableWords} 个词已在不同日期通过四项测试 · {growth.dueWords} 个词到期待复测</p>
    <button className="growth-primary growth-test-action" onClick={onTest}><GrowthSymbol kind="play" />挑战测试</button>
    <details className="growth-explanation"><summary>怎样才算“会了”？<GrowthSymbol kind="down" /></summary><p>看英文认意思、独立朗读、英译中、中译英四项的最近完整测试都独立答对，才算一个会的词。口头三项由家长听后确认，看词选图由系统核对；跟读、提示、跳过和打卡不计入。</p><p>按词表中所学的义项判断，相同英文合并计一次，不表示已经懂得所有词义。到期表示该复测，并不自动判定忘记；新测试未通过或改过词义后，当前会词数量和称号会相应更新。已获得的奖章永久保留。</p><p>当前会词称号：{growth.rank.title}。</p></details>
  </section>;
}

function GrowthWords({ growth, words, initialFilter = 'practiced', onLearn }: { growth: GrowthSummary; words: Word[]; initialFilter?: WordFilter; onLearn?: () => void }) {
  const [filter, setFilter] = useState<WordFilter>(initialFilter);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = growth.words.filter(word => (filter === 'practiced' || (filter === 'verified' ? word.verified : word.dimensions.some(item => item.dueAt && Date.parse(item.dueAt) <= Date.parse(growth.asOf)))) && `${word.term} ${word.meaning}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(shown.length / 8)), currentPage = Math.min(page, pages - 1);
  const images = new Map(words.map(word => [word.id, word.imageUrl]));
  const changePage = (next: number) => { setPage(next); listRef.current?.scrollIntoView({block: 'start', behavior: 'instant'}); };
  return <section className="growth-panel" aria-labelledby="growth-words-title">
    <div className="growth-section-heading"><h2 id="growth-words-title">我的单词朋友</h2><span>{shown.length} 条记录 · 按所学义项</span></div>
    <div className="growth-word-toolbar"><div className="growth-word-filters" role="group" aria-label="筛选单词记录">{([{ id: 'practiced', label: `练过 ${growth.practicedWords}` }, { id: 'verified', label: `会的 ${growth.verifiedWords}` }, { id: 'due', label: `待复测 ${growth.dueWords}` }] as const).map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => {setFilter(item.id); setPage(0);}}>{item.label}</button>)}</div><label className="growth-search"><GrowthSymbol kind="search" /><input aria-label="查找单词记录" type="search" value={query} onChange={event => {setQuery(event.target.value); setPage(0);}} placeholder="查找英文或中文" /></label></div>
    <div className="growth-word-list" ref={listRef}>{shown.slice(currentPage * 8, (currentPage + 1) * 8).map(word => <details className="growth-word-card" key={`${filter}:${word.wordId}`}><summary>{images.get(word.wordId) && <img src={images.get(word.wordId)} alt="" loading="lazy" decoding="async" />}<span className="growth-word-copy"><strong>{word.term}</strong><span>{word.meaning}</span><small className={word.verified ? 'is-verified' : ''}>{word.stable ? '跨天巩固' : word.verified ? '四项通过' : '练习中'}</small></span><GrowthSymbol kind="down" /></summary><div className="growth-word-skills">{word.dimensions.map(item => <span key={item.dimension} className={item.passed ? 'is-passed' : ''}><span>{assessmentLabels[item.dimension]}</span><strong>{item.result ? assessmentResultLabels[item.result] : '待测试'}</strong></span>)}</div></details>)}</div>
    {!shown.length && <div className="growth-empty growth-word-empty"><GrowthSymbol kind="book" /><p>{query ? '没有找到这个单词。' : filter === 'verified' ? '四项独立测试都通过的词，会出现在这里。' : filter === 'due' ? '现在没有到期待复测的单词。' : '练过的单词，会出现在这里。'}</p>{query ? <button className="growth-secondary" onClick={() => {setQuery(''); setPage(0);}}>清除查找</button> : filter !== 'practiced' && growth.practicedWords ? <button className="growth-secondary" onClick={() => {setFilter('practiced'); setPage(0);}}>看看练过的词</button> : onLearn && <button className="growth-primary" onClick={onLearn}><GrowthSymbol kind="play" />去学几个词</button>}</div>}
    {pages > 1 && <nav className="growth-word-pagination" aria-label="单词记录分页"><button disabled={!currentPage} onClick={() => changePage(currentPage - 1)}>← 上一页</button><span>{currentPage + 1} / {pages}</span><button disabled={currentPage + 1 >= pages} onClick={() => changePage(currentPage + 1)}>下一页 →</button></nav>}
  </section>;
}

export function ChildGrowth({ growth, words = [], onBack, onTest, onLearn }: { growth?: GrowthSummary; words?: Word[]; onBack: () => void; onTest: () => void; onLearn?: () => void }) {
  const [module, setModule] = useState<GrowthModule>('overview');
  const [wordFilter, setWordFilter] = useState<WordFilter>('practiced');
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [module]);
  if (!growth) return <main className="growth-page"><nav className="growth-nav"><button onClick={onBack}><GrowthSymbol kind="back" />回首页</button></nav><header className="growth-heading"><h1>我的成长</h1><Mascot small /></header><section className="growth-panel"><p role="status">成长记录尚未载入，请重新连接本机服务。</p></section></main>;
  const earned = growth.badges.filter(badge => badge.unlocked);
  const openWords = (filter: WordFilter) => {setWordFilter(filter); setModule('words');};
  return <main className="growth-page page-enter" data-growth-module={module}>
    <nav className="growth-nav" aria-label="成长导航"><button onClick={module === 'overview' ? onBack : () => setModule('overview')}><GrowthSymbol kind="back" />{module === 'overview' ? '回首页' : '成长首页'}</button></nav>
    <header className="growth-heading"><h1>{module === 'overview' ? '我的成长' : growthModules.find(item => item.id === module)!.title}</h1><Mascot small /></header>
    <nav className="growth-module-nav" aria-label="成长模块">{growthModules.map(item => <button key={item.id} aria-label={item.title} aria-current={module === item.id ? 'page' : undefined} onClick={() => {if (item.id === 'words') setWordFilter('practiced'); setModule(item.id);}}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg><span>{item.short}</span></button>)}</nav>
    {module === 'overview' && <>
      <section className="growth-highlight" aria-labelledby="growth-title"><div className="growth-highlight-copy"><h2 id="growth-title">{earned.length ? `收获了 ${earned.length} 枚奖章` : '第一枚奖章，等你点亮'}</h2><p>{growth.todayCheckedIn ? '今天的努力，已经记住啦' : growth.totalDays ? '带上单词朋友，再玩一轮吧' : '从认识第一个单词开始吧'}</p><button onClick={onLearn ?? onBack}><GrowthSymbol kind="play" />{onLearn ? growth.totalDays ? '继续玩' : '开始学习' : '回首页'}</button></div><div className="growth-highlight-art" aria-hidden="true">{earned.length ? earned.slice(-3).map(badge => <span key={badge.id}><BadgeArt badge={badge} /></span>) : <span><Medal locked /></span>}</div></section>
      <section className="growth-summary" aria-label="我的学习记录"><button aria-label={`查看练过的词，${growth.practicedWords}词`} onClick={() => openWords('practiced')}><strong>{growth.practicedWords}<small>词</small></strong><span>练过的词</span></button><button aria-label={`查看会的词，${growth.verifiedWords}词`} onClick={() => openWords('verified')}><strong>{growth.verifiedWords}<small>词</small></strong><span>会的词</span></button><button aria-label={`查看学习打卡，累计${growth.totalDays}天`} onClick={() => setModule('calendar')}><strong>{growth.totalDays}<small>天</small></strong><span>学习天数</span></button></section><p className="growth-summary-note">会的词需四项独立测试都通过。</p>
      <BadgeCollection growth={growth} />
    </>}
    {module === 'calendar' && <GrowthCalendar growth={growth} />}
    {module === 'skills' && <GrowthSkills growth={growth} onTest={onTest} />}
    {module === 'words' && <GrowthWords growth={growth} words={words} initialFilter={wordFilter} onLearn={onLearn} />}
  </main>;
}
