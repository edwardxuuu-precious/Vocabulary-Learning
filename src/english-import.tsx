import { useEffect, useRef, useState } from 'react';
import type { AppState, ImportPreparation, ImportRow, WordPack } from '../shared/contracts';
import { correctImportTerm, importRowsSource, needsImportEnrichment, reconcileImportRows } from '../shared/import-draft';
import { isEnrichedRow, partOfSpeechLabels, partsOfSpeech, wordGamePlan } from '../shared/vocabulary';
import { visualTheme } from '../shared/visual-theme';
import { api, errorMessage, post } from './api';
import { canConfirmPack, type ConfirmedPackPreview, type PackPreview } from './pack-workflow';
import './import-review.css';

interface ReviewRowProps {
  row: ImportRow; number: number; locked: boolean; spellingEnabled: boolean;
  editing?: boolean; setEditing?: (open: boolean) => void;
  edit: (field: 'meaning' | 'partOfSpeech' | 'pictureHint', value: string) => void;
  correct: (term: string) => Promise<boolean>; keep: () => void; retry: () => void;
}

export function VocabularyReviewRow({ row, number, locked, spellingEnabled, editing = false, setEditing = () => {}, edit, correct, keep, retry }: ReviewRowProps) {
  const [term, setTerm] = useState(row.term);
  const suggestion = row.spellingSuggestion, complete = isEnrichedRow(row);
  const apply = async (value: string) => { if (await correct(value)) setEditing(false); };
  return <article className={`prep-vocabulary-row${suggestion ? ' has-spelling-suggestion' : ''}`} aria-label={`第 ${number} 词 ${row.term}`}>
    <div className="prep-vocabulary-fields">
      <div className="prep-term-field"><span className="prep-row-number">{String(number).padStart(2, '0')}</span><div><strong lang="en">{row.term}</strong><button type="button" className="prep-text-button prep-edit-term" disabled={locked} onClick={() => { setTerm(row.term); setEditing(!editing); }} aria-label={`修改 ${row.term} 的英文`}>修改英文</button></div><span className={`prep-row-state ${complete ? 'is-complete' : ''}`}>{suggestion ? '核对拼写' : complete ? '已补全' : '待补全'}</span></div>
      <label><span>中文意思</span><input aria-label={`${row.term} 中文意思`} value={row.meaning} maxLength={160} placeholder={suggestion ? '先核对英文拼写' : '等待补全'} disabled={locked} onChange={event => edit('meaning', event.target.value)} /></label>
      <label><span>词性</span><select aria-label={`${row.term} 词性`} value={row.partOfSpeech ?? ''} disabled={locked} onChange={event => edit('partOfSpeech', event.target.value)}><option value="">待补全</option>{partsOfSpeech.map(pos => <option key={pos} value={pos}>{partOfSpeechLabels[pos]}</option>)}</select></label>
    </div>
    {editing && <form className="prep-term-editor" onSubmit={event => { event.preventDefault(); void apply(term); }}><label>修改英文<input aria-label={`修改 ${row.term}`} value={term} onChange={event => setTerm(event.target.value)} maxLength={80} autoFocus disabled={locked} autoComplete="off" spellCheck={false} /></label><button type="submit" className="prep-secondary" disabled={locked || !term.trim()}>保存并补全此词</button><button type="button" className="prep-text-button" disabled={locked} onClick={() => setEditing(false)}>取消</button><p>只重新补全这个词，其他词的核对内容保留。</p></form>}
    {suggestion && <div className="prep-spelling-suggestion"><div className="prep-suggestion-icon" aria-hidden="true">?</div><div className="prep-suggestion-copy"><strong>你想输入的是 <span lang="en">{suggestion.term}</span> 吗？</strong><p>{suggestion.reason}</p><div className="prep-suggestion-actions"><button type="button" className="prep-suggestion-accept" disabled={locked} onClick={() => void apply(suggestion.term)}>改为 <span lang="en">{suggestion.term}</span> 并补全 <span aria-hidden="true">→</span></button><button type="button" className="prep-text-button" disabled={locked} onClick={keep}>保留原词</button></div></div></div>}
    {row.usageNote && !suggestion && <p className="prep-sense-note">请留意：{row.usageNote}</p>}
    {!complete && !suggestion && <div className="prep-row-retry"><span>{row.usageNote ? '可直接修改英文，或手动补齐。' : '补全后再核对中文与配图。'}</span><button type="button" className="prep-text-button" disabled={locked} onClick={retry}>仅补全此词</button></div>}
    <details className="prep-vocabulary-detail"><summary>配图思路与游戏</summary><label>图片要表现什么<textarea aria-label={`${row.term} 配图说明`} value={row.pictureHint ?? ''} maxLength={300} rows={2} disabled={locked} placeholder="由 Codex 根据选定词义准备，也可手动填写" onChange={event => edit('pictureHint', event.target.value)} /></label><p>游戏：{wordGamePlan(row, spellingEnabled).slice(1).map(game => game.title).join(' · ')}</p></details>
  </article>;
}

interface Props { spellingEnabled: boolean; hasBooks: boolean; back: () => void; confirmed: (state: AppState, pack: WordPack | undefined) => Promise<void>; packIds: string[] }
export function EnglishImport({ spellingEnabled, hasBooks, back, confirmed, packIds }: Props) {
  const [source, setSource] = useState(''), [title, setTitle] = useState('我的第一本词书');
  const [preview, setPreview] = useState<ConfirmedPackPreview | null>(null), [job, setJob] = useState<ImportPreparation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [filter, setFilter] = useState<'all' | 'pending'>('all');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const mounted = useRef(true), revision = useRef(0), file = useRef<HTMLInputElement>(null), jobRef = useRef<ImportPreparation | null>(null);
  const draftRows = useRef<ImportRow[]>([]), sourceRows = useRef<ImportRow[]>([]);
  const remember = (rows: ImportRow[]) => { draftRows.current = rows; return rows; };
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
        if (!disposed && mounted.current && request === revision.current) { setJob(next); setPreview(current => current ? { ...current, rows: remember(next.rows) } : current); setError(next.error ?? ''); }
      } catch (failure) { if (!disposed && mounted.current && request === revision.current) setError(`${errorMessage(failure)}，正在重新读取；也可以停止补全。`); }
      finally { polling = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 1200);
    return () => { disposed = true; clearInterval(timer); };
  }, [job?.id, job?.status]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [Boolean(preview)]);
  const act = async (action: () => Promise<void>): Promise<boolean> => {
    if (busy) return false; setBusy(true); setError('');
    try { await action(); return true; } catch (failure) { if (mounted.current) setError(errorMessage(failure)); return false; }
    finally { if (mounted.current) setBusy(false); }
  };
  const updateSource = (text: string) => { revision.current++; setSource(text); setPreview(null); setJob(null); setError(''); };
  const enrich = async (rows: ImportRow[], text: string, request: number, onlyTerms?: string[]) => {
    if (!rows.some(row => needsImportEnrichment(row) && (!onlyTerms || onlyTerms.includes(row.term)))) { setJob(null); return; }
    const started = await post<ImportPreparation>('/api/import/enrich', { text, rows, ...(onlyTerms ? { onlyTerms } : {}) });
    if (!mounted.current || request !== revision.current) { void post(`/api/import/enrich/${started.id}/cancel`).catch(() => {}); return; }
    setJob(started); setPreview(current => current ? { ...current, rows: remember(started.rows) } : current);
  };
  const prepare = () => void act(async () => {
    const request = ++revision.current;
    const parsed = await post<PackPreview>('/api/import/preview', { text: source });
    if (!mounted.current || request !== revision.current) return;
    if (parsed.errors.length) { setPreview({ ...parsed, source }); return; }
    const rows = reconcileImportRows(parsed.rows, draftRows.current, sourceRows.current);
    sourceRows.current = parsed.rows; remember(rows); setPreview({ ...parsed, rows, source });
    await enrich(rows, source, request);
  });
  const retry = (onlyTerms?: string[]) => void act(async () => { if (preview) await enrich(preview.rows, source, ++revision.current, onlyTerms); });
  const stop = () => void act(async () => { if (!job) return; revision.current++; const next = await post<ImportPreparation>(`/api/import/enrich/${job.id}/cancel`); if (mounted.current) { setJob(next); setPreview(current => current ? { ...current, rows: remember(next.rows) } : current); } });
  const backToSource = () => void act(async () => {
    revision.current++;
    if (job?.status === 'running') { const stopped = await post<ImportPreparation>(`/api/import/enrich/${job.id}/cancel`); if (!mounted.current) return; remember(stopped.rows); }
    setPreview(null); setJob(null); setError(''); setEditingIndex(null);
  });
  const edit = (index: number, field: 'meaning' | 'partOfSpeech' | 'pictureHint', value: string) => {
    revision.current++; setError(''); setJob(null);
    setPreview(current => current ? { ...current, rows: remember(current.rows.map((row, at) => {
      if (at !== index || row[field] === value) return row;
      const next = { ...row, [field]: value || undefined };
      if (field === 'meaning') next.meaning = value;
      if (field === 'meaning' || field === 'partOfSpeech') { delete next.pictureHint; delete next.usageNote; }
      return next;
    })) } : current);
  };
  const correct = (index: number, term: string) => act(async () => {
    if (!preview) return;
    const rows = correctImportTerm(preview.rows, index, term), text = importRowsSource(rows), request = ++revision.current;
    setEditingIndex(null);
    sourceRows.current = rows.map(row => ({ term: row.term, meaning: row.meaning }));
    remember(rows); setSource(text); setJob(null); setPreview({ ...preview, source: text, rows });
    await enrich(rows, text, request, [rows[index].term]);
  });
  const keep = (index: number) => {
    revision.current++; setJob(null); setError('');
    setPreview(current => current ? { ...current, rows: remember(current.rows.map((row, at) => { if (at !== index) return row; const { spellingSuggestion: _advice, ...original } = row; return original; })) } : current);
  };
  const complete = preview?.rows.filter(isEnrichedRow).length ?? 0, total = preview?.rows.length ?? 0;
  const suggested = preview?.rows.filter(row => row.spellingSuggestion).length ?? 0;
  const missing = preview?.rows.filter(needsImportEnrichment).length ?? 0;
  const valid = editingIndex === null && canConfirmPack(title, source, preview, true);
  const confirm = () => void act(async () => {
    if (!valid || !preview) return;
    const state = await post<AppState>('/api/packs', { title: title.trim(), rows: preview.rows, requireEnriched: true, imageTheme: visualTheme.id });
    await confirmed(state, state.packs.find(pack => !packIds.includes(pack.id)));
  });
  return <section className="prep-import" aria-labelledby="prep-import-title">
    <div className="prep-import-heading"><div><span className="prep-kicker">第 1 步</span><h2 id="prep-import-title">{preview ? preview.errors.length ? '检查一下英文' : '核对这次要学的意思' : '只要粘贴英文'}</h2><p>{preview ? preview.errors.length ? '修改后再试，已补全的草稿会保留。' : '英文有误可以在原行修改，已补全的其他词会保留。' : '每行一个单词或短语，中文和词性交给 Codex。'}</p></div>{hasBooks && <button className="prep-text-button" disabled={locked} onClick={back}>返回词表</button>}</div>
    {!preview && <>{draftRows.current.length > 0 && <p className="prep-draft-retained" role="status">已保留 {draftRows.current.filter(isEnrichedRow).length} 个词的补全内容与人工修改。继续核对时，只补新增或修改的词。</p>}<label className="field-label" htmlFor="words-input">英文单词或短语</label><textarea id="words-input" value={source} onChange={event => updateSource(event.target.value)} placeholder={'apple\njump\nhappy'} rows={7} spellCheck={false} disabled={locked} /><div className="prep-import-tools"><input ref={file} type="file" accept=".csv,.tsv,.txt" hidden onChange={event => { const selected = event.target.files?.[0]; if (selected) { const request = ++revision.current; void selected.text().then(text => { if (mounted.current && request === revision.current) updateSource(text); }).catch(failure => setError(errorMessage(failure))); } event.target.value = ''; }} /><button type="button" className="prep-secondary prep-file-import" disabled={locked} onClick={() => file.current?.click()}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m-4 4 4-4 4 4M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>从文件导入</button></div></>}
    <div className="prep-name-field"><label className="field-label" htmlFor="pack-title">词表名字</label><input id="pack-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={60} disabled={locked} /></div>
    {preview?.errors.length ? <div className="inline-warning" role="alert">{preview.errors.map((message, i) => <p key={i}>{message}</p>)}</div> : null}
    {preview && !preview.errors.length && <>
      <div className={`prep-enrichment-status${suggested ? ' needs-attention' : ''}`}><div role="status"><strong>{running ? 'Codex 正在补全' : complete === total ? '词义草稿已备好' : suggested ? `${suggested} 个词需要核对拼写` : job?.status === 'stopped' ? '已停止，草稿保留' : '继续补齐这份词表'}</strong><span>已补全 {complete} / {total} 词{suggested > 0 ? ' · 在下方确认建议即可' : complete > 0 && complete < total ? ' · 已完成内容保留' : ' · 确认前仍可修改'}</span></div>{running ? <button className="prep-text-button" disabled={busy} onClick={stop}>停止补全</button> : missing > 0 ? <button className="prep-secondary" disabled={busy} onClick={() => retry()}>只补缺项 · {missing} 词</button> : <span className="prep-status-symbol" aria-hidden="true">{complete === total ? '✓' : '?'}</span>}</div>
      <div className="prep-review-toolbar"><div className="prep-review-filters" role="group" aria-label="筛选词义草稿"><button type="button" aria-pressed={filter === 'all'} disabled={editingIndex !== null} onClick={() => setFilter('all')}>全部 <span>{total}</span></button><button type="button" aria-pressed={filter === 'pending'} disabled={editingIndex !== null} onClick={() => setFilter('pending')}>待处理 <span>{total - complete}</span></button></div><span>{editingIndex !== null ? '保存或取消英文修改后继续' : '英文、中文都可直接修改'}</span></div>
      <div className="prep-vocabulary-list" aria-label="可编辑的词义草稿">{preview.rows.map((row, i) => filter === 'pending' && isEnrichedRow(row) ? null : <VocabularyReviewRow key={`${i}:${row.term}`} row={row} number={i + 1} locked={locked || editingIndex !== null && editingIndex !== i} spellingEnabled={spellingEnabled} editing={editingIndex === i} setEditing={open => setEditingIndex(open ? i : null)} edit={(field, value) => edit(i, field, value)} correct={term => correct(i, term)} keep={() => keep(i)} retry={() => retry([row.term])} />)}{filter === 'pending' && complete === total && <div className="prep-review-done"><strong>所有词都已补齐</strong><p>可以切回全部核对，确认后再准备素材。</p><button type="button" className="prep-text-button" onClick={() => setFilter('all')}>查看全部 {total} 词</button></div>}</div>
    </>}
    {error && <p className="pack-error" role="alert">{error}</p>}
    <div className="prep-import-footer">{preview ? <><button className="prep-text-button" disabled={busy} onClick={backToSource}>{running ? '停止并修改整份英文' : '← 修改整份英文'}</button><div className="prep-import-commit"><span className="prep-confirm-hint">{!preview.errors.length && total > complete ? `还有 ${total - complete} 词待处理` : !preview.errors.length ? `${total} 词待你确认` : '修正英文后继续'}</span><button className="prep-primary" disabled={locked || !valid} onClick={confirm}>确认词义并准备素材<span>→</span></button></div></> : <button className="prep-primary" disabled={locked || !source.trim()} onClick={prepare}>{busy ? '正在检查…' : draftRows.current.length ? '继续核对，只补改动' : '让 Codex 补全'}<span>→</span></button>}</div>
  </section>;
}
