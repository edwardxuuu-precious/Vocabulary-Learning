import { useEffect, useRef, useState } from 'react';
import { companionBiographies, companionCharacters, companionIds, type CompanionCharacter } from '../shared/companions';
import './companion-library.css';

export function CompanionLibrary({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<CompanionCharacter | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', escape); opener.current?.focus(); };
  }, [Boolean(selected)]);
  const character = selected ? companionCharacters[selected] : null;
  const move = (offset: number) => { if (selected) setSelected(companionIds[(companionIds.indexOf(selected) + offset + companionIds.length) % companionIds.length]); };
  return <main className="companion-library page-enter">
    <header className="companion-library-header"><button onClick={onBack} aria-label="回到单词游乐园首页">⌂</button><div><h1>伙伴图鉴</h1><p>{companionIds.length} 位伙伴，陪你一起冒险</p></div></header>
    <div className="companion-grid">{companionIds.map(id => {
      const entry = companionCharacters[id];
      return <button className="companion-card" key={id} aria-label={`认识${entry.name}`} onClick={event => { opener.current = event.currentTarget; setSelected(id); }}>
        <img src={entry.image} alt={entry.name} loading="lazy" decoding="async" /><strong>{entry.name}</strong><span>{entry.faction === 'autobot' ? '汽车人' : '霸天虎'}</span>
      </button>;
    })}</div>
    {character && <div className="companion-backdrop" onClick={() => setSelected(null)}><section className="companion-portrait" role="dialog" aria-modal="true" aria-labelledby="companion-name" aria-describedby="companion-biography" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <button ref={close} className="companion-close" aria-label="回到伙伴图鉴" onClick={() => setSelected(null)}>×</button>
      <div className="companion-portrait-content" key={selected} tabIndex={0} role="region" aria-label={`${character.name}的图片与简介`}>
        <img src={character.image} alt={character.name} />
        <div className="companion-profile">
          <h2 id="companion-name">{character.name}</h2>
          <p className="companion-english-name">{character.englishName}<span>{character.faction === 'autobot' ? '汽车人' : '霸天虎'}</span></p>
          <p className="companion-biography" id="companion-biography">{companionBiographies[selected!]}</p>
        </div>
      </div>
      <div className="companion-portrait-nav"><button aria-label="上一位伙伴" onClick={() => move(-1)}>←</button><span>{companionIds.indexOf(selected!) + 1} / {companionIds.length}</span><button aria-label="下一位伙伴" onClick={() => move(1)}>→</button></div>
    </section></div>}
  </main>;
}
