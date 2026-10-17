import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { badgeCatalog, badgeById, badgeSeries, buildBadges, nextBadges, type BadgeValues } from '../shared/badge-catalog.ts';
import { childGrowth, recordBadgeAwards } from '../shared/growth.ts';
import { Store, validateBackup } from '../server/store.ts';
import type { BadgeAward } from '../shared/contracts.ts';

const zero: BadgeValues = { days: 0, practicedWords: 0, verifiedWords: 0, stableWords: 0, look: 0, read: 0, 'en-zh': 0, 'zh-en': 0 };
const now = new Date('2026-10-17T04:00:00Z');
const disabled = { configured: false, available: false, status: 'test_disabled', detail: 'offline' };
test('128 badges have unique IDs, stable serials, titles and visible motifs across eight progressive series', () => {
  assert.equal(badgeCatalog.length, 128); assert.equal(badgeSeries.length, 8);
  for (const field of ['id', 'serial', 'title', 'icon'] as const) assert.equal(new Set(badgeCatalog.map(badge => badge[field])).size, 128, field);
  for (const series of badgeSeries) {
    const badges = badgeCatalog.filter(badge => badge.series === series.metric);
    assert.equal(badges.length, 16);
    assert.ok(badges.every((badge, index) => index === 0 || badge.target > badges[index - 1].target));
    assert.equal(new Set(badges.map(badge => badge.frame)).size, 4);
  }
});
test('original eight IDs retain their meanings, so incentive keys do not change during catalogue expansion', () => {
  for (const [id, target] of Object.entries({ 'first-day': 1, 'seven-days': 7, 'thirty-days': 30, 'first-word': 1, 'ten-words': 10, 'thirty-words': 30, 'fifty-words': 50, 'hundred-words': 100 })) assert.equal(badgeById.get(id)!.target, target);
});
test('practice medals never award a vocabulary or oral ability milestone', () => {
  const badges = buildBadges({ ...zero, days: 7, practicedWords: 500 });
  assert.ok(badges.filter(badge => badge.unlocked).every(badge => ['days', 'practicedWords'].includes(badge.series)));
  assert.equal(badges.find(badge => badge.id === 'first-word')!.unlocked, false);
});
test('each series exposes just its nearest future badge and an exact remaining amount', () => {
  const badges = buildBadges({ ...zero, days: 2, practicedWords: 4 });
  const next = nextBadges(badges);
  assert.equal(next.length, 8); assert.equal(new Set(next.map(badge => badge.series)).size, 8);
  assert.equal(next.find(badge => badge.series === 'days')!.remaining, 1);
  assert.equal(next.find(badge => badge.series === 'practicedWords')!.remaining, 1);
  assert.ok(next.every(badge => badge.remaining > 0 && !badge.unlocked));
});
test('a recorded medal stays earned when current vocabulary regresses; remaining progress never becomes negative', () => {
  const awards: BadgeAward[] = [{ badgeId: 'first-word', recordedAt: now.toISOString(), value: 1, source: 'progress' }];
  const badge = buildBadges(zero, awards).find(badge => badge.id === 'first-word')!;
  assert.equal(badge.unlocked, true); assert.equal(badge.current, 0); assert.equal(badge.remaining, 0);
  assert.equal(nextBadges(buildBadges(zero, awards)).find(badge => badge.series === 'verifiedWords')!.target, 2);
  assert.ok(buildBadges({ ...zero, days: 9999, verifiedWords: 9999 }).every(badge => badge.remaining >= 0));
});
test('a family incentive binds to one stable ID and unset badges do not invent a reward', () => {
  const badges = buildBadges(zero, [], { 'first-word': '周末一起选一本绘本' });
  assert.equal(badges.find(badge => badge.id === 'first-word')!.incentive, '周末一起选一本绘本');
  assert.ok(badges.filter(badge => badge.id !== 'first-word').every(badge => badge.incentive === undefined));
  assert.equal(buildBadges(zero, [], { W01: '一起拼一套积木' }).find(badge => badge.serial === 'W01')!.incentive, '一起拼一套积木');
});
test('awards persist exactly once inside store writes; reads, restarts and old-backup restoration do not duplicate or erase them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'badge-store-'));
  let store = new Store(dir, () => now);
  try {
    const originalBackup = store.exportBackup();
    store.mutate(data => {
      const wordId = data.words[0].id, id = 'study';
      data.sessions.push({ id, wordIds: [wordId], completedWordIds: [wordId], startedAt: now.toISOString(), completedAt: now.toISOString(), rewardGranted: true });
      data.attempts.push({ id: 'practice', sessionId: id, wordId, skill: 'recall', correct: false, hinted: true, practiceOnly: true, source: 'click', createdAt: now.toISOString() });
    });
    const earned = store.read().badgeAwards!;
    assert.equal(earned.length, 2); assert.ok(earned.some(award => award.badgeId === 'first-day'));
    const beforeRead = store.read(); store.state({ speech: disabled, codex: disabled }); assert.deepEqual(store.read(), beforeRead);
    store.mutate(() => {}); assert.deepEqual(store.read().badgeAwards, earned);
    const backup = store.exportBackup(); assert.deepEqual(validateBackup(backup).data.badgeAwards, earned);
    store.close(); store = new Store(dir, () => now); assert.deepEqual(store.read().badgeAwards, earned);
    store.restoreBackup(originalBackup); assert.deepEqual(store.read().badgeAwards, earned);
    assert.equal(store.state({ speech: disabled, codex: disabled }).growth!.practicedWords, 0);
    assert.equal(store.state({ speech: disabled, codex: disabled }).growth!.badges.filter(badge => badge.unlocked).length, 2);
    assert.throws(() => store.mutate(data => { data.badgeAwards = []; throw Error('rollback'); }));
    assert.deepEqual(store.read().badgeAwards, earned);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('legacy profiles backfill only currently evidenced medals without changing the learning evidence', () => {
  const data: Parameters<typeof childGrowth>[0] = { words: [], attempts: [], sessions: [{ id: 'old', wordIds: ['removed-word'], completedWordIds: ['removed-word'], startedAt: now.toISOString(), completedAt: now.toISOString(), rewardGranted: true }] };
  const sessions = structuredClone(data.sessions); recordBadgeAwards(data, now);
  assert.deepEqual(data.sessions, sessions); assert.equal(data.badgeAwards!.length, 1); assert.equal(data.badgeAwards![0].source, 'backfill');
  assert.equal(childGrowth(data, now).verifiedWords, 0);
  assert.equal(childGrowth(data, new Date('2026-10-16T00:00:00Z')).badges.filter(badge => badge.unlocked).length, 0);
});
test('unknown, duplicated, under-threshold or malformed award records cannot enter a restored backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'badge-backup-')), store = new Store(dir, () => now);
  try {
    const backup = store.exportBackup();
    const valid: BadgeAward = { badgeId: 'first-word', recordedAt: now.toISOString(), value: 1, source: 'progress' };
    for (const awards of [[{ ...valid, badgeId: 'unknown' }], [valid, valid], [{ ...valid, value: 0 }], [{ ...valid, recordedAt: 'invalid' }], [{ ...valid, source: 'ai' }]]) {
      const modified = structuredClone(backup); (modified.data as any).badgeAwards = awards;
      assert.throws(() => validateBackup(modified), /奖章/);
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
