import {maxAssessmentOralItems} from '../shared/assessment.ts';
import {requireSentenceStudy} from './sentence-study.ts';
import {assessmentCue,validAssessmentCue,challengeReviewResult} from '../shared/assessment-cues.ts';
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
  if (Object.keys(body).some(key => !['itemId', 'action', 'selectedId', 'expectedVersion','cueVersion'].includes(key)) || !['record', 'choose', 'skip', 'unavailable','prepare-cue','picture-hint'].includes(String(body.action))||body.cueVersion!==undefined&&body.cueVersion!==1&&body.cueVersion!==2) throw new AppError('挑战作答无效。');
  const session = challenge(data, id), item = currentChallengeItem(data, session, body.itemId, imageAvailable);
  const old = item.response, version = old?.version ?? 0;
  if (body.expectedVersion !== version) {
    // Identical first choice or upload retry returns saved evidence without a second score.
    if (old && (body.action === 'choose' && item.selectedId === body.selectedId || body.action === 'record' && old.recording?.sha256 === recording?.sha256 || body.action === 'skip' && old.kind === 'skipped')) return session;
    throw new AppError('作答已更新，请刷新后重试。', 'ASSESSMENT_VERSION', 409);
  }
  const cueVersion=body.cueVersion as 1|2|undefined;
  if(cueVersion!==undefined&&item.dimension!=='zh-en')throw new AppError('当前题目不使用中文场景。');
  const cue=cueVersion===undefined?item.cue:cueVersion===item.cue?.version?item.cue:assessmentCue(item.word,data.words,cueVersion);
  if(cueVersion===2&&['record','prepare-cue'].includes(String(body.action)))requireSentenceStudy(data,item.word);
  if(body.action==='prepare-cue'||body.action==='picture-hint'){
    if(item.dimension!=='zh-en'||cueVersion===undefined)throw new AppError('当前题目不能打开此提示。');
    if(cue?.kind==='needs-context')throw new AppError('这道题还缺少明确语境，先放下，不算答错。','ASSESSMENT_CUE_UNAVAILABLE',409);
    // A saved answer keeps its actual old prompt until a new answer is saved atomically.
    if(!old)item.cue=cue;
    if(body.action==='picture-hint')item.pictureHint??={shownAt:now.toISOString(),afterResponseVersion:version};
    return session;
  }
  if (old && (item.dimension === 'look' || body.action !== 'record')) return session;
  if(cueVersion!==undefined)item.cue=cue;
  let kind: 'recording' | 'choice' | 'skipped' | 'unavailable';
  if (body.action === 'record') {
    if (item.dimension === 'look' || !recording) throw new AppError('录音题目无效。');
    if(item.cue?.kind==='needs-context')throw new AppError('这道题还缺少明确语境，先放下，不算答错。','ASSESSMENT_CUE_UNAVAILABLE',409);
    kind = 'recording';
  } else if (body.action === 'choose') {
    if (item.dimension !== 'look' || item.choices.length < 2 || !item.choices.some(choice => choice.id === body.selectedId)) throw new AppError('请选择有效图片。');
    kind = 'choice'; item.selectedId = body.selectedId as string;
  } else if (body.action === 'unavailable') {
    if (!(item.dimension==='look'&&!item.choices.length)&&!(item.dimension==='zh-en'&&item.cue?.kind==='needs-context')) throw new AppError('当前题目可以作答。');
    kind = 'unavailable';
  } else kind = 'skipped';
  item.response = { version: version + 1, kind, answeredAt: now.toISOString(), ...(kind === 'recording' ? { recording } : {}),...(cueVersion!==undefined?{cueVersion}:{}),...(item.pictureHint&&version+1>item.pictureHint.afterResponseVersion?{pictureHinted:true as const}:{}) };
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
  if (!session.submittedAt || Object.keys(body).some(key => key !== 'items') || !Array.isArray(body.items) || !body.items.length || body.items.length > maxAssessmentOralItems) throw new AppError('请选择要核验的题目。');
  const ids = new Set<string>();
  for (const row of body.items) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['itemId', 'responseVersion', 'proposalVersion', 'reviewVersion', 'result'].includes(key))) throw new AppError('核验数据无效。');
    const item = session.items.find(item => item.id === row.itemId);
    if (!item || item.dimension === 'look' || !item.response || ids.has(item.id) || !['correct', 'incorrect', 'hinted', 'unconfirmed', 'skipped','unavailable'].includes(row.result)) throw new AppError('核验题目无效。');
    ids.add(item.id);
    if (row.responseVersion !== item.response.version || row.proposalVersion !== (item.proposal?.version ?? 0) || row.reviewVersion !== (item.reviews?.length ?? 0)) throw new AppError('题目或建议已更新，请刷新后重新核验。', 'ASSESSMENT_VERSION', 409);
    const result=challengeReviewResult(item,row.result,data.words);
    if(row.result==='unavailable'&&item.response.kind!=='unavailable'&&(item.cue??assessmentCue(item.word,data.words)).kind!=='needs-context')throw new AppError('当前题目可以核验。');
    if (item.response.kind !== 'recording' && !['skipped', 'unconfirmed','unavailable'].includes(result) || item.response.recording?.status === 'missing' && !['unconfirmed','unavailable'].includes(result)) throw new AppError('缺少原始回答，请标记未确认并重新测试。');
  }
  for (const row of body.items) {
    const item = session.items.find(item => item.id === row.itemId)!;
    const reviews = item.reviews ??= [];
    const result=challengeReviewResult(item,row.result,data.words);
    reviews.push({ version: reviews.length + 1, responseVersion: item.response!.version, proposalVersion: item.proposal?.version ?? 0, result, at: now.toISOString() });
    writeAttempt(data, session, item, result, now.toISOString(), reviews.length);
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
    if (!allowed(item, ['id', 'dimension', 'word', 'choices', 'response', 'result', 'selectedId', 'transcript', 'proposal', 'reviews','cue','pictureHint'])) fail();
    if(item.cue!==undefined&&(item.dimension!=='zh-en'||!validAssessmentCue(item.cue,item.word)))fail();
    if(item.pictureHint!==undefined&&(!allowed(item.pictureHint,['shownAt','afterResponseVersion'])||item.dimension!=='zh-en'||!date(item.pictureHint.shownAt)||Date.parse(item.pictureHint.shownAt)<Date.parse(session.startedAt)||session.submittedAt&&Date.parse(item.pictureHint.shownAt)>Date.parse(session.submittedAt)||!Number.isSafeInteger(item.pictureHint.afterResponseVersion)||item.pictureHint.afterResponseVersion<0))fail();
    const response = item.response, attempt = attempts.find(row => row.sessionId === session.id && row.itemId === item.id);
    if (!response) { if(item.pictureHint?.afterResponseVersion)fail();unanswered = true; if (item.result || item.transcript || item.proposal || item.reviews || attempt) fail(); continue; }
    if (unanswered || !allowed(response, ['version', 'kind', 'answeredAt', 'recording','cueVersion','pictureHinted']) || !positive(response.version) || !date(response.answeredAt) || Date.parse(response.answeredAt) < Date.parse(session.startedAt) || session.submittedAt && Date.parse(response.answeredAt) > Date.parse(session.submittedAt)) fail();
    if(item.pictureHint&&(item.pictureHint.afterResponseVersion>response.version||response.version>item.pictureHint.afterResponseVersion&&Date.parse(item.pictureHint.shownAt)>Date.parse(response.answeredAt)||response.version===item.pictureHint.afterResponseVersion&&Date.parse(item.pictureHint.shownAt)<Date.parse(response.answeredAt)))fail();
    if(response.cueVersion!==undefined&&(![1,2].includes(response.cueVersion)||item.dimension!=='zh-en'||response.cueVersion!==item.cue?.version)||response.pictureHinted!==undefined&&response.pictureHinted!==true||Boolean(response.pictureHinted)!==Boolean(item.pictureHint&&response.version>item.pictureHint.afterResponseVersion))fail();
    if (!['recording', 'choice', 'skipped', 'unavailable'].includes(response.kind) || (response.kind === 'recording') !== Boolean(response.recording) || response.kind === 'choice' && (item.dimension !== 'look' || !item.choices.some(choice => choice.id === item.selectedId)) || response.kind !== 'choice' && item.selectedId !== undefined || response.kind === 'unavailable' && !(item.dimension==='look'&&!item.choices.length)&&!(item.dimension==='zh-en'&&item.cue?.kind==='needs-context') || response.kind === 'recording' && item.dimension === 'look') fail();
    if (response.recording) {
      const r = response.recording;
      if (!allowed(r, ['id', 'bytes', 'seconds', 'sha256', 'status']) || !/^[a-f0-9-]{36}$/.test(r.id) || !positive(r.bytes) || r.bytes > 640044 || !Number.isFinite(r.seconds) || r.seconds < .1 || r.seconds > 20 || !/^[a-f0-9]{64}$/.test(r.sha256) || !['ready', 'missing', 'purge-pending', 'deleted'].includes(r.status)) fail();
    }
    if (item.transcript && (!session.submittedAt || !allowed(item.transcript, ['text', 'responseVersion', 'at']) || item.transcript.responseVersion !== response.version || typeof item.transcript.text !== 'string' || item.transcript.text.length > 2000 || !date(item.transcript.at))) fail();
    if (item.proposal && (!item.transcript || !allowed(item.proposal, ['version', 'responseVersion', 'verdict', 'reason', 'at']) || !positive(item.proposal.version) || item.proposal.responseVersion !== response.version || !['matched', 'practice', 'unclear'].includes(item.proposal.verdict) || typeof item.proposal.reason !== 'string' || !item.proposal.reason || item.proposal.reason.length > 240 || !date(item.proposal.at))) fail();
    if (item.reviews !== undefined && (!Array.isArray(item.reviews) || item.dimension === 'look')) fail();
    for (const [index, review] of (item.reviews ?? []).entries()) if (!allowed(review, ['version', 'responseVersion', 'proposalVersion', 'result', 'at']) || review.version !== index + 1 || review.responseVersion !== response.version || !Number.isSafeInteger(review.proposalVersion) || review.proposalVersion < 0 || review.proposalVersion > (item.proposal?.version ?? 0) || !['correct', 'incorrect', 'hinted', 'unconfirmed', 'skipped','unavailable'].includes(review.result) || !date(review.at) || !session.submittedAt || Date.parse(review.at) < Date.parse(session.submittedAt)) fail();
    const last = item.reviews?.at(-1);
    if(last&&(response.cueVersion!==undefined||response.pictureHinted)&&challengeReviewResult(item,last.result,session.items.map(row=>row.word))!==last.result)fail();
    if (Boolean(attempt) !== Boolean(session.submittedAt && (item.dimension === 'look' || last)) || attempt && (attempt.createdAt !== response.answeredAt || attempt.confirmedAt !== (last?.at ?? session.submittedAt) || attempt.reviewVersion !== last?.version || attempt.result !== item.result || item.result !== (last?.result ?? (response.kind === 'choice' ? item.selectedId === item.word.id ? 'correct' : 'incorrect' : response.kind === 'unavailable' ? 'unavailable' : 'skipped')))) fail();
    if (!attempt && item.result !== undefined) fail();
  }
  if (session.submittedAt && (unanswered || !date(session.submittedAt)) || Boolean(session.job) !== Boolean(session.submittedAt)) fail();
  if (session.job && (!allowed(session.job, ['status', 'stage', 'runs', 'runId', 'error']) || !['queued', 'transcribing', 'grading', 'review', 'failed', 'interrupted'].includes(session.job.status) || !['transcribe', 'grade'].includes(session.job.stage) || !Number.isSafeInteger(session.job.runs) || session.job.runs < 0 || session.job.runId !== undefined && !/^[a-f0-9-]{36}$/.test(session.job.runId) || session.job.error !== undefined && (typeof session.job.error !== 'string' || session.job.error.length > 240))) fail();
}
