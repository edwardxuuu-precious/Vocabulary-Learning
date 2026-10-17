import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childGrowth } from '../shared/growth.ts';
import { assessmentDimensions } from '../shared/assessment.ts';
import { learningBackground, learningBackgrounds } from '../shared/learning-backgrounds.ts';
import type { AssessmentResult, Word } from '../shared/contracts.ts';
import { Store } from '../server/store.ts';

const now = new Date('2026-10-17T04:00:00Z');
type Data = Parameters<typeof childGrowth>[0];
const word = (id = 'apple', term = 'apple'): Word => ({ id, term, meaning: '苹果', packId: 'family', imageUrl: `/assets/${id}.png`, assetStatus: 'approved', imageSource: 'upload', learningVersion: 0 });
function fixture(): Data { return { words: [word()], sessions: [], attempts: [], assessments: [], assessmentAttempts: [], assessmentProgress: [] }; }
function practice(data: Data, day = '2026-10-17T02:00:00Z', id = `practice-${data.sessions.length}`, wordId = 'apple') {
  data.sessions.push({ id, wordIds: [wordId], completedWordIds: [], startedAt: day, rewardGranted: false });
  data.attempts.push({ id, sessionId: id, wordId, skill: 'recall', correct: false, hinted: true, practiceOnly: true, source: 'click', createdAt: day, learningVersion: 0 });
}
function assess(data: Data, time = '2026-10-17T03:00:00Z', result: AssessmentResult = 'correct', wordId = 'apple') {
  const target = data.words.find(word => word.id === wordId)!;
  const id = `assessment-${data.assessments!.length}`;
  const snapshot = { id: target.id, term: target.term, meaning: target.meaning, imageUrl: target.imageUrl, learningVersion: target.learningVersion ?? 0 };
  const session = { id, wordIds: [wordId], mode: 'full' as const, startedAt: time, completedAt: time, items: assessmentDimensions.map(dimension => ({ id: `${id}-${dimension}`, dimension, word: snapshot, choices: [], result })) };
  data.assessments!.push(session);
  data.assessmentAttempts!.push(...session.items.map(item => ({ id: item.id, sessionId: id, itemId: item.id, wordId, learningVersion: snapshot.learningVersion, dimension: item.dimension, result, source: item.dimension === 'look' ? 'server' as const : 'parent' as const, createdAt: time })));
  return session;
}

test('an untouched profile has no check-in, known words or unlocked medal; merely opening a session changes nothing', () => {
  const data = fixture();
  data.sessions.push({ id: 'opened', wordIds: ['apple'], completedWordIds: [], startedAt: now.toISOString(), rewardGranted: false });
  const result = childGrowth(data, now);
  assert.equal(result.totalDays, 0); assert.equal(result.verifiedWords, 0); assert.equal(result.practicedWords, 0);
  assert.ok(result.badges.every(badge => !badge.unlocked));
});
test('follow-along, hints and multiple attempts count as one study day and never as verified vocabulary', () => {
  const data = fixture(); practice(data); practice(data);
  const result = childGrowth(data, now);
  assert.equal(result.totalDays, 1); assert.equal(result.todayCheckedIn, true); assert.equal(result.currentStreak, 1);
  assert.equal(result.practicedWords, 1); assert.equal(result.todayPracticedWords, 1); assert.equal(result.verifiedWords, 0);
  assert.equal(result.badges.find(badge => badge.id === 'first-day')!.unlocked, true);
  assert.equal(result.badges.find(badge => badge.id === 'first-word')!.unlocked, false);
});
test('only a completed assessment with all four independently correct dimensions lights the first skill medal', () => {
  const data = fixture(); assess(data);
  const result = childGrowth(data, now);
  assert.equal(result.verifiedWords, 1); assert.equal(result.stableWords, 0); assert.equal(result.rank.nextTarget, 2);
  assert.equal(result.badges.find(badge => badge.id === 'first-word')!.unlocked, true);
  assert.deepEqual(Object.values(result.skills), [1, 1, 1, 1]);
});
for (const result of ['incorrect', 'hinted', 'unconfirmed', 'skipped', 'unavailable'] as const) test(`${result} assessment evidence is not a verified word`, () => {
  const data = fixture(); assess(data, undefined, result);
  assert.equal(childGrowth(data, now).verifiedWords, 0);
});
test('parent judgement and server objective evidence cannot impersonate each other', () => {
  const data = fixture(); assess(data);
  data.assessmentAttempts![0].source = 'server';
  assert.equal(childGrowth(data, now).verifiedWords, 0);
});
test('unfinished or future-completed tests cannot add or erase a confirmed word', () => {
  const data = fixture(); assess(data);
  const session = assess(data, '2026-10-17T03:30:00Z', 'incorrect');
  delete (session as { completedAt?: string }).completedAt;
  assert.equal(childGrowth(data, now).verifiedWords, 1);
  session.completedAt = '2026-10-18T03:30:00Z';
  assert.equal(childGrowth(data, now).verifiedWords, 1);
});
test('the most recent completed result changes current vocabulary even if storage order is different', () => {
  const data = fixture(); assess(data); assess(data, '2026-10-17T03:30:00Z', 'hinted');
  data.assessmentAttempts!.reverse();
  assert.equal(childGrowth(data, now).verifiedWords, 0);
});
test('changed meanings or learning versions never inherit old skill medals', () => {
  for (const change of ['version', 'meaning', 'term', 'reset'] as const) {
    const data = fixture(); assess(data);
    if (change === 'version') data.words[0].learningVersion = 1;
    if (change === 'meaning') data.words[0].meaning = '苹果公司';
    if (change === 'term') data.words[0].term = 'banana';
    if (change === 'reset') data.words[0].learningResetAt = '2026-10-17T03:30:00Z';
    assert.equal(childGrowth(data, now).verifiedWords, 0, change);
  }
});
test('the same English entry across books counts once, while each tested meaning stays inspectable', () => {
  const data = fixture(); data.words.push({ ...word('apple-copy', ' APPLE '), packId: 'other' });
  practice(data); practice(data, undefined, undefined, 'apple-copy'); assess(data); assess(data, undefined, undefined, 'apple-copy');
  const result = childGrowth(data, now);
  assert.equal(result.verifiedWords, 1); assert.equal(result.practicedWords, 1); assert.equal(result.words.length, 2);
});
test('cross-day consolidation requires two different Shanghai dates in every dimension', () => {
  const data = fixture(); assess(data, '2026-10-16T15:00:00Z'); assess(data, '2026-10-16T15:30:00Z');
  assert.equal(childGrowth(data, now).stableWords, 0);
  assess(data, '2026-10-16T16:30:00Z');
  assert.equal(childGrowth(data, now).stableWords, 1);
  assert.deepEqual(childGrowth(data, now).days, ['2026-10-16', '2026-10-17']);
});
test('attendance respects local midnight, longest streak, yesterday and rest days; future/orphan records are ignored', () => {
  const data = fixture();
  for (const time of ['2026-10-12T02:00:00Z', '2026-10-13T02:00:00Z', '2026-10-14T02:00:00Z', '2026-10-16T15:30:00Z']) practice(data, time);
  practice(data, '2026-10-18T02:00:00Z');
  data.attempts.push({ ...data.attempts[0], id: 'orphan', sessionId: 'missing', createdAt: now.toISOString() });
  const result = childGrowth(data, now);
  assert.equal(result.totalDays, 4); assert.equal(result.currentStreak, 1); assert.equal(result.longestStreak, 3); assert.equal(result.todayCheckedIn, false);
  assert.equal(childGrowth(data, new Date('2026-10-20T02:00:00Z')).currentStreak, 0);
});
test('due review is reported separately from forgetting; growth reads do not change saved facts or backups', () => {
  const data = fixture(); assess(data);
  data.assessmentProgress!.push({ wordId: 'apple', learningVersion: 0, dimension: 'look', stage: 1, dueAt: '2026-10-17T00:00:00Z' });
  const original = structuredClone(data), result = childGrowth(data, now);
  assert.equal(result.verifiedWords, 1); assert.equal(result.dueWords, 1); assert.deepEqual(data, original);
  const dir = mkdtempSync(join(tmpdir(), 'word-growth-'));
  const store = new Store(dir, () => now);
  try {
    const before = store.read();
    const disabled = { configured: false, available: false, status: 'disabled', detail: 'test' };
    assert.equal(store.state({ speech: disabled, codex: disabled }).growth!.verifiedWords, 0);
    assert.deepEqual(store.read(), before);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('a learning session always picks the same background, with all generated assets available across random sessions', () => {
  const scene = learningBackground('session-1');
  for (let step = 0; step < 20; step++) assert.deepEqual(learningBackground('session-1'), scene);
  const selected = new Set(Array.from({ length: 100 }, (_, index) => learningBackground(`session-${index}`).id));
  assert.equal(selected.size, learningBackgrounds.length);
  for (const background of learningBackgrounds) {
    const png = readFileSync(new URL(`../public${background.image}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.ok(png.readUInt32BE(16) > 1000); assert.ok(png.readUInt32BE(20) > 700);
  }
});
