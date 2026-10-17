import { randomUUID } from 'node:crypto';
import type { AssessmentAttempt, AssessmentResult, AssessmentSession } from '../shared/contracts.ts';
import { assessmentChoices, assessmentCurrent, assessmentDay, assessmentDimensions, assessmentWords, dueAssessmentProgress, sameAssessmentWord, recommendedAssessmentItems } from '../shared/assessment.ts';
import { gameWord } from '../shared/game-plan.ts';
import { AppError, type StoredData } from './store.ts';
import { validateRecordedSession } from './challenge-state.ts';

const DAY = 86_400_000, intervals = [1, 3, 7, 14, 30];
const shuffle = <T>(items: T[], random: () => number) => { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; };
export function createAssessment(data: StoredData, body: Record<string, unknown>, now: Date, random = Math.random) {
  if (Object.keys(body).some(key => !['wordIds', 'mode', 'workflow'].includes(key)) || body.workflow !== undefined && body.workflow !== 'recorded' || !['full', 'due', 'recommended'].includes(String(body.mode ?? 'full')) || body.mode === 'recommended' && body.wordIds !== undefined) throw new AppError('测试请求无效。');
  const mode = (body.mode ?? 'full') as AssessmentSession['mode'];
  const available = assessmentWords(data), due = dueAssessmentProgress(data, now);
  const recommended = mode === 'recommended' ? recommendedAssessmentItems(data, now) : [];
  const defaultIds = mode === 'recommended' ? [...new Set(recommended.map(item => item.wordId))] : mode === 'due' ? [...new Set(due.map(item => item.wordId))] : [...available].reverse().map(word => word.id);
  const ids = body.wordIds ?? defaultIds.slice(0, 5);
  if (!Array.isArray(ids) || !ids.length || ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !available.some(word => word.id === id))) throw new AppError('请选择 1–5 个已学且已准备好的单词。', 'ASSESSMENT_WORDS');
  const words = ids.map(id => available.find(word => word.id === id)!);
  const session: AssessmentSession = { id: randomUUID(), wordIds: ids, mode, items: [], startedAt: now.toISOString() };
  if (body.workflow === 'recorded') session.workflow = 'recorded';
  for (const dimension of assessmentDimensions) for (const word of shuffle(words, random)) {
    if (mode === 'due' && !due.some(item => item.wordId === word.id && item.dimension === dimension)) continue;
    if (mode === 'recommended' && !recommended.some(item => item.wordId === word.id && item.dimension === dimension)) continue;
    const choices = dimension === 'look' ? shuffle(assessmentChoices(word, shuffle(available, random)), random).map(gameWord) : [];
    session.items.push({ id: `${word.id}:${dimension}`, dimension, word: gameWord(word), choices });
  }
  if (!session.items.length) throw new AppError('这些单词目前没有到期的测试项。', 'ASSESSMENT_NOT_DUE');
  (data.assessments ??= []).push(session);
  return session;
}
function recordProgress(data: StoredData, attempt: AssessmentAttempt) {
  if (attempt.result === 'unavailable') return;
  const rows = data.assessmentProgress ??= [];
  let row = rows.find(row => row.wordId === attempt.wordId && row.learningVersion === attempt.learningVersion && row.dimension === attempt.dimension);
  if (!row) { row = { wordId: attempt.wordId, learningVersion: attempt.learningVersion, dimension: attempt.dimension, stage: 0, dueAt: attempt.createdAt }; rows.push(row); }
  if (attempt.result === 'correct') {
    const today = assessmentDay(new Date(attempt.createdAt));
    if (row.lastSuccessDay === today) return;
    row.stage = Math.min(5, row.stage + 1); row.lastSuccessDay = today;
    row.dueAt = new Date(Date.parse(attempt.createdAt) + intervals[row.stage - 1] * DAY).toISOString();
  } else if (attempt.result === 'incorrect' || attempt.result === 'hinted') { row.stage = 0; row.dueAt = new Date(Date.parse(attempt.createdAt) + DAY).toISOString(); }
  else { row.dueAt = new Date(Math.min(Date.parse(row.dueAt) > Date.parse(attempt.createdAt) ? Date.parse(row.dueAt) : Infinity, Date.parse(attempt.createdAt) + DAY)).toISOString(); }
}
export function rebuildAssessmentProgress(data: StoredData) {
  data.assessmentProgress = [];
  for (const attempt of [...(data.assessmentAttempts ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) recordProgress(data, attempt);
}
export function assessmentAction(data: StoredData, id: string, body: Record<string, unknown>, now: Date, imageAvailable: (url: string) => boolean) {
  const session = data.assessments?.find(session => session.id === id);
  if (!session) throw new AppError('找不到这轮测试。', 'NOT_FOUND', 404);
  if (session.workflow === 'recorded') throw new AppError('录音挑战请使用作答接口。');
  if (Object.keys(body).some(key => !['itemId', 'action', 'selectedId', 'judgement'].includes(key)) || typeof body.itemId !== 'string' || !['choose', 'judge', 'skip', 'unavailable'].includes(String(body.action))) throw new AppError('测试动作无效。');
  const item = session.items.find(item => item.id === body.itemId);
  if (!item) throw new AppError('这道题不在本轮测试中。');
  if (item.result !== undefined) return session; // First answer is immutable, including network retries.
  if (session.completedAt || assessmentCurrent(session)?.id !== item.id) throw new AppError('请先完成当前测试题。', 'ASSESSMENT_ORDER', 409);
  const enabled = new Set(data.packs.filter(pack => pack.enabled).map(pack => pack.id));
  const valid = (snapshot: typeof item.word) => { const word = data.words.find(word => word.id === snapshot.id); return word && enabled.has(word.packId) && word.assetStatus === 'approved' && sameAssessmentWord(word, snapshot) && imageAvailable(word.imageUrl); };
  if (!valid(item.word) || item.choices.some(choice => !valid(choice))) throw new AppError('词义或素材已变化，请暂停这轮测试，按当前词表重新开始。', 'ASSESSMENT_STALE', 409);
  let result: AssessmentResult;
  if (body.action === 'skip') result = 'skipped';
  else if (body.action === 'unavailable') {
    if (item.dimension !== 'look' || item.choices.length >= 2) throw new AppError('当前题目可以正常作答。');
    result = 'unavailable';
  } else if (body.action === 'choose') {
    if (item.dimension !== 'look' || item.choices.length < 2 || !item.choices.some(choice => choice.id === body.selectedId)) throw new AppError('请选择当前题目中的图片。');
    item.selectedId = body.selectedId as string;
    result = item.selectedId === item.word.id ? 'correct' : 'incorrect';
  } else {
    if (item.dimension === 'look' || !['correct', 'incorrect', 'hinted', 'unconfirmed'].includes(String(body.judgement))) throw new AppError('请选择真实的家长判定。');
    result = body.judgement as AssessmentResult;
  }
  const attempts = data.assessmentAttempts ??= [];
  // A same-day retry after feedback is not fresh independent evidence.
  if (result === 'correct' && attempts.some(attempt => attempt.wordId === item.word.id && attempt.learningVersion === item.word.learningVersion && attempt.dimension === item.dimension && ['incorrect', 'hinted'].includes(attempt.result) && assessmentDay(new Date(attempt.createdAt)) === assessmentDay(now))) result = 'hinted';
  item.result = result;
  const attempt: AssessmentAttempt = { id: `${session.id}:${item.id}`, sessionId: session.id, itemId: item.id, wordId: item.word.id, learningVersion: item.word.learningVersion, dimension: item.dimension, result, source: item.dimension === 'look' ? 'server' : 'parent', createdAt: now.toISOString() };
  attempts.push(attempt); recordProgress(data, attempt);
  if (!assessmentCurrent(session)) session.completedAt = now.toISOString();
  return session;
}

/** Optional arrays make old backups compatible; validate new evidence before retaining it. */
export function validateAssessmentData(data: any, media: (url: unknown) => boolean) {
  const sessions = data.assessments === undefined ? [] : data.assessments, attempts = data.assessmentAttempts === undefined ? [] : data.assessmentAttempts, progress = data.assessmentProgress === undefined ? [] : data.assessmentProgress, practices = data.assessmentPractices === undefined ? [] : data.assessmentPractices;
  const fail = () => { throw new AppError('备份测试记录、复习进度或练习证据无效。'); };
  const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 240;
  const date = (value: unknown) => typeof value === 'string' && value.length < 40 && Number.isFinite(Date.parse(value));
  const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  const wordIds = new Set(data.words.map((word: any) => word.id)), learningIds = new Set(data.sessions.map((session: any) => session.id));
  const snapshot = (word: any) => word && wordIds.has(word.id) && typeof word.term === 'string' && /^[A-Za-z][A-Za-z '\-]*$/.test(word.term) && word.term.length <= 80 && typeof word.meaning === 'string' && word.meaning.length > 0 && word.meaning.length <= 160 && media(word.imageUrl) && count(word.learningVersion) && Object.keys(word).every(key => ['id', 'term', 'meaning', 'imageUrl', 'learningVersion'].includes(key));
  if (![sessions, attempts, progress, practices].every(Array.isArray) || sessions.length > 100000 || attempts.length > 1000000 || progress.length > 100000 || practices.length > 1000000) fail();
  for (const rows of [sessions, attempts, practices]) if (rows.some((row: any) => !row || !text(row.id)) || new Set(rows.map((row: any) => row.id)).size !== rows.length) fail();
  for (const session of sessions) {
    if (!['full', 'due', 'recommended'].includes(session.mode) || !date(session.startedAt) || session.completedAt !== undefined && !date(session.completedAt) || !Array.isArray(session.wordIds) || !session.wordIds.length || session.wordIds.length > 5 || new Set(session.wordIds).size !== session.wordIds.length || session.wordIds.some((id: any) => !wordIds.has(id)) || !Array.isArray(session.items) || !session.items.length || session.items.length > 20) fail();
    let unfinished = false, order = -1;
    const itemIds = new Set();
    for (const item of session.items) {
      if (!item || !assessmentDimensions.includes(item.dimension) || !snapshot(item.word) || !session.wordIds.includes(item.word.id) || item.id !== `${item.word.id}:${item.dimension}` || itemIds.has(item.id) || !Array.isArray(item.choices) || item.choices.some((word: any) => !snapshot(word))) fail();
      itemIds.add(item.id);
      const index = assessmentDimensions.indexOf(item.dimension);
      if (index < order) fail(); order = index;
      if (item.dimension !== 'look' && item.choices.length || item.dimension === 'look' && item.choices.length !== 0 && (item.choices.length < 2 || item.choices.length > 3 || !item.choices.some((choice: any) => JSON.stringify(choice) === JSON.stringify(item.word)) || ['id', 'term', 'meaning', 'imageUrl'].some(key => new Set(item.choices.map((choice: any) => key === 'term' ? choice[key].toLowerCase() : choice[key])).size !== item.choices.length))) fail();
      if (session.workflow === 'recorded') continue;
      if (item.result === undefined) unfinished = true;
      else if (unfinished || !['correct', 'incorrect', 'hinted', 'unconfirmed', 'skipped', 'unavailable'].includes(item.result)) fail();
      if (item.selectedId !== undefined && (item.dimension !== 'look' || !['correct', 'incorrect', 'hinted'].includes(item.result) || !item.choices.some((choice: any) => choice.id === item.selectedId))) fail();
      if (item.dimension === 'look' && item.result === 'unconfirmed') fail();
      if (item.dimension === 'look' && ['correct', 'incorrect', 'hinted'].includes(item.result) && (!item.selectedId || (item.result !== 'incorrect') !== (item.selectedId === item.word.id))) fail();
      if (item.result === 'unavailable' && (item.dimension !== 'look' || item.choices.length)) fail();
      if (item.result !== undefined && !attempts.some((attempt: any) => attempt.sessionId === session.id && attempt.itemId === item.id && attempt.result === item.result)) fail();
    }
    if (session.workflow === 'recorded') validateRecordedSession(session, attempts);
    else if (session.workflow !== undefined || Boolean(session.completedAt) === unfinished) fail();
    if (session.mode === 'full' && session.items.length !== session.wordIds.length * 4) fail();
  }
  const allowed = (value: any, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
  for (const attempt of attempts) {
    const session = sessions.find((session: any) => session.id === attempt.sessionId), item = session?.items.find((item: any) => item.id === attempt.itemId);
    if (!item || item.result === undefined || attempt.id !== `${session.id}:${item.id}` || attempt.wordId !== item.word.id || attempt.learningVersion !== item.word.learningVersion || attempt.dimension !== item.dimension || attempt.result !== item.result || !date(attempt.createdAt) || Date.parse(attempt.createdAt) < Date.parse(session.startedAt) || session.completedAt && Date.parse(attempt.createdAt) > Date.parse(session.completedAt) || attempt.source !== (item.dimension === 'look' ? 'server' : 'parent') || !allowed(attempt, ['id', 'sessionId', 'itemId', 'wordId', 'learningVersion', 'dimension', 'result', 'source', 'createdAt', ...(session.workflow === 'recorded' ? ['confirmedAt', 'reviewVersion'] : [])])) fail();
  }
  for (const row of progress) if (!row || !wordIds.has(row.wordId) || !assessmentDimensions.includes(row.dimension) || !count(row.learningVersion) || !count(row.stage) || row.stage > 5 || !date(row.dueAt) || row.lastSuccessDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(row.lastSuccessDay) || !allowed(row, ['wordId', 'learningVersion', 'dimension', 'stage', 'dueAt', 'lastSuccessDay'])) fail();
  if (new Set(progress.map((row: any) => `${row.wordId}:${row.learningVersion}:${row.dimension}`)).size !== progress.length) fail();
  const replay = { assessmentProgress: [] } as unknown as StoredData;
  replay.assessmentAttempts = attempts; rebuildAssessmentProgress(replay);
  const sorted = (rows: any[]) => [...rows].sort((a, b) => `${a.wordId}:${a.learningVersion}:${a.dimension}`.localeCompare(`${b.wordId}:${b.learningVersion}:${b.dimension}`)).map(row => [row.wordId, row.learningVersion, row.dimension, row.stage, row.dueAt, row.lastSuccessDay ?? null]);
  if (JSON.stringify(sorted(replay.assessmentProgress!)) !== JSON.stringify(sorted(progress))) fail();
  for (const practice of practices) {
    const session = data.sessions.find((session: any) => session.id === practice.sessionId), step = `practice-${practice.dimension}`;
    const task = session?.tasks?.find((task: any) => task.wordId === practice.wordId), activity = session?.activities?.find((activity: any) => activity.wordId === practice.wordId && activity.step === step);
    if (!wordIds.has(practice.wordId) || !learningIds.has(practice.sessionId) || !assessmentDimensions.includes(practice.dimension) || !count(practice.learningVersion) || !date(practice.createdAt) || practice.id !== `${practice.sessionId}:${practice.wordId}:${practice.dimension}` || !task?.steps.includes(step) || !session.completedSteps?.[practice.wordId]?.includes(step) || activity && activity.word.learningVersion !== practice.learningVersion || !allowed(practice, ['id', 'sessionId', 'wordId', 'learningVersion', 'dimension', 'createdAt'])) fail();
  }
  // Drop any unrecognized session/item fields rather than transporting credentials through a backup.
  const cleaned = sessions.map((session: AssessmentSession) => session.workflow === 'recorded' ? structuredClone(session) : ({ id: session.id, wordIds: session.wordIds, mode: session.mode, startedAt: session.startedAt, ...(session.completedAt ? { completedAt: session.completedAt } : {}), items: session.items.map(item => ({ id: item.id, dimension: item.dimension, word: item.word, choices: item.choices, ...(item.result ? { result: item.result } : {}), ...(item.selectedId ? { selectedId: item.selectedId } : {}) })) }));
  return { assessments: cleaned, assessmentAttempts: attempts, assessmentProgress: progress, assessmentPractices: practices };
}
