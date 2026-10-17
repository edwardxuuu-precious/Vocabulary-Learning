import { useEffect, useRef, useState } from 'react';
import type { AppState, ImportPreparation, ImportRow, WordPack } from '../shared/contracts';
import { isEnrichedRow, partOfSpeechLabels, partsOfSpeech, wordGamePlan } from '../shared/vocabulary';
import { visualTheme } from '../shared/visual-theme';
import { api, errorMessage, post } from './api';
import { canConfirmPack, type ConfirmedPackPreview, type PackPreview } from './pack-workflow';

interface Props { spellingEnabled: boolean; hasBooks: boolean; back: () => void; confirmed: (state: AppState, pack: WordPack | undefined) => Promise<void>; packIds: string[] }
export function EnglishImport({ spellingEnabled, hasBooks, back, confirmed, packIds }: Props) {
  const [source, setSource] = useState(''), [title, setTitle] = useState('我的第一本词书');
  const [preview, setPreview] = useState<ConfirmedPackPreview | null>(null), [job, setJob] = useState<ImportPreparation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), revision = useRef(0), file = useRef<HTMLInputElement>(null), jobRef = useRef<ImportPreparation | null>(null);
  jobRef.current = job;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++; const current = jobRef.current; if (current?.status === 'running') void post(`/api/import/enrich/${current.id}/cancel`).catch(() => {}); }; }, []);
  const running = job?.status === 'running', locked = busy || running;
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const request = revision.current, id = job.id; let disposed = false, polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try {
        const next = await api<ImportPreparation>(`/api/import/enrich/${id}`, { signal: AbortSignal.timeout(10000) });
        if (!disposed && mounted.current && request === revision.current) { setJob(next); setPreview(current => current ? { ...current, rows: next.rows } : current); setError(next.error ?? ''); }
      } catch (failure) { if (!disposed && mounted.current && request === revision.current) setError(`${errorMessage(failure)}，正在重新读取；也可以停止补全。`); }
      finally { polling = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 1200);
    return () => { disposed = true; clearInterval(timer); };
  }, [job?.id, job?.status]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [Boolean(preview)]);
  const act = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (failure) { if (mounted.current) setError(errorMessage(failure)); } finally { if (mounted.current) setBusy(false); } };
  const updateSource = (text: string) => { revision.current++; setSource(text); setPreview(null); setJob(null); setError(''); };
  const prepare = () => void act(async () => {
    const request = revision.current;
    const parsed = await post<PackPreview>('/api/import/preview', { text: source });
    if (!mounted.current || request !== revision.current) return;
    const next = { ...parsed, source }; setPreview(next);
    if (parsed.errors.length) return;
    const started = await post<ImportPreparation>('/api/import/enrich', { text: source });
    if (!mounted.current || request !== revision.current) { void post(`/api/import/enrich/${started.id}/cancel`).catch(() => {}); return; }
    setJob(started); setPreview({ ...next, rows: started.rows });
  });
  const retry = () => void act(async () => {
    if (!preview) return;
    const next = await post<ImportPreparation>('/api/import/enrich', { text: source, rows: preview.rows });
    if (!mounted.current) { void post(`/api/import/enrich/${next.id}/cancel`).catch(() => {}); return; }
    setJob(next);
  });
  const stop = () => void act(async () => { if (!job) return; revision.current++; const next = await post<ImportPreparation>(`/api/import/enrich/${job.id}/cancel`); if (mounted.current) { setJob(next); setPreview(current => current ? { ...current, rows: next.rows } : current); } });
  const edit = (index: number, field: keyof ImportRow, value: string) => {
    revision.current++; setError('');
    setPreview(current => current ? { ...current, rows: current.rows.map((row, at) => {
      if (at !== index) return row;
      const next = { ...row, [field]: value || undefined };
      if (field === 'meaning') next.meaning = value;
      if (field === 'meaning' || field === 'partOfSpeech') { delete next.pictureHint; delete next.usageNote; }
      return next;
    }) } : current);
  };
  const complete = preview?.rows.filter(isEnrichedRow).length ?? 0;
  const valid = canConfirmPack(title, source, preview, true);
  const confirm = () => void act(async () => {
    if (!valid || !preview) return;
    const state = await post<AppState>('/api/packs', { title: title.trim(), rows: preview.rows, requireEnriched: true, imageTheme: visualTheme.id });
    await confirmed(state, state.packs.find(pack => !packIds.includes(pack.id)));
  });
  return <section className="prep-import" aria-labelledby="prep-import-title">
    <div className="prep-import-heading"><div><span className="prep-kicker">第 1 步</span><h2 id="prep-import-title">{preview ? preview.errors.length ? '检查一下英文' : '核对这次要学的意思' : '只要粘贴英文'}</h2><p>{preview ? preview.errors.length ? '修改后再试，词表还没有保存。' : 'Codex 补全中文、词性和配图思路，你可以直接修改。' : '每行一个单词或短语，中文和词性交给 Codex。'}</p></div>{hasBooks && <button className="prep-text-button" disabled={locked} onClick={back}>返回词表</button>}</div>
    {!preview && <><label className="field-label" htmlFor="words-input">英文单词或短语</label><textarea id="words-input" value={source} onChange={event => updateSource(event.target.value)} placeholder={'apple\njump\nhappy'} rows={7} spellCheck={false} disabled={locked} /><div className="prep-import-tools"><input ref={file} type="file" accept=".csv,.tsv,.txt" hidden onChange={event => { const selected = event.target.files?.[0]; if (selected) { const request = ++revision.current; void selected.text().then(text => { if (mounted.current && request === revision.current) updateSource(text); }).catch(failure => setError(errorMessage(failure))); } event.target.value = ''; }} /><button type="button" className="prep-secondary prep-file-import" disabled={locked} onClick={() => file.current?.click()}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m-4 4 4-4 4 4M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>从文件导入</button></div></>}
    <div className="prep-name-field"><label className="field-label" htmlFor="pack-title">词表名字</label><input id="pack-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={60} disabled={locked} /></div>
    {preview?.errors.length ? <div className="inline-warning" role="alert">{preview.errors.map((message, i) => <p key={i}>{message}</p>)}</div> : null}
    {preview && !preview.errors.length && <>
      <div className="prep-enrichment-status" role="status"><span>{running ? '✦ Codex 正在补全' : complete === preview.rows.length ? '✓ 词义草稿已备好' : job?.status === 'stopped' ? '已停止，草稿保留' : '还有词条需要补齐'} · {complete} / {preview.rows.length}</span>{running && <button className="prep-text-button" disabled={busy} onClick={stop}>停止补全</button>}</div>
      <div className="prep-vocabulary-list" aria-label="可编辑的词义草稿">{preview.rows.map((row, i) => <article className="prep-vocabulary-row" key={i}>
        <div className="prep-vocabulary-fields"><strong lang="en">{row.term}</strong><label><span>中文意思</span><input aria-label={`${row.term} 中文意思`} value={row.meaning} maxLength={160} placeholder="等待补全" disabled={locked} onChange={event => edit(i, 'meaning', event.target.value)} /></label><label><span>词性</span><select aria-label={`${row.term} 词性`} value={row.partOfSpeech ?? ''} disabled={locked} onChange={event => edit(i, 'partOfSpeech', event.target.value)}><option value="">待补全</option>{partsOfSpeech.map(pos => <option key={pos} value={pos}>{partOfSpeechLabels[pos]}</option>)}</select></label></div>
        {row.usageNote && <p className="prep-sense-note">请留意：{row.usageNote}</p>}
        <details className="prep-vocabulary-detail"><summary>配图思路与游戏</summary><label>图片要表现什么<textarea aria-label={`${row.term} 配图说明`} value={row.pictureHint ?? ''} maxLength={300} rows={2} disabled={locked} placeholder="由 Codex 根据选定词义准备，也可手动填写" onChange={event => edit(i, 'pictureHint', event.target.value)} /></label><p>游戏：{wordGamePlan(row, spellingEnabled).slice(1).map(game => game.title).join(' · ')}</p></details>
      </article>)}</div>
    </>}
    {error && <p className="pack-error" role="alert">{error}</p>}
    <div className="prep-import-footer">{preview ? <><button className="prep-text-button" disabled={locked} onClick={() => { revision.current++; setPreview(null); setJob(null); setError(''); }}>← 修改英文</button><div className="prep-import-commit">{!preview.errors.length && complete < preview.rows.length && !running && <button className="prep-secondary" disabled={busy} onClick={retry}>补齐词义与配图思路</button>}<button className="prep-primary" disabled={locked || !valid} onClick={confirm}>确认词义并准备素材<span>→</span></button></div></> : <button className="prep-primary" disabled={locked || !source.trim()} onClick={prepare}>{busy ? '正在检查…' : '让 Codex 补全'}<span>→</span></button>}</div>
  </section>;
}
