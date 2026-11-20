import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GameWord } from '../../shared/contracts';
import { visualTheme } from '../../shared/visual-theme';
import { PictureRecognitionTask, type PictureAnswer } from '../../src/recognize-picture-task';

type Content = { words: GameWord[]; targetId: string; isolated: true };
type Position = { index: number; answer?: PictureAnswer; hinted: boolean };
const emptyPosition = (): Position => ({ index: 0, hinted: false });

function Preview() {
  const [content, setContent] = useState<Content>();
  const [error, setError] = useState('');
  const [position, setPosition] = useState<Position>(emptyPosition);
  const [page, setPage] = useState<'task' | 'home'>('task');
  const [modal, setModal] = useState<'help' | 'pause'>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/__preview/content', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('原词图暂时无法读取，请重新打开预览。');
      const value = await response.json() as Content;
      setContent(value);
      try {
        const saved = JSON.parse(sessionStorage.getItem('picture-ui-preview-v1') ?? 'null');
        if (saved?.key === value.words.map(word => word.id).join(':') && Number.isInteger(saved.position?.index) && saved.position.index >= 0 && saved.position.index <= value.words.length) setPosition(saved.position);
      } catch { /* A damaged local preview position starts a fresh preview. */ }
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (content) sessionStorage.setItem('picture-ui-preview-v1', JSON.stringify({ key: content.words.map(word => word.id).join(':'), position })); }, [content, position]);
  useEffect(() => { if (modal) dialog.current?.showModal(); else dialog.current?.close(); }, [modal]);
  const reset = () => { setPosition(emptyPosition()); setPage('task'); setModal(undefined); };
  const done = content && position.index >= content.words.length;
  const ordered = content && [content.words.find(row => row.id === content.targetId)!, ...content.words.filter(row => row.id !== content.targetId)];
  const current = ordered?.[position.index];
  const choices = content ? [...content.words.slice(position.index % content.words.length), ...content.words.slice(0, position.index % content.words.length)] : [];
  return <div className="picture-preview-root">
    <div className="picture-preview-bar"><span className="picture-preview-label">界面预览</span><button onClick={reset}>重新开始</button></div>
    {error ? <div className="picture-preview-home"><h1>预览暂时打不开</h1><p role="alert">{error}</p></div> : !content ? <div className="picture-preview-home"><p role="status">正在打开原词图…</p></div> : page === 'home' || done ? <main className="picture-preview-home">
      <img src={visualTheme.characters.optimus.image} alt=""/>
      <h1>{done ? '预览到这里' : '选图界面预览'}</h1>
      <p>{done ? '可以重新体验，也可以返回看看图片。' : '沿用这组词的原图片，点图即可作答。'}</p>
      <div className="picture-preview-home-words">{content.words.map(row => <img key={row.id} src={row.imageUrl} alt={row.meaning}/>)}</div>
      <button className="picture-preview-primary" onClick={done ? reset : () => setPage('task')}>{done ? '再看一遍' : '继续预览'}</button>
    </main> : current ? <PictureRecognitionTask word={current} choices={choices} answer={position.answer} hinted={position.hinted} completed={position.index} total={content.words.length}
      onChoose={id => setPosition(previous => previous.answer?.outcome === 'correct' || previous.answer?.outcome === 'skipped' ? previous : { ...previous, answer: { selectedId: id, outcome: id === current.id ? 'correct' : 'retry' } })}
      onContinue={() => setPosition(previous => ({ index: previous.index + 1, hinted: false }))}
      onHint={() => setPosition(previous => ({ ...previous, hinted: true }))}
      onSkip={() => setPosition(previous => ({ ...previous, answer: { outcome: 'skipped' } }))}
      onHome={() => setPage('home')} onPause={() => setModal('pause')} onHelp={() => setModal('help')}/> : null}
    <dialog ref={dialog} className="picture-preview-dialog" onCancel={event => { event.preventDefault(); setModal(undefined); }} onClick={event => { if (event.target === event.currentTarget) setModal(undefined); }} aria-labelledby="picture-dialog-title">
      <h2 id="picture-dialog-title">{modal === 'help' ? '怎么玩？' : '休息一下'}</h2>
      {modal === 'help' ? <ol><li>先看英文。</li><li>点一张图片作答。</li><li>看过反馈，再点“继续”。</li></ol> : <p>准备好了，就接着看这一题。</p>}
      <button className="picture-preview-primary" onClick={() => setModal(undefined)}>{modal === 'help' ? '知道了' : '继续预览'}</button>
    </dialog>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
