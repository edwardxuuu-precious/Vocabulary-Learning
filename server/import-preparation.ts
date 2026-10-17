import { randomUUID } from 'node:crypto';
import type { ImportPreparation, ImportRow } from '../shared/contracts.ts';
import { isEnrichedRow } from '../shared/vocabulary.ts';
import { AppError, parseImport, validateRows } from './store.ts';
import { validateVocabularyResult, type VocabularyInput } from './integrations/vocabulary.ts';

export function createImportPreparation(options: { dataDir: string; enrich: (input: VocabularyInput) => Promise<ImportRow[]> }) {
  const jobs = new Map<string, ImportPreparation>();
  let active: { id: string; controller: AbortController; done: Promise<void> } | undefined, closed = false;
  const get = (id: string) => { const job = jobs.get(id); if (!job) throw new AppError('词表草稿已过期，请重新粘贴。', 'IMPORT_NOT_FOUND', 404); return structuredClone(job); };
  async function run(job: ImportPreparation, controller: AbortController) {
    try {
      const pending = job.rows.map((row, index) => ({ row, index })).filter(item => !isEnrichedRow(item.row));
      for (let offset = 0; offset < pending.length; offset += 20) {
        if (controller.signal.aborted || closed) return;
        const batch = pending.slice(offset, offset + 20);
        const result = await options.enrich({ rows: batch.map(item => item.row), dataDir: options.dataDir, signal: controller.signal });
        // Validate even injected providers, before any result becomes a reviewable proposal.
        const checked = validateVocabularyResult({ rows: result.map(row => ({ ...row, pictureHint: row.pictureHint ?? '' })) }, batch.map(item => item.row));
        if (controller.signal.aborted || closed) return;
        batch.forEach((item, i) => { job.rows[item.index] = checked[i]; });
        job.completed = job.rows.filter(isEnrichedRow).length;
      }
      job.status = job.completed === job.total ? 'ready' : 'error';
      if (job.status === 'error') job.error = '有词条尚未识别，请检查英文或手动补全中文、词性和配图说明。';
    } catch (failure) {
      if (controller.signal.aborted || closed) return;
      job.status = 'error'; job.error = failure instanceof Error && typeof (failure as { code?: string }).code === 'string' ? failure.message : '词义补全暂时失败，已完成部分保留，请稍后补齐。';
    } finally { if (active?.id === job.id) active = undefined; }
  }
  function start(text: unknown, edited?: unknown): ImportPreparation {
    if (closed) throw new AppError('词表准备服务已关闭。');
    if (active) throw new AppError('已有词表正在补全，请先等候或停止。', 'IMPORT_BUSY', 409);
    const parsed = parseImport(text); if (parsed.errors.length) throw new AppError(parsed.errors.join(' '));
    let rows = parsed.rows;
    if (edited !== undefined) {
      const checked = validateRows(edited, true);
      if (checked.errors.length || checked.rows.length !== rows.length || checked.rows.some((row, i) => row.term !== rows[i].term)) throw new AppError('英文词表已变化，请重新检查。', 'IMPORT_STALE', 409);
      rows = checked.rows;
    }
    while (jobs.size >= 8) jobs.delete(jobs.keys().next().value!);
    const job: ImportPreparation = { id: randomUUID(), status: 'running', rows, total: rows.length, completed: rows.filter(isEnrichedRow).length };
    jobs.set(job.id, job);
    const controller = new AbortController();
    const done = new Promise<void>(resolve => setImmediate(() => void run(job, controller).finally(resolve)));
    active = { id: job.id, controller, done };
    return get(job.id);
  }
  async function cancel(id: string) {
    const job = jobs.get(id); get(id);
    const owned = active?.id === id ? active : undefined;
    if (owned) { job!.status = 'stopped'; owned.controller.abort(); await owned.done; }
    return get(id);
  }
  return { get, start, cancel, async close() { closed = true; if (active) await cancel(active.id); } };
}
