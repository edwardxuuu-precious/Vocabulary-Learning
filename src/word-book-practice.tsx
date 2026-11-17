import type { AppState, LearningStartRequest } from '../shared/contracts';
import { packPracticeOptions } from '../shared/pack-practice';
import { Mascot } from './mascot';

export function WordBookPractice({state, busy, onStart, onBack, onSelect,onLearn}: {
  state:AppState; busy:boolean; onStart:(request:LearningStartRequest)=>void; onBack:()=>void; onSelect:()=>void;onLearn?:(packId:string)=>void;
}) {
  const books = packPracticeOptions(state);
  return <main className="learning-hub word-picker book-practice page-enter">
    <nav className="hub-nav" aria-label="词表练习导航"><button onClick={onBack}><span aria-hidden="true">←</span>回复习</button></nav>
    <header className="hub-heading"><h1>选一本，来复习</h1><Mascot small/></header>
    <p className="book-practice-intro">这里只复习已经认识的词。还没认识的新朋友，可以去学习。</p>
    <div className="book-practice-grid">{books.map(({pack,words,total,ready,unlearned,scopeChanged,resume,segment,request})=><section className="book-practice-card" key={pack.id} aria-label={`${pack.title}词表练习`}>
      <div className="book-practice-heading"><span className="book-practice-symbol" aria-hidden="true">▤</span><div><h2>{pack.title}</h2><p>{total} 个词 · 已学 {words.length} 个 · 未学 {unlearned} 个</p></div></div>
      <div className="book-practice-pictures" aria-hidden="true">{(resume?resume.wordIds.map(id=>state.words.find(word=>word.id===id)).filter((word):word is AppState['words'][number]=>!!word):words).slice(0,3).map(word=><span key={word.id}><img src={word.imageUrl} alt=""/></span>)}</div>
      {resume?<div className="book-practice-status"><strong>进度已保存</strong><p>本轮 {resume.wordIds.length} 词 · {segment?`本小段 ${segment.completed}/${segment.total} 小任务`:`已练完 ${resume.completedWordIds.length} 词`}</p></div>
        :<div className="book-practice-status"><strong>{words.length?`${words.length} 个已学词一起复习`:'先认识几个新朋友'}</strong><p>{words.length?'这次只练已经认识的当前词义。':'先去学习，认识后再来复习。'}</p></div>}
      {ready<total&&<p className="book-practice-pending">{total-ready} 个词还需家长准备。</p>}
      {scopeChanged&&<p className="book-practice-pending">本轮词义或素材已变化，原进度保留，请家长确认。</p>}
      <button className="hub-start" disabled={busy||scopeChanged||!resume&&!words.length} aria-label={resume?`继续整本复习：${pack.title}`:`整本复习：${pack.title}，${words.length}词`} onClick={()=>onStart(request)}><span aria-hidden="true">▶</span>{busy?'准备中…':resume?'继续复习':'开始复习'}<span aria-hidden="true">→</span></button>
      {!!unlearned&&onLearn&&<button className="hub-text-button" disabled={busy} onClick={()=>onLearn(pack.id)}>去学习这本书的未学词 →</button>}
    </section>)}</div>
    {!books.length&&<section className="book-practice-empty"><h2>先请家长准备一本词表</h2><p>交给孩子学习后，就能在这里整本练习。</p></section>}
    <footer className="book-practice-footer"><button className="hub-text-button" disabled={busy} onClick={onSelect}>也可以自己挑几个词 <span aria-hidden="true">→</span></button></footer>
  </main>;
}
