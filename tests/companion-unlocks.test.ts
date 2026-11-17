import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { companionCharacters, companionFor, companionIds, originalCompanionIds } from '../shared/companions.ts';
import { companionVideos } from '../shared/companion-videos.ts';
import { companionAnimationRemaining, companionUnlockSummary, earnedCompanionCredits, recordCompanionRewards, starterCompanions, unlockableCompanions, validCompanionRewards, mergeCompanionRewards, type CompanionRewardLedger } from '../shared/companion-unlocks.ts';
import { assessmentDimensions } from '../shared/assessment.ts';
import type { AssessmentResult, AssessmentSession, Word } from '../shared/contracts.ts';
import { Store, validateBackup } from '../server/store.ts';
import { rebuildAssessmentProgress } from '../server/assessments.ts';
import { createTestMode } from '../server/test-mode.ts';
import { createApp } from '../server/index.ts';

const now = new Date('2026-11-14T04:00:00Z');
const firstDay = '2026-11-12T03:00:00Z', reviewDay = '2026-11-13T03:00:00Z';
const offline = { configured: false, available: false, status: '工程测试', detail: '没有云调用' };
const statuses = { speech: offline, codex: offline };
type Data = Parameters<typeof earnedCompanionCredits>[0];
const termAt = (index: number) => 'word a' + [...index.toString(26)].map(letter => String.fromCharCode(97 + parseInt(letter, 26))).join('');
function fixture(count = 1): Data {
  return { packs: [{ id: 'family', title: '隔离工程词书', enabled: true, createdAt: firstDay }],
    words: Array.from({ length: count }, (_, index): Word => ({ id: `word-${index}`, packId: 'family', term: termAt(index), meaning: `工程词义${index}`, imageUrl: index % 2 ? '/assets/words/banana.svg' : '/assets/words/apple.svg', assetStatus: 'approved', imageSource: 'upload', learningVersion: 0 })),
    assessments: [], assessmentAttempts: [] };
}
function assess(data: Data, wordId = data.words[0].id, time = firstDay, result: AssessmentResult = 'correct') {
  const word = data.words.find(item => item.id === wordId)!;
  const id = `test-${data.assessments!.length}`;
  const snapshot = { id: word.id, term: word.term, meaning: word.meaning, imageUrl: word.imageUrl, learningVersion: word.learningVersion ?? 0 };
  const other = data.words.find(item => item.imageUrl !== word.imageUrl);
  const choices = other ? [snapshot, { id: other.id, term: other.term, meaning: other.meaning, imageUrl: other.imageUrl, learningVersion: other.learningVersion ?? 0 }] : [];
  const session: AssessmentSession = { id, wordIds: [wordId], mode: 'full', startedAt: time, completedAt: time,
    items: assessmentDimensions.map(dimension => ({ id: `${wordId}:${dimension}`, dimension, word: snapshot, choices: dimension === 'look' ? choices : [], result, ...(dimension === 'look' && choices.length ? { selectedId: wordId } : {}) })) };
  data.assessments!.push(session);
  data.assessmentAttempts!.push(...session.items.map(item => ({ id: `${id}:${item.id}`, itemId: item.id, sessionId: id, wordId,
    learningVersion: snapshot.learningVersion, dimension: item.dimension, result, source: item.dimension === 'look' ? 'server' as const : 'parent' as const, createdAt: time })));
  return session;
}
const summary = (data: Data) => companionUnlockSummary(earnedCompanionCredits(data, now));
function dispose(dir: string) {
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  assert.ok(dir.includes('companion-'));
  rmSync(dir, { recursive: true, force: true });
}

test('starter animations need ten and twenty new words alongside the existing character and animation cycle', () => {
  for (const count of [0, 9, 10, 19, 20, 29, 30, 39, 40]) {
    const data = fixture(count);
    for (const word of data.words) assess(data, word.id);
    const result = summary(data);
    assert.equal(result.newWords, count);
    assert.equal(result.ruleVersion, 3);
    assert.equal(result.unlockedIds.length, 2 + Math.floor((count + 10) / 20));
    assert.equal(result.animationUnlockedIds.length, Math.min(2, Math.floor(count / 10)) + Math.floor(count / 20));
    assert.equal(result.newWordProgress, count % 10);
    assert.equal(result.nextReward?.kind, count < 20 ? 'animation' : count % 20 < 10 ? 'character' : 'animation');
    assert.equal(result.nextReward?.companionId, count < 20 ? starterCompanions[Math.floor(count / 10)] : unlockableCompanions[Math.floor(count / 20)]);
    assert.equal(result.nextReward?.remaining, 10 - count % 10);
    assert.deepEqual(result.unlockedIds.slice(0, 2), starterCompanions);
    assert.deepEqual(result.animationUnlockedIds.filter(id => starterCompanions.includes(id)), starterCompanions.slice(0, Math.floor(count / 10)));
    for (const [index, id] of starterCompanions.entries()) assert.equal(companionAnimationRemaining(result, id), Math.max(0, (index + 1) * 10 - count));
  }
});

test('review passes never advance or fill the new-word cycle', () => {
  const data = fixture(19);
  for (const word of data.words) { assess(data, word.id); assess(data, word.id, reviewDay); }
  const beforeReview = summary(data);
  assert.equal(beforeReview.unlockedIds.length, 3); assert.equal(beforeReview.animationUnlockedIds.length, 1);
  assert.equal(beforeReview.nextReward?.remaining, 1);
  const extra = fixture(20).words[19]; data.words.push(extra); assess(data, extra.id);
  assert.equal(summary(data).unlockedIds.length, 3);
  const beforeExtraReview = summary(data);
  assess(data, extra.id, reviewDay);
  assert.deepEqual(summary(data), beforeExtraReview);
  assert.equal(summary(data).animationUnlockedIds.length, 3);
});

test('same-day repeats, later reviews and copied English entries cannot farm new-word credits', () => {
  const data = fixture();
  assess(data); assess(data, undefined, '2026-11-12T04:00:00Z');
  assert.equal(summary(data).newWords, 1);
  const first = summary(data);
  assess(data, undefined, reviewDay); assess(data, undefined, '2026-11-13T04:00:00Z');
  data.words.push({ ...data.words[0], id: 'copy', term: ' WORD   AA ' });
  assess(data, 'copy', reviewDay);
  assert.deepEqual(summary(data), first);
  assess(data, undefined, '2026-11-14T03:00:00Z');
  assert.deepEqual(summary(data), first);
});

for (const result of ['hinted', 'incorrect', 'unconfirmed', 'skipped', 'unavailable'] as const) test(`${result} answers cannot earn a new word`, () => {
  const data = fixture(); assess(data, undefined, firstDay, result);
  assert.equal(summary(data).newWords, 0);
  const learned = fixture(); assess(learned); assess(learned, undefined, reviewDay, result);
  assert.equal(summary(learned).newWords, 1);
  assert.equal(summary(learned).nextReward?.progress, 1);
});

test('source, completed test, time, word version, sense and sample boundaries all apply', () => {
  for (const change of ['source', 'unfinished', 'future', 'orphan', 'version', 'meaning', 'reset', 'sample', 'deleted'] as const) {
    const data = fixture(), session = assess(data);
    if (change === 'source') data.assessmentAttempts!.find(item => item.dimension === 'look')!.source = 'parent';
    if (change === 'unfinished') delete session.completedAt;
    if (change === 'future') session.completedAt = '2026-11-15T03:00:00Z';
    if (change === 'orphan') data.assessments = [];
    if (change === 'version') data.words[0].learningVersion = 1;
    if (change === 'meaning') data.words[0].meaning = '改义';
    if (change === 'reset') data.words[0].learningResetAt = reviewDay;
    if (change === 'sample') data.packs[0].isSample = true;
    if (change === 'deleted') data.words[0].deletedAt = reviewDay;
    assert.equal(summary(data).newWords, 0, change);
  }
});

test('an intermediate success cannot hide a later failure in the same completed test', () => {
  const data = fixture(); assess(data);
  const session = assess(data, undefined, reviewDay), attempt = data.assessmentAttempts!.at(-1)!;
  session.items.at(-1)!.result = attempt.result = 'hinted';
  assert.equal(summary(data).newWords, 1);
  const combined = fixture(), a = assess(combined), b = assess(combined, undefined, reviewDay);
  a.items.at(-1)!.result = combined.assessmentAttempts![3].result = 'incorrect';
  b.items[0].result = combined.assessmentAttempts![4].result = 'incorrect';
  assert.equal(summary(combined).newWords, 0);
});

test('new mastery may combine completed focused tests while later full passes do not add credit', () => {
  const data = fixture(), first = assess(data), second = assess(data, undefined, reviewDay);
  first.items = first.items.slice(0, 2); second.items = second.items.slice(2);
  data.assessmentAttempts = data.assessmentAttempts!.filter(attempt => data.assessments!.find(session => session.id === attempt.sessionId)!.items.some(item => item.id === attempt.itemId));
  assert.equal(summary(data).newWords, 1);
  const before = summary(data);
  assess(data, undefined, '2026-11-14T03:00:00Z');
  assert.deepEqual(summary(data), before);
});

test('Shanghai answer dates remain the credit date and late confirmation never creates a new word', () => {
  const data = fixture(); assess(data, undefined, '2026-11-12T15:59:00Z');
  assess(data, undefined, '2026-11-12T16:01:00Z');
  for (const attempt of data.assessmentAttempts!) attempt.confirmedAt = '2026-11-14T03:00:00Z';
  assert.equal(earnedCompanionCredits(data, now).learned[0].day, '2026-11-12');
  const again = assess(data, undefined, '2026-11-13T03:00:00Z');
  assert.equal(summary(data).newWords, 1);
  again.startedAt = '2026-11-12T15:59:30Z';
  assert.equal(summary(data).newWords, 1);
});

test('reward history survives later wrong answers, edits and deletion without rewriting formal evidence', () => {
  const data = fixture(20); for (const word of data.words) assess(data, word.id);
  const before = structuredClone(data); recordCompanionRewards(data, now);
  assert.deepEqual(data.assessments, before.assessments); assert.deepEqual(data.assessmentAttempts, before.assessmentAttempts);
  const earned = structuredClone(data.companionRewards);
  for (const word of data.words) { assess(data, word.id, reviewDay, 'incorrect'); word.deletedAt = reviewDay; }
  recordCompanionRewards(data, now); assert.deepEqual(data.companionRewards, earned);
  assert.equal(summary(data).unlockedIds.length, 3);
});

test('the expanded catalogue stays capped at one hundred and does not finish at the old twenty-role milestone', () => {
  const data = fixture(2000); for (const word of data.words) assess(data, word.id);
  const result = summary(data); assert.equal(result.unlockedIds.length, 100); assert.equal(result.allUnlocked, true);
  const partial = companionUnlockSummary({ version: 1, learned: earnedCompanionCredits(data, now).learned.slice(0, 400), reviewed: [] });
  assert.equal(partial.unlockedIds.length, 22); assert.equal(partial.allUnlocked, false);
  const lastAnimationPending = companionUnlockSummary({ version: 2, learned: earnedCompanionCredits(data, now).learned.slice(0, 1950), reviewed: [], legacyReviewUnlocks: 0 });
  assert.equal(lastAnimationPending.unlockedIds.length, 100); assert.equal(lastAnimationPending.animationUnlockedIds.length, 99);
  assert.equal(lastAnimationPending.allUnlocked, false); assert.equal(lastAnimationPending.nextReward?.kind, 'animation');
});

test('v1 review rewards stay open while new reviews stop contributing after the upgrade', () => {
  const data = fixture(30), oldCredits = data.words.slice(0, 20).map(word => ({ term: word.term, day: '2026-11-12' }));
  data.companionRewards = { version: 1, learned: oldCredits, reviewed: oldCredits.map(item => ({ ...item, day: '2026-11-13' })) };
  assert.equal(companionUnlockSummary(data.companionRewards).animationUnlockedIds.length, 4);
  for (const word of data.words) assess(data, word.id);
  recordCompanionRewards(data, now);
  assert.equal((data.companionRewards as CompanionRewardLedger).version, 2);
  const upgraded = summary(data);
  assert.equal(upgraded.unlockedIds.length, 5); assert.equal(upgraded.animationUnlockedIds.length, 4);
  assert.equal(upgraded.nextReward?.companionId, unlockableCompanions[2]); assert.equal(upgraded.nextReward?.kind, 'animation');
  for (const word of data.words) assess(data, word.id, '2026-11-14T03:00:00Z');
  recordCompanionRewards(data, now);
  assert.deepEqual(summary(data), upgraded); assert.equal(data.companionRewards.reviewed.length, 20);
  const restored = mergeCompanionRewards(data.companionRewards, { version: 1, learned: oldCredits, reviewed: oldCredits.map(item => ({ ...item, day: '2026-11-13' })) });
  assert.deepEqual(companionUnlockSummary(restored), upgraded); assert.ok(validCompanionRewards(restored));
});

test('merging new and legacy backups never withdraws a character or animation', () => {
  const learned = Array.from({ length: 40 }, (_, at) => ({ term: termAt(at), day: '2026-11-12' }));
  const current: CompanionRewardLedger = { version: 2, learned, reviewed: [], legacyReviewUnlocks: 0 };
  const legacy: CompanionRewardLedger = { version: 1, learned: learned.slice(0, 20), reviewed: learned.slice(0, 20).map(item => ({ ...item, day: '2026-11-13' })) };
  const merged = mergeCompanionRewards(current, legacy), result = companionUnlockSummary(merged);
  for (const previous of [companionUnlockSummary(current), companionUnlockSummary(legacy)]) {
    for (const id of previous.unlockedIds) assert.ok(result.unlockedIds.includes(id));
    for (const id of previous.animationUnlockedIds) assert.ok(result.animationUnlockedIds.includes(id));
  }
  assert.deepEqual(mergeCompanionRewards(merged, legacy), merged);
});

test('expansion preserves every previously earned identity before adding new characters from both factions', () => {
  const oldOrder = originalCompanionIds.filter(id => !starterCompanions.includes(id));
  assert.deepEqual(unlockableCompanions.slice(0, oldOrder.length), oldOrder);
  assert.equal(unlockableCompanions.length, 98); assert.equal(new Set(unlockableCompanions).size, 98);
  assert.deepEqual(unlockableCompanions.slice(18, 20), ['skywarp', 'cliffjumper']);
});

test('backup ledger rejects duplicate, malformed, same-day first/review and unknown fields', () => {
  const valid: CompanionRewardLedger = { version: 1, learned: [{ term: 'apple', day: '2026-11-12' }], reviewed: [{ term: 'apple', day: '2026-11-13' }] };
  assert.ok(validCompanionRewards(valid));
  assert.ok(validCompanionRewards({ ...valid, version: 2, legacyReviewUnlocks: 0 }));
  for (const value of [{ ...valid, version: 2 }, { ...valid, learned: [...valid.learned, ...valid.learned] }, { ...valid, reviewed: [...valid.reviewed, ...valid.reviewed] },
    { ...valid, reviewed: [{ term: 'apple', day: '2026-11-12' }] }, { ...valid, reviewed: [{ term: 'banana', day: '2026-11-13' }] },
    { ...valid, learned: [{ term: 'apple', day: '2026-02-30' }] }, { ...valid, unlockedIds: companionIds },
    { ...valid, version: 2, legacyReviewUnlocks: 1 }, { ...valid, version: 2, legacyReviewUnlocks: -1 }, { ...valid, version: 2, legacyReviewUnlocks: 0.5 }]) assert.equal(validCompanionRewards(value), false);
});

test('store state, restart, legacy backfill, restore and test profile preserve the reward boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'companion-store-'));
  let store = new Store(dir, () => now);
  try {
    const oldBackup = store.exportBackup(), data = fixture(10);
    for (const word of data.words) assess(data, word.id);
    store.mutate(target => { Object.assign(target, data); rebuildAssessmentProgress(target); });
    const earned = store.read().companionRewards;
    assert.equal(earned!.learned.length, 10); assert.equal(earned!.version, 2);
    const beforeRead = store.read(); assert.equal(store.state(statuses).companionUnlocks!.unlockedIds.length, 3); assert.deepEqual(store.read(), beforeRead);
    assert.deepEqual(store.state(statuses).companionUnlocks!.animationUnlockedIds, ['optimus']);
    const backup = store.exportBackup(); assert.deepEqual(validateBackup(backup).data.companionRewards, earned);
    const invalid = structuredClone(backup); invalid.data.companionRewards!.learned.push(invalid.data.companionRewards!.learned[0]);
    assert.throws(() => validateBackup(invalid), /伙伴解锁/);
    store.close(); store = new Store(dir, () => now); assert.deepEqual(store.read().companionRewards, earned);
    const testing = createTestMode(store, () => true);
    try { const token = testing.enter().token; const testStore = testing.require(token).store; assert.deepEqual(testStore.state(statuses).companionUnlocks!.unlockedIds, starterCompanions); assert.deepEqual(testStore.state(statuses).companionUnlocks!.animationUnlockedIds, []); }
    finally { await testing.close(); }
    store.restoreBackup(oldBackup); assert.deepEqual(store.read().companionRewards, earned);
    assert.equal(store.state(statuses).growth!.verifiedWords, 0);
    store.mutate(() => {}); assert.deepEqual(store.read().companionRewards, earned);
    assert.throws(() => store.mutate(target => { target.companionRewards = undefined; throw Error('rollback'); }));
    assert.deepEqual(store.read().companionRewards, earned);
  } finally { store.close(); dispose(dir); }
});

test('HTTP exposes only the authoritative summary and reads cannot award credits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'companion-http-'));
  const app = createApp({ dataDir: dir, chatEnabled: false, integrations: { probeIntegrations: async () => statuses, getCachedSpeech: async () => undefined } });
  try {
    app.store.clock = () => now;
    await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`, before = app.store.read();
    const response = await fetch(base + '/api/state'), state = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(state.companionUnlocks.unlockedIds, starterCompanions);
    assert.equal(state.companionUnlocks.ruleVersion, 3); assert.deepEqual(state.companionUnlocks.animationUnlockedIds, []);
    assert.deepEqual(state.companionUnlocks.nextReward, { kind: 'animation', companionId: 'optimus', progress: 0, remaining: 10 });
    assert.equal(state.companionRewards, undefined); assert.deepEqual(app.store.read(), before);
    for (const count of [9, 10, 19, 20]) {
      const data = fixture(count); for (const word of data.words) assess(data, word.id);
      app.store.mutate(target => { Object.assign(target, data); target.companionRewards = undefined; });
      const beforeRead = app.store.read(), observed = await (await fetch(base + '/api/state')).json();
      assert.deepEqual(observed.companionUnlocks, summary(data)); assert.deepEqual(app.store.read(), beforeRead);
    }
  } finally { await app.close(); dispose(dir); }
});

test('React catalogue pages show 100/50/50 totals while shared mascots expose only earned roles', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { CompanionLibrary } = await vite.ssrLoadModule('/src/companion-library.tsx');
    const { CompanionAccessProvider } = await vite.ssrLoadModule('/src/companion-access.tsx');
    const { Mascot } = await vite.ssrLoadModule('/src/mascot.tsx');
    const html = renderToStaticMarkup(createElement(CompanionLibrary, { onBack() {} }));
    assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 18);
    assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 2);
    assert.match(html, /已解锁 2 \/ 100/); assert.ok(!html.includes('它的故事')); assert.ok(!html.includes('youtube.com')); assert.ok(!html.includes('bilibili.com')); assert.ok(!html.includes('<iframe'));
    assert.match(html, /动画 0 \/ 100/); assert.equal((html.match(/>动画待解锁</g) ?? []).length, 2);
    const stale = renderToStaticMarkup(createElement(CompanionLibrary, { onBack() {}, progress: { ...companionUnlockSummary(), animationUnlockedIds: starterCompanions } }));
    assert.match(stale, /动画 0 \/ 100/); assert.ok(!stale.includes('动画已解锁'));
    assert.equal((html.match(/>50<\/span>/g) ?? []).length, 2); assert.match(html, /图鉴翻页/); assert.match(html, /下一页/);
    const lockedMascot = renderToStaticMarkup(createElement(Mascot, { character: 'bumblebee' }));
    assert.ok(!lockedMascot.includes(companionCharacters.bumblebee.image));
    const unlockedMascot = renderToStaticMarkup(createElement(CompanionAccessProvider, { unlockedIds: [...starterCompanions, 'bumblebee'], children: createElement(Mascot, { character: 'bumblebee' }) }));
    assert.ok(unlockedMascot.includes(companionCharacters.bumblebee.image));
    for (const id of companionIds) {
      const link = companionVideos[id], url = new URL(link.url), player = new URL(link.embedUrl);
      assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'www.bilibili.com'); assert.equal(url.pathname, '/video/BV1RW411E73m/');
      assert.equal(url.searchParams.get('p'), String(link.episodeNumber)); assert.ok(link.episodeNumber >= 1 && link.episodeNumber <= 98);
      assert.equal(player.protocol, 'https:'); assert.equal(player.hostname, 'player.bilibili.com'); assert.equal(player.pathname, '/player.html');
      assert.equal(player.searchParams.get('bvid'), 'BV1RW411E73m'); assert.equal(player.searchParams.get('cid'), String(link.cid));
      assert.equal(player.searchParams.get('p'), String(link.episodeNumber)); assert.equal(player.searchParams.get('autoplay'), '0'); assert.equal(player.searchParams.get('danmaku'), '0');
      assert.equal(link.language, '普通话'); assert.equal(link.platform, '哔哩哔哩'); assert.equal(link.publisher, '深渊的幽灵');
    }
    assert.equal(new Set(companionIds.map(id => companionVideos[id].url)).size, 33);
    assert.equal(companionVideos.scorponok.episodeNumber, 98); assert.equal(companionVideos.sixshot.episodeNumber, 96);
    const { CompanionAnimation } = await vite.ssrLoadModule('/src/companion-animation.tsx');
    const preview = renderToStaticMarkup(createElement(CompanionAnimation, { name: '擎天柱', video: companionVideos.optimus, unlocked: true }));
    assert.match(preview, /看中文动画/); assert.match(preview, /aria-expanded="false"/); assert.match(preview, /普通话/);
    assert.ok(!preview.includes('<iframe')); assert.ok(!preview.includes('player.bilibili.com')); assert.ok(!preview.includes('youtube.com'));
    const animationLocked = renderToStaticMarkup(createElement(CompanionAnimation, { name: '大黄蜂', video: companionVideos.bumblebee, unlocked: false, remaining: 10 }));
    assert.match(animationLocked, /大黄蜂的动画待解锁/); assert.match(animationLocked, /再新学会10个不同单词/);
    for (const forbidden of ['<iframe', 'bilibili.com', '看中文动画', '第1集']) assert.ok(!animationLocked.includes(forbidden), forbidden);
    for (const count of [0, 9, 10, 19, 20]) {
      const data = fixture(count); for (const word of data.words) assess(data, word.id);
      const progress = summary(data);
      for (const [index, id] of starterCompanions.entries()) {
        const unlocked = progress.animationUnlockedIds.includes(id), name = companionCharacters[id].name;
        const detail = renderToStaticMarkup(createElement(CompanionAnimation, { name, video: companionVideos[id], unlocked, remaining: companionAnimationRemaining(progress, id) }));
        assert.equal(unlocked, count >= (index + 1) * 10);
        if (unlocked) assert.match(detail, /看中文动画/);
        else {
          assert.ok(detail.includes(name + '的动画待解锁'));
          assert.ok(detail.includes(`再新学会${(index + 1) * 10 - count}个不同单词`));
          for (const forbidden of ['<iframe', 'bilibili.com', '看中文动画', '重新加载', '全屏观看']) assert.ok(!detail.includes(forbidden), `${id}/${count}/${forbidden}`);
        }
      }
    }
    for (let at = 0; at < 20; at++) assert.ok(starterCompanions.includes(companionFor('test', at, starterCompanions)));
  } finally { await vite.close(); }
});
