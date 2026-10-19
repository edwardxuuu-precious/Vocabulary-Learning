import { useEffect, useState } from 'react';
import type { AppState, GameKind, LearningSession, LearningStartRequest, PackGameCatalogue } from '../shared/contracts';
import { packPracticeOptions } from '../shared/pack-practice';
import { gameDefinition } from '../shared/game-registry';
import { sessionTaskProgress } from './learning-session';
import { api, errorMessage } from './api';
import { Mascot } from './mascot';

function GameTileIcon({kind}:{kind:GameKind|'random'}) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind==='random'?<><rect x="6" y="6" width="20" height="20" rx="5"/><circle cx="11" cy="11" r="1"/><circle cx="21" cy="11" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="11" cy="21" r="1"/><circle cx="21" cy="21" r="1"/></>:kind==='flip'||kind==='repair'?<><rect x="4" y="8" width="13" height="19" rx="3"/><rect x="15" y="4" width="13" height="19" rx="3"/><path d="m20 10 4 3-4 3Z"/></>:kind==='gate'?<><path d="M6 27V14a10 10 0 0 1 20 0v13M3 27h26M12 26V14a4 4 0 0 1 8 0v12"/></>:kind==='supply'?<><path d="M4 11 16 5l12 6-12 6ZM4 11v13l12 6 12-6V11M16 17v13"/></>:kind==='portal'||kind==='missing'?<><circle cx="16" cy="16" r="11"/><path d="M12 12a4 4 0 0 1 8 0c0 3-4 3-4 6m0 4h.01"/></>:<><rect x="5" y="5" width="9" height="9" rx="2"/><rect x="18" y="5" width="9" height="9" rx="2"/><rect x="5" y="18" width="9" height="9" rx="2"/><path d="m20 22 3 3 5-7"/></>}</svg>;
}
const progressText=(session:LearningSession)=>{const p=sessionTaskProgress(session);return `${p?.completed??0}/${p?.total??session.wordIds.length} 小任务`;};

export function WordBookGames({state,busy,onStart,onBack}:{state:AppState;busy:boolean;onStart:(request:LearningStartRequest)=>void;onBack:()=>void}) {
  const books=packPracticeOptions(state);
  const [selected,setSelected]=useState(()=>state.activeSession?.packGame?state.activeSession.practicePackId??'':state.resumableSessions?.find(session=>session.packGame)?.practicePackId??''),[category,setCategory]=useState('all'),[catalogue,setCatalogue]=useState<PackGameCatalogue>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const book=books.find(book=>book.pack.id===selected)??books[0],packId=book?.pack.id;
  const content=book?.words.map(word=>`${word.id}:${word.learningVersion}:${word.assetStatus}`).join('|');
  useEffect(()=>{
    setCatalogue(undefined);setError('');if(!packId)return;
    const abort=new AbortController();
    void api<PackGameCatalogue>(`/api/pack-games?packId=${encodeURIComponent(packId)}`,{signal:abort.signal}).then(setCatalogue).catch(error=>{if(!abort.signal.aborted)setError(errorMessage(error));});
    return()=>abort.abort();
  },[packId,content,state.settings.spellingEnabled,state.settings.familyGamesEnabled,state.settings.contextGamesEnabled,retry]);
  const pending=(state.resumableSessions??(state.activeSession?[state.activeSession]:[])).filter(session=>session.practicePackId===packId&&session.packGame&&!session.completedAt&&!session.suspendedAt);
  const latest=pending[0],randomSaved=pending.find(session=>session.packGame?.selection==='random');
  const start=(game:GameKind|'random')=>{const saved=pending.find(session=>session.packGame?.selection===game);onStart(saved?{mode:'resume',sessionId:saved.id}:{mode:'practice',packId,wordIds:book.words.map(word=>word.id),game,strategy:'classic'});};
  const playable=catalogue?.games.filter(game=>game.wordCount>0)??[],locked=catalogue?.games.filter(game=>!game.wordCount)??[];
  const visible=playable.filter(game=>category==='all'||(category==='listen'?['listen','sound'].includes(game.step):game.step===category));
  return <main className="learning-hub word-picker book-game-lobby page-enter">
    <nav className="hub-nav" aria-label="游戏导航"><button onClick={onBack}><span aria-hidden="true">←</span>回大厅</button></nav>
    <header className="hub-heading"><h1>这次玩什么？</h1><Mascot small/></header>
    <div className="book-game-scope">{books.length>1?<label>词表<select aria-label="游戏词表" disabled={busy} value={packId??''} onChange={event=>{setSelected(event.target.value);setCategory('all');}}>{books.map(book=><option value={book.pack.id} key={book.pack.id}>{book.pack.title} · {book.words.length} 词</option>)}</select></label>:<strong>{book?.pack.title??'还没有可玩的词表'}{book&&<span> · {book.words.length} 个已备好的词</span>}</strong>}<p>选一个玩法，也可以随机玩。离开会保存，下次接着玩。</p></div>
    {!book?<section className="book-practice-empty"><h2>先请家长准备一本词表</h2><p>交给孩子学习后，就能来这里选游戏。</p></section>:<>
      <div className={`book-game-featured${latest&&latest.packGame?.selection!=='random'?' has-resume':''}`}>
        {latest&&latest.packGame?.selection!=='random'&&<section className="book-game-resume"><small>进度已保存</small><h2>{gameDefinition(latest.packGame!.selection)?.title}</h2><p>{progressText(latest)}</p><button className="hub-start" disabled={busy} onClick={()=>onStart({mode:'resume',sessionId:latest.id})}>接着玩 <span aria-hidden="true">→</span></button></section>}
        <section className="book-game-random"><div className="book-game-dice"><GameTileIcon kind="random"/></div><div><h2>随机玩</h2><p>{randomSaved?`进度已保存 · ${progressText(randomSaved)}`:'帮你搭配当前可玩的玩法'}</p><button className="hub-start" disabled={busy||!randomSaved&&!catalogue?.randomWordCount} onClick={()=>start('random')}>{randomSaved?'继续随机游戏':'随机开始'} <span aria-hidden="true">→</span></button></div></section>
      </div>
      {error?<div className="book-game-error" role="alert"><p>{error}</p><button className="hub-outline-button" onClick={()=>setRetry(value=>value+1)}>重新加载玩法</button></div>:!catalogue?<p className="book-game-loading" role="status">正在看看这本词表能玩什么…</p>:<>
        <div className="book-game-filter" role="group" aria-label="玩法分类">{([{id:'all',title:'全部玩法'},{id:'listen',title:'听一听'},{id:'recall',title:'想一想'},{id:'spell',title:'拼一拼'}]).map(item=><button key={item.id} aria-pressed={category===item.id} onClick={()=>setCategory(item.id)}>{item.title}</button>)}</div>
        <div className="book-game-grid">{visible.map(game=>{const saved=pending.find(session=>session.packGame?.selection===game.kind);return <button className="book-game-kind" key={game.kind} disabled={busy} aria-label={`${saved?'继续':'玩'}${game.title}`} onClick={()=>start(game.kind)}><span className="book-game-kind-icon"><GameTileIcon kind={game.kind}/></span><strong>{game.title}</strong><small>{saved?`已保存 · ${progressText(saved)}`:`${game.wordCount} 词可玩`}</small><span className="book-game-kind-arrow" aria-hidden="true">→</span></button>;})}</div>
        {!visible.length&&<p className="book-game-loading">这里暂时没有合适的玩法，可以试试其他分类。</p>}
        {!!locked.length&&<details className="book-game-locked"><summary>还有 {locked.length} 种玩法需要准备</summary><p>有些玩法需要更多不同的图片、指定词类、已审核素材，或家长开启相应选项。</p><div>{locked.map(game=><span key={game.kind}>{game.title}</span>)}</div></details>}
      </>}
    </>}
  </main>;
}
