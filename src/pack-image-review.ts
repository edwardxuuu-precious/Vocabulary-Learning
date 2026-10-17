import type { Word } from '../shared/contracts';

export interface ImageReviewSelection { wordId: string; imageUrl: string; term: string; meaning: string; learningVersion?: number }
export const isPreparedImage = (url: string) => Boolean(url && !/(?:^|\/)assets\/placeholder\.svg(?:[?#]|$)/i.test(url));
export function imageReviewSnapshot(word: Word): ImageReviewSelection | null {
  if (word.assetStatus !== 'review' || !isPreparedImage(word.imageUrl)) return null;
  return { wordId: word.id, imageUrl: word.imageUrl, term: word.term, meaning: word.meaning, learningVersion: word.learningVersion ?? 0 };
}
const matches = (left: ImageReviewSelection, right: ImageReviewSelection) => left.wordId === right.wordId && left.imageUrl === right.imageUrl
  && left.term === right.term && left.meaning === right.meaning && (left.learningVersion ?? 0) === (right.learningVersion ?? 0);

/** A selection can approve only the exact image and meaning the parent saw, in this pack. */
export function reconcileImageSelections(packId: string, words: Word[], selections: ImageReviewSelection[], failedImages: ReadonlySet<string> = new Set()) {
  const members = new Map(words.filter(word => word.packId === packId).map(word => [word.id, word]));
  const seen = new Set<string>();
  return selections.filter(selected => {
    const word = members.get(selected.wordId), current = word ? imageReviewSnapshot(word) : null;
    if (!current || failedImages.has(current.imageUrl) || seen.has(selected.wordId) || !matches(selected, current)) return false;
    seen.add(selected.wordId); return true;
  });
}

export function toggleImageSelection(packId: string, words: Word[], selections: ImageReviewSelection[], word: Word) {
  const valid = reconcileImageSelections(packId, words, selections);
  if (valid.some(item => item.wordId === word.id)) return valid.filter(item => item.wordId !== word.id);
  const snapshot = word.packId === packId ? imageReviewSnapshot(word) : null;
  const currentWord = words.find(item => item.id === word.id && item.packId === packId);
  const current = currentWord ? imageReviewSnapshot(currentWord) : null;
  return snapshot && current && matches(snapshot, current) ? [...valid, snapshot] : valid;
}

export function selectVisibleReviewImages(packId: string, visibleWords: Word[], failedImages: ReadonlySet<string> = new Set()) {
  return visibleWords.filter(word => word.packId === packId && !failedImages.has(word.imageUrl)).map(imageReviewSnapshot).filter((item): item is ImageReviewSelection => item !== null);
}
