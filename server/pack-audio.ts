import { resolve } from 'node:path';
import type { PackAudioStatus, Word, WordPack } from '../shared/contracts.ts';
import type { TtsInput } from './integrations/elevenlabs.ts';
import type * as Providers from './integrations/index.ts';
import { AppError, type Store } from './store.ts';

export interface PackAudioOptions {
  store: Pick<Store, 'read' | 'reserve' | 'settle'>;
  integration: Pick<typeof Providers, 'ttsStatus' | 'getCachedSpeech' | 'synthesizeSpeech' | 'estimateTtsCost'>;
  dataDir: string;
  toMediaUrl: (filePath: string) => string;
}
interface Snapshot { pack: WordPack; words: Word[]; fingerprint: string }
interface Job { packId: string; fingerprint: string; controller: AbortController; done: Promise<void>; currentTerm?: string }
interface Outcome { fingerprint: string; status: 'stopped' | 'error'; error?: string }

/** Explicit parent-authorized work only. Runtime job state is rebuilt from exact provider caches after restart. */
export function createPackAudioManager(options: PackAudioOptions) {
  const { store, integration, toMediaUrl } = options, dataDir = resolve(options.dataDir);
  let active: Job | undefined, closed = false;
  const outcomes = new Map<string, Outcome>();
  const input = (text: string, signal?: AbortSignal): TtsInput => ({ text, locale: 'en-US', tone: 'clear', dataDir, ...(signal ? { signal } : {}) });
  function snapshot(packId: string): Snapshot {
    const data = store.read(), pack = data.packs.find(item => item.id === packId && !item.deletedAt);
    if (!pack) throw new AppError('找不到这本词表。', 'PACK_AUDIO_NOT_FOUND', 404);
    const words = data.words.filter(word => word.packId === packId && !word.deletedAt);
    // Picture approval, labels and enablement can proceed in parallel; only the audio input/membership matters.
    return { pack, words, fingerprint: JSON.stringify([pack.id, words.map(word => [word.id, word.term])]) };
  }
  function check(job: Job) {
    if (closed || job.controller.signal.aborted) throw new AppError('词表发音准备已停止。', 'CANCELLED', 409);
    if (snapshot(job.packId).fingerprint !== job.fingerprint) throw new AppError('词表内容已变化，请按新内容重新准备发音。', 'PACK_AUDIO_CHANGED', 409);
  }
  async function cached(text: string, signal?: AbortSignal) {
    if (integration.ttsStatus().provider !== 'elevenlabs') throw new AppError('预缓存只支持现有 ElevenLabs 朗读。', 'PACK_AUDIO_PROVIDER', 503);
    if (!text.trim() || text.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new AppError('词表中有无效的英文词条，请家长检查后重试。', 'PACK_AUDIO_INVALID_TERM');
    const file = await integration.getCachedSpeech(input(text, signal));
    if (file) toMediaUrl(file); // Provider checks bytes/format; the host checks the current local media boundary.
    return Boolean(file);
  }
  async function scan(value: Snapshot): Promise<PackAudioStatus['words']> {
    const terms = new Map<string, Promise<boolean>>();
    for (const word of value.words) if (!terms.has(word.term)) terms.set(word.term, cached(word.term));
    // Await every rejection even if one term fails, without querying duplicate terms twice.
    const rows = await Promise.allSettled([...terms].map(async ([term, pending]) => [term, await pending] as const));
    const failure = rows.find(row => row.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const found = new Map(rows.flatMap(row => row.status === 'fulfilled' ? [row.value] : []));
    return value.words.map(word => ({ wordId: word.id, term: word.term, cached: found.get(word.term) === true }));
  }
  function safeMessage(error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code?.startsWith('BUDGET')) return '本月语音预算不足，已停止准备；已缓存的发音仍可使用。';
    if (code === 'PACK_AUDIO_CHANGED' || code === 'PACK_AUDIO_NOT_FOUND') return '词表内容已变化，请按新内容重新准备发音。';
    if (code === 'PACK_AUDIO_INVALID_TERM') return '词表中有无效的英文词条，请家长检查后重试。';
    if (code === 'SPEECH_RATE_LIMIT') return 'ElevenLabs 额度或频率受限，已停止；请家长检查后再重试。';
    if (code === 'PACK_AUDIO_PROVIDER') return '请先配置现有 ElevenLabs 英文朗读服务，再重试准备发音。';
    if (code === 'SPEECH_AUTH') return 'ElevenLabs 认证或音色权限未通过，已停止准备。';
    return '发音准备没有完成，已停止；已缓存的发音会保留，请家长检查后重试。';
  }
  async function getStatus(packId: string): Promise<PackAudioStatus> {
    // A concurrent edit must not make a scan of the old text look ready for the new text.
    for (let retry = 0; retry < 2; retry++) {
      const value = snapshot(packId);
      let words: PackAudioStatus['words'];
      try { words = await scan(value); }
      catch (error) { return { packId, status: 'error', total: value.words.length, cached: 0, words: value.words.map(word => ({ wordId: word.id, term: word.term, cached: false })), error: safeMessage(error) }; }
      if (snapshot(packId).fingerprint !== value.fingerprint) continue;
      const count = words.filter(word => word.cached).length;
      if (!words.length) return { packId, status: 'error', total: 0, cached: 0, words, error: '这本词表没有单词，请先由家长确认词表内容。' };
      if (count === words.length) return { packId, status: 'ready', total: words.length, cached: count, words };
      const running = active?.packId === packId && active.fingerprint === value.fingerprint;
      const previous = outcomes.get(packId), outcome = previous?.fingerprint === value.fingerprint ? previous : undefined;
      return { packId, status: running ? active!.controller.signal.aborted ? 'stopped' : 'running' : outcome?.status ?? 'idle', total: words.length, cached: count, words,
        ...(running && active!.currentTerm ? { currentTerm: active!.currentTerm } : {}), ...(outcome?.error && !running ? { error: outcome.error } : {}) };
    }
    const value = snapshot(packId);
    return { packId, status: 'error', total: value.words.length, cached: 0, words: value.words.map(word => ({ wordId: word.id, term: word.term, cached: false })), error: '词表内容正在变化，请稍后重新检查。' };
  }
  function requireProvider() {
    const status = integration.ttsStatus();
    if (status.provider !== 'elevenlabs' || !status.configured) throw new AppError('当前英文朗读服务未配置。', 'PACK_AUDIO_PROVIDER', 503);
  }
  async function run(job: Job, value: Snapshot) {
    try {
      for (const term of new Set(value.words.map(word => word.term))) {
        check(job); job.currentTerm = term;
        if (await cached(term, job.controller.signal)) { check(job); continue; }
        check(job); requireProvider();
        let charge: string | undefined;
        const result = await integration.synthesizeSpeech({ ...input(term, job.controller.signal), beforeRequest: () => {
          check(job); requireProvider();
          if (charge) throw new AppError('发音请求不能重复记账。', 'PACK_AUDIO_OWNER', 500);
          charge = store.reserve('tts', integration.estimateTtsCost(term), term.length);
        } });
        // Only the provider's actual request owner reserves/settles. A shared in-flight waiter owns no charge.
        if (result.mode !== 'api' || !Number.isFinite(result.costCny) || result.costCny < 0) throw new AppError('没有获得真实缓存发音。', 'PACK_AUDIO_RESULT', 502);
        if (charge) store.settle(charge, result.costCny, term.length);
        check(job);
        if (!result.filePath) throw new AppError('没有获得真实缓存发音。', 'PACK_AUDIO_RESULT', 502);
        toMediaUrl(result.filePath);
        if (!await cached(term, job.controller.signal)) throw new AppError('完整发音缓存尚未保存。', 'PACK_AUDIO_RESULT', 502);
        check(job);
      }
      check(job); outcomes.delete(job.packId);
    } catch (error) {
      outcomes.set(job.packId, { fingerprint: job.fingerprint, status: job.controller.signal.aborted || closed ? 'stopped' : 'error',
        ...(!job.controller.signal.aborted && !closed ? { error: safeMessage(error) } : {}) });
      // Failure after dispatch has unknown usage: retain its reservation and never retry automatically.
    } finally { if (active === job) active = undefined; }
  }
  async function start(packId: string): Promise<PackAudioStatus> {
    if (closed) throw new AppError('发音准备服务已关闭。', 'PACK_AUDIO_CLOSED', 503);
    if (active) {
      if (active.packId !== packId) throw new AppError('另一本词表正在准备发音，请先等它完成或停止。', 'PACK_AUDIO_BUSY', 409);
      return getStatus(packId);
    }
    const value = snapshot(packId), job: Job = { packId, fingerprint: value.fingerprint, controller: new AbortController(), done: Promise.resolve() };
    active = job; outcomes.delete(packId);
    // Keep close/cancel joined to the entire initial read and subsequent writer, including slow cache scans.
    let finish!: () => void; job.done = new Promise<void>(done => { finish = done; });
    try {
      const status = await getStatus(packId);
      if (job.controller.signal.aborted || closed) { if (active === job) active = undefined; finish(); return { ...status, status: 'stopped' }; }
      if (status.status === 'ready' || status.status === 'error') { if (active === job) active = undefined; finish(); return status; }
      check(job);
      void run(job, value).finally(finish);
      return { ...status, status: 'running' };
    } catch (error) { if (active === job) active = undefined; finish(); throw error; }
  }
  async function cancel(packId: string): Promise<PackAudioStatus> {
    const job = active?.packId === packId ? active : undefined;
    if (job) { job.controller.abort(); await job.done; }
    const value = snapshot(packId); outcomes.set(packId, { fingerprint: value.fingerprint, status: 'stopped' });
    return getStatus(packId);
  }
  return { getStatus, start, cancel, busy: () => Boolean(active), async close() { closed = true; const job = active; if (job) { job.controller.abort(); await job.done; } } };
}
