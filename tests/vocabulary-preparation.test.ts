import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import { parseImport, validateRows, Store, validateBackup } from '../server/store.ts';
import { createImportPreparation } from '../server/import-preparation.ts';
import { validateVocabularyResult, enrichVocabulary } from '../server/integrations/vocabulary.ts';
import type { DialogueTransport } from '../server/integrations/dialogue.ts';
import type { ImportRow } from '../shared/contracts.ts';
import { isEnrichedRow, wordGamePlan } from '../shared/vocabulary.ts';
import { canConfirmPack } from '../src/pack-workflow.ts';

const proposal = (term: string, extra: Partial<ImportRow> = {}): ImportRow => ({ term, meaning: '苹果', partOfSpeech: 'noun', pictureHint: '一颗清晰的大苹果，没有文字', usageNote: '', ...extra });
async function settle(manager: ReturnType<typeof createImportPreparation>, id: string) { for (let n = 0; n < 200; n++) { const job = manager.get(id); if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 2)); } throw Error('test job did not settle'); }

test('English-only lines, comma lists and Excel phrases parse without guesses or a compulsory meaning; literal word survives', () => {
  assert.deepEqual(parseImport('word\napple\nice cream').rows, [{ term: 'word', meaning: '' }, { term: 'apple', meaning: '' }, { term: 'ice cream', meaning: '' }]);
  assert.deepEqual(parseImport('English\nWord').rows.map(row => row.term), ['English', 'Word']);
  assert.deepEqual(parseImport('apple, jump，happy\nice cream').rows.map(row => row.term), ['apple', 'jump', 'happy', 'ice cream']);
  assert.deepEqual(parseImport('apple\tjump\thappy').rows.map(row => row.term), ['apple', 'jump', 'happy']);
  assert.deepEqual(parseImport('apple 苹果\nhappy\nice cream,冰淇淋').rows.map(row => row.meaning), ['苹果', '', '冰淇淋']);
  assert.ok(parseImport('apple\nApple').errors.length); assert.ok(parseImport('run42').errors.length);
  assert.equal(validateRows([{ term: 'apple', meaning: '' }]).rows.length, 0);
  assert.equal(canConfirmPack('书', 'apple', { source: 'apple', rows: [{ term: 'apple', meaning: '' }], errors: [] }, true), false);
});

test('model proposals preserve exact English/order and parent-provided sense/POS, reject invented tools, malformed fields and empty known scenes', () => {
  const input = [{ term: 'light', meaning: '轻的', partOfSpeech: 'adjective' as const }];
  const row = proposal('light', { meaning: '轻的', partOfSpeech: 'adjective', usageNote: '另有光的意思，本次学习轻的' });
  assert.deepEqual(validateVocabularyResult({ rows: [row] }, input), [row]);
  for (const wrong of [{ ...row, term: 'Light' }, { ...row, meaning: '光' }, { ...row, partOfSpeech: 'noun' }, { ...row, pictureHint: '' }, { ...row, execute: 'code' }, { ...row, partOfSpeech: 'madeup' }]) assert.throws(() => validateVocabularyResult({ rows: [wrong] }, input));
  const unknown = proposal('zzzx', { meaning: '', partOfSpeech: 'other', pictureHint: '', usageNote: '无法识别，请检查拼写' });
  assert.equal(isEnrichedRow(validateVocabularyResult({ rows: [unknown] }, [{ term: 'zzzx', meaning: '' }])[0]), false);
});

test('large import batches retain completed proposals on quota failure; retry only prepares missing entries and never changes formal facts', async () => {
  let calls = 0, failed = true;
  const terms = Array.from({ length: 21 }, (_, i) => 'word' + String.fromCharCode(97 + i));
  const manager = createImportPreparation({ dataDir: 'unused', enrich: async input => { calls++; if (failed && calls === 2) throw Object.assign(Error('模拟额度用完'), { code: 'CODEX_QUOTA' }); return input.rows.map(row => proposal(row.term)); } });
  try {
    let job = await settle(manager, manager.start(terms.join('\n')).id);
    assert.equal(job.status, 'error'); assert.equal(job.completed, 20); assert.equal(calls, 2);
    failed = false; job = await settle(manager, manager.start(terms.join('\n'), job.rows).id);
    assert.equal(job.status, 'ready'); assert.equal(job.completed, 21); assert.equal(calls, 3);
    assert.throws(() => manager.start('apple', [proposal('cat')]), { code: 'IMPORT_STALE' });
  } finally { await manager.close(); }
});

test('stop ignores a late provider success, enforces a single writer, and retains already completed batches', async () => {
  let release!: () => void;
  const manager = createImportPreparation({ dataDir: 'unused', enrich: async input => { await new Promise<void>(resolve => { release = resolve; input.signal?.addEventListener('abort', () => resolve(), { once: true }); }); return input.rows.map(row => proposal(row.term)); } });
  try {
    const job = manager.start('apple'); assert.throws(() => manager.start('cat'), { code: 'IMPORT_BUSY' });
    while (!release) await new Promise(resolve => setTimeout(resolve, 2));
    const stopped = await manager.cancel(job.id); release();
    assert.equal(stopped.status, 'stopped'); assert.equal(stopped.completed, 0); assert.equal(stopped.rows[0].meaning, '');
  } finally { await manager.close(); }
});

test('confirmed metadata survives backup and a changed POS invalidates approval and learning while word audio remains English-only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'word-vocab-store-')); const store = new Store(directory);
  try {
    const pack = store.createPack('单词', [proposal('apple')]); let word = store.read().words.find(word => word.packId === pack.id)!;
    assert.equal(word.partOfSpeech, 'noun'); assert.ok(word.pictureHint);
    const backup = store.exportBackup(); assert.equal(validateBackup(backup).data.words.find(item => item.id === word.id)?.partOfSpeech, 'noun');
    store.updateWord(word.id, { meaning: '快乐的', partOfSpeech: 'adjective' }, () => true);
    word = store.read().words.find(item => item.id === word.id)!;
    assert.equal(word.assetStatus, 'draft'); assert.equal(word.learningVersion, 1); assert.equal(word.pictureHint, undefined); assert.equal(word.usageNote, undefined);
    assert.equal(wordGamePlan(word)[0].title, '看看它的样子');
    assert.equal(wordGamePlan({ term: 'ice cream' }, true).some(game => game.step === 'spell'), false);
    assert.equal(wordGamePlan({ term: 'happy', partOfSpeech: 'adjective' }, true).at(-1)?.step, 'spell');
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('HTTP enrichment is proposal-only; confirmation requires complete metadata and passes the reviewed scene to image generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'word-vocab-api-'));
  const none = { configured: false, available: false, status: 'test', detail: '模拟，不连接云服务' };
  let images = 0;
  const app = createApp({ dataDir: directory, chatEnabled: false, integrations: { probeIntegrations: async () => ({ speech: none, codex: { ...none, configured: true } }), ttsStatus: () => none, getCachedSpeech: async () => undefined,
    enrichVocabulary: async input => input.rows.map(row => proposal(row.term)), generateIllustration: async input => { images++; assert.equal(input.partOfSpeech, 'noun'); assert.match(input.pictureHint!, /苹果/); throw Error('模拟停止，不生成'); },
  } });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (app.server.address() as { port: number }).port;
  const request = async (url: string, body?: unknown) => { const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  try {
    const before = app.store.read(); const start = await request('/api/import/enrich', { text: 'happy' }); assert.equal(start.status, 202);
    let result; for (let i = 0; i < 100; i++) { result = (await request(`/api/import/enrich/${start.body.id}`)).body; if (result.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.equal(result.status, 'ready'); assert.deepEqual(app.store.read(), before); assert.equal(images, 0);
    const invalid = await request('/api/packs', { title: '未确认', rows: [{ term: 'happy', meaning: '快乐' }], requireEnriched: true }); assert.equal(invalid.status, 400);
    assert.equal((await request('/api/packs', { title: '确认', rows: result.rows, requireEnriched: true })).status, 200);
    for (let i = 0; i < 100 && !images; i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(images, 1); assert.equal(app.store.read().packs.at(-1)?.enabled, false); assert.equal(app.store.read().charges.length, 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('official vocabulary transport requests a no-tool ephemeral OAuth turn, validates real shape, rejects API-key login and tool attempts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'word-vocab-rpc-'));
  let mode = 'success', closed = 0; const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const factory = (options: { args: string[] }): DialogueTransport => {
    assert.ok(options.args.includes('permissions.word_dialogue.network.enabled=false'));
    let listener: ((value: Record<string, any>) => void) | undefined;
    return { notify() {}, listen(cb) { listener = cb; return () => { listener = undefined; }; }, close() { closed++; }, async request(method, params) {
      calls.push({ method, params });
      if (method === 'account/read') return { account: { type: mode === 'login' ? 'apiKey' : 'chatgpt' } };
      if (method === 'permissionProfile/list') return { data: [{ id: 'word_dialogue', allowed: true }] };
      if (method === 'config/read') return { config: { mcp_servers: { private_server: {} } } };
      if (method === 'thread/start') { assert.equal(params?.ephemeral, true); assert.equal(params?.approvalPolicy, 'never'); return { thread: { id: 'test-thread' } }; }
      if (method === 'turn/start') {
        setImmediate(() => {
          if (mode === 'tool') listener?.({ method: 'item/completed', params: { threadId: 'test-thread', turnId: 'turn', item: { type: 'commandExecution' } } });
          else { listener?.({ method: 'item/completed', params: { threadId: 'test-thread', turnId: 'turn', item: { type: 'agentMessage', text: JSON.stringify({ rows: [proposal('apple')] }) } } }); listener?.({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { id: 'turn', status: 'completed' } } }); }
        }); return { turn: { id: 'turn' } };
      }
      return {};
    } };
  };
  try {
    const input = { rows: [{ term: 'apple', meaning: '' }], dataDir: directory };
    assert.equal((await enrichVocabulary(input, { transportFactory: factory }))[0].meaning, '苹果');
    assert.equal((calls.find(call => call.method === 'thread/start')?.params?.config as any).mcp_servers.private_server.enabled, false);
    assert.ok(calls.some(call => call.method === 'turn/start' && call.params?.outputSchema));
    mode = 'login'; await assert.rejects(enrichVocabulary(input, { transportFactory: factory }), { code: 'CODEX_LOGIN_REQUIRED' });
    mode = 'tool'; await assert.rejects(enrichVocabulary(input, { transportFactory: factory }), { code: 'VOCABULARY_TOOL_BLOCKED' });
    assert.equal(closed, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
