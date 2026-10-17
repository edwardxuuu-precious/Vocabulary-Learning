import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, PackAudioStatus, PackImageStatus, WordPack } from '../shared/contracts';
import { api, errorMessage, post } from './api';
import { packPreparation } from './pack-workflow';
import { EnglishImport } from './english-import';
import { partOfSpeechLabels } from '../shared/vocabulary';
import { imageStatusLabels } from './pack-image-status';
import { isPreparedImage } from './pack-image-review';
import { PreparationSteps } from './preparation-steps';
import './pack-workbench.css';

export function usePackAudio(packs: WordPack[], enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<string, PackAudioStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const packsRef = useRef(packs), mounted = useRef(true);
  const generation = useRef(0), polling = useRef(false);
  const statusRequests = useRef(new Map<string, number>());
  packsRef.current = packs;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const refresh = useCallback(async (packId?: string) => {
    const request = generation.current;
    const ids = packId ? [packId] : packsRef.current.map(pack => pack.id);
    await Promise.all(ids.map(async id => {
      const serial = (statusRequests.current.get(id) ?? 0) + 1; statusRequests.current.set(id, serial);
      const current = () => mounted.current && request === generation.current && serial === statusRequests.current.get(id);
      try {
        const status = await api<PackAudioStatus>(`/api/packs/${encodeURIComponent(id)}/audio`, { signal: AbortSignal.timeout(10000) });
        if (current()) { setStatuses(previous => ({ ...previous, [id]: status })); setErrors(previous => { const next = { ...previous }; delete next[id]; return next; }); }
      } catch (failure) {
        if (current()) { setErrors(previous => ({ ...previous, [id]: errorMessage(failure) })); setStatuses(previous => { const next = { ...previous }; delete next[id]; return next; }); }
      }
    }));
  }, []);
  const identity = packs.map(pack => pack.id).join('|');
  useEffect(() => {
    if (!enabled) return;
    const poll = async () => { if (polling.current) return; polling.current = true; try { await refresh(); } finally { polling.current = false; } };
    void poll(); const timer = setInterval(() => void poll(), 2000);
    return () => { clearInterval(timer); generation.current++; };
  }, [enabled, identity, refresh]);
  return { statuses, errors, refresh };
}

interface WorkbenchProps {
  state: AppState;
  statuses: Record<string, PackAudioStatus>;
  statusErrors: Record<string, string>;
  refreshAudio: (packId?: string) => Promise<void>;
  imageStatuses: Record<string, PackImageStatus>;
  imageErrors: Record<string, string>;
  refreshImages: (packId?: string) => Promise<void>;
  reload: () => Promise<AppState>;
  report: (message: string) => void;
  showImages: (packId: string) => void;
  onExit: () => void;
  packId: string;
  selectPack: (packId: string) => void;
  handoff: (packId: string) => Promise<void>;
  showSettings: () => void;
}

export function PackWorkbench({ state, statuses, statusErrors, refreshAudio, imageStatuses, imageErrors, refreshImages, reload, report, showImages, onExit, packId, selectPack, handoff, showSettings }: WorkbenchProps) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [creating, setCreating] = useState(() => !state.packs.some(pack => !pack.isSample));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const confirmed = async (_created: AppState, pack: WordPack | undefined) => {
    await reload();
    if (pack) { selectPack(pack.id); setCreating(false); await Promise.all([refreshAudio(pack.id), refreshImages(pack.id)]); }
    report('词义已确认，发音、图片和配套游戏正在准备。');
  };
  const cache = (packId: string, cancel = false) => void act(async () => {
    await post(`/api/packs/${encodeURIComponent(packId)}/audio${cancel ? '/cancel' : ''}`, {});
    await refreshAudio(packId); await reload();
  });
  const images = (packId: string, cancel = false) => void act(async () => {
    await post(`/api/packs/${encodeURIComponent(packId)}/images${cancel ? '/cancel' : ''}`, {});
    await reload(); await refreshImages(packId);
  });
  const formal = state.packs.filter(pack => !pack.isSample), samples = state.packs.filter(pack => pack.isSample);
  const current = formal.find(pack => pack.id === packId) ?? formal.at(-1);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [creating, packId]);
  const startNew = () => { setCreating(true); setError(''); };
  const renderPack = (pack: WordPack) => {
    const audio = statuses[pack.id], ready = packPreparation(pack, state.words, audio);
    const members = state.words.filter(word => word.packId === pack.id);
    const imageStatus = imageStatuses[pack.id], drawing = imageStatus?.status === 'running' || imageStatus?.status === 'queued';
    const pictured = members.filter(word => ['review', 'approved'].includes(word.assetStatus) && isPreparedImage(word.imageUrl)).length;
    const pendingImages = members.some(word => word.assetStatus === 'draft' || word.assetStatus === 'error');
    const labels = { idle: '等待准备', running: '正在准备', ready: '声音已备好', stopped: '已停止，可继续', error: '有声音待补齐' };
    return <article key={pack.id} className="preparation-book" aria-label={`${pack.title}备课进度`}>
      <div className="preparation-book-title"><div><span className="prep-kicker">{pack.isSample ? '开发示例 · 非正式词表' : '当前词表'}</span><h2>{pack.title}</h2><p>{ready.total} 个单词 · 词表已确认{pack.enabled ? ' · 孩子可学习' : ''}</p></div><details className="prep-word-list"><summary>查看词表</summary><div className="preview-table"><table><thead><tr><th>英文</th><th>中文意思</th><th>词性</th></tr></thead><tbody>{members.map(word => <tr key={word.id}><td>{word.term}</td><td>{word.meaning}</td><td>{word.partOfSpeech ? partOfSpeechLabels[word.partOfSpeech] : '—'}</td></tr>)}</tbody></table></div></details></div>
      <section className="prep-materials" aria-label="声音和图片准备">
        <div className="prep-material"><div className="prep-material-title"><span aria-hidden="true">♫</span><h3>单词发音</h3><strong>{audio ? ready.cached : '…'}<small> / {ready.total}</small></strong></div><progress value={audio ? ready.cached : undefined} max={Math.max(1, ready.total)} aria-label={`${pack.title}发音缓存进度`} /><p role="status">{audio?.status === 'running' && audio.currentTerm ? `正在准备 ${audio.currentTerm}` : audio ? labels[audio.status] : statusErrors[pack.id] ? '状态读取失败' : '正在检查本机缓存'}</p>
          {(audio?.error || statusErrors[pack.id]) && <p className="pack-error" role="alert">{audio?.error || statusErrors[pack.id]} 词表已保留。</p>}
          {audio?.status === 'running' ? <button className="prep-text-button" disabled={busy} onClick={() => cache(pack.id, true)}>停止准备发音</button> : audio && ready.missingAudio.length > 0 ? <button className="prep-text-button" disabled={busy} onClick={() => cache(pack.id)}>补齐发音</button> : statusErrors[pack.id] ? <button className="prep-text-button" disabled={busy} onClick={() => void act(() => refreshAudio(pack.id))}>重新检查发音</button> : null}
          {audio && ready.missingAudio.length > 0 && <details className="prep-detail"><summary>哪些发音还没好？</summary><p>{ready.missingAudio.map(word => word.term).join(' · ')}</p></details>}
        </div>
        <div className="prep-material"><div className="prep-material-title"><span aria-hidden="true">▧</span><h3>单词图片</h3><strong>{pictured}<small> / {ready.total}</small></strong></div><progress value={pictured} max={Math.max(1, ready.total)} aria-label={`${pack.title}图片准备进度，包含待审核`} /><p role="status">{imageStatus ? imageStatusLabels[imageStatus.status] : imageErrors[pack.id] ? '状态读取失败' : '正在检查图片'}{ready.reviewing > 0 ? ` · ${ready.reviewing} 张等你审核` : ''}</p>
          {(imageStatus?.error || imageErrors[pack.id]) && <p className="pack-error" role="alert">{imageStatus?.error || imageErrors[pack.id]} 已有素材会保留。</p>}
          {!state.integrations.codex.configured && pendingImages && <p className="prep-service-note">生图账号尚未连接。<button className="prep-text-button" onClick={showSettings}>去设置</button></p>}
          {drawing ? <button className="prep-text-button" disabled={busy} onClick={() => images(pack.id, true)}>停止准备图片</button> : pendingImages && <button className="prep-text-button" disabled={busy || !state.integrations.codex.configured} onClick={() => images(pack.id)}>补齐图片</button>}
          <details className="prep-detail"><summary>查看图片进度</summary><p>已确认 {ready.approved} 张，待审核 {ready.reviewing} 张，待准备 {Math.max(0, ready.total - pictured)} 张。{imageStatus?.currentWordId ? `正在画 ${members.find(word => word.id === imageStatus.currentWordId)?.term || '一个单词'}。` : ''}</p></details>
        </div>
      </section>
      <section className="prep-next-step" aria-label="审核并交给孩子"><div><span className="prep-kicker">下一步</span><h3>{ready.reviewing ? `审核 ${ready.reviewing} 张图片` : ready.canEnable ? pack.enabled ? '已经交给孩子啦' : ready.approved < ready.total ? `已备好 ${ready.approved} 个词` : '可以交给孩子啦' : !audio ? '正在检查素材' : '素材备好后，来这里审核'}</h3><p>{ready.reviewing ? '核对图片和中文意思，再确认给孩子。' : ready.canEnable ? `${ready.approved} 个词已确认图片和发音${ready.approved < ready.total ? '，其余词可以之后补齐' : ''}。` : !audio ? '正在核对本机发音缓存，请稍等。' : ready.blockedReason}</p></div>
        <div className="prep-next-actions">{ready.reviewing > 0 ? <><button className="prep-primary" disabled={busy} onClick={() => showImages(pack.id)}>审核图片<span>→</span></button>{ready.canEnable && !pack.enabled && <button className="prep-text-button" disabled={busy} onClick={() => void act(() => handoff(pack.id))}>先学已备好的 {ready.approved} 个词</button>}</> : ready.canEnable ? <><button className="prep-primary" disabled={busy} onClick={() => pack.enabled ? onExit() : void act(() => handoff(pack.id))}>{pack.enabled ? '去孩子首页' : pack.isSample ? '家长开启示例体验' : ready.approved < ready.total ? `先学已备好的 ${ready.approved} 个词` : '给孩子学习'}<span>→</span></button><button className="prep-text-button" disabled={busy} onClick={() => showImages(pack.id)}>查看图片</button></> : <button className="prep-secondary" disabled={busy || !pictured} onClick={() => showImages(pack.id)}>查看图片</button>}</div>
      </section>
    </article>;
  };
  return <div className="pack-workbench">
    {formal.length > 0 && !creating && <div className="prep-book-switch"><label htmlFor="prep-current-pack">当前词表<select id="prep-current-pack" value={current?.id ?? ''} disabled={busy} onChange={event => { selectPack(event.target.value); setCreating(false); setError(''); }}>{formal.map(pack => <option key={pack.id} value={pack.id}>{pack.title}{pack.enabled ? ' · 已启用' : ''}</option>)}</select></label><button className="prep-secondary" disabled={busy} onClick={startNew}>＋ 新词表</button></div>}
    <PreparationSteps active={creating ? 1 : current && (packPreparation(current, state.words, statuses[current.id]).reviewing > 0 || packPreparation(current, state.words, statuses[current.id]).canEnable) ? 3 : 2} pack={creating ? undefined : current} words={state.words} audio={current ? statuses[current.id] : undefined} />
    {error && <div className="pack-error workbench-error" role="alert">{error}</div>}
    {creating ? <EnglishImport spellingEnabled={state.settings.spellingEnabled} hasBooks={formal.length > 0} back={() => setCreating(false)} confirmed={confirmed} packIds={state.packs.map(pack => pack.id)} /> : current && renderPack(current)}
    {samples.length > 0 && <details className="prep-samples"><summary>开发示例与历史（{samples.length} 本）</summary><p>这些不是你提供的正式词表，默认不启用；学习历史保留。</p>{samples.map(renderPack)}</details>}
  </div>;
}
