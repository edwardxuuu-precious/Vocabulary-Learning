import { BackButton, PageHeading } from './ui-layout';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { companionBiographies, companionCharacters, companionIds, type CompanionCharacter } from '../shared/companions';
import { companionAnimationRemaining, companionUnlockSummary, type CompanionUnlockSummary } from '../shared/companion-unlocks';
import { companionVideos } from '../shared/companion-videos';
import { CompanionAnimation } from './companion-animation';
import './companion-library.css';

type FactionFilter = 'all' | 'autobot' | 'decepticon';
const filters: { id: FactionFilter; label: string }[] = [{ id: 'all', label: '全部' }, { id: 'autobot', label: '汽车人' }, { id: 'decepticon', label: '霸天虎' }];

function CompanionArrow({ direction = 'right' }: { direction?: 'left' | 'right' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'M19 12H5m6-6-6 6 6 6' : 'M5 12h14m-6-6 6 6-6 6'} /></svg>;
}

function CompanionLock() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>;
}

export function CompanionLibrary({ onBack, progress = companionUnlockSummary() }: { onBack: () => void; progress?: CompanionUnlockSummary }) {
  const [selected, setSelected] = useState<CompanionCharacter | null>(null);
  const [faction, setFaction] = useState<FactionFilter>('all');
  const [page, setPage] = useState(0);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const fullscreenExitedAt = useRef(-Infinity);
  const animationIds = (progress.animationUnlockedIds ?? []).filter(id => companionAnimationRemaining(progress, id) === 0);
  const next = progress.nextReward;
  const nextName = next ? companionCharacters[next.companionId].name : '';
  const orderedIds = [...progress.unlockedIds, ...companionIds.filter(id => !progress.unlockedIds.includes(id))];
  const visibleIds = orderedIds.filter(id => faction === 'all' || companionCharacters[id].faction === faction);
  const pageSize = 20, pageCount = Math.ceil(visibleIds.length / pageSize);
  const pageIds = visibleIds.slice(page * pageSize, (page + 1) * pageSize);
  const availableIds = visibleIds.filter(id => progress.unlockedIds.includes(id));
  const move = (offset: number) => setSelected(current => current && availableIds.length ? availableIds[(availableIds.indexOf(current) + offset + availableIds.length) % availableIds.length] : null);
  // Profile changes or a refreshed state cannot leave an inaccessible portrait open.
  useEffect(() => { if (selected && !progress.unlockedIds.includes(selected)) setSelected(null); }, [selected, progress.unlockedIds]);
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const fullscreenChanged = () => { if (!document.fullscreenElement) fullscreenExitedAt.current = performance.now(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // Browsers may exit native fullscreen before dispatching its Escape to this document.
      if (document.fullscreenElement || performance.now() - fullscreenExitedAt.current < 350) return;
      if (event.key === 'Escape') setSelected(null);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    document.addEventListener('fullscreenchange', fullscreenChanged);
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('fullscreenchange', fullscreenChanged); document.removeEventListener('keydown', keyboard); opener.current?.focus(); };
  }, [Boolean(selected), faction, progress.unlockedIds.join(',')]);
  const accessible = selected && progress.unlockedIds.includes(selected) ? selected : null;
  const character = accessible ? companionCharacters[accessible] : null;
  const biography = accessible ? companionBiographies[accessible] : '';
  const video = accessible ? companionVideos[accessible] : null;
  const introductionEnd = biography.indexOf('。') + 1;

  return <>
    <main className="companion-library page-enter" inert={selected !== null}>
      <nav className="companion-library-nav" aria-label="图鉴导航"><BackButton onClick={onBack} label="回到单词游乐园首页">回首页</BackButton></nav>
      <PageHeading title="伙伴图鉴" description={`已解锁 ${progress.unlockedIds.length} / ${companionIds.length} 位伙伴 · 动画 ${animationIds.length} / ${companionIds.length}`}/>
      <section className="companion-unlock-progress" aria-label="伙伴解锁进度">
        <div className="companion-unlock-heading"><CompanionLock/><div><h2>{progress.allUnlocked ? '人物和动画都解锁啦！' : next?.kind === 'animation' ? `解锁${nextName}的动画` : '认识下一位伙伴'}</h2><p>{progress.allUnlocked ? '所有伙伴的图片、故事和动画都可以看了。' : progress.newWords < 20 ? '每新学会10个词，解锁一段领袖动画。' : '新学会10词开人物，再学10词开它的动画，然后认识下一位。'}</p></div></div>
        {!progress.allUnlocked && next && <div className="companion-credit-track companion-cycle-track"><div><strong>{next.kind === 'character' ? `${nextName}的图片和故事` : `${nextName}的动画`}</strong><span>{next.progress} / {next.progress + next.remaining} 词</span></div><progress max={next.progress + next.remaining} value={next.progress} aria-label={next.kind === 'character' ? '人物解锁进度' : '动画解锁进度'}/><small>累计新学会 {progress.newWords} 词 · 再学会 {next.remaining} 词{next.kind === 'character' ? '认识这位新伙伴' : '看它的动画'}</small></div>}
        <details className="companion-credit-rules"><summary>怎样算进度</summary><p>只累计新学会的不同英文。擎天柱、威震天的图片和故事默认可看，动画分别在累计10词、20词时解锁。同时，10词解锁大黄蜂的图片和故事，20词解锁它的动画，30词、40词再解锁下一位的图文和动画，随后循环。新词仍以四项正式测试均独立通过为准，口头回答由家长核验；同词跨书只计一次，复习不推进这个循环，已经学会词数获得的奖励永久保留。</p></details>
      </section>
      <div className="companion-filters" role="group" aria-label="伙伴阵营">{filters.map(item => <button key={item.id} aria-pressed={faction === item.id} onClick={() => { setFaction(item.id); setPage(0); }}>{item.label}<span>{companionIds.filter(id => item.id === 'all' || companionCharacters[id].faction === item.id).length}</span></button>)}</div>
      <div className="companion-grid" aria-label={filters.find(item => item.id === faction)!.label + '伙伴'}>{pageIds.map((id, index) => {
        const entry = companionCharacters[id];
        const unlocked = progress.unlockedIds.includes(id);
        return <button className={'companion-card faction-' + entry.faction + (unlocked ? '' : ' companion-card-locked')} key={id} aria-label={unlocked ? '认识' + entry.name : '神秘伙伴，待解锁'} aria-disabled={!unlocked} aria-haspopup={unlocked ? 'dialog' : undefined} onClick={event => { if (!unlocked) return; opener.current = event.currentTarget; setSelected(id); }}>
          <span className="companion-card-art"><img src={entry.image} alt="" loading={index < 5 ? 'eager' : 'lazy'} decoding="async" draggable={false} /></span>
          <span className="companion-card-name"><strong>{unlocked ? entry.name : '待解锁'}</strong>{unlocked ? <CompanionArrow /> : <CompanionLock />}</span>
          {unlocked && <small className="companion-animation-badge">{animationIds.includes(id) ? '动画已解锁' : '动画待解锁'}</small>}
        </button>;
      })}</div>
      {pageCount > 1 && <nav className="companion-pages" aria-label="图鉴翻页"><button disabled={page === 0} onClick={() => setPage(current => current - 1)}><CompanionArrow direction="left"/>上一页</button><span aria-live="polite">{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(current => current + 1)}>下一页<CompanionArrow/></button></nav>}
    </main>
    {character && createPortal(<div className="companion-backdrop" onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}><section className={'companion-portrait faction-' + character.faction} role="dialog" aria-modal="true" aria-labelledby="companion-name" aria-describedby="companion-introduction" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], summary, iframe, [tabindex="0"]')).filter(item => !item.matches(':disabled'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <button ref={close} className="companion-close" aria-label="回到伙伴图鉴" onClick={() => setSelected(null)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      <div className="companion-portrait-content" key={selected} tabIndex={0} role="region" aria-label={character.name + '的图片与简介'}>
        <div className="companion-portrait-stage"><img src={character.image} alt={character.name} draggable={false} /></div>
        <div className="companion-profile">
          <span className="companion-faction">{character.faction === 'autobot' ? '汽车人' : '霸天虎'}</span>
          <h2 id="companion-name">{character.name}</h2>
          <p className="companion-english-name">{character.englishName}</p>
          <p className="companion-introduction" id="companion-introduction">{biography.slice(0, introductionEnd)}</p>
          <details className="companion-more"><summary>它的故事</summary><p className="companion-biography" id="companion-biography">{biography.slice(introductionEnd)}</p></details>
        </div>
        {video && <CompanionAnimation key={accessible} name={character.name} video={video} unlocked={animationIds.includes(accessible!)} remaining={companionAnimationRemaining(progress, accessible!)}/>}
      </div>
      <nav className="companion-portrait-nav" aria-label="切换伙伴"><button aria-label="上一位伙伴" disabled={availableIds.length < 2} onClick={() => move(-1)}><CompanionArrow direction="left" />上一位</button><span aria-live="polite" aria-atomic="true">{availableIds.indexOf(selected!) + 1} / {availableIds.length}</span><button aria-label="下一位伙伴" disabled={availableIds.length < 2} onClick={() => move(1)}>下一位<CompanionArrow /></button></nav>
    </section></div>, document.body)}
  </>;
}
