import { useEffect, useState } from 'react';
import type { GrowthSummary, LearningSession } from '../shared/contracts';
import { assessmentDay, assessmentLabels, assessmentResultLabels } from '../shared/assessment';
import { shiftGrowthDay } from '../shared/growth';
import { companionFor } from '../shared/companions';
import { Mascot } from './mascot';
import { BadgeCollection } from './badge-collection';
import './child-growth.css';

export function Medal({ locked = false, kind = 'skill' }: { locked?: boolean; kind?: 'practice' | 'skill' }) {
  return <span className={`growth-medal ${locked ? 'is-locked' : ''} medal-${kind}`} aria-hidden="true"><svg viewBox="0 0 88 100" fill="none"><path d="m23 57-7 37 28-13 28 13-7-37" fill="currentColor" opacity=".65" /><circle cx="44" cy="40" r="33" fill="currentColor" /><circle cx="44" cy="40" r="26" stroke="white" strokeWidth="3" opacity=".65" /><path d="m44 20 6 13 15 2-11 11 3 15-13-7-13 7 3-15-11-11 15-2Z" fill="white" /></svg></span>;
}

function GrowthStats({ growth }: { growth: GrowthSummary }) {
  return <div className="growth-stats"><div title="四项独立测试都通过"><strong>{growth.verifiedWords}<small>词</small></strong><span>会的单词</span></div><div><strong>{growth.practicedWords}<small>词</small></strong><span>已经练习过</span></div><div><strong>{growth.totalDays}<small>天</small></strong><span>累计学习</span></div></div>;
}

export function LearningReward({ growth, session, onGrowth, onTest, onHome, onAgain, onSelect }: { growth?: GrowthSummary; session: LearningSession | null; onGrowth: () => void; onTest: () => void; onHome: () => void; onAgain?: () => void; onSelect?: () => void }) {
  return <main className="growth-reward page-enter">
    <div className="growth-reward-companion"><Mascot character={companionFor(session?.id ?? 'reward', 19)} /></div>
    <h1>这一轮完成啦！</h1><p className="growth-reward-subtitle">这一轮完成了 {session?.completedWordIds.length ?? 0} 个词的练习</p>
    {growth ? <section className="growth-reward-card" aria-label="本次成长记录"><div className="growth-checkin"><span aria-hidden="true">✓</span><div><strong>{growth.todayCheckedIn ? '今天已打卡' : '本轮练习已保存'}</strong><small>累计学习 {growth.totalDays} 天{growth.currentStreak > 1 ? ` · 连续 ${growth.currentStreak} 天` : ''}</small></div></div><GrowthStats growth={growth} /><p>练习过的词，和家长测过后再点亮实力奖章。</p></section> : <p role="status">成长记录暂未载入，请重新连接本机服务。</p>}
    <div className="growth-reward-actions">
      {onAgain && <button className="growth-primary" onClick={onAgain}>▷ 再练一轮 <span aria-hidden="true">→</span></button>}
      {onSelect && <button className="growth-secondary" onClick={onSelect}>自己选词 <span aria-hidden="true">→</span></button>}
      <button className="growth-secondary" onClick={onTest}>挑战本轮 <span aria-hidden="true">→</span></button>
      <button className="growth-home" onClick={onGrowth}>♧ 看看我的奖章</button>
      <button className="growth-home" onClick={onHome}>⌂ 返回大厅</button>
    </div>
  </main>;
}

type GrowthModule = 'overview' | 'calendar' | 'skills' | 'words';
const growthModules: { id: GrowthModule; title: string; path: string }[] = [
  { id: 'overview', title: '奖章与词汇', path: 'm8 3 4 3 4-3 1 8-5 4-5-4Z M9 15l-2 6 5-2 5 2-2-6' },
  { id: 'calendar', title: '学习打卡', path: 'M5 5h14v15H5Z M8 3v4m8-4v4M5 10h14m-11 5 3 3 5-5' },
  { id: 'skills', title: '能力进展', path: 'M5 20v-6h3v6m3 0V9h3v11m3 0V4h3v16' },
  { id: 'words', title: '单词记录', path: 'M12 5v15m0-15C8 2 4 3 3 4v14c4-2 7-1 9 2m0-15c4-3 8-2 9-1v14c-4-2-7-1-9 2' },
];

function GrowthCalendar({ growth }: { growth: GrowthSummary }) {
  const today = assessmentDay(new Date(growth.asOf)), daySet = new Set(growth.days);
  const start = shiftGrowthDay(today, -34), weekday = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  return <div className="growth-module-content growth-calendar-module">
    <div className="growth-stats"><div><strong>{growth.totalDays}<small>天</small></strong><span>累计学习</span></div><div><strong>{growth.currentStreak}<small>天</small></strong><span>当前连续</span></div><div><strong>{growth.longestStreak}<small>天</small></strong><span>最长连续</span></div></div>
    <section className="growth-panel growth-calendar" aria-labelledby="growth-calendar-title">
      <div className="growth-section-heading"><h1 id="growth-calendar-title">我的学习足迹</h1><span className={growth.todayCheckedIn ? 'growth-today-done' : ''}>{growth.todayCheckedIn ? '✓ 今天已打卡' : '今天还没开始'}</span></div>
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
    <h1 id="growth-skills-title">我已经能做到</h1>
    <p className="growth-panel-caption">看、读、双向翻译，各自留下真实记录。</p>
    <div className="growth-skill-counts">{Object.entries(growth.skills).map(([dimension, value]) => <div key={dimension}><span>{assessmentLabels[dimension as keyof typeof assessmentLabels]}</span><strong>{value}<small>词</small></strong></div>)}</div>
    <p className="growth-evidence-note">{growth.stableWords} 个词已在不同日期通过四项测试 · {growth.dueWords} 个词到期待复测</p>
    <button className="growth-secondary" onClick={onTest}>挑战测试 →</button>
    <details className="growth-explanation"><summary>怎样才算“会了”？</summary><p>看英文认意思、独立朗读、英译中、中译英四项的最近完整测试都独立答对，才算一个会的词。口头三项由家长听后确认，看词选图由系统核对；跟读、提示、跳过和打卡不计入。</p><p>按词表中所学的义项判断，相同英文合并计一次，不表示已经懂得所有词义。到期表示该复测，并不自动判定忘记；新测试未通过或改过词义后，会词数量和实力奖章会相应更新。</p></details>
  </section>;
}

function GrowthWords({ growth }: { growth: GrowthSummary }) {
  const [filter, setFilter] = useState<'verified' | 'practiced' | 'due'>('verified');
  const [query, setQuery] = useState('');
  const shown = growth.words.filter(word => (filter === 'practiced' || (filter === 'verified' ? word.verified : word.dimensions.some(item => item.dueAt && Date.parse(item.dueAt) <= Date.parse(growth.asOf)))) && `${word.term} ${word.meaning}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="growth-panel" aria-labelledby="growth-words-title">
    <div className="growth-section-heading"><h1 id="growth-words-title">我的单词记录</h1><span>按所学义项查看</span></div>
    <div className="growth-word-filters" role="group" aria-label="筛选单词记录">{([{ id: 'verified', label: `会的词 ${growth.verifiedWords}` }, { id: 'practiced', label: `练过的词 ${growth.practicedWords}` }, { id: 'due', label: `待复测 ${growth.dueWords}` }] as const).map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
    <label className="growth-search">查找单词<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="英文或中文" /></label>
    <div className="growth-word-list">{shown.map(word => <article key={word.wordId}><div><strong>{word.term}</strong><span>{word.meaning}</span><small>{word.stable ? '跨天四项都通过' : word.verified ? '四项都通过' : '还在练习中'}</small></div><div className="growth-word-skills">{word.dimensions.map(item => <span key={item.dimension} className={item.passed ? 'is-passed' : ''} title={`${assessmentLabels[item.dimension]}：${item.result ? assessmentResultLabels[item.result] : '待测试'}`}>{item.passed ? '✓' : '○'} {assessmentLabels[item.dimension]}</span>)}</div></article>)}</div>
    {!shown.length && <p className="growth-empty">{query ? '没有找到这个单词。' : filter === 'verified' ? '还没有四项都通过的单词。练习之后，和家长一起测一测吧。' : filter === 'due' ? '现在没有到期待复测的单词。' : '开始第一次学习，就会留下你的足迹。'}</p>}
  </section>;
}

export function ChildGrowth({ growth, onBack, onTest }: { growth?: GrowthSummary; onBack: () => void; onTest: () => void }) {
  const [module, setModule] = useState<GrowthModule>('overview');
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [module]);
  if (!growth) return <main className="growth-page"><button onClick={onBack}>← 回首页</button><h1>我的成长</h1><p role="status">成长记录尚未载入，请重新连接本机服务。</p></main>;
  const next = growth.rank.nextTarget;
  return <main className="growth-page page-enter" data-growth-module={module}>
    <nav className="growth-nav"><button onClick={module === 'overview' ? onBack : () => setModule('overview')}>{module === 'overview' ? '← 回首页' : '← 成长首页'}</button><strong>{module === 'overview' ? '我的成长' : growthModules.find(item => item.id === module)!.title}</strong><span aria-hidden="true">✦</span></nav>
    <nav className="growth-module-nav" aria-label="成长模块">{growthModules.map(item => <button key={item.id} aria-current={module === item.id ? 'page' : undefined} onClick={() => setModule(item.id)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg><span>{item.title}</span></button>)}</nav>
    {module === 'overview' && <>
      <section className="growth-hero" aria-labelledby="growth-title"><Medal locked={!growth.verifiedWords} /><div><span>我的词汇实力</span><h1 id="growth-title">{growth.rank.title}</h1><p>{next ? `再有 ${Math.max(0, next - growth.verifiedWords)} 个词四项都通过，点亮下一枚实力奖章` : '已经点亮全部实力奖章，继续认识新单词吧'}</p></div></section>
      <section className="growth-vocabulary growth-panel" aria-labelledby="growth-vocabulary-title"><h2 id="growth-vocabulary-title">当前词汇量</h2><div className="growth-vocabulary-counts"><div><span>会的单词</span><strong>{growth.verifiedWords}<small>词</small></strong></div><div><span>已经练习过</span><strong>{growth.practicedWords}<small>词</small></strong></div></div><p>四项独立测试都通过，才计入会的单词。</p></section>
      <BadgeCollection growth={growth} />
    </>}
    {module === 'calendar' && <GrowthCalendar growth={growth} />}
    {module === 'skills' && <GrowthSkills growth={growth} onTest={onTest} />}
    {module === 'words' && <GrowthWords growth={growth} />}
  </main>;
}
