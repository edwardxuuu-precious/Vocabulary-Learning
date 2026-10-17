import type { ImportRow, PartOfSpeech, Word } from './contracts.ts';

export const partOfSpeechLabels: Record<PartOfSpeech, string> = {
  noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', pronoun: '代词',
  preposition: '介词', conjunction: '连词', interjection: '感叹词', determiner: '限定词',
  numeral: '数词', phrase: '短语', other: '其他',
};
export const partsOfSpeech = Object.keys(partOfSpeechLabels) as PartOfSpeech[];
export function isEnrichedRow(row: ImportRow) {
  return Boolean(typeof row?.meaning === 'string' && row.meaning.trim() && row.partOfSpeech && partsOfSpeech.includes(row.partOfSpeech) && typeof row.pictureHint === 'string' && row.pictureHint.trim());
}

/** Host-owned game templates bind to the reviewed word, picture and cached audio. No generated code is run. */
export function wordGamePlan(word: Pick<Word, 'term' | 'partOfSpeech'>, spellingEnabled = false) {
  return [
    { step: 'learn' as const, title: word.partOfSpeech === 'verb' ? '看看这个动作' : word.partOfSpeech === 'adjective' ? '看看它的样子' : '认识新朋友' },
    { step: 'listen' as const, title: '听声音，找图片' },
    { step: 'sound' as const, title: '哪个声音是它？' },
    { step: 'recall' as const, title: '自己说一说' },
    ...(spellingEnabled && /^[a-z]+$/i.test(word.term) ? [{ step: 'spell' as const, title: '把字母排排队' }] : []),
  ];
}
