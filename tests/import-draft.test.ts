import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ImportRow } from '../shared/contracts.ts';
import { correctImportTerm, importRowsSource, reconcileImportRows } from '../shared/import-draft.ts';
import { isEnrichedRow } from '../shared/vocabulary.ts';
import { parseImport, validateRows } from '../server/store.ts';
import { validateVocabularyResult } from '../server/integrations/vocabulary.ts';
import { createImportPreparation } from '../server/import-preparation.ts';

const ready = (term: string, meaning = '苹果'): ImportRow => ({ term, meaning, partOfSpeech: 'noun', pictureHint: '家长核对过的配图说明', usageNote: '' });
const typo: ImportRow = { term: 'bananna', meaning: '', partOfSpeech: 'other', usageNote: '请核对英文', spellingSuggestion: { term: 'banana', reason: '常见的香蕉拼写为 banana，多输入了一个 n。' } };
async function settled(manager: ReturnType<typeof createImportPreparation>, id: string) {
  for (let i = 0; i < 100; i++) { const job = manager.get(id); if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw Error('isolated enrichment did not settle');
}

test('returning to English preserves manual edits and images for unchanged terms, with reorder/add/remove resolved by identity', () => {
  const original = parseImport('apple 苹果\nbananna\ncat').rows;
  const manual = ready('apple', '一颗红苹果'), cat = ready('cat', '猫');
  const rows = reconcileImportRows(parseImport('cat\napple 苹果\nbanana\njump').rows, [manual, typo, cat], original);
  assert.deepEqual(rows, [cat, manual, { term: 'banana', meaning: '' }, { term: 'jump', meaning: '' }]);
  assert.deepEqual(reconcileImportRows(original, [manual, typo, cat], original), [manual, typo, cat]);
  assert.deepEqual(reconcileImportRows(parseImport('apple 青苹果').rows, [manual], original), [{ term: 'apple', meaning: '青苹果' }]);
  assert.deepEqual(reconcileImportRows(parseImport('apple').rows, [manual], original), [{ term: 'apple', meaning: '' }]);
  assert.deepEqual(reconcileImportRows(parseImport('Apple').rows, [manual], original), [{ term: 'Apple', meaning: '' }]);
});

test('inline correction invalidates only that term and produces a preview-bound source; duplicates and malformed fixes keep the original intact', () => {
  const rows = [ready('apple'), typo, ready('cat', '猫')], snapshot = structuredClone(rows);
  const corrected = correctImportTerm(rows, 1, ' banana ');
  assert.deepEqual(corrected, [rows[0], { term: 'banana', meaning: '' }, rows[2]]);
  assert.deepEqual(parseImport(importRowsSource(corrected)).rows, corrected.map(row => ({ term: row.term, meaning: row.meaning })));
  assert.throws(() => correctImportTerm(rows, 1, 'Apple'), /已在词表/);
  assert.throws(() => correctImportTerm(rows, 1, 'banana42'), /有效/);
  assert.deepEqual(rows, snapshot);
});

test('model advice is bounded, proposal-only, exact-term preserving, and cannot bypass formal confirmation', () => {
  const input = [{ term: 'bananna', meaning: '' }], output = { ...typo, pictureHint: '' };
  assert.deepEqual(validateVocabularyResult({ rows: [output] }, input), [typo]);
  assert.equal(isEnrichedRow({ ...ready('bananna'), spellingSuggestion: typo.spellingSuggestion }), false);
  assert.ok(validateRows([{ ...ready('bananna'), spellingSuggestion: typo.spellingSuggestion }]).errors.length);
  assert.equal(validateRows([typo], true).errors.length, 0);
  for (const suggestion of [{ term: 'bananna', reason: '相同' }, { term: 'banana42', reason: '无效' }, { term: 'banana', reason: '' }, { term: 'banana', reason: '建议', execute: 'tool' }]) {
    assert.throws(() => validateVocabularyResult({ rows: [{ ...output, spellingSuggestion: suggestion }] }, input));
  }
  assert.throws(() => validateVocabularyResult({ rows: [{ ...output, term: 'banana' }] }, input));
  assert.deepEqual(validateVocabularyResult({ rows: [{ ...ready('apple'), spellingSuggestion: null }] }, [{ term: 'apple', meaning: '' }]), [ready('apple')]);
});

test('corrected single-word retry skips every other pending term, retains manual proposals, and does not retry unaccepted spelling advice', async () => {
  const calls: string[][] = [];
  const manager = createImportPreparation({ dataDir: 'unused', enrich: async input => { calls.push(input.rows.map(row => row.term)); return input.rows.map(row => ready(row.term, row.meaning || '香蕉')); } });
  try {
    const rows = [ready('apple', '家长修改的苹果'), { term: 'banana', meaning: '' }, { term: 'jump', meaning: '' }, typo];
    const source = importRowsSource(rows);
    let job = await settled(manager, manager.start(source, rows, ['banana']).id);
    assert.deepEqual(calls, [['banana']]); assert.equal(job.rows[0].meaning, '家长修改的苹果');
    assert.equal(job.rows[2].meaning, ''); assert.deepEqual(job.rows[3], typo);
    job = await settled(manager, manager.start(source, job.rows).id);
    assert.deepEqual(calls, [['banana'], ['jump']]); assert.equal(job.completed, 3); assert.deepEqual(job.rows[3], typo);
    assert.throws(() => manager.start(source, rows, ['missing']), { code: 'IMPORT_STALE' });
    assert.throws(() => manager.start(source, rows, ['banana', 'banana']), { code: 'IMPORT_STALE' });
  } finally { await manager.close(); }
});

test('real review-row component exposes local correction, explicit acceptance/keep and accessible editable fields', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { VocabularyReviewRow } = await vite.ssrLoadModule('/src/english-import.tsx');
    const props = { row: typo, number: 2, locked: false, spellingEnabled: false, edit() {}, correct: async () => true, keep() {}, retry() {} };
    const html = renderToStaticMarkup(createElement(VocabularyReviewRow, props));
    assert.match(html, /bananna/); assert.match(html, /banana/); assert.match(html, /保留原词/); assert.match(html, /并补全/);
    assert.match(html, /aria-label="修改 bananna 的英文"/); assert.match(html, /aria-label="bananna 中文意思"/);
    assert.match(html, /has-spelling-suggestion/); assert.match(html, /核对拼写/);
    const complete = renderToStaticMarkup(createElement(VocabularyReviewRow, { ...props, row: ready('apple') }));
    assert.match(complete, /已补全/); assert.doesNotMatch(complete, /prep-spelling-suggestion/);
  } finally { await vite.close(); }
});
