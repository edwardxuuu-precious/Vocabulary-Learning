import { visualTheme } from '../shared/visual-theme';
import { Medal } from './child-growth';

export function EntryHome({ busy, openParent, openCompanions, openGrowth, begin }: { busy: boolean; openParent: () => void; openCompanions: () => void; openGrowth?: () => void; begin: () => void }) {
  return <main className="entry-home page-enter">
    <header className="entry-header">
      <h1><span className="entry-insignia" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="m9 8 11-4 11 4 3 13-14 15L6 21Z" fill="currentColor" /><path d="m12 15 6 3v4l-6-2Zm16 0-6 3v4l6-2ZM17 27h6" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" /></svg></span><span>单词游乐园</span></h1>
    </header>
    <section className="entry-playground" aria-label="选择入口">
      <picture className="entry-scene">
        <source media="(max-aspect-ratio: 1/1)" srcSet={visualTheme.homePortrait} width="941" height="1672" />
        <img src={visualTheme.homeDesktop} width="1448" height="1086" alt="Q版擎天柱、大黄蜂和阿尔茜在远处的机甲基地等待出发" draggable={false} fetchPriority="high" decoding="async" />
      </picture>
      <div className="entry-copy">
        <h2>单词冒险<span>现在出发</span></h2>
        <div className="entry-actions">
          <button className="entry-start" disabled={busy} onClick={begin} aria-label="孩子入口，开始玩">
            <span className="entry-play-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24"><path d="m8 4 12 8L8 20Z" fill="currentColor" /></svg></span>
            <span>{busy ? '马上就好…' : '开始玩'}</span>
          </button>
          <button className="entry-parent" onClick={openParent} aria-label="家长入口">
            <span className="entry-parent-icon" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5.65" /></svg></span>
            <span>家长空间</span>
            <svg className="entry-parent-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </button>
        </div>
      </div>
    </section>
    {openGrowth && <button className="entry-growth" onClick={openGrowth} aria-label="打开我的成长和奖章"><Medal />我的成长</button>}
    <button className="entry-companions" onClick={openCompanions} aria-label="打开伙伴图鉴"><span aria-hidden="true">✦</span>伙伴图鉴</button>
  </main>;
}
