import { useEffect, useRef, useState } from 'react';
import type { AppState, IllustrationJob, PackAudioStatus, PackImageStatus, Word } from '../shared/contracts';
import { api, errorMessage, post } from './api';
import { imageReviewSnapshot, isPreparedImage, reconcileImageSelections, selectVisibleReviewImages, toggleImageSelection, type ImageReviewSelection } from './pack-image-review';
import { PackImageProgress } from './pack-image-status';
import { packPreparation } from './pack-workflow';
import { PreparationSteps } from './preparation-steps';
import { partOfSpeechLabels } from '../shared/vocabulary';
import './pack-image-review.css';

interface ImageReviewProps {
  state: AppState; packId: string; setPackId: (id: string) => void;
  status?: PackImageStatus; statusError?: string;
  refreshImages: (packId?: string) => Promise<void>;
  reload: () => Promise<AppState>; report: (message: string) => void;
  editWord: (word: Word) => void; backToPacks: () => void;
  audioStatus?: PackAudioStatus;
  handoff: (packId: string) => Promise<void>;
}
const statusLabels: Record<Word['assetStatus'], string> = { draft: '待准备', generating: '正在画', review: '待家长确认', approved: '已确认', error: '未完成' };
const pageSize = 24;
interface RedrawFeedback { phase: 'submitting' | 'accepted' | 'error'; imageUrl: string; message: string }

export function PackImageReview({ state, packId, setPackId, status, statusError, refreshImages, reload, report, editWord, backToPacks, audioStatus, handoff }: ImageReviewProps) {
  const [filter, setFilter] = useState('review'), [page, setPage] = useState(1);
  const [selections, setSelections] = useState<ImageReviewSelection[]>([]);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [enlarged, setEnlarged] = useState<ImageReviewSelection | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [redraws, setRedraws] = useState<Record<string, RedrawFeedback>>({});
  const redrawRequests = useRef(new Set<string>());
  const mutation = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pack = state.packs.find(item => item.id === packId);
  const words = state.words.filter(word => word.packId === packId);
  const redrawingIds = new Set(Object.entries(redraws).filter(([, value]) => value.phase !== 'error').map(([id]) => id));
  const filtered = words.filter(word => filter === 'all' || word.assetStatus === filter || redrawingIds.has(word.id) || (filter === 'review' && word.assetStatus === 'generating'));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages), shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const unavailableImages = new Set(state.words.filter(word => !loadedImages.has(word.imageUrl) || failedImages.has(word.imageUrl)).map(word => word.imageUrl));
  const validSelections = reconcileImageSelections(packId, state.words.filter(word => !redrawingIds.has(word.id)), selections, unavailableImages);
  const visibleSnapshots = selectVisibleReviewImages(packId, shown.filter(word => !redrawingIds.has(word.id)), unavailableImages);
  const validSelectedIds = new Set(validSelections.map(item => item.wordId));
  const working = status?.status === 'running' || status?.status === 'queued';
  const ready = pack ? packPreparation(pack, state.words, audioStatus) : null;
  useEffect(() => { setSelections([]); setEnlarged(null); setPage(1); setFilter('review'); setNotice(''); setError(''); }, [packId]);
  useEffect(() => {
    setRedraws(previous => {
      const next = { ...previous }; let changed = false;
      for (const [id, feedback] of Object.entries(previous)) {
        const word = state.words.find(item => item.id === id);
        if (!word || word.imageUrl !== feedback.imageUrl || (feedback.phase === 'accepted' && Boolean(word.error))) { delete next[id]; changed = true; }
      }
      return changed ? next : previous;
    });
  }, [state.words]);
  useEffect(() => {
    const unavailable = new Set(state.words.filter(word => !loadedImages.has(word.imageUrl) || failedImages.has(word.imageUrl)).map(word => word.imageUrl));
    const valid = reconcileImageSelections(packId, state.words, selections, unavailable);
    if (valid.length !== selections.length) { setSelections(valid); setNotice('图片或词义已更新，相关旧选择已清除，请重新查看。'); }
    if (enlarged) {
      const word = state.words.find(item => item.id === enlarged.wordId && item.packId === packId);
      if (!word || word.imageUrl !== enlarged.imageUrl || word.term !== enlarged.term || word.meaning !== enlarged.meaning || (word.learningVersion ?? 0) !== (enlarged.learningVersion ?? 0)) setEnlarged(null);
    }
  }, [packId, state.words, selections, enlarged, failedImages, loadedImages]);
  useEffect(() => {
    if (!enlarged) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setEnlarged(null); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [enlarged]);
  const act = async (action: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try { await action(); await reload(); await refreshImages(packId); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); void reload().catch(() => {}); void refreshImages(packId); }
    finally { mutation.current = false; if (mounted.current) setBusy(false); }
  };
  const changePack = (id: string) => { setSelections([]); setEnlarged(null); setPackId(id); };
  const selectPage = () => { setSelections(visibleSnapshots); setNotice(`已选择本页 ${visibleSnapshots.length} 张，请核对后确认。`); };
  const toggle = (word: Word) => { if (loadedImages.has(word.imageUrl) && !failedImages.has(word.imageUrl)) setSelections(previous => toggleImageSelection(packId, state.words, previous, word)); };
  const imageLoaded = (imageUrl: string) => setLoadedImages(previous => previous.has(imageUrl) ? previous : new Set(previous).add(imageUrl));
  const imageFailed = (imageUrl: string) => {
    setFailedImages(previous => new Set(previous).add(imageUrl));
    setLoadedImages(previous => { const next = new Set(previous); next.delete(imageUrl); return next; });
    setSelections(previous => previous.filter(item => item.imageUrl !== imageUrl));
    setEnlarged(previous => previous?.imageUrl === imageUrl ? null : previous);
    setNotice('有图片加载失败，已取消这张的选择。重试显示成功后再审核。');
  };
  const retryImage = (imageUrl: string) => setFailedImages(previous => { const next = new Set(previous); next.delete(imageUrl); return next; });
  const approve = () => void act(async () => {
    const snapshots = reconcileImageSelections(packId, state.words.filter(word => !redrawingIds.has(word.id)), selections, unavailableImages);
    if (!snapshots.length || snapshots.length !== selections.length) { setSelections(snapshots); throw new Error('选择的图片已变化，请重新检查后再确认。'); }
    await post(`/api/packs/${encodeURIComponent(packId)}/images/approve`, { selections: snapshots });
    setSelections([]); setEnlarged(null); setNotice(''); report(pack?.enabled ? `已确认 ${snapshots.length} 张图片，会加入这本已启用的词表。` : `已确认 ${snapshots.length} 张图片，词表仍未启用。`);
  });
  const prepare = (cancel = false) => void act(async () => {
    if (cancel) { setSelections([]); setEnlarged(null); }
    await post(`/api/packs/${encodeURIComponent(packId)}/images${cancel ? '/cancel' : ''}`, {});
  });
  const redraw = async (word: Word) => {
    if (redrawRequests.current.has(word.id) || redrawingIds.has(word.id) || word.assetStatus === 'generating') return;
    redrawRequests.current.add(word.id);
    setSelections(previous => previous.filter(item => item.wordId !== word.id));
    if (enlarged?.wordId === word.id) setEnlarged(null);
    setRedraws(previous => ({ ...previous, [word.id]: { phase: 'submitting', imageUrl: word.imageUrl, message: '正在提交重画…' } }));
    try {
      await api<IllustrationJob>(`/api/words/${encodeURIComponent(word.id)}/illustrate`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(15000) });
      if (mounted.current) setRedraws(previous => ({ ...previous, [word.id]: { phase: 'accepted', imageUrl: word.imageUrl, message: '已提交，正在重画；旧图先保留。' } }));
      const updates = await Promise.allSettled([reload(), refreshImages(packId)]);
      if (mounted.current) setRedraws(previous => {
        if (previous[word.id]?.phase !== 'accepted') return previous;
        // Once state is fresh, the word itself owns progress, completion and cancellation.
        if (updates[0].status === 'fulfilled') { const next = { ...previous }; delete next[word.id]; return next; }
        return { ...previous, [word.id]: { ...previous[word.id], message: '已提交重画，进度暂未读到，请刷新查看。' } };
      });
    } catch (failure) {
      const message = errorMessage(failure);
      if (mounted.current) setRedraws(previous => ({ ...previous, [word.id]: { phase: 'error', imageUrl: word.imageUrl, message: /已有\s*3\s*个图片任务/.test(message) ? '已有 3 张图片正在生成，等一张完成后再点重画。' : `重画未能提交：${message}` } }));
    } finally { redrawRequests.current.delete(word.id); }
  };
  const edit = (word: Word) => { setSelections(previous => previous.filter(item => item.wordId !== word.id)); setEnlarged(null); editWord(word); };
  return <section className="image-review-panel" aria-labelledby="image-review-heading">
    <button className="prep-text-button review-back" disabled={busy} onClick={backToPacks}>← 返回备课</button>
    <PreparationSteps active={3} pack={pack} words={state.words} audio={audioStatus} />
    <div className="review-heading"><div><span className="prep-kicker">第 3 步</span><h2 id="image-review-heading">检查图片，再交给孩子</h2><p>{pack?.title || '请选择词表'}{pack?.isSample ? ' · 开发示例，非正式词表' : ''}</p></div><details className="prep-review-switch"><summary>切换词表</summary><label htmlFor="asset-pack">当前词表<select id="asset-pack" value={packId} disabled={busy} onChange={event => changePack(event.target.value)}>{!state.packs.length && <option value="">还没有词表</option>}{state.packs.map(item => <option key={item.id} value={item.id}>{item.isSample ? '示例 / ' : ''}{item.title}</option>)}</select></label></details></div>
    {(working || status?.pending || status?.failed || statusError || status?.error) ? <details className="prep-review-progress"><summary>准备进度与补缺{working ? ' · 正在画图' : ''}</summary><PackImageProgress status={status} error={statusError} words={words} /><div className="image-generation-actions">{working ? <button className="prep-secondary" disabled={busy} onClick={() => prepare(true)}>停止准备图片</button> : <button className="prep-secondary" disabled={busy || !pack || !words.some(word => word.assetStatus === 'draft' || word.assetStatus === 'error') || !state.integrations.codex.configured} onClick={() => prepare(false)}>补齐图片</button>}<span>使用 Codex OAuth 现有额度，不充值；已有可审核图片会保留。</span></div></details> : null}
    {!state.integrations.codex.configured && words.some(word => word.assetStatus === 'draft' || word.assetStatus === 'error') && <p className="pack-error">Codex 生图尚未连接。请到“设置”连接官方账号，再继续准备缺图。已有图片与词表会保留。</p>}
    <div className="image-review-checklist"><strong>核对后再勾选</strong><p>图片符合中文意思、适合孩子，且没有英文答案。拿不准先不选。</p></div>
    <div className="asset-filters" role="group" aria-label="图片审核筛选">{[{ id: 'review', text: '待确认' }, { id: 'approved', text: '已确认' }, { id: 'all', text: '全部' }].map(item => <button key={item.id} disabled={busy} aria-pressed={filter === item.id} className={filter === item.id ? 'active' : ''} onClick={() => { setFilter(item.id); setPage(1); setSelections([]); setNotice(''); }}>{item.text}<span>{words.filter(word => item.id === 'all' || word.assetStatus === item.id).length}</span></button>)}</div>

    {error && <p className="pack-error" role="alert">{error}</p>}{notice && <p className="image-selection-notice" role="status">{notice}</p>}
    <div className="image-review-grid">{shown.map(word => {
      const redrawFeedback = redraws[word.id], redrawing = redrawingIds.has(word.id) || word.assetStatus === 'generating';
      const realImage = isPreparedImage(word.imageUrl), failed = failedImages.has(word.imageUrl), review = Boolean(imageReviewSnapshot(word)) && !failed && !redrawing;
      return <article key={word.id} className={`image-review-card ${validSelectedIds.has(word.id) ? 'selected' : ''}`}>
        <div className="review-picture">{realImage && !failed ? <button className="review-enlarge" onClick={() => setEnlarged({ wordId: word.id, imageUrl: word.imageUrl, term: word.term, meaning: word.meaning, learningVersion: word.learningVersion ?? 0 })} aria-label={`放大查看${word.term}图片`}><img src={word.imageUrl} alt={`${word.term}：${word.meaning}，待核对图片`} loading="lazy" onLoad={event => { if (event.currentTarget.naturalWidth > 0) imageLoaded(word.imageUrl); }} onError={() => imageFailed(word.imageUrl)} /><span>⤢ 看大图</span></button> : <div className="asset-placeholder"><span>✦</span><span>{failed ? '图片加载失败，暂不能审核' : '等待一张新插画'}</span>{failed && <button className="text-button" onClick={() => retryImage(word.imageUrl)}>重试显示图片</button>}</div>}<span className={`asset-status status-${word.assetStatus}`}>{statusLabels[word.assetStatus]}</span></div>
        <div className="review-word"><h3>{word.term}</h3><p>{word.meaning}{word.partOfSpeech && <span className="prep-pos-tag">{partOfSpeechLabels[word.partOfSpeech]}</span>}</p><small>{!realImage ? '待准备' : word.imageSource === 'builtin' ? '复用内置插画 · 请核对义项' : word.imageSource === 'codex' ? 'Codex 生成 · 请人工审核' : '本地图片 · 请人工审核'}</small></div>
        {review && <label className="review-select"><input type="checkbox" disabled={busy || !loadedImages.has(word.imageUrl)} checked={validSelectedIds.has(word.id)} onChange={() => toggle(word)} /><span>{loadedImages.has(word.imageUrl) ? '这张符合词义，加入确认' : '图片加载成功后可审核'}</span></label>}
        {redrawFeedback ? <p className={redrawFeedback.phase === 'error' ? 'asset-error review-redraw-feedback' : 'review-redraw-feedback'} role={redrawFeedback.phase === 'error' ? 'alert' : 'status'}>{redrawFeedback.message}</p> : word.error ? <p className="asset-error" role="alert">{word.error}</p> : redrawing ? <p className="review-redraw-feedback" role="status">正在重画，旧图先保留；完成后请重新确认。</p> : null}
        {!state.integrations.codex.configured && <p className="asset-error review-redraw-feedback">Codex 尚未连接，请到设置连接后重画。</p>}
        <div className="review-card-actions"><button className="text-button" disabled={busy || redrawing || !state.integrations.codex.configured} onClick={() => void redraw(word)}>{redrawFeedback?.phase === 'submitting' ? '提交中…' : redrawing ? '正在重画…' : realImage ? '重新画一张' : '生成插画'}</button><button className="text-button" disabled={busy || redrawing} onClick={() => edit(word)}>编辑词义</button></div>
      </article>;
    })}</div>
    <div className="image-selection-toolbar"><div><button className="text-button" disabled={busy || !visibleSnapshots.length} onClick={selectPage}>选择本页（{visibleSnapshots.length}）</button><button className="text-button" disabled={busy || !validSelections.length} onClick={() => { setSelections([]); setNotice(''); }}>取消选择</button><span>已选 {validSelections.length} 张</span></div></div>
    {!shown.length && <div className="prep-review-empty"><span aria-hidden="true">{ready?.canEnable ? '✓' : '▧'}</span><h3>{filter === 'review' && ready?.approved ? '图片已确认' : filter === 'review' && working ? '小栗正在画图' : '这里暂时没有图片'}</h3><p>{filter === 'review' && ready?.canEnable ? `${ready.approved} 个词已备好，可以交给孩子了。` : filter === 'review' && ready?.approved ? audioStatus ? '图片已确认，发音还没备好。返回备课可以补齐。' : '图片已确认，正在检查发音缓存。' : filter === 'review' && working ? '画好一张，就会出现在这里。' : '可切换“全部”查看，或返回备课补齐素材。'}</p></div>}
    {pages > 1 && <nav className="image-pagination" aria-label="图片审核分页"><button className="button secondary compact-button" disabled={busy || currentPage <= 1} onClick={() => { setPage(currentPage - 1); setSelections([]); }}>上一页</button><span>第 {currentPage} / {pages} 页 · 每页最多 {pageSize} 张</span><button className="button secondary compact-button" disabled={busy || currentPage >= pages} onClick={() => { setPage(currentPage + 1); setSelections([]); }}>下一页</button></nav>}
    <footer className="prep-review-footer"><div><strong>{validSelections.length ? `已选择 ${validSelections.length} 张图片` : ready?.reviewing ? `还有 ${ready.reviewing} 张待确认` : ready?.canEnable ? `${ready.approved} 个词可以学习` : '还差一点就准备好啦'}</strong><p>{validSelections.length ? pack?.enabled ? '词表已启用，确认的图片会加入孩子学习。' : '确认只批准当前所见的图片，不会自动启用词表。' : ready?.reviewing ? '勾选图片，再点击确认。已备好的部分也可返回备课先交给孩子。' : ready?.canEnable ? ready.approved < ready.total ? '其余词备好后再加入，孩子先学已确认的部分。' : '发音和图片均已准备好。' : pack && !audioStatus ? '正在核对本机发音缓存，请稍等。' : ready?.blockedReason || '请先选择词表。'}</p></div>{validSelections.length ? <button className="prep-primary" disabled={busy} onClick={approve}>确认 {validSelections.length} 张图片<span>✓</span></button> : <button className="prep-primary" disabled={busy || !ready?.canEnable || !pack || Boolean(ready.reviewing)} onClick={() => void act(async () => { if (pack) await handoff(pack.id); })}>{ready?.reviewing ? '勾选图片后确认' : pack?.enabled ? '去孩子首页' : ready?.canEnable && ready.approved < ready.total ? `先学这 ${ready.approved} 个词` : '给孩子学习'}<span>→</span></button>}</footer>
    {enlarged && <div className="modal-backdrop image-preview-backdrop" onClick={event => { if (event.target === event.currentTarget) setEnlarged(null); }}><section className="modal image-review-modal" role="dialog" aria-modal="true" aria-labelledby="image-preview-title"><button autoFocus className="icon-button modal-close" onClick={() => setEnlarged(null)} aria-label="关闭大图">×</button><div><h2 id="image-preview-title">{enlarged.term}</h2><p>{enlarged.meaning}</p></div><img src={enlarged.imageUrl} alt={`${enlarged.term}：${enlarged.meaning}的大图审核`} onError={() => imageFailed(enlarged.imageUrl)} /><p className="image-preview-note">请核对中文义项、画面适宜性和是否泄露英文答案。</p><button className="button secondary" onClick={() => setEnlarged(null)}>看好了，返回审核列表</button></section></div>}
  </section>;
}
