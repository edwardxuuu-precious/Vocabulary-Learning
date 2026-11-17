import type { ImportRow } from './contracts.ts';
import { isEnrichedRow } from './vocabulary.ts';

/** Reuse by exact English identity, never by row position or guessed similarity. */
export function reconcileImportRows(parsed: ImportRow[], drafts: ImportRow[], original: ImportRow[] = []): ImportRow[] {
  const saved = new Map(drafts.map(row => [row.term, row]));
  const sources = new Map(original.map(row => [row.term, row]));
  return parsed.map(row => {
    const previous = saved.get(row.term), source = sources.get(row.term);
    if (!previous) return { ...row };
    const changedMeaning = source ? row.meaning !== source.meaning : Boolean(row.meaning && row.meaning !== previous.meaning);
    if (changedMeaning) return { ...row };
    return { ...previous };
  });
}

export const needsImportEnrichment = (row: ImportRow) => !isEnrichedRow(row) && !row.spellingSuggestion;
export const importRowsSource = (rows: ImportRow[]) => rows.map(row => row.term + (row.meaning ? '\t' + row.meaning : '')).join('\n');

/** A changed spelling cannot inherit a different term's meaning, scene or model advice. */
export function correctImportTerm(rows: ImportRow[], index: number, value: string): ImportRow[] {
  const term = value.trim().replace(/\s+/g, ' ');
  if (!term || term.length > 80 || !/^[A-Za-z][A-Za-z '\-]*$/.test(term)) throw Error('请填写有效的英文单词或短语。');
  if (rows.some((row, at) => at !== index && row.term.toLowerCase() === term.toLowerCase())) throw Error(`「${term}」已在词表中，请换一个词或返回删除重复行。`);
  return rows.map((row, at) => at !== index || row.term === term ? row : { term, meaning: '' });
}
