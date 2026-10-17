import type { IllustrationJob, PackImageStatus, Word } from '../shared/contracts.ts';
import { AppError, type Store } from './store.ts';

export interface PackImageOptions {
  store: Pick<Store, 'read'>;
  /** Resolves only after the existing illustration job is in a terminal state. */
  runWord(wordId: string): Promise<IllustrationJob>;
  cancelWord(wordId: string): void | Promise<void>;
}
interface Snapshot { words: Word[]; fingerprint: string }
interface Batch {
  packId: string; fingerprint: string; cancelled: boolean; done: Promise<void>; resolve(): void;
  currentWordId?: string; wake?: () => void; cancelSent?: Promise<void>;
}
interface Outcome { fingerprint: string; status: 'error' | 'stopped'; error?: string }

/** Parent-authorized, serial missing-image work. Reading state or restarting never dispatches generation. */
export function createPackImageManager(options: PackImageOptions) {
  const { store, runWord, cancelWord } = options;
  const queue: Batch[] = [], outcomes = new Map<string, Outcome>();
  let active: Batch | undefined, closed = false, pumping: Promise<void> | undefined, scheduled: NodeJS.Immediate | undefined;
  function snapshot(packId: string): Snapshot {
    const data = store.read();
    if (!data.packs.some(pack => pack.id === packId && !pack.deletedAt)) throw new AppError('找不到这本词表。', 'PACK_IMAGE_NOT_FOUND', 404);
    const words = data.words.filter(word => word.packId === packId && !word.deletedAt);
    return { words, fingerprint: JSON.stringify([packId, data.profile.interestVersion, data.profile.interests, words.map(word => [word.id,word.term,word.meaning,word.learningVersion])]) };
  }
  function check(batch: Batch) {
    if (closed || batch.cancelled) throw new AppError('词表图片准备已停止。', 'CANCELLED', 409);
    if (snapshot(batch.packId).fingerprint !== batch.fingerprint) throw new AppError('词义、词表内容或兴趣已变化，请按新内容重新准备图片。', 'PACK_IMAGE_CHANGED', 409);
  }
  function safeError(error: unknown) {
    const code = String((error as { code?: string })?.code ?? '');
    if (code === 'PACK_IMAGE_CHANGED') return '词义、词表内容或兴趣已变化，请按新内容重新准备图片。';
    if (/^(CODEX|IMAGE)_(LOGIN_REQUIRED|AUTH|NOT_LOGGED_IN)$/.test(code)) return '请先连接现有 Codex 账号，再补齐缺图；已成功的图片会保留。';
    if (/^(CODEX|IMAGE)_.*(RATE_LIMIT|QUOTA|CREDIT|PAYMENT|USAGE_LIMIT|LIMIT_REACHED|EXHAUST)/.test(code)) return 'Codex 使用额度或频率受限，已停止准备且不会充值；已成功的图片会保留。';
    return '图片准备没有完成，已保留成功图片；请检查 Codex 账号登录、使用额度或该单词的错误提示，再补齐缺图。';
  }
  function currentFingerprint(packId: string, fallback: string) { try { return snapshot(packId).fingerprint; } catch { return fallback; } }
  function record(batch: Batch, status: 'error' | 'stopped', error?: string) {
    outcomes.set(batch.packId, { fingerprint: currentFingerprint(batch.packId,batch.fingerprint), status, ...(error ? { error } : {}) });
  }
  function getStatus(packId: string): PackImageStatus {
    const value = snapshot(packId), total = value.words.length;
    const approved = value.words.filter(word => word.assetStatus === 'approved').length, reviewing = value.words.filter(word => word.assetStatus === 'review').length;
    const failed = value.words.filter(word => word.assetStatus === 'error').length, pending = total - approved - reviewing - failed;
    const batch = active?.packId === packId ? active : queue.find(batch => batch.packId === packId);
    const outcome = outcomes.get(packId), previous = outcome?.fingerprint === value.fingerprint ? outcome : undefined;
    const changed = batch && batch.fingerprint !== value.fingerprint;
    const status: PackImageStatus['status'] = !total ? 'error' : changed ? 'error' : batch ? batch.cancelled ? 'stopped' : batch === active ? 'running' : 'queued'
      : previous?.status ?? (approved === total ? 'ready' : failed ? 'error' : value.words.some(word => word.assetStatus === 'generating') ? 'running' : pending ? 'idle' : 'review');
    return { packId,status,total,approved,reviewing,pending,failed,
      ...(batch?.currentWordId ? {currentWordId:batch.currentWordId} : {}),
      ...(!total ? {error:'这本词表没有单词，请先确认词表内容。'} : changed ? {error:safeError({code:'PACK_IMAGE_CHANGED'})} : previous?.error ? {error:previous.error} : failed && !batch ? {error:safeError(undefined)} : {}) };
  }
  function pause(batch: Batch) {
    return new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); if (batch.wake === finish) batch.wake = undefined; resolve(); };
      const timer = setTimeout(finish,50); timer.unref(); batch.wake = finish;
    });
  }
  async function run(batch: Batch) {
    try {
      const initial = snapshot(batch.packId); check(batch);
      for (const original of initial.words) {
        check(batch);
        let word = snapshot(batch.packId).words.find(word => word.id === original.id)!;
        batch.currentWordId = word.id;
        // Join an already-generating word through its stored state; never replace its in-flight asset.
        const joined = word.assetStatus === 'generating';
        while (word.assetStatus === 'generating') { await pause(batch); check(batch); word = snapshot(batch.packId).words.find(word => word.id === original.id)!; }
        if (word.assetStatus === 'approved' || word.assetStatus === 'review') continue;
        if (joined) throw new AppError('已有图片任务没有完成，请家长检查后再补齐。', 'PACK_IMAGE_RESULT', 502);
        const result = await runWord(word.id); check(batch);
        const current = snapshot(batch.packId).words.find(item => item.id === word.id)!;
        if (result.wordId !== word.id || result.status !== 'review' || !['review','approved'].includes(current.assetStatus)) throw new AppError('单词图片准备未完成。', 'PACK_IMAGE_RESULT', 502);
      }
      check(batch); outcomes.delete(batch.packId);
    } catch (error) { record(batch,closed || batch.cancelled ? 'stopped' : 'error',closed || batch.cancelled ? undefined : safeError(error)); }
  }
  async function pump() {
    while (!closed && queue.length) {
      const batch = queue.shift()!; active = batch;
      try { await run(batch); }
      finally { if (active === batch) active = undefined; batch.currentWordId = undefined; batch.resolve(); }
    }
  }
  function schedule() {
    if (closed || scheduled || pumping) return;
    scheduled = setImmediate(() => {
      scheduled = undefined;
      if (closed) return;
      pumping = pump().finally(() => { pumping = undefined; if (queue.length) schedule(); });
    });
  }
  function start(packId: string): PackImageStatus {
    if (closed) throw new AppError('图片准备服务已关闭。', 'PACK_IMAGE_CLOSED', 503);
    const value = snapshot(packId);
    if (active?.packId === packId || queue.some(batch => batch.packId === packId)) return getStatus(packId);
    outcomes.delete(packId);
    if (!value.words.length || value.words.every(word => word.assetStatus === 'approved' || word.assetStatus === 'review')) return getStatus(packId);
    let resolve!: () => void; const done = new Promise<void>(finish => {resolve=finish;});
    queue.push({packId,fingerprint:value.fingerprint,cancelled:false,done,resolve}); schedule(); return getStatus(packId);
  }
  async function stop(batch: Batch) {
    batch.cancelled = true; batch.wake?.();
    if (batch.currentWordId && !batch.cancelSent) batch.cancelSent = Promise.resolve().then(() => cancelWord(batch.currentWordId!)).catch(() => {});
    await batch.cancelSent;
    await batch.done;
  }
  async function cancel(packId: string): Promise<PackImageStatus> {
    const value = snapshot(packId), queued = queue.findIndex(batch => batch.packId === packId);
    if (queued !== -1) { const [batch] = queue.splice(queued,1); batch.cancelled = true; record(batch,'stopped'); batch.resolve(); }
    if (active?.packId === packId) await stop(active);
    else if (queued === -1) outcomes.set(packId,{fingerprint:value.fingerprint,status:'stopped'});
    return getStatus(packId);
  }
  async function close() {
    closed = true; if (scheduled) clearImmediate(scheduled); scheduled = undefined;
    for (const batch of queue.splice(0)) { batch.cancelled = true; record(batch,'stopped'); batch.resolve(); }
    if (active) await stop(active);
    await pumping;
  }
  return { getStatus,start,cancel,busy:()=>Boolean(active || queue.length),close };
}
