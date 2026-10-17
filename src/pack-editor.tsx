import { useState } from 'react';
import type { AppState, PackEditRow, Word, WordPack } from '../shared/contracts';
import { packContentRevision, partOfSpeechLabels, partsOfSpeech } from '../shared/vocabulary';
import { api, errorMessage, patch } from './api';

interface Props {
  pack: WordPack;
  words: Word[];
  reload: () => Promise<AppState>;
  saved: (deleted: boolean) => void;
  cancel: () => void;
}
type DraftRow = PackEditRow & { key: string };

export function PackEditor({ pack, words, reload, saved, cancel }: Props) {
  const [initial] = useState(() => ({ pack, words: words.filter(word => word.packId === pack.id), revision: packContentRevision(pack, words) }));
  const [title, setTitle] = useState(pack.title);
  const [rows, setRows] = useState<DraftRow[]>(() => initial.words.map(word => ({ key: word.id, id: word.id, term: word.term, meaning: word.meaning, partOfSpeech: word.partOfSpeech })));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState(false);
  const removed = initial.words.filter(word => !rows.some(row => row.id === word.id));
  const update = (key: string, value: Partial<DraftRow>) => setRows(previous => previous.map(row => row.key === key ? { ...row, ...value } : row));
  const save = async (deletePack = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (deletePack) await api(`/api/packs/${encodeURIComponent(pack.id)}`, { method: 'DELETE' });
      else await patch(`/api/packs/${encodeURIComponent(pack.id)}`, { title, revision: initial.revision, rows: rows.map(({ key, ...row }) => row) });
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); return; }
    // A refresh failure must not leave an already-saved editor open for a duplicate submission.
    try { await reload(); } catch { /* Parent polling retries the state read. */ }
    saved(deletePack);
  };
  return <section className="pack-editor" aria-labelledby="pack-editor-title">
    <div className="pack-editor-heading"><h2 id="pack-editor-title">编辑词表</h2><button type="button" className="prep-secondary" disabled={busy} onClick={cancel}>取消编辑</button></div>
    <p className="pack-editor-note">可以修改名称、英文、中文意思和词性，也可以增删单词。修改过的词会暂停学习，重新准备并确认图片和发音后再使用；未修改的词保留素材和进度。</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || deleting}>
        <label className="field-label" htmlFor="pack-edit-title">词表名称</label><input id="pack-edit-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={80} required autoFocus />
        <div className="pack-editor-rows">{rows.map((row, index) => <div className="pack-editor-row" key={row.key}>
          <label>英文<input aria-label={`第${index + 1}行英文`} value={row.term} maxLength={60} required onChange={event => update(row.key, { term: event.target.value })} /></label>
          <label>中文意思<input aria-label={`第${index + 1}行中文意思`} value={row.meaning} maxLength={120} required onChange={event => update(row.key, { meaning: event.target.value })} /></label>
          <label>词性<select aria-label={`第${index + 1}行词性`} value={row.partOfSpeech ?? ''} onChange={event => update(row.key, { partOfSpeech: event.target.value ? event.target.value as Word['partOfSpeech'] : undefined })}><option value="">未标注</option>{partsOfSpeech.map(pos => <option key={pos} value={pos}>{partOfSpeechLabels[pos]}</option>)}</select></label>
          <button type="button" className="prep-text-button pack-delete-button" aria-label={`删除第${index + 1}行 ${row.term}`} onClick={() => setRows(previous => previous.filter(item => item.key !== row.key))}>删除</button>
        </div>)}</div>
        <button type="button" className="prep-secondary" onClick={() => setRows(previous => [...previous, { key: crypto.randomUUID(), term: '', meaning: '' }])}>＋ 添加单词</button>
        {!rows.length && <p className="pack-editor-note">词表至少保留一个单词；如果整本都不需要了，可以删除词表。</p>}
        {removed.length > 0 && <p className="pack-editor-removals" role="status">保存后删除 {removed.length} 个词：{removed.map(word => word.term).join('、')}。历史学习记录保留；取消编辑可撤回。</p>}
      </fieldset>
      {error && <p className="pack-error" role="alert">{error}</p>}
      {!deleting && <div className="pack-editor-actions"><button className="prep-primary" type="submit" disabled={busy || !title.trim() || !rows.length || rows.some(row => !row.term.trim() || !row.meaning.trim())}>{busy ? '正在保存…' : '保存词表'}</button><button className="prep-text-button pack-delete-button" type="button" disabled={busy} onClick={() => { setDeleting(true); setError(''); }}>删除整本词表</button></div>}
    </form>
    {deleting && <div className="pack-delete-confirm" role="alert"><h3>删除“{initial.pack.title}”？</h3><p>整本词表的 {initial.words.length} 个单词会从备课和孩子的学习选择中移除，包含这些词的未完成轮次会停止。已有学习记录和素材保留。</p><div className="pack-editor-actions"><button className="prep-secondary" disabled={busy} onClick={() => setDeleting(false)}>保留词表</button><button className="prep-secondary pack-delete-button" disabled={busy} onClick={() => void save(true)}>{busy ? '正在删除…' : '确认删除词表'}</button></div></div>}
  </section>;
}
