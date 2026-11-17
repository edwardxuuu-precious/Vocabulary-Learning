import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { companionBiographies, companionCharacters, companionFor, companionIds, originalCompanionIds } from '../shared/companions.ts';
import { illustrationPrompt } from '../server/integrations/codex.ts';

test('every catalogue companion has a distinct local portrait, including both factions', () => {
  assert.equal(companionIds.length, 100);
  assert.equal(companionIds.filter(id => companionCharacters[id].faction === 'autobot').length, 50);
  assert.equal(companionIds.filter(id => companionCharacters[id].faction === 'decepticon').length, 50);
  assert.equal(new Set(companionIds.map(id => companionCharacters[id].image)).size, companionIds.length);
  for (const id of companionIds) assert.ok(existsSync(resolve('public', '.' + companionCharacters[id].image)), `Missing portrait: ${id}`);
  assert.ok(companionIds.some(id => companionCharacters[id].faction === 'autobot'));
  assert.ok(companionIds.some(id => companionCharacters[id].faction === 'decepticon'));
});

test('all one hundred characters have distinct names, original biographies, and the original portraits keep their paths', () => {
  assert.equal(new Set(companionIds.map(id => companionCharacters[id].englishName)).size, 100);
  assert.equal(new Set(companionIds.map(id => companionCharacters[id].name)).size, 100);
  assert.equal(new Set(companionIds.map(id => companionBiographies[id])).size, 100);
  for (const id of companionIds) assert.ok(companionBiographies[id].length >= 80, id);
  assert.equal(originalCompanionIds.length, 20);
  for (const id of originalCompanionIds) assert.ok(!companionCharacters[id].image.includes('companions-v2/'), id);
  assert.ok(!companionIds.some(id => ['galvatron', 'rodimusprime', 'goldbug', 'orionpax'].includes(id)), 'An upgraded form must not count as another character.');
});

test('a task rotation visits all companions before repeating and restores the same companion', () => {
  for (const seed of ['session-a', 'session-b', '学习']) {
    const cycle = companionIds.map((_, at) => companionFor(seed, at));
    assert.equal(new Set(cycle).size, companionIds.length);
    assert.equal(companionFor(seed), companionFor(seed, companionIds.length));
    assert.equal(companionFor(seed, -1), cycle.at(-1));
    assert.equal(companionFor(seed, 3), companionFor(seed, 3));
  }
});

test('new image jobs vary the companion without changing the reviewed sense or weakening art rules', () => {
  const input = { term: 'make', meaning: '制作', partOfSpeech: 'verb' as const, interests: [], pictureHint: '把纸折成小船' };
  const prompts = Array.from({ length: 40 }, (_, at) => illustrationPrompt({ ...input, jobId: `fixture-${at}` }));
  const assignments = prompts.map(prompt => prompt.match(/Assigned supporting companion for this image: ([^.]+)\./)![1]);
  assert.ok(new Set(assignments).size >= 10);
  assert.equal(prompts[0], illustrationPrompt({ ...input, jobId: 'fixture-0' }));
  for (const prompt of prompts) {
    assert.ok(prompt.includes('"exactChineseMeaning":"制作"'));
    assert.ok(prompt.includes('把纸折成小船'));
    assert.match(prompt, /at most ONE small Transformer/);
    assert.match(prompt, /If a companion would confuse the meaning, omit the companion/);
    assert.match(prompt, /honor that reviewed choice/);
    assert.match(prompt, /No written words/);
  }
});
