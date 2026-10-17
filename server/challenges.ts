import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AssessmentSession } from '../shared/contracts.ts';
import { AppError, type Store } from './store.ts';
import { assertChallengeAssets, challenge, currentChallengeItem, reviewChallenge, saveChallengeResponse, submitChallenge } from './challenge-state.ts';
import { createAssessmentStt, type AssessmentSttInput } from './integrations/assessment-stt.ts';
import { createAssessmentGrader, validateGradingSuggestions, type GradingAnswer, type GradingSuggestion } from './integrations/assessment-grader.ts';
import { IntegrationError } from './integrations/errors.ts';

export function validateChallengeWav(audio: Buffer) {
  if (audio.length < 3244 || audio.length > 640044 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.readUInt32LE(4) !== audio.length - 8 || audio.toString('ascii', 8, 16) !== 'WAVEfmt ' || audio.readUInt32LE(16) !== 16 || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1 || audio.readUInt32LE(24) !== 16000 || audio.readUInt32LE(28) !== 32000 || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16 || audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== audio.length - 44 || (audio.length - 44) % 2) throw new AppError('请重新录一段不超过20秒的有效声音。', 'INVALID_AUDIO');
  let energy = 0;
  for (let offset = 44; offset < audio.length; offset += 2) energy += (audio.readInt16LE(offset) / 32768) ** 2;
  if (Math.sqrt(energy / ((audio.length - 44) / 2)) < .002) throw new AppError('没有听到声音，可以重录或跳过。', 'EMPTY_AUDIO');
  return (audio.length - 44) / 32000;
}
export interface ChallengeServices { transcribe?: (input: AssessmentSttInput) => Promise<string>; grade?: (answers: GradingAnswer[], signal: AbortSignal) => Promise<GradingSuggestion[]> }
export function createChallengeManager(options: { store: Store; dataDir: string; imageAvailable: (url: string) => boolean; services?: ChallengeServices; removeRecording?: (file: string) => void }) {
  const { store, imageAvailable } = options, directory = path.join(options.dataDir, 'assessment-recordings');
  mkdirSync(directory, { recursive: true });
  const safeDirectory = () => {
    if (realpathSync(directory) !== path.join(realpathSync(options.dataDir), 'assessment-recordings')) throw new AppError('录音目录无效。', 'RECORDING_DIRECTORY', 500);
  }; safeDirectory();
  const file = (id: string) => { safeDirectory(); if (!/^[a-f0-9-]{36}$/.test(id)) throw new AppError('录音编号无效。'); const target = path.join(directory, `${id}.wav`); if (existsSync(target) && realpathSync(target) !== target) throw new AppError('录音路径无效。'); return target; };
  const transcribe = options.services?.transcribe ?? createAssessmentStt(), grade = options.services?.grade ?? createAssessmentGrader({ dataDir: options.dataDir });
  let closed = false, running: Promise<void> | undefined, controller: AbortController | undefined;
  function cleanup() {
    if (closed) return;
    const data = store.read(), referenced = new Set<string>();
    for (const session of data.assessments ?? []) for (const item of session.items) {
      const audio = item.response?.recording; if (!audio) continue; referenced.add(audio.id);
      if (audio.status === 'purge-pending') {
        try { const target = file(audio.id); if (existsSync(target)) (options.removeRecording ?? unlinkSync)(target); store.mutate(data => { const audio = challenge(data, session.id).items.find(row => row.id === item.id)?.response?.recording; if (audio?.status === 'purge-pending') audio.status = 'deleted'; }); } catch { /* Persisted purge-pending is retried at startup and on the maintenance timer. */ }
      } else if (audio.status === 'ready' && !existsSync(file(audio.id))) store.mutate(data => { challenge(data, session.id).items.find(row => row.id === item.id)!.response!.recording!.status = 'missing'; });
    }
    for (const name of readdirSync(directory)) if (/^[a-f0-9-]{36}\.wav$/.test(name) && !referenced.has(name.slice(0, -4))) { try { unlinkSync(file(name.slice(0, -4))); } catch { /* Retry orphan cleanup. */ } }
  }
  if (store.read().assessments?.some(session => session.job && ['queued', 'transcribing', 'grading'].includes(session.job.status))) store.mutate(data => { for (const session of data.assessments ?? []) if (session.job && ['queued', 'transcribing', 'grading'].includes(session.job.status)) { session.job.status = 'interrupted'; session.job.error = '服务重启，批改已中断。成功转写已保存，请家长重试剩余阶段。'; delete session.job.runId; } });
  cleanup(); const maintenance = setInterval(() => { try { cleanup(); } catch { /* Next timer retries. */ } }, 30000); maintenance.unref();
  function update(id: string, runId: string, fn: (session: AssessmentSession) => void) {
    if (closed) return;
    store.mutate(data => { const session = challenge(data, id); if (session.job?.runId === runId) fn(session); });
  }
  async function run(id: string) {
    const runId = randomUUID(); controller = new AbortController(); const signal = controller.signal;
    store.mutate(data => { const job = challenge(data, id).job!; job.runId = runId; job.runs++; job.status = 'transcribing'; job.stage = 'transcribe'; delete job.error; });
    try {
      const snapshot = challenge(store.read(), id);
      for (const item of snapshot.items) {
        if (closed || signal.aborted) return;
        if (item.response?.kind !== 'recording' || item.reviews?.length || item.transcript) continue;
        assertChallengeAssets(store.read(), item, imageAvailable);
        const audio = item.response.recording!;
        if (audio.status !== 'ready') throw new AppError('原音缺失，请重新测试或标记未确认。');
        const bytes = readFileSync(file(audio.id));
        if (createHash('sha256').update(bytes).digest('hex') !== audio.sha256) throw new AppError('录音已变化，请重新测试。');
        let charge: string | undefined;
        const text = await transcribe({ audio: bytes, seconds: audio.seconds, language: item.dimension === 'en-zh' ? 'zh' : 'en', signal, beforeRequest: estimate => { if (closed || signal.aborted) throw new AppError('批改已停止。'); charge = store.reserve('stt', estimate, audio.seconds); } });
        if (closed || signal.aborted) return;
        if (typeof text !== 'string' || text.length > 2000) throw new AppError('转写响应无效。');
        if (charge) store.settle(charge, 0); // Confirmed free-plan allowance; seconds are retained in the ledger.
        update(id, runId, session => { const current = session.items.find(row => row.id === item.id)!; if (!current.reviews?.length && current.response?.version === item.response!.version) current.transcript = { text, responseVersion: item.response!.version, at: store.clock().toISOString() }; });
      }
      if (closed || signal.aborted) return;
      update(id, runId, session => { session.job!.status = 'grading'; session.job!.stage = 'grade'; });
      const pending = challenge(store.read(), id).items.filter(item => item.transcript && !item.proposal && !item.reviews?.length);
      const answers = pending.map(item => ({ id: item.id, dimension: item.dimension, term: item.word.term, meaning: item.word.meaning, transcript: item.transcript!.text }));
      if (answers.length) {
        for (const item of pending) assertChallengeAssets(store.read(), item, imageAvailable);
        const suggestions = validateGradingSuggestions({ items: await grade(answers, signal) }, answers);
        if (closed || signal.aborted) return;
        update(id, runId, session => { for (const suggestion of suggestions) {
          const item = session.items.find(row => row.id === suggestion.id)!;
          const snapshotItem = pending.find(row => row.id === item.id)!;
          // A parent review or changed vocabulary always wins over a late model result.
          if (item.reviews?.length || item.response?.version !== snapshotItem.response?.version) continue;
          assertChallengeAssets(store.read(), item, imageAvailable);
          item.proposal = { version: (item.proposal?.version ?? 0) + 1, responseVersion: item.response!.version, verdict: suggestion.verdict, reason: suggestion.reason, at: store.clock().toISOString() };
        } });
      }
      update(id, runId, session => { session.job!.status = 'review'; delete session.job!.runId; });
    } catch (error) {
      update(id, runId, session => { session.job!.status = 'failed'; session.job!.error = error instanceof AppError || error instanceof IntegrationError ? error.message.slice(0, 240) : '批改服务未完成，原音和已完成转写已保留。'; delete session.job!.runId; });
    } finally { controller = undefined; }
  }
  function kick() {
    if (closed || running) return;
    running = (async () => {
      let next: AssessmentSession | undefined;
      while (!closed && (next = store.read().assessments?.find(session => session.workflow === 'recorded' && session.job?.status === 'queued'))) await run(next.id);
    })().catch(() => {}).finally(() => { running = undefined; });
  }
  return {
    cleanup,
    busy: () => Boolean(running),
    upload(id: string, itemId: string, expectedVersion: number, audio: Buffer) {
      const seconds = validateChallengeWav(audio), sha256 = createHash('sha256').update(audio).digest('hex');
      const previous = currentChallengeItem(store.read(), challenge(store.read(), id), itemId, imageAvailable).response?.recording;
      if (previous?.sha256 === sha256) return challenge(store.read(), id);
      const recording = { id: randomUUID(), bytes: audio.length, seconds, sha256, status: 'ready' as const };
      writeFileSync(file(recording.id), audio, { flag: 'wx' });
      let result: AssessmentSession;
      try { result = store.mutate(data => saveChallengeResponse(data, id, { itemId, expectedVersion, action: 'record' }, store.clock(), imageAvailable, recording)); }
      catch (error) { unlinkSync(file(recording.id)); throw error; }
      cleanup(); return result;
    },
    respond: (id: string, body: Record<string, unknown>) => store.mutate(data => saveChallengeResponse(data, id, body, store.clock(), imageAvailable)),
    submit(id: string) { const result = store.mutate(data => submitChallenge(data, id, store.clock(), imageAvailable)); setImmediate(kick); return result; },
    review(id: string, body: Record<string, unknown>) { store.mutate(data => reviewChallenge(data, id, body, store.clock())); cleanup(); return challenge(store.read(), id); },
    retry(id: string) { const result = store.mutate(data => { const session = challenge(data, id); if (!session.job || !['failed', 'interrupted'].includes(session.job.status)) return session; session.job.status = 'queued'; delete session.job.error; return session; }); setImmediate(kick); return result; },
    audio(id: string, itemId: string) { const item = challenge(store.read(), id).items.find(row => row.id === itemId), audio = item?.response?.recording; if (!audio || audio.status !== 'ready' || item?.reviews?.length || !existsSync(file(audio.id))) throw new AppError('原音已清理或缺失，请查看文字记录，未确认题可重新测试。', 'NOT_FOUND', 404); return readFileSync(file(audio.id)); },
    async close() { closed = true; clearInterval(maintenance); controller?.abort(); await running; },
  };
}
