import type { ImportRow, PackAudioStatus, Word, WordPack } from '../shared/contracts';
import { isPreparedImage } from './pack-image-review';
import { isEnrichedRow } from '../shared/vocabulary';

export interface PackPreview { rows: ImportRow[]; errors: string[] }
export interface ConfirmedPackPreview extends PackPreview { source: string }

/** Keep server validation bound to the exact pasted source; edits and stale responses invalidate confirmation. */
export function canConfirmPack(title: string, source: string, preview: ConfirmedPackPreview | null, requireEnriched = false) {
  return Boolean(title.trim() && preview && preview.source === source && preview.rows.length > 0 && !preview.errors.length && (!requireEnriched || preview.rows.every(isEnrichedRow)));
}

export function packPreparation(pack: WordPack, words: Word[], audio?: PackAudioStatus) {
  const members = words.filter(word => word.packId === pack.id);
  const approved = members.filter(word => word.assetStatus === 'approved' && isPreparedImage(word.imageUrl));
  const cached = new Set(audio?.packId === pack.id ? audio.words.filter(item => item.cached).map(item => `${item.wordId}\0${item.term}`) : []);
  const cachedCount = members.filter(word => cached.has(`${word.id}\0${word.term}`)).length;
  const approvedCached = approved.filter(word => cached.has(`${word.id}\0${word.term}`)).length;
  const canEnable = approved.length > 0 && (pack.isSample === true || approvedCached === approved.length);
  return { total: members.length, approved: approved.length, approvedCached, cached: cachedCount,
    reviewing: members.filter(word => word.assetStatus === 'review').length,
    missingImages: members.filter(word => word.assetStatus !== 'approved').length,
    missingAudio: members.filter(word => !cached.has(`${word.id}\0${word.term}`)),
    canEnable,
    blockedReason: !approved.length ? '先确认至少一张准确的单词图片。' : !canEnable ? '已确认图片的单词还需补齐发音，才能交给孩子。' : '',
  };
}

export function parentPreparationNeeded(packs: WordPack[], words: Word[]) {
  // Samples are usable only after an explicit parent enable action. Suspended historical sessions do not grant access.
  return !words.some(word => word.assetStatus === 'approved' && isPreparedImage(word.imageUrl) && packs.some(pack => pack.id === word.packId && pack.enabled));
}

export function selectedPackWords(words: Word[], packId: string) {
  return words.filter(word => word.packId === packId);
}

/** A real choice needs a different spoken answer and a different picture; samples never pad a formal assessment. */
export function learningAnswerOptions(target: Word, candidates: Word[], packs: WordPack[], limit = 3) {
  const sample = packs.find(pack => pack.id === target.packId)?.isSample === true;
  const terms = new Set([target.term.trim().toLowerCase()]), images = new Set([target.imageUrl]), meanings = new Set([target.meaning.trim()]);
  const choices = [target];
  for (const candidate of candidates) {
    if (choices.length >= limit) break;
    if (candidate.id === target.id || candidate.assetStatus !== 'approved' || !isPreparedImage(candidate.imageUrl)) continue;
    if ((packs.find(pack => pack.id === candidate.packId)?.isSample === true) !== sample) continue;
    const term = candidate.term.trim().toLowerCase();
    if (terms.has(term) || images.has(candidate.imageUrl) || meanings.has(candidate.meaning.trim())) continue;
    choices.push(candidate); terms.add(term); images.add(candidate.imageUrl); meanings.add(candidate.meaning.trim());
  }
  return choices;
}
