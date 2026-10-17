import test from 'node:test';
import assert from 'node:assert/strict';
import type { Word } from '../shared/contracts';
import { imageReviewSnapshot, isPreparedImage, reconcileImageSelections, selectVisibleReviewImages, toggleImageSelection } from '../src/pack-image-review';
import { packPreparation } from '../src/pack-workflow';

const word = (id: string, extra: Partial<Word> = {}): Word => ({ id, packId: 'p', term: id, meaning: '苹果', imageUrl: `/media/${id}.png`, assetStatus: 'review', imageSource: 'codex', learningVersion: 0, ...extra });

test('a placeholder, missing picture, draft or already-approved word cannot enter a review snapshot', () => {
  for (const imageUrl of ['', '/assets/placeholder.svg', '/assets/placeholder.svg?v=3', 'https://local/assets/placeholder.svg#preview']) {
    assert.equal(isPreparedImage(imageUrl), false); assert.equal(imageReviewSnapshot(word('a', { imageUrl })), null);
  }
  assert.equal(imageReviewSnapshot(word('a', { assetStatus: 'approved' })), null);
  assert.equal(imageReviewSnapshot(word('a', { assetStatus: 'draft' })), null);
});

test('the selection copies exactly the visible URL, English, meaning and learning version; later object mutation cannot silently change it', () => {
  const shown = word('a', { learningVersion: 4 }); const snapshot = imageReviewSnapshot(shown)!;
  assert.deepEqual(snapshot, { wordId: 'a', imageUrl: '/media/a.png', term: 'a', meaning: '苹果', learningVersion: 4 });
  shown.meaning = '树'; assert.equal(snapshot.meaning, '苹果'); assert.deepEqual(reconcileImageSelections('p', [shown], [snapshot]), []);
});

test('redraw, term change, sense change and version change each discard only the stale image selection', () => {
  const first = word('a'), second = word('b'); const selections = [imageReviewSnapshot(first)!, imageReviewSnapshot(second)!];
  for (const extra of [{ imageUrl: '/media/new.png' }, { term: 'another' }, { meaning: '梨' }, { learningVersion: 1 }, { assetStatus: 'generating' as const }]) {
    assert.deepEqual(reconcileImageSelections('p', [{ ...first, ...extra }, second], selections).map(item => item.wordId), ['b']);
  }
});

test('a queued batch cannot confirm a selection from another pack, and repeated entries do not approve twice', () => {
  const first = word('a'), other = word('b', { packId: 'q' });
  const selected = [imageReviewSnapshot(first)!, imageReviewSnapshot(other)!, imageReviewSnapshot(first)!];
  assert.deepEqual(reconcileImageSelections('p', [first, other], selected).map(item => item.wordId), ['a']);
  assert.deepEqual(reconcileImageSelections('q', [first, other], selected).map(item => item.wordId), ['b']);
});

test('select all uses only the displayed page of genuine pending reviews, never hidden pages or approved pictures', () => {
  const displayed = [word('a'), word('b', { assetStatus: 'approved' }), word('c', { imageUrl: '/assets/placeholder.svg' }), word('d', { packId: 'q' })];
  const hiddenPage = word('not-seen');
  const selected = selectVisibleReviewImages('p', displayed);
  assert.deepEqual(selected.map(item => item.wordId), ['a']); assert.ok(!selected.some(item => item.wordId === hiddenPage.id));
});

test('toggle selects an exact current review or removes it, while a stale prior selection is pruned before a different choice is added', () => {
  const first = word('a'), second = word('b'); let selected = toggleImageSelection('p', [first, second], [], first);
  assert.equal(selected.length, 1); selected = toggleImageSelection('p', [first, second], selected, first); assert.deepEqual(selected, []);
  const stale = imageReviewSnapshot(first)!; first.imageUrl = '/media/replacement.png';
  selected = toggleImageSelection('p', [first, second], [stale], second); assert.deepEqual(selected.map(item => item.wordId), ['b']);
  assert.deepEqual(toggleImageSelection('p', [first, second], selected, word('other', { packId: 'q' })).map(item => item.wordId), ['b']);
});

test('identical URLs with a changed meaning do not inherit approval, while an absent legacy version is equivalent only to version zero', () => {
  const shown = word('a', { learningVersion: undefined }); const snapshot = imageReviewSnapshot(shown)!;
  assert.equal(snapshot.learningVersion, 0); assert.equal(reconcileImageSelections('p', [shown], [snapshot]).length, 1);
  shown.meaning = '苹果树'; assert.equal(reconcileImageSelections('p', [shown], [snapshot]).length, 0);
  shown.meaning = '苹果'; shown.learningVersion = 1; assert.equal(reconcileImageSelections('p', [shown], [snapshot]).length, 0);
});

test('an unavailable image is removed from selection and select-all; retrying never silently restores its old selection', () => {
  const first = word('a'), second = word('b'), unavailable = new Set([first.imageUrl]);
  const selected = [imageReviewSnapshot(first)!, imageReviewSnapshot(second)!];
  const valid = reconcileImageSelections('p', [first, second], selected, unavailable);
  assert.deepEqual(valid.map(item => item.wordId), ['b']);
  assert.deepEqual(selectVisibleReviewImages('p', [first, second], unavailable).map(item => item.wordId), ['b']);
  unavailable.clear();
  assert.deepEqual(reconcileImageSelections('p', [first, second], valid, unavailable).map(item => item.wordId), ['b']);
});

test('a stale clicked card cannot select a replaced image or a deleted word', () => {
  const before = word('a'), current = { ...before, imageUrl: '/media/replaced.png' };
  assert.deepEqual(toggleImageSelection('p', [current], [], before), []);
  assert.deepEqual(toggleImageSelection('p', [], [], before), []);
});

test('a placeholder marked approved cannot unlock a word book even when audio is cached', () => {
  const first = word('a', { assetStatus: 'approved', imageUrl: '/assets/placeholder.svg' });
  const ready = packPreparation({ id: 'p', title: '正式词书', enabled: false, createdAt: '' }, [first], { packId: 'p', status: 'ready', total: 1, cached: 1, words: [{ wordId: 'a', term: 'a', cached: true }] });
  assert.equal(ready.approved, 0); assert.equal(ready.canEnable, false);
});
