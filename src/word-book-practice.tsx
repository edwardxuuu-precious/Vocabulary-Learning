import type { AppState, LearningStartRequest } from '../shared/contracts';
import { packPracticeOptions } from '../shared/pack-practice';
import { Mascot } from './mascot';

export function WordBookPractice({state, busy, onStart, onBack, onSelect}: {
  state:AppState; busy:boolean; onStart:(request:LearningStartRequest)=>void; onBack:()=>void; onSelect:()=>void;
}) {
  const books = packPracticeOptions(state);
  return <main className="learning-hub word-picker book-practice page-enter">
    <nav className="hub-nav" aria-label="词表练习导航"><button onClick={onBack}><span aria-hidden="true">←</span>回大厅</button></nav>
    <header className="hub-heading"><h1>选一本，来复习</h1><Mascot small/></header>
    <p className="book-practice-intro">接触过的词直接复习，新词先认识。想重新听讲解，可以自己选词“从头学”。</p>
    <div className="book-practice-grid">{books.map(({pack,words,total,learned,resume,segment,request})=><section className="book-practice-card" key={pack.id} aria-label={`${pack.title}词表练习`}>
      <div className="book-practice-heading"><span className="book-practice-symbol" aria-hidden="true">▤</span><div><h2>{pack.title}</h2><p>{total} 个词{words.length<total?` · ${words.length} 个已备好`:''}</p></div></div>
      <div className="book-practice-pictures" aria-hidden="true">{words.slice(0,3).map(word=><span key={word.id}><img src={word.imageUrl} alt=""/></span>)}</div>
      {resume?<div className="book-practice-status"><strong>进度已保存</strong><p>本轮 {resume.wordIds.length} 词 · {segment?`本小段 ${segment.completed}/${segment.total} 小任务`:`已练完 ${resume.completedWordIds.length} 词`}</p></div>
        :<div className="book-practice-status"><strong>{words.length} 个词一起复习</strong><p>{learned?`接触过 ${learned} 词，直接练习；新词先认识。`:'新词先认识，再一起复习。'}</p></div>}
      {words.length<total&&<p className="book-practice-pending">{total-words.length} 个词还需家长准备，本轮先复习已备好的词。</p>}
      <button className="hub-start" disabled={busy||!words.length} aria-label={resume?`继续整本复习：${pack.title}`:`整本复习：${pack.title}，${words.length}词`} onClick={()=>onStart(request)}><span aria-hidden="true">▶</span>{busy?'准备中…':resume?'继续复习':'开始复习'}<span aria-hidden="true">→</span></button>
    </section>)}</div>
    {!books.length&&<section className="book-practice-empty"><h2>先请家长准备一本词表</h2><p>交给孩子学习后，就能在这里整本练习。</p></section>}
    <footer className="book-practice-footer"><button className="hub-text-button" disabled={busy} onClick={onSelect}>也可以自己挑几个词 <span aria-hidden="true">→</span></button></footer>
  </main>;
}
