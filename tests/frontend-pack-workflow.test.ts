import test from 'node:test';
import assert from 'node:assert/strict';
import type { PackAudioStatus, Word, WordPack } from '../shared/contracts';
import { canConfirmPack, learningAnswerOptions, packPreparation, parentPreparationNeeded, selectedPackWords } from '../src/pack-workflow';

const pack: WordPack = { id: 'p', title: '学校单词', enabled: false, createdAt: '', confirmedAt: '2026-10-16T10:00:00Z' };
const sample: WordPack = { id: 'sample', title: '12个示例', enabled: false, createdAt: '', isSample: true };
const word = (id: string, extra: Partial<Word> = {}): Word => ({ id, term: id, packId: 'p', meaning: `${id}的意思`, imageUrl: '/real.svg', imageSource: 'builtin', assetStatus: 'approved', ...extra });
const audio = (words: Word[], extra: Partial<PackAudioStatus> = {}): PackAudioStatus => ({ packId: 'p', status: 'ready', total: words.length, cached: words.length, words: words.map(item => ({ wordId: item.id, term: item.term, cached: true })), ...extra });

test('confirming a word list requires the exact server-validated source, a title, nonempty rows and zero errors', () => {
  const source = 'apple\t苹果'; const preview = { source, rows: [{ term: 'apple', meaning: '苹果' }], errors: [] };
  assert.equal(canConfirmPack('  学校  ', source, preview), true);
  assert.equal(canConfirmPack('词书', source + '\ncat\t猫', preview), false);
  assert.equal(canConfirmPack('词书', source, { ...preview, errors: ['第2行缺中文'] }), false);
  assert.equal(canConfirmPack('词书', source, { ...preview, rows: [] }), false);
  assert.equal(canConfirmPack(' ', source, preview), false); assert.equal(canConfirmPack('词书', source, null), false);
});

test('a confirmed pack cannot enable before at least one real image is approved, even if all audio is cached', () => {
  const words = [word('apple', { assetStatus: 'draft', imageUrl: '' })];
  assert.equal(packPreparation(pack, words, audio(words)).canEnable, false);
  assert.equal(packPreparation(pack, [word('apple', { imageUrl: '' })], audio(words)).canEnable, false);
});

test('all image-approved words need matching cached audio; running, stopped and error states do not manufacture readiness', () => {
  const words = [word('apple'), word('cat')];
  for (const status of ['running', 'stopped', 'error'] as const) {
    const result = packPreparation(pack, words, audio(words, { status, cached: 2, words: [{ wordId: 'apple', term: 'apple', cached: true }, { wordId: 'cat', term: 'cat', cached: false }] }));
    assert.equal(result.canEnable, false); assert.equal(result.cached, 1); assert.equal(result.approvedCached, 1); assert.deepEqual(result.missingAudio.map(item => item.id), ['cat']);
  }
});

test('a ready image-approved subset can enable while unapproved words still need audio or images', () => {
  const words = [word('apple'), word('cat', { assetStatus: 'review' }), word('dog', { assetStatus: 'draft', imageUrl: '' })];
  const result = packPreparation(pack, words, audio([words[0]], { status: 'running', total: 3 }));
  assert.equal(result.canEnable, true); assert.equal(result.approved, 1); assert.equal(result.total, 3); assert.equal(result.reviewing, 1); assert.equal(result.cached, 1);
});

test('stale audio from another pack or the previous spelling cannot permit activation', () => {
  const words = [word('apple', { term: 'apricot' })];
  assert.equal(packPreparation(pack, words, audio([word('apple')])).canEnable, false);
  assert.equal(packPreparation(pack, [word('apple')], audio([word('apple')], { packId: 'other' })).canEnable, false);
  assert.equal(packPreparation(pack, [word('apple')]).canEnable, false);
});

test('sample eligibility is explicit and separate; no enabled sample or suspended historical plan makes home start learning', () => {
  const example = word('apple', { packId: 'sample' });
  assert.equal(parentPreparationNeeded([sample], [example]), true);
  assert.equal(parentPreparationNeeded([{ ...sample, enabled: true }], [example]), false);
  assert.equal(packPreparation(sample, [example]).canEnable, true);
  assert.equal(parentPreparationNeeded([{ ...pack, enabled: true }], [word('cat', { assetStatus: 'review' })]), true);
});

test('current pack scope excludes sample and other-pack words from bulk image actions and counts', () => {
  const words = [word('apple'), word('cat', { packId: 'other' }), word('dog', { packId: 'sample' })];
  assert.deepEqual(selectedPackWords(words, 'p').map(item => item.id), ['apple']);
  assert.deepEqual(selectedPackWords(words, ''), []); assert.equal(packPreparation(pack, words, audio(words)).total, 1);
});

test('a one-word formal list stays a practice choice instead of borrowing sample words as false assessment alternatives', () => {
  const target = word('apple'); const examples = [word('cat', { packId: 'sample', imageUrl: '/cat.svg' }), word('dog', { packId: 'sample', imageUrl: '/dog.svg' })];
  const choices = learningAnswerOptions(target, [target, ...examples], [pack, { ...sample, enabled: true }]);
  assert.equal(choices.length < 2, true); assert.deepEqual(choices.map(item => item.id), ['apple']);
});

test('duplicate words regardless of English case and duplicate pictures cannot become distinguishable answer choices', () => {
  const target = word('apple', { imageUrl: '/apple.svg' });
  const choices = learningAnswerOptions(target, [word('case', { term: ' APPLE ', imageUrl: '/other.svg' }), word('same-picture', { imageUrl: '/apple.svg' }), word('cat', { imageUrl: '/cat.svg' }), word('cat-copy', { term: 'CAT', imageUrl: '/cat2.svg' })], [pack]);
  assert.deepEqual(choices.map(item => item.id), ['apple', 'cat']);
});

test('formal distinct approved words form choices while drafts and reused pictures remain outside them', () => {
  const target = word('apple', { imageUrl: '/apple.svg' });
  const choices = learningAnswerOptions(target, [word('cat', { imageUrl: '/cat.svg' }), word('draft', { assetStatus: 'draft', imageUrl: '/draft.svg' }), word('dog', { imageUrl: '/dog.svg' }), word('bird', { imageUrl: '/bird.svg' })], [pack]);
  assert.deepEqual(choices.map(item => item.id), ['apple', 'cat', 'dog']);
});

test('identical Chinese senses cannot be distractors even with different English and pictures', () => {
  const target = word('big', { meaning: '大的', imageUrl: '/big.png' });
  assert.deepEqual(learningAnswerOptions(target, [word('large', { meaning: '大的', imageUrl: '/large.png' }), word('small', { meaning: '小的', imageUrl: '/small.png' })], [pack]).map(item => item.id), ['big', 'small']);
});
