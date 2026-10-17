import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { BadgeMetric, GrowthBadge, GrowthSummary } from '../shared/contracts';
import { badgeSeries, nextBadges } from '../shared/badge-catalog';
import './badge-collection.css';

const frames = {
  round: 'M48 5a41 41 0 1 1 0 82 41 41 0 0 1 0-82Z',
  shield: 'M48 5 84 18v28c0 24-20 40-36 48C32 86 12 70 12 46V18Z',
  hexagon: 'M48 4 86 25v44L48 93 10 69V25Z',
  flower: 'm48 4 11 8 15-2 4 15 13 9-7 14 5 16-14 9-5 15-16-3-12 11-12-12-16 1-1-16L3 57l7-14-4-15 15-7 6-14 14 4Z',
};

export function BadgeArt({ badge }: { badge: GrowthBadge }) {
  return <span className={`badge-art ${badge.unlocked ? 'is-earned' : 'is-locked'}`} style={{ '--badge-color': badge.color } as CSSProperties} aria-hidden="true">
    <svg className="badge-art-frame" viewBox="0 0 96 100"><path d={frames[badge.frame]} className="badge-art-body" /><path d={frames[badge.frame]} className="badge-art-inset" transform="translate(48 48) scale(.83) translate(-48 -48)" /></svg>
    <span className="badge-art-symbol">{badge.icon}</span>
    <span className="badge-art-status">{badge.unlocked ? <svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg> : <svg viewBox="0 0 20 20"><rect x="5" y="8" width="10" height="9" rx="2" /><path d="M7 8V5a3 3 0 0 1 6 0v3" /></svg>}</span>
  </span>;
}

export function badgeRemaining(badge: GrowthBadge) {
  if (badge.unlocked) return '已经获得';
  if (badge.series === 'days') return `再学习 ${badge.remaining} 天`;
  if (badge.series === 'practicedWords') return `再练习 ${badge.remaining} 个不同的词`;
  if (badge.series === 'verifiedWords') return `再有 ${badge.remaining} 个词四项独立通过`;
  if (badge.series === 'stableWords') return `再有 ${badge.remaining} 个词跨天四项通过`;
  return `再有 ${badge.remaining} 个词通过${badge.seriesTitle}`;
}

function BadgeProgress({ badge, showLabel = true }: { badge: GrowthBadge; showLabel?: boolean }) {
  return <><div className="badge-progress" role="progressbar" aria-label={`${badge.title}进度`} aria-valuemin={0} aria-valuemax={badge.target} aria-valuenow={badge.unlocked ? badge.target : badge.progress}><span style={{ width: `${badge.unlocked ? 100 : 100 * badge.progress / badge.target}%` }} /></div>{showLabel && <span className="badge-progress-label">{badge.unlocked ? '✓ 已获得' : `${badge.progress} / ${badge.target} ${badge.unit} · 还差 ${badge.remaining} ${badge.unit}`}</span>}</>;
}

export function BadgeCollection({ growth }: { growth: GrowthSummary }) {
  const [view, setView] = useState<'earned' | 'next' | 'all'>('earned');
  const [series, setSeries] = useState<BadgeMetric | 'all'>('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<GrowthBadge>();
  const focusedCard = useRef<HTMLButtonElement | null>(null);
  const controls = useRef<HTMLDivElement | null>(null);
  const firstBrowse = useRef(true);
  useEffect(() => { if (firstBrowse.current) { firstBrowse.current = false; return; } controls.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, [view, series, page]);
  const close = () => { setSelected(undefined); focusedCard.current?.focus(); };
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', listener); return () => { window.removeEventListener('keydown', listener); document.body.style.overflow = previousOverflow; };
  }, [selected]);
  // An old local server may still be serving the previous response until it restarts.
  if (growth.badges.some(badge => !badge.serial)) return <section className="growth-panel"><h2>我的奖章</h2><p role="status">奖章册正在更新，请刷新页面重新连接本机服务。</p></section>;
  const earned = growth.badges.filter(badge => badge.unlocked);
  const upcoming = nextBadges(growth.badges).sort((a, b) => b.progress / b.target - a.progress / a.target);
  const nearest = upcoming[0];
  const candidates = view === 'earned' ? earned : view === 'next' ? upcoming : growth.badges;
  const shown = candidates.filter(badge => series === 'all' || badge.series === series);
  const pages = Math.max(1, Math.ceil(shown.length / 12)), activePage = Math.min(page, pages - 1);
  const selectBadge = (badge: GrowthBadge, button: HTMLButtonElement) => { focusedCard.current = button; setSelected(badge); };
  return <section className="growth-panel badge-collection" aria-labelledby="growth-badges-title">
    <div className="growth-section-heading"><h2 id="growth-badges-title">我的奖章册</h2><span><b>{earned.length}</b> 枚已获得</span></div>
    <p className="growth-panel-caption">已获得的奖章永久保留。点开查看获得条件。</p>
    {nearest ? <button className="badge-next" onClick={event => selectBadge(nearest, event.currentTarget)} aria-label={`下一枚奖章：${nearest.title}，${badgeRemaining(nearest)}`}><BadgeArt badge={nearest} /><span className="badge-next-copy"><small>下一枚目标</small><strong>{nearest.title}</strong><span>{badgeRemaining(nearest)}</span><BadgeProgress badge={nearest} showLabel={false} /></span><span aria-hidden="true">→</span></button> : <p className="badge-all-earned">全部奖章都已获得！你的探险足迹已经满满一册。</p>}
    <div className="badge-browse-controls" ref={controls}><div className="badge-view-tabs" role="group" aria-label="奖章范围">{([{ id: 'earned', label: `已获得 ${earned.length}` }, { id: 'next', label: `下一目标 ${upcoming.length}` }, { id: 'all', label: `全部 ${growth.badges.length}` }] as const).map(item => <button key={item.id} aria-pressed={view === item.id} onClick={() => { setView(item.id); setPage(0); }}>{item.label}</button>)}</div><label className="badge-series-label">系列<select aria-label="奖章系列" value={series} onChange={event => { setSeries(event.target.value as BadgeMetric | 'all'); setPage(0); }}><option value="all">全部系列</option>{badgeSeries.map(item => <option key={item.metric} value={item.metric}>{item.title}</option>)}</select></label></div>
    <div className="badge-card-grid">{shown.slice(activePage * 12, (activePage + 1) * 12).map(badge => <article key={badge.id} className={`badge-card ${badge.unlocked ? 'is-earned' : 'is-locked'}`} data-badge-id={badge.id} style={{ '--badge-color': badge.color } as CSSProperties}><button onClick={event => selectBadge(badge, event.currentTarget)} aria-label={`${badge.title}，${badge.unlocked ? '已获得' : `还差${badge.remaining}${badge.unit}`}`}><BadgeArt badge={badge} /><h3>{badge.title}</h3><span className="badge-card-series">{badge.seriesTitle}</span>{badge.unlocked ? <span className="badge-earned-label">✓ 已获得</span> : <><BadgeProgress badge={badge} showLabel={false} /><span className="badge-card-remaining">{badgeRemaining(badge)}</span></>}{badge.incentive && <span className="badge-incentive">家长奖励：{badge.incentive}</span>}</button></article>)}</div>
    {!shown.length && <div className="badge-empty"><span aria-hidden="true">🌱</span><p>{view === 'earned' ? '这个系列还没有获得的奖章。下一份努力，就离它更近一步。' : '这个范围暂时没有奖章。'}</p><button onClick={() => { setView('next'); setSeries('all'); setPage(0); }}>看看下一目标 →</button></div>}
    {pages > 1 && <nav className="badge-pagination" aria-label="奖章分页"><button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>← 上一页</button><span>{activePage + 1} / {pages}</span><button disabled={activePage === pages - 1} onClick={() => setPage(activePage + 1)}>下一页 →</button></nav>}
    {selected && createPortal(<div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}><section className="modal badge-detail" role="dialog" aria-modal="true" aria-labelledby="badge-detail-title"><button className="badge-detail-close" aria-label="关闭奖章详情" autoFocus onClick={close}>×</button><BadgeArt badge={selected} /><span className="badge-detail-serial">{selected.serial} · {selected.seriesTitle}</span><h2 id="badge-detail-title">{selected.title}</h2><p>{selected.description}</p><BadgeProgress badge={selected} /><strong className="badge-detail-goal">{badgeRemaining(selected)}</strong>{selected.recordedAt && <small>记录于 {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(selected.recordedAt))}</small>}<div className="badge-detail-incentive"><strong>这枚奖章的家长奖励</strong><p>{selected.incentive ?? '家长还没有设置这枚奖章的奖励。'}</p></div><button className="growth-secondary" onClick={close}>记住目标，继续探险</button></section></div>, document.body)}
  </section>;
}
