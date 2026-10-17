import type { AssessmentItem, AssessmentRecording, AssessmentResult, AssessmentSession } from '../shared/contracts.ts';
import { assessmentCurrent, sameAssessmentWord } from '../shared/assessment.ts';
import { rebuildAssessmentProgress } from './assessments.ts';
import { AppError, type StoredData } from './store.ts';

export function challenge(data: StoredData, id: string) {
  const session = data.assessments?.find(row => row.id === id);
  if (!session || session.workflow !== 'recorded') throw new AppError('找不到录音挑战。', 'NOT_FOUND', 404);
  return session;
}
export function currentChallengeItem(data: StoredData, session: AssessmentSession, itemId: unknown, imageAvailable: (url: string) => boolean) {
  const item = session.items.find(row => row.id === itemId);
  if (!item) throw new AppError('找不到这道题。');
  if (session.submittedAt) throw new AppError('本轮已提交，作答已冻结。', 'ASSESSMENT_FROZEN', 409);
  if (!item.response && assessmentCurrent(session)?.id !== item.id) throw new AppError('请先完成当前题。', 'ASSESSMENT_ORDER', 409);
  assertChallengeAssets(data, item, imageAvailable);
  return item;
}
export function assertChallengeAssets(data: StoredData, item: AssessmentItem, imageAvailable: (url: string) => boolean) {
  for (const snapshot of [item.word, ...item.choices]) {
    const word = data.words.find(row => row.id === snapshot.id);
    if (!sameAssessmentWord(word, snapshot) || word?.assetStatus !== 'approved' || !data.packs.some(pack => pack.id === word.packId && pack.enabled) || !imageAvailable(snapshot.imageUrl))
      throw new AppError('词义或素材已变化，请按当前词表重新挑战。', 'ASSESSMENT_STALE', 409);
  }
}
export function saveChallengeResponse(data: StoredData, id: string, body: Record<string, unknown>, now: Date, imageAvailable: (url: string) => boolean, recording?: AssessmentRecording) {
  if (Object.keys(body).some(key => !['itemId', 'action', 'selectedId', 'expectedVersion'].includes(key)) || !['record', 'choose', 'skip', 'unavailable'].includes(String(body.action))) throw new AppError('挑战作答无效。');
  const session = challenge(data, id), item = currentChallengeItem(data, session, body.itemId, imageAvailable);
  const old = item.response, version = old?.version ?? 0;
  if (body.expectedVersion !== version) {
    // Identical first choice or upload retry returns saved evidence without a second score.
    if (old && (body.action === 'choose' && item.selectedId === body.selectedId || body.action === 'record' && old.recording?.sha256 === recording?.sha256 || body.action === 'skip' && old.kind === 'skipped')) return session;
    throw new AppError('作答已更新，请刷新后重试。', 'ASSESSMENT_VERSION', 409);
  }
  if (old && (item.dimension === 'look' || body.action !== 'record')) return session;
  let kind: 'recording' | 'choice' | 'skipped' | 'unavailable';
  if (body.action === 'record') {
    if (item.dimension === 'look' || !recording) throw new AppError('录音题目无效。');
    kind = 'recording';
  } else if (body.action === 'choose') {
    if (item.dimension !== 'look' || item.choices.length < 2 || !item.choices.some(choice => choice.id === body.selectedId)) throw new AppError('请选择有效图片。');
    kind = 'choice'; item.selectedId = body.selectedId as string;
  } else if (body.action === 'unavailable') {
    if (item.dimension !== 'look' || item.choices.length) throw new AppError('当前题目可以作答。');
    kind = 'unavailable';
  } else kind = 'skipped';
  item.response = { version: version + 1, kind, answeredAt: now.toISOString(), ...(kind === 'recording' ? { recording } : {}) };
  delete item.transcript; delete item.proposal;
  return session;
}
function writeAttempt(data: StoredData, session: AssessmentSession, item: AssessmentItem, result: AssessmentResult, confirmedAt: string, reviewVersion?: number) {
  item.result = result;
  const id = `${session.id}:${item.id}`, attempts = data.assessmentAttempts ??= [];
  const attempt = { id, sessionId: session.id, itemId: item.id, wordId: item.word.id, learningVersion: item.word.learningVersion, dimension: item.dimension, result, source: item.dimension === 'look' ? 'server' as const : 'parent' as const, createdAt: item.response!.answeredAt, confirmedAt, ...(reviewVersion ? { reviewVersion } : {}) };
  const index = attempts.findIndex(row => row.id === id);
  if (index >= 0) attempts[index] = attempt; else attempts.push(attempt);
}
export function submitChallenge(data: StoredData, id: string, now: Date, imageAvailable: (url: string) => boolean) {
  const session = challenge(data, id);
  if (session.submittedAt) return session;
  if (assessmentCurrent(session)) throw new AppError('先完成或跳过本轮题目。');
  for (const item of session.items) assertChallengeAssets(data, item, imageAvailable);
  session.submittedAt = session.completedAt = now.toISOString();
  for (const item of session.items) if (item.dimension === 'look') writeAttempt(data, session, item, item.response!.kind === 'choice' ? item.selectedId === item.word.id ? 'correct' : 'incorrect' : item.response!.kind === 'unavailable' ? 'unavailable' : 'skipped', session.submittedAt);
  session.job = { status: session.items.some(item => item.response?.kind === 'recording') ? 'queued' : 'review', stage: 'transcribe', runs: 0 };
  rebuildAssessmentProgress(data);
  return session;
}
export function reviewChallenge(data: StoredData, id: string, body: Record<string, unknown>, now: Date) {
  const session = challenge(data, id);
  if (!session.submittedAt || Object.keys(body).some(key => key !== 'items') || !Array.isArray(body.items) || !body.items.length || body.items.length > 15) throw new AppError('请选择要核验的题目。');
  const ids = new Set<string>();
  for (const row of body.items) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['itemId', 'responseVersion', 'proposalVersion', 'reviewVersion', 'result'].includes(key))) throw new AppError('核验数据无效。');
    const item = session.items.find(item => item.id === row.itemId);
    if (!item || item.dimension === 'look' || !item.response || ids.has(item.id) || !['correct', 'incorrect', 'hinted', 'unconfirmed', 'skipped'].includes(row.result)) throw new AppError('核验题目无效。');
    ids.add(item.id);
    if (row.responseVersion !== item.response.version || row.proposalVersion !== (item.proposal?.version ?? 0) || row.reviewVersion !== (item.reviews?.length ?? 0)) throw new AppError('题目或建议已更新，请刷新后重新核验。', 'ASSESSMENT_VERSION', 409);
    if (item.response.kind !== 'recording' && !['skipped', 'unconfirmed'].includes(row.result) || item.response.recording?.status === 'missing' && row.result !== 'unconfirmed') throw new AppError('缺少原始回答，请标记未确认并重新测试。');
  }
  for (const row of body.items) {
    const item = session.items.find(item => item.id === row.itemId)!;
    const reviews = item.reviews ??= [];
    reviews.push({ version: reviews.length + 1, responseVersion: item.response!.version, proposalVersion: item.proposal?.version ?? 0, result: row.result, at: now.toISOString() });
    writeAttempt(data, session, item, row.result, now.toISOString(), reviews.length);
    if (item.response?.recording && item.response.recording.status !== 'deleted') item.response.recording.status = 'purge-pending';
  }
  rebuildAssessmentProgress(data);
  return session;
}

/** Strict nested allowlists prevent recordings, paths, credentials or forged evidence entering backups. */
export function validateRecordedSession(session: AssessmentSession, attempts: NonNullable<StoredData['assessmentAttempts']>) {
  const fail = () => { throw new AppError('备份录音挑战证据无效。'); };
  const allowed = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
  const date = (value: unknown): value is string => typeof value === 'string' && value.length < 40 && Number.isFinite(Date.parse(value));
  const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
  if (!allowed(session, ['id', 'workflow', 'wordIds', 'mode', 'items', 'startedAt', 'completedAt', 'submittedAt', 'job']) || session.submittedAt !== session.completedAt) fail();
  let unanswered = false;
  for (const item of session.items) {
    if (!allowed(item, ['id', 'dimension', 'word', 'choices', 'response', 'result', 'selectedId', 'transcript', 'proposal', 'reviews'])) fail();
    const response = item.response, attempt = attempts.find(row => row.sessionId === session.id && row.itemId === item.id);
    if (!response) { unanswered = true; if (item.result || item.transcript || item.proposal || item.reviews || attempt) fail(); continue; }
    if (unanswered || !allowed(response, ['version', 'kind', 'answeredAt', 'recording']) || !positive(response.version) || !date(response.answeredAt) || Date.parse(response.answeredAt) < Date.parse(session.startedAt) || session.submittedAt && Date.parse(response.answeredAt) > Date.parse(session.submittedAt)) fail();
    if (!['recording', 'choice', 'skipped', 'unavailable'].includes(response.kind) || (response.kind === 'recording') !== Boolean(response.recording) || response.kind === 'choice' && (item.dimension !== 'look' || !item.choices.some(choice => choice.id === item.selectedId)) || response.kind !== 'choice' && item.selectedId !== undefined || response.kind === 'unavailable' && (item.dimension !== 'look' || item.choices.length) || response.kind === 'recording' && item.dimension === 'look') fail();
    if (response.recording) {
      const r = response.recording;
      if (!allowed(r, ['id', 'bytes', 'seconds', 'sha256', 'status']) || !/^[a-f0-9-]{36}$/.test(r.id) || !positive(r.bytes) || r.bytes > 640044 || !Number.isFinite(r.seconds) || r.seconds < .1 || r.seconds > 20 || !/^[a-f0-9]{64}$/.test(r.sha256) || !['ready', 'missing', 'purge-pending', 'deleted'].includes(r.status)) fail();
    }
    if (item.transcript && (!session.submittedAt || !allowed(item.transcript, ['text', 'responseVersion', 'at']) || item.transcript.responseVersion !== response.version || typeof item.transcript.text !== 'string' || item.transcript.text.length > 2000 || !date(item.transcript.at))) fail();
    if (item.proposal && (!item.transcript || !allowed(item.proposal, ['version', 'responseVersion', 'verdict', 'reason', 'at']) || !positive(item.proposal.version) || item.proposal.responseVersion !== response.version || !['matched', 'practice', 'unclear'].includes(item.proposal.verdict) || typeof item.proposal.reason !== 'string' || !item.proposal.reason || item.proposal.reason.length > 240 || !date(item.proposal.at))) fail();
    if (item.reviews !== undefined && (!Array.isArray(item.reviews) || item.dimension === 'look')) fail();
    for (const [index, review] of (item.reviews ?? []).entries()) if (!allowed(review, ['version', 'responseVersion', 'proposalVersion', 'result', 'at']) || review.version !== index + 1 || review.responseVersion !== response.version || !Number.isSafeInteger(review.proposalVersion) || review.proposalVersion < 0 || review.proposalVersion > (item.proposal?.version ?? 0) || !['correct', 'incorrect', 'hinted', 'unconfirmed', 'skipped'].includes(review.result) || !date(review.at) || !session.submittedAt || Date.parse(review.at) < Date.parse(session.submittedAt)) fail();
    const last = item.reviews?.at(-1);
    if (Boolean(attempt) !== Boolean(session.submittedAt && (item.dimension === 'look' || last)) || attempt && (attempt.createdAt !== response.answeredAt || attempt.confirmedAt !== (last?.at ?? session.submittedAt) || attempt.reviewVersion !== last?.version || attempt.result !== item.result || item.result !== (last?.result ?? (response.kind === 'choice' ? item.selectedId === item.word.id ? 'correct' : 'incorrect' : response.kind === 'unavailable' ? 'unavailable' : 'skipped')))) fail();
    if (!attempt && item.result !== undefined) fail();
  }
  if (session.submittedAt && (unanswered || !date(session.submittedAt)) || Boolean(session.job) !== Boolean(session.submittedAt)) fail();
  if (session.job && (!allowed(session.job, ['status', 'stage', 'runs', 'runId', 'error']) || !['queued', 'transcribing', 'grading', 'review', 'failed', 'interrupted'].includes(session.job.status) || !['transcribe', 'grade'].includes(session.job.stage) || !Number.isSafeInteger(session.job.runs) || session.job.runs < 0 || session.job.runId !== undefined && !/^[a-f0-9-]{36}$/.test(session.job.runId) || session.job.error !== undefined && (typeof session.job.error !== 'string' || session.job.error.length > 240))) fail();
}
