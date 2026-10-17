import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { companionBiographies, companionCharacters, companionIds, type CompanionCharacter } from '../shared/companions';
import { Mascot } from './mascot';
import './companion-library.css';

type FactionFilter = 'all' | 'autobot' | 'decepticon';
const filters: { id: FactionFilter; label: string }[] = [{ id: 'all', label: '全部' }, { id: 'autobot', label: '汽车人' }, { id: 'decepticon', label: '霸天虎' }];

function CompanionArrow({ direction = 'right' }: { direction?: 'left' | 'right' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'M19 12H5m6-6-6 6 6 6' : 'M5 12h14m-6-6 6 6-6 6'} /></svg>;
}

export function CompanionLibrary({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<CompanionCharacter | null>(null);
  const [faction, setFaction] = useState<FactionFilter>('all');
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const visibleIds = companionIds.filter(id => faction === 'all' || companionCharacters[id].faction === faction);
  const move = (offset: number) => setSelected(current => current ? visibleIds[(visibleIds.indexOf(current) + offset + visibleIds.length) % visibleIds.length] : null);
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') setSelected(null);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keyboard); opener.current?.focus(); };
  }, [Boolean(selected), faction]);
  const character = selected ? companionCharacters[selected] : null;
  const biography = selected ? companionBiographies[selected] : '';
  const introductionEnd = biography.indexOf('。') + 1;

  return <>
    <main className="companion-library page-enter" inert={selected !== null}>
      <nav className="companion-library-nav" aria-label="图鉴导航"><button onClick={onBack} aria-label="回到单词游乐园首页"><CompanionArrow direction="left" />回首页</button></nav>
      <header className="companion-library-header"><h1>伙伴图鉴</h1><Mascot small /></header>
      <div className="companion-filters" role="group" aria-label="伙伴阵营">{filters.map(item => <button key={item.id} aria-pressed={faction === item.id} onClick={() => setFaction(item.id)}>{item.label}<span>{companionIds.filter(id => item.id === 'all' || companionCharacters[id].faction === item.id).length}</span></button>)}</div>
      <div className="companion-grid" aria-label={filters.find(item => item.id === faction)!.label + '伙伴'}>{visibleIds.map((id, index) => {
        const entry = companionCharacters[id];
        return <button className={'companion-card faction-' + entry.faction} key={id} aria-label={'认识' + entry.name} aria-haspopup="dialog" onClick={event => { opener.current = event.currentTarget; setSelected(id); }}>
          <span className="companion-card-art"><img src={entry.image} alt="" loading={index < 5 ? 'eager' : 'lazy'} decoding="async" draggable={false} /></span>
          <span className="companion-card-name"><strong>{entry.name}</strong><CompanionArrow /></span>
        </button>;
      })}</div>
    </main>
    {character && createPortal(<div className="companion-backdrop" onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}><section className={'companion-portrait faction-' + character.faction} role="dialog" aria-modal="true" aria-labelledby="companion-name" aria-describedby="companion-introduction companion-biography" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, [tabindex="0"]'));
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
          <p className="companion-biography" id="companion-biography">{biography.slice(introductionEnd)}</p>
        </div>
      </div>
      <nav className="companion-portrait-nav" aria-label="切换伙伴"><button aria-label="上一位伙伴" onClick={() => move(-1)}><CompanionArrow direction="left" />上一位</button><span aria-live="polite" aria-atomic="true">{visibleIds.indexOf(selected!) + 1} / {visibleIds.length}</span><button aria-label="下一位伙伴" onClick={() => move(1)}>下一位<CompanionArrow /></button></nav>
    </section></div>, document.body)}
  </>;
}
