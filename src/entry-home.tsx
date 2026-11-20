import type { CSSProperties } from 'react';
import { visualTheme } from '../shared/visual-theme';
import { companionIds } from '../shared/companions';
import { Medal } from './child-growth';

export function EntryHome({ busy, openParent, openCompanions, openGrowth, begin, review, unlockedCount = 2 }: { busy: boolean; openParent: () => void; openCompanions: () => void; openGrowth?: () => void; begin: () => void; review: () => void; unlockedCount?: number }) {
  const { optimus, megatron } = visualTheme.characters;
  return <main className="entry-home page-enter" style={{ '--entry-base-scene': `url("${visualTheme.homeDesktop}")` } as CSSProperties}>
    <div className="entry-hall">
      <header className="entry-hall-header">
        <h1 className="entry-hall-brand"><img src={visualTheme.brandIcon} width="36" height="36" alt="" draggable={false} /><span>单词游乐园</span></h1>
        <button type="button" className="entry-hall-parent" onClick={openParent} aria-label="家长入口">家长空间</button>
      </header>
      <section className="entry-hall-welcome" aria-labelledby="entry-hall-greeting">
        <h2 id="entry-hall-greeting">今天学什么？</h2>
      </section>
      <nav className={`entry-hall-modules${openGrowth ? '' : ' entry-hall-without-growth'}`} aria-label="学习与成长入口" aria-busy={busy}>
        <button type="button" className="entry-hall-module entry-hall-learn" disabled={busy} onClick={begin} aria-label="进入学习，学习新词">
          <span className="entry-hall-title">学习新词</span><span className="entry-hall-description">认识单词，学会怎么用</span>
          <img className="entry-hall-character" src={optimus.image} alt="" draggable={false} decoding="async" />
          <span className="entry-hall-go">进入学习<span aria-hidden="true">→</span></span>
        </button>
        <button type="button" className="entry-hall-module entry-hall-review" disabled={busy} onClick={review} aria-label="进入复习，复习已经学过的词">
          <span className="entry-hall-title">复习老朋友</span><span className="entry-hall-description">把学过的词再想一想</span>
          <img className="entry-hall-character" src={megatron.image} alt="" draggable={false} decoding="async" />
          <span className="entry-hall-go">进入复习<span aria-hidden="true">→</span></span>
        </button>
        <div className="entry-hall-small-modules">
          <button type="button" className="entry-hall-module entry-hall-companions" onClick={openCompanions} aria-label={`打开伙伴图鉴，已解锁${unlockedCount}位伙伴`}>
            <span className="entry-hall-portraits" aria-hidden="true"><span><img src={optimus.image} alt="" draggable={false} /></span><span><img src={megatron.image} alt="" draggable={false} /></span></span>
            <span className="entry-hall-caption"><strong>伙伴图鉴</strong><small>{unlockedCount} / {companionIds.length} 位伙伴</small></span><span className="entry-hall-small-arrow" aria-hidden="true">→</span>
          </button>
          {openGrowth && <button type="button" className="entry-hall-module entry-hall-growth" onClick={openGrowth} aria-label="打开我的成长和奖章">
            <span className="entry-hall-medal" aria-hidden="true"><Medal /></span>
            <span className="entry-hall-caption"><strong>我的成长</strong><small>奖章与学习记录</small></span><span className="entry-hall-small-arrow" aria-hidden="true">→</span>
          </button>}
        </div>
      </nav>
    </div>
  </main>;
}
