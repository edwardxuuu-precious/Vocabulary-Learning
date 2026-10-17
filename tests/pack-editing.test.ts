import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBackup } from '../server/store.ts';
import { createApp } from '../server/index.ts';
import { packContentRevision } from '../shared/vocabulary.ts';
import type { Word } from '../shared/contracts.ts';

const none = { configured: false, available: false, status: 'test_only', detail: '隔离测试，无云服务' };
const services = { speech: none, codex: none };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pack-edit-'));
  const store = new Store(dir);
  const pack = store.createPack('我的词表', [{ term: 'apple', meaning: '苹果' }, { term: 'cat', meaning: '猫' }, { term: 'dog', meaning: '狗' }]);
  const words = store.read().words.filter(word => word.packId === pack.id);
  const request = () => ({ title: pack.title, revision: packContentRevision(store.read().packs.find(item => item.id === pack.id)!, store.read().words), rows: words.map(word => ({ id: word.id, term: word.term, meaning: word.meaning, partOfSpeech: word.partOfSpeech })) });
  return { dir, store, pack, words, request, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('saving a name or unchanged rows retains ids, approved assets and learning progress; changed content resets only its word', () => {
  const f = fixture(); try {
    f.store.enablePack(f.pack.id, true);
    const session = f.store.startSession(false, {}, { mode: 'relearn', wordIds: f.words.map(word => word.id) });
    f.store.attempt({ sessionId: session.id, wordId: f.words[0].id, step: 'listen', skill: 'listen', correct: true, hinted: false, source: 'click' });
    const before = f.store.read();
    f.store.updatePack(f.pack.id, { ...f.request(), title: '改名后' });
    assert.deepEqual(f.store.read().words, before.words); assert.deepEqual(f.store.read().progress, before.progress);
    const body = f.request(); body.rows[1].meaning = '小猫';
    f.store.updatePack(f.pack.id, { ...body, title: '改名后' });
    const data = f.store.read(), changed = data.words.find(word => word.id === f.words[1].id)!;
    assert.equal(changed.assetStatus, 'draft'); assert.equal(changed.imageUrl, '/assets/placeholder.svg'); assert.equal(changed.learningVersion, 1);
    assert.deepEqual(data.words.find(word => word.id === f.words[0].id), before.words.find(word => word.id === f.words[0].id));
    assert.deepEqual(data.progress, before.progress); assert.ok(!f.store.startSession().wordIds.includes(changed.id));
    assert.throws(() => f.store.updateWord(changed.id, { assetStatus: 'approved' }, () => true), /图片/);
  } finally { f.close(); }
});

test('bulk removal and addition keep evidence and suspended snapshots, survive backup restore, and never affect another pack', () => {
  const f = fixture(); try {
    f.store.enablePack(f.pack.id, true);
    const session = f.store.startSession(false, {}, { mode: 'relearn', wordIds: f.words.map(word => word.id) });
    f.store.attempt({ sessionId: session.id, wordId: f.words[0].id, step: 'listen', skill: 'listen', correct: true, hinted: false, source: 'click' });
    const before = f.store.read();
    const body = f.request();
    f.store.updatePack(f.pack.id, { ...body, rows: [body.rows[1], body.rows[2], { term: 'bird', meaning: '鸟' }] });
    const data = f.store.read(), visible = f.store.state(services);
    assert.ok(!visible.words.some(word => word.id === f.words[0].id)); assert.ok(data.words.find(word => word.id === f.words[0].id)?.deletedAt);
    assert.deepEqual(data.attempts, before.attempts); assert.deepEqual(data.progress, before.progress);
    assert.deepEqual(data.sessions[0], { ...before.sessions[0], suspendedAt: data.sessions[0].suspendedAt });
    assert.ok(data.sessions[0].suspendedAt); assert.equal(visible.activeSession, null);
    assert.deepEqual(data.words.filter(word => word.packId === 'starter'), before.words.filter(word => word.packId === 'starter'));
    const added = visible.words.find(word => word.term === 'bird' && word.packId === f.pack.id)!; assert.equal(added.assetStatus, 'draft'); assert.equal(added.packId, f.pack.id);
    const backup = f.store.exportBackup(); assert.ok(validateBackup(backup).data.words.find(word => word.id === f.words[0].id)?.deletedAt);
    f.store.restoreBackup(backup); assert.deepEqual(f.store.state(services).words, visible.words);
    assert.throws(() => f.store.updateWord(f.words[0].id, { assetStatus: 'approved' }, () => true), /找不到/);
  } finally { f.close(); }
});

test('empty, duplicate, foreign and stale content edits are atomic; POS can be cleared', () => {
  const f = fixture(); try {
    const before = f.store.read(), body = f.request();
    for (const invalid of [
      { ...body, title: '' }, { ...body, rows: [] }, { ...body, rows: [body.rows[0], { term: 'APPLE', meaning: '苹果' }] },
      { ...body, rows: [{ ...body.rows[0], id: 'starter-apple' }] }, { ...body, revision: 'outdated' },
    ]) { assert.throws(() => f.store.updatePack(f.pack.id, invalid)); assert.deepEqual(f.store.read(), before); }
    f.store.updateWord(f.words[0].id, { partOfSpeech: 'noun' }, () => true);
    assert.throws(() => f.store.updatePack(f.pack.id, body), /已被修改/);
    f.store.updatePack(f.pack.id, f.request()); assert.equal(f.store.read().words.find(word => word.id === f.words[0].id)?.partOfSpeech, undefined);
  } finally { f.close(); }
});

test('whole-pack deletion stops learning without deleting progress, assets or charges, remains deleted after restart and restore', () => {
  const f = fixture(); try {
    f.store.enablePack(f.pack.id, true); f.store.startSession(); f.store.reserve('tts', 0.1, 10);
    const before = f.store.read(); f.store.deletePack(f.pack.id);
    assert.ok(!f.store.state(services).packs.some(pack => pack.id === f.pack.id));
    assert.equal(f.store.state(services).activeSession, null); assert.deepEqual(f.store.startSession().wordIds, []);
    for (const key of ['attempts', 'progress', 'charges', 'stickers'] as const) assert.deepEqual(f.store.read()[key], before[key]);
    assert.deepEqual(f.store.read().words.filter(word => word.packId === f.pack.id).map(word => word.imageUrl), f.words.map(word => word.imageUrl));
    assert.throws(() => f.store.enablePack(f.pack.id, true), /找不到/);
    const backup = f.store.exportBackup(); f.store.restoreBackup(backup); assert.ok(!f.store.state(services).packs.some(pack => pack.id === f.pack.id));
    const reopened = new Store(f.dir); try { assert.ok(!reopened.state(services).packs.some(pack => pack.id === f.pack.id)); } finally { reopened.close(); }
  } finally { f.close(); }
});

test('HTTP edit and delete endpoints do not generate cloud content; deleted entries cannot be generated, enabled or prepared', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-edit-api-')); let calls = 0;
  const app = createApp({ dataDir: dir, chatEnabled: false, integrations: {
    probeIntegrations: async () => services, ttsStatus: () => ({ ...none, provider: 'elevenlabs' }), getCachedSpeech: async () => undefined,
    generateIllustration: async () => { calls++; throw Error('no cloud'); }, synthesizeSpeech: async () => { calls++; throw Error('no cloud'); },
  } });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (app.server.address() as { port: number }).port;
  const request = async (path: string, method: string, body?: unknown) => {
    const result = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: result.status, body: await result.json() };
  };
  try {
    const pack = app.store.createPack('API词表', [{ term: 'cat', meaning: '猫' }, { term: 'dog', meaning: '狗' }]);
    const words = app.store.read().words.filter(word => word.packId === pack.id);
    let result = await request(`/api/packs/${pack.id}`, 'PATCH', { title: 'API改名', revision: packContentRevision(pack, words), rows: words.map(word => ({ id: word.id, term: word.term, meaning: word.meaning })) });
    assert.equal(result.status, 200); assert.equal(result.body.packs.find((item: { id: string }) => item.id === pack.id).title, 'API改名');
    result = await request(`/api/words/${words[0].id}`, 'DELETE'); assert.equal(result.status, 200); assert.ok(!result.body.words.some((word: Word) => word.id === words[0].id));
    assert.equal((await request(`/api/packs/${pack.id}/audio`, 'GET')).body.total, 1);
    assert.equal((await request(`/api/packs/${pack.id}/images`, 'GET')).body.total, 1);
    assert.equal((await request(`/api/words/${words[0].id}/illustrate`, 'POST')).status, 404);
    assert.equal((await request(`/api/packs/${pack.id}`, 'DELETE')).status, 200);
    for (const [path, method, body] of [[`/api/packs/${pack.id}/audio`, 'POST'], [`/api/packs/${pack.id}/images`, 'POST'], [`/api/packs/${pack.id}`, 'PATCH', { enabled: true }]] as const) assert.equal((await request(path, method, body)).status, 404);
    assert.equal(calls, 0); assert.equal(app.store.read().charges.length, 0);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('deleting a pack cancels its in-flight image batch before hiding content and cannot revive deleted words', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-edit-cancel-'));
  let entered!: () => void, aborted = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const app = createApp({ dataDir: dir, chatEnabled: false, integrations: {
    probeIntegrations: async () => ({ speech: none, codex: { ...none, configured: true } }), ttsStatus: () => ({ ...none, provider: 'elevenlabs' }), getCachedSpeech: async () => undefined,
    generateIllustration: async ({ signal }) => new Promise((_resolve, reject) => {
      entered(); signal?.addEventListener('abort', () => { aborted = true; reject(Error('cancelled fixture')); }, { once: true });
    }),
  } });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (app.server.address() as { port: number }).port;
  try {
    const pack = app.store.createPack('任务取消', [{ term: 'pear', meaning: '梨' }]);
    assert.equal((await fetch(`${base}/api/packs/${pack.id}/images`, { method: 'POST' })).status, 200);
    await started;
    const response = await fetch(`${base}/api/packs/${pack.id}`, { method: 'DELETE' });
    assert.equal(response.status, 200); assert.equal(aborted, true);
    assert.ok(!(await response.json()).packs.some((item: { id: string }) => item.id === pack.id));
    assert.equal(app.store.read().jobs[0].status, 'cancelled');
    assert.ok(app.store.read().words.filter(word => word.packId === pack.id).every(word => word.deletedAt && word.assetStatus === 'draft'));
    validateBackup(app.store.exportBackup());
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
