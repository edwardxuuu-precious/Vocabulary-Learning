import assert from 'node:assert/strict';
import test from 'node:test';
import { assessmentCue } from '../shared/assessment-cues.ts';
import { sentenceIllustration } from '../shared/sentence-illustrations.ts';

test('a sentence gets its reviewed scene instead of reusing the word picture', () => {
  const black = { term: 'black', meaning: '黑色的', imageUrl: '/media/black-balloon.png' };
  const cue = assessmentCue(black);
  assert.equal(sentenceIllustration(black, cue)?.src, '/assets/sentence-scenes/black-backpack.png');
  assert.equal(sentenceIllustration(black, { ...cue, sentence: 'The balloon is ___.' }), undefined);
  assert.equal(sentenceIllustration(black, { ...cue, text: '这顶帽子是黑色的。' }), undefined);
  assert.equal(sentenceIllustration({ ...black, term: 'white' }, cue), undefined);
});

test('only the exact reviewed original may be reused as a sentence picture', () => {
  const brown = { term: 'brown', meaning: '棕色的', imageUrl: '/media/images/0dc71b7a-f2db-4300-8578-a69f69d699cf/illustration.png' };
  assert.equal(sentenceIllustration(brown)?.src, brown.imageUrl);
  assert.equal(sentenceIllustration({ ...brown, imageUrl: '/media/brown-table.png' }), undefined);
});
