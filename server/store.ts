import { adaptiveMainlineActivities } from '../shared/adaptive-mainline.ts';
import { mainlineActivities } from '../shared/mainline-experience.ts';
import { fixedPackGame, randomPackGame } from '../shared/pack-games.ts';
import { validGameMaterial, extendedKinds } from '../shared/game-materials.ts';
import { DatabaseSync } from 'node:sqlite';
import { lessonSegment, syncLessonProgress, validLessonPlan } from '../shared/lesson-plan.ts';
import type { LessonPlan } from '../shared/contracts.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { dailyLearningPlan, learningDay, selectedLearningTasks, supplementalLearningPlan, SECONDS_PER_LEARNING_TASK } from '../shared/learning.ts';
import { learningEncounters } from '../shared/learning-history.ts';
import { childGrowth, recordBadgeAwards } from '../shared/growth.ts';
import { badgeById, badgeCatalog } from '../shared/badge-catalog.ts';
import { partsOfSpeech, packContentRevision } from '../shared/vocabulary.ts';
import { activityDone, buildActivities, currentActivity } from '../shared/game-plan.ts';
import { memoryLoopKinds, memoryLoopTasks, arrangeMemoryLoop, freezeMemoryLoop, pendingLearningCheckpoint, recallFirstActivity, transitionMemoryRecall, validMemoryLoopPolicy } from '../shared/learning-policy.ts';
import { validGameSession } from './game-validation.ts';
import { assessmentAction, createAssessment, validateAssessmentData } from './assessments.ts';
import { assessmentDimensions, practiceDimension, practiceStep } from '../shared/assessment.ts';
import type { AssessmentData, BadgeAward, LearningStartRequest } from '../shared/contracts.ts';
import { seededRandom, recallGame, gameDefinition, gameRegistry, type GamePlanOptions } from '../shared/game-registry.ts';
import { activityStateKeys, gameActions, transitionGame, gameAccepted } from '../shared/game-rules.ts';
import { pairedGame } from '../shared/game-boards.ts';
import { validPracticeRecordings } from '../shared/oral-practice.ts';
import { isGoalCheckpoint } from '../shared/learning-goals.ts';
import type { PracticeRecording } from '../shared/contracts.ts';
import type { AppState, ChildProfile, Settings, Word, WordPack, SkillProgress, LearningAttempt, LearningSession, IllustrationJob, IntegrationStatus, ImportRow, Skill, LearningStep, ImageReviewSelection } from '../shared/contracts.ts';

export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, code = 'INVALID_REQUEST', status = 400) { super(message); this.code = code; this.status = status; }
}
interface Charge { id: string; month: string; reserved: number; actual?: number; kind: 'tts' | 'stt'; units: number }
export interface StoredData extends AssessmentData {
  lessonPlan?: LessonPlan;
  version: 1; profile: ChildProfile; settings: Settings; packs: WordPack[]; words: Word[];
  progress: SkillProgress[]; attempts: LearningAttempt[]; sessions: LearningSession[]; activeLearningSessionId?: string | null; lastCompletedLearningSessionId?: string;
  stickers: string[]; jobs: IllustrationJob[]; charges: Charge[]; practiceRecordings?: PracticeRecording[]; badgeAwards?: BadgeAward[];
}
export function requireLearningPlanVersion(session: LearningSession, version: unknown) {
  if (version !== undefined && version !== (session.learningPolicy?.version ?? 1) || session.experienceUpgrade && version !== session.learningPolicy?.version) throw new AppError('这轮玩法已更新，正在重新连接当前进度。', 'SESSION_PLAN_CHANGED', 409);
}
const DAY = 86_400_000;
const INTERVALS = [1, 3, 7, 14, 30];
const SKILLS: Skill[] = ['recognize', 'listen', 'read', 'recall', 'spell'];
const STEPS: LearningStep[] = ['learn', 'recognize', 'listen', 'sound', 'read', 'recall', 'spell', ...assessmentDimensions.map(practiceStep)];
const stepSkill = (step: LearningStep): Skill | undefined => step === 'sound' ? 'listen' : step === 'learn' || practiceDimension(step) ? undefined : step as Skill;
const completedStepsFor = (session: LearningSession, wordId: string): LearningStep[] => session.completedSteps && Object.hasOwn(session.completedSteps, wordId) ? session.completedSteps[wordId] : [];
const stepEvidence = (attempts: LearningAttempt[], sessionId: string, wordId: string, step: LearningStep) => step === 'learn' || attempts.some(a => a.sessionId === sessionId && a.wordId === wordId && a.step === step && a.skill === stepSkill(step) && (a.correct || a.practiceOnly));
const defaults: Settings = { dailyNewWords: 3, dailyReviewWords: 6, sessionMinutes: 10, spellingEnabled: false, monthlyBudgetCny: 30, voiceEnabled: true };
export const localDay = learningDay;
export const monthKey = (date = new Date()) => localDay(date).slice(0, 7);
const clone = <T>(value: T): T => structuredClone(value);
function hasPracticeAudio(data:StoredData,dataDir:string,sessionId:string,activityId:string,version:number){
  return (data.practiceRecordings??[]).some(r=>{
    if(r.sessionId!==sessionId||r.activityId!==activityId||r.status!=='ready'||r.word.learningVersion!==version)return false;
    const root=path.join(dataDir,'practice-recordings'),file=path.join(root,r.id+'.wav');
    if(!existsSync(file)||!realpathSync(file).startsWith(realpathSync(root)+path.sep))return false;
    const bytes=readFileSync(file);return bytes.length===r.bytes&&createHash('sha256').update(bytes).digest('hex')===r.sha256;
  });
}

function seed(now: Date): StoredData {
  const rows = [['apple','苹果'],['banana','香蕉'],['cat','猫'],['dog','狗'],['ball','球'],['car','汽车'],['sun','太阳'],['moon','月亮'],['fish','鱼'],['bird','鸟'],['jump','跳跃'],['run','跑步']];
  return { version: 1, profile: { nickname: '小探险家', interests: [], interestVersion: 1, onboardingCompleted: false }, settings: { ...defaults },
    packs: [{ id: 'starter', title: '示例词表（非正式）', enabled: false, isSample: true, createdAt: now.toISOString() }],
    words: rows.map(([term, meaning]) => ({ id: `starter-${term}`, packId: 'starter', term, meaning, imageUrl: `/assets/words/${term}.svg`, assetStatus: 'approved', imageSource: 'builtin' })),
    progress: [], attempts: [], sessions: [], stickers: [], jobs: [], charges: [] };
}

export function validateRows(rows: unknown, allowIncomplete = false): { rows: ImportRow[]; errors: string[] } {
  const result: ImportRow[] = [], errors: string[] = [], seen = new Map<string, string>();
  if (!Array.isArray(rows)) return { rows: [], errors: ['词表必须是列表。'] };
  if (rows.length > 500) return { rows: [], errors: ['每次最多导入 500 个单词。'] };
  rows.forEach((row, i) => {
    const term = typeof row?.term === 'string' ? row.term.trim().replace(/\s+/g, ' ') : '';
    const meaning = typeof row?.meaning === 'string' ? row.meaning.trim() : '';
    if (!term || !allowIncomplete && !meaning) { errors.push(`第 ${i + 1} 行需要英文和中文意思。`); return; }
    if (term.length > 80 || !/^[A-Za-z][A-Za-z '\-]*$/.test(term)) { errors.push(`第 ${i + 1} 行英文格式不正确，请只填单词或短语。`); return; }
    if (meaning.length > 160 || /[\u0000-\u001f]/.test(meaning)) { errors.push(`第 ${i + 1} 行中文意思太长或含控制字符。`); return; }
    const key = term.toLowerCase();
    if (seen.has(key)) { errors.push(`第 ${i + 1} 行「${term}」${seen.get(key) === meaning ? '重复，请删除重复行' : '有多个意思，请为本次学习保留一个明确义项'}。`); return; }
    if (row.partOfSpeech !== undefined && !partsOfSpeech.includes(row.partOfSpeech)) { errors.push(`第 ${i + 1} 行词性无效。`); return; }
    if (row.pictureHint !== undefined && (typeof row.pictureHint !== 'string' || !row.pictureHint.trim() || row.pictureHint.length > 300 || /[\u0000-\u001f]/.test(row.pictureHint))) { errors.push(`第 ${i + 1} 行配图说明无效。`); return; }
    if (row.usageNote !== undefined && (typeof row.usageNote !== 'string' || row.usageNote.length > 160 || /[\u0000-\u001f]/.test(row.usageNote))) { errors.push(`第 ${i + 1} 行义项提示无效。`); return; }
    seen.set(key, meaning); result.push({ term, meaning,
      ...(row.partOfSpeech !== undefined ? { partOfSpeech: row.partOfSpeech } : {}),
      ...(row.pictureHint !== undefined ? { pictureHint: row.pictureHint.trim() } : {}),
      ...(row.usageNote !== undefined ? { usageNote: row.usageNote.trim() } : {}),
    });
  });
  if (!rows.length) errors.push('词表为空，请输入英文和中文意思。');
  return { rows: result, errors };
}

export function parseImport(text: unknown): { rows: ImportRow[]; errors: string[] } {
  if (typeof text !== 'string' || !text.trim()) return { rows: [], errors: ['请粘贴英文单词，每行一个，或选择 CSV 文件。'] };
  if (text.length > 200_000) return { rows: [], errors: ['词表文件太大。'] };
  text = text.replace(/^\uFEFF/, '');
  const records: string[] = []; let record = '', quoted = false;
  const source = text as string;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') { record += ch; if (quoted && source[i + 1] === '"') { record += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (ch === '\n' || ch === '\r')) { if (ch === '\r' && source[i + 1] === '\n') i++; if (record.trim()) records.push(record); record = ''; }
    else record += ch;
  }
  if (quoted) return { rows: [], errors: ['CSV 引号未闭合，请检查文件。'] };
  if (record.trim()) records.push(record);
  const table: string[][] = [];
  for (const [index,line] of records.entries()) {
    const delimiters = new Set<string>(); quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { if (quoted && line[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && ['\t',',','，'].includes(line[i])) delimiters.add(line[i]);
    }
    const delimiter = delimiters.has('\t') ? '\t' : delimiters.has(',') ? ',' : delimiters.has('，') ? '，' : undefined;
    if (!delimiter) {
      if (/^(英文|单词)\s+(中文|意思|释义)$/.test(line.trim()) || /^(term|word|english)\s+(meaning|chinese)$/i.test(line.trim())) { table.push(['term','meaning']); continue; }
      // Chinese begins the meaning, so spaces inside an English phrase are never mistaken for columns.
      const pair = line.trim().match(/^([A-Za-z][A-Za-z '\-]*?)\s+([\p{Script=Han}].*)$/u);
      if (!pair) { table.push([line.trim()]); continue; }
      table.push([pair[1],pair[2]]); continue;
    }
    const row: string[] = []; let cell = '', afterQuote = false; quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
        else if (!quoted && (cell.trim() || afterQuote)) return { rows: [], errors: [`第 ${index + 1} 行 CSV 引号位置错误。`] };
        else { if (quoted) afterQuote = true; quoted = !quoted; }
      } else if (!quoted && (ch === delimiter || delimiter === ',' && ch === '，')) { row.push(cell); cell = ''; afterQuote = false; }
      else if (afterQuote && ch.trim()) return { rows: [], errors: [`第 ${index + 1} 行 CSV 引号后需要分隔符。`] };
      else cell += ch;
    }
    row.push(cell); table.push(row);
  }
  if (table.length && (/^(英文|单词)$/i.test(table[0][0].trim()) || table[0].length === 2 && /^(term|word|english)$/i.test(table[0][0].trim()) && /^(meaning|chinese|中文|意思|释义)$/i.test(table[0][1].trim()))) table.shift();
  const rows: ImportRow[] = [];
  for (const [index, row] of table.entries()) {
    if (row.length > 1 && row.every(cell => /^[A-Za-z][A-Za-z '\-]*$/.test(cell.trim()))) {
      rows.push(...row.map(term => ({ term, meaning: '' }))); // English comma/Excel lists; phrases retain internal spaces.
    } else if (row.length <= 2) rows.push({ term: row[0], meaning: row[1] ?? '' });
    else return { rows: [], errors: [`第 ${index + 1} 行不是一列英文或中英两列，请检查 CSV。`] };
  }
  return validateRows(rows, true);
}

function suspendSampleSessions(data: StoredData, now: Date, samplePackIds: Set<string>, includeMixed = false) {
  const packByWord = new Map(data.words.map(word => [word.id, word.packId]));
  for (const session of data.sessions) {
    if (session.completedAt || session.suspendedAt || !session.wordIds.length) continue;
    const sample = (id: string) => samplePackIds.has(packByWord.get(id) ?? '');
    if (includeMixed ? session.wordIds.some(sample) : session.wordIds.every(sample)) session.suspendedAt = now.toISOString();
  }
}

function migrateSamplePack(data: StoredData, now: Date) {
  const starter = data.packs.find(pack => pack.id === 'starter');
  if (starter && starter.isSample === undefined) {
    starter.isSample = true; starter.enabled = false; starter.title = '示例词表（非正式）';
    suspendSampleSessions(data, now, new Set(['starter']), true);
  }
}

export class Store {
  db: DatabaseSync;
  dataDir: string;
  clock: () => Date;
  constructor(dataDir: string, clock = () => new Date()) {
    this.dataDir = path.resolve(dataDir); this.clock = clock; mkdirSync(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dataDir, 'playroom.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY CHECK (id=1), body TEXT NOT NULL)');
    if (!this.db.prepare('SELECT id FROM documents WHERE id=1').get()) this.db.prepare('INSERT INTO documents(id,body) VALUES(1,?)').run(JSON.stringify(seed(clock())));
    this.mutate(data => {
      migrateSamplePack(data, this.clock());
      for (const job of data.jobs) if (job.status === 'queued' || job.status === 'running') { job.status = 'error'; job.error = '服务重启，生成任务已中断，可以重新生成。'; const word = data.words.find(w => w.id === job.wordId); if (word?.assetStatus === 'generating') word.assetStatus = word.imageSource === 'builtin' ? 'approved' : 'error'; }
    });
  }
  close() { this.db.close(); }
  read(): StoredData { const data = JSON.parse((this.db.prepare('SELECT body FROM documents WHERE id=1').get() as { body: string }).body) as StoredData; data.assessments ??= []; data.assessmentAttempts ??= []; data.assessmentProgress ??= []; data.assessmentPractices ??= []; return data; }
  mutate<T>(fn: (data: StoredData) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const data = this.read(); const result = fn(data); this.reconcileSessions(data); syncLessonProgress(data.lessonPlan, data.sessions); recordBadgeAwards(data, this.clock()); this.db.prepare('UPDATE documents SET body=? WHERE id=1').run(JSON.stringify(data)); this.db.exec('COMMIT'); return clone(result); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private reconcileSessions(data: StoredData) {
    const packs = new Set(data.packs.filter(p => p.enabled).map(p => p.id));
    const approved = new Set(data.words.filter(w => packs.has(w.packId) && w.assetStatus === 'approved').map(w => w.id));
    for (const session of data.sessions) if (!session.completedAt && !session.suspendedAt) {
      session.wordIds = session.wordIds.filter(id => approved.has(id));
      session.completedWordIds = session.completedWordIds.filter(id => session.wordIds.includes(id));
      if (session.tasks) {
        if (session.activities) {
          const unchanged = (snapshot: { id: string; term: string; meaning: string; imageUrl: string; learningVersion: number }) => data.words.some(word => approved.has(word.id) && word.id === snapshot.id && word.term === snapshot.term && word.meaning === snapshot.meaning && word.imageUrl === snapshot.imageUrl && (word.learningVersion ?? 0) === snapshot.learningVersion);
          session.wordIds = session.wordIds.filter(id => session.activities!.filter(activity => activity.wordId === id).every(activity => unchanged(activity.word)));
          session.completedWordIds = session.completedWordIds.filter(id => session.wordIds.includes(id));
          session.activities = session.activities.filter(activity => session.wordIds.includes(activity.wordId));
          for (const activity of session.activities) if (activity.choices.some(choice => !unchanged(choice)) || activity.cueWord && !unchanged(activity.cueWord)) {
            activity.kind = 'standard'; activity.choices = []; delete activity.groupId; delete activity.cueWord; delete activity.targets; delete activity.direction; delete activity.routeStart; delete activity.routeCells; delete activity.letterGrid; delete activity.material; delete activity.spellingBoard;
            session.activityStates = { ...session.activityStates, [activity.id]: { hinted: true } };
          }
          const ids = new Set(session.activities.map(activity => activity.id));
          session.activityStates = Object.fromEntries(Object.entries(session.activityStates ?? {}).filter(([id]) => ids.has(id)));
        }
        session.tasks = session.tasks.filter(task => session.wordIds.includes(task.wordId));
        session.completedSteps = Object.fromEntries(Object.entries(session.completedSteps ?? {}).filter(([id]) => session.wordIds.includes(id)));
      }
      if (!session.wordIds.length) session.completedAt = this.clock().toISOString();
    }
    if (data.activeLearningSessionId && !data.sessions.some(session => session.id === data.activeLearningSessionId && !session.completedAt && !session.suspendedAt)) data.activeLearningSessionId = null;
  }
  state(integrations: IntegrationStatus): AppState {
    const data = this.read(), month = monthKey(this.clock()), charges = data.charges.filter(c => c.month === month);
    return { lessonPlan: data.lessonPlan, profile: data.profile, settings: data.settings, packs: data.packs.filter(pack => !pack.deletedAt), words: data.words.filter(word => !word.deletedAt), progress: data.progress, attempts: data.attempts,
      assessments: data.assessments, assessmentAttempts: data.assessmentAttempts, assessmentProgress: data.assessmentProgress, assessmentPractices: data.assessmentPractices,
      activeSession: this.activeLearningSession(data),
      resumableSessions: data.sessions.filter(s => !s.completedAt && !s.suspendedAt).reverse().sort((a, b) => Number(b.id === data.activeLearningSessionId) - Number(a.id === data.activeLearningSessionId) || (b.lastResumedAt ?? b.startedAt).localeCompare(a.lastResumedAt ?? a.startedAt)),
      lastCompletedSession: data.sessions.find(s => s.id === data.lastCompletedLearningSessionId && s.completedAt && s.rewardGranted) ?? data.sessions.filter(s => s.completedAt && s.rewardGranted && !s.suspendedAt).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))[0] ?? null,
      learningHistory: learningEncounters(data), learningNow: this.clock().toISOString(),
      stickers: data.stickers, growth: childGrowth(data, this.clock()), integrations, usage: { month, budgetCny: data.settings.monthlyBudgetCny, estimatedCny: Number(charges.reduce((s,c) => s + (c.actual ?? c.reserved), 0).toFixed(6)),
        ttsCharacters: charges.filter(c => c.kind === 'tts').reduce((s,c) => s+c.units, 0), sttSeconds: charges.filter(c => c.kind === 'stt').reduce((s,c) => s+c.units, 0), imageJobs: data.jobs.filter(j => monthKey(new Date(j.createdAt)) === month).length } };
  }
  private activeLearningSession(data: StoredData) {
    if (data.activeLearningSessionId === null) return null;
    return data.activeLearningSessionId === undefined
      ? [...data.sessions].reverse().find(s => !s.completedAt && !s.suspendedAt) ?? null
      : data.sessions.find(s => s.id === data.activeLearningSessionId && !s.completedAt && !s.suspendedAt) ?? null;
  }
  updateProfile(body: Record<string, unknown>) {
    return this.mutate(data => {
      if (body.nickname !== undefined) { if (typeof body.nickname !== 'string' || !body.nickname.trim() || body.nickname.length > 30) throw new AppError('名字需要 1–30 个字。'); data.profile.nickname = body.nickname.trim(); }
      if (body.interests !== undefined) {
        if (!Array.isArray(body.interests) || body.interests.length > 8 || body.interests.some(s => typeof s !== 'string' || !s.trim() || s.length > 40)) throw new AppError('兴趣最多 8 项，每项不超过 40 个字。');
        const interests = [...new Set((body.interests as string[]).map(s => s.trim()))];
        if (JSON.stringify(interests) !== JSON.stringify(data.profile.interests)) data.profile.interestVersion++;
        data.profile.interests = interests;
      }
      if (body.onboardingCompleted !== undefined) { if (typeof body.onboardingCompleted !== 'boolean') throw new AppError('兴趣确认状态无效。'); data.profile.onboardingCompleted = body.onboardingCompleted; }
    });
  }
  updateSettings(body: Record<string, unknown>) {
    this.mutate(data => {
      const ranges = { dailyNewWords: [1, 20], dailyReviewWords: [0, 50], sessionMinutes: [3, 30], monthlyBudgetCny: [0, 10000] };
      for (const [key, value] of Object.entries(body)) {
        if (key in ranges) { const [min,max] = ranges[key as keyof typeof ranges]; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (key !== 'monthlyBudgetCny' && !Number.isInteger(value))) throw new AppError(`设置 ${key} 超出允许范围。`); }
        else if (key === 'learningStrategy') { if (typeof value!=='string'||!['classic','memory-loop'].includes(value)) throw new AppError('学习策略无效。'); }
        else if (['spellingEnabled','voiceEnabled','feedbackSoundsEnabled','familyGamesEnabled','contextGamesEnabled'].includes(key)) { if (typeof value !== 'boolean') throw new AppError(`设置 ${key} 需要布尔值。`); }
        else throw new AppError(`不支持的设置：${key}`);
        (data.settings as unknown as Record<string, unknown>)[key] = value;
      }
    });
  }
  createPack(title: unknown, rows: unknown, imageTheme?: string) {
    const checked = validateRows(rows); if (checked.errors.length) throw new AppError(checked.errors.join(' '));
    if (typeof title !== 'string' || !title.trim() || title.length > 80) throw new AppError('词表名称需要 1–80 个字。');
    return this.mutate(data => { const pack: WordPack = { id: randomUUID(), title: title.trim(), enabled: false, isSample: false, confirmedAt: this.clock().toISOString(), createdAt: this.clock().toISOString() }; data.packs.push(pack);
      data.words.push(...checked.rows.map(row => {
        const cached = data.words.find(w => w.term.toLowerCase() === row.term.toLowerCase() && w.meaning === row.meaning && w.assetStatus === 'approved' && w.imageUrl !== '/assets/placeholder.svg' && (imageTheme ? w.imageTheme === imageTheme && w.partOfSpeech === row.partOfSpeech && w.pictureHint === row.pictureHint : w.imageSource === 'builtin'));
        return { ...row, id: randomUUID(), packId: pack.id, imageUrl: cached?.imageUrl ?? '/assets/placeholder.svg', imageSource: cached?.imageSource ?? 'builtin' as const, ...(cached?.imageTheme ? { imageTheme: cached.imageTheme } : {}), assetStatus: cached ? 'approved' as const : 'draft' as const };
      })); return pack; });
  }
  enablePack(id: string, enabled: unknown) {
    this.mutate(data => {
      const pack = data.packs.find(p => p.id === id && !p.deletedAt); if (!pack) throw new AppError('找不到词表。', 'NOT_FOUND', 404);
      if (typeof enabled !== 'boolean') throw new AppError('enabled 需要布尔值。');
      pack.enabled = enabled;
      if (enabled && !pack.isSample) {
        const samples = new Set(data.packs.filter(item => item.isSample).map(item => item.id));
        suspendSampleSessions(data, this.clock(), samples);
        for (const sample of data.packs) if (samples.has(sample.id)) sample.enabled = false;
      }
    });
  }
  updatePack(id: string, body: Record<string, unknown>) {
    return this.mutate(data => {
      const pack = data.packs.find(pack => pack.id === id && !pack.deletedAt);
      if (!pack) throw new AppError('找不到词表。', 'NOT_FOUND', 404);
      if (body.revision !== packContentRevision(pack, data.words)) throw new AppError('词表内容已被修改，请关闭编辑并重新打开。', 'PACK_CONTENT_CHANGED', 409);
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 80) throw new AppError('词表名称需要 1–80 个字。');
      const checked = validateRows(body.rows);
      if (checked.errors.length) throw new AppError(checked.errors.join(' '));
      const rows = body.rows as (ImportRow & { id?: unknown })[], existing = data.words.filter(word => word.packId === id && !word.deletedAt);
      const ids = rows.flatMap(row => row.id === undefined ? [] : [row.id]);
      if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !existing.some(word => word.id === id))) throw new AppError('词条已变化，请重新打开词表。', 'PACK_CONTENT_CHANGED', 409);
      pack.title = body.title.trim();
      for (const word of existing) if (!ids.includes(word.id)) this.removeWord(data, word);
      checked.rows.forEach((row, index) => {
        const word = existing.find(word => word.id === rows[index].id);
        if (word) this.changeWord(data, word, { ...row, partOfSpeech: row.partOfSpeech ?? null });
        else data.words.push({ ...row, id: randomUUID(), packId: id, imageTheme: existing[0]?.imageTheme, imageUrl: '/assets/placeholder.svg', imageSource: 'builtin', assetStatus: 'draft' });
      });
      pack.confirmedAt = this.clock().toISOString();
    });
  }
  private removeWord(data: StoredData, word: Word) {
    // Retain ids, evidence and private recordings for historical references and backup validation.
    word.deletedAt = this.clock().toISOString(); word.assetStatus = 'draft';
    for (const session of data.sessions) if (!session.completedAt && !session.suspendedAt && session.wordIds.includes(word.id)) session.suspendedAt = this.clock().toISOString();
  }
  deleteWord(id: string) {
    this.mutate(data => {
      const word = data.words.find(word => word.id === id && !word.deletedAt);
      if (!word) throw new AppError('找不到单词。', 'NOT_FOUND', 404);
      this.removeWord(data, word);
    });
  }
  deletePack(id: string) {
    this.mutate(data => {
      const pack = data.packs.find(pack => pack.id === id && !pack.deletedAt);
      if (!pack) throw new AppError('找不到词表。', 'NOT_FOUND', 404);
      pack.deletedAt = this.clock().toISOString(); pack.enabled = false;
      for (const word of data.words) if (word.packId === id && !word.deletedAt) this.removeWord(data, word);
    });
  }
  private changeWord(data: StoredData, word: Word, body: Record<string, unknown>) {
    const proposed = { ...word, ...body };
    if (proposed.partOfSpeech === null) delete proposed.partOfSpeech;
    const checked = validateRows([proposed]); if (checked.errors.length) throw new AppError(checked.errors.join(' '));
    const row = checked.rows[0];
    const changed = ['term', 'meaning', 'partOfSpeech', 'pictureHint'].some(key => row[key as keyof ImportRow] !== word[key as keyof Word]);
    if (!changed) return;
    if (body.assetStatus === 'approved') throw new AppError('请先保存词义，再重新准备并确认图片。');
    if ((row.term !== word.term || row.meaning !== word.meaning || row.partOfSpeech !== word.partOfSpeech) && body.pictureHint === undefined) { delete row.pictureHint; delete row.usageNote; }
    delete word.partOfSpeech; delete word.pictureHint; delete word.usageNote; delete word.error; delete word.gameMaterials;
    Object.assign(word, row); word.assetStatus = 'draft'; word.imageUrl = '/assets/placeholder.svg'; word.imageSource = 'builtin';
    word.learningResetAt = this.clock().toISOString(); word.learningVersion = (word.learningVersion ?? 0) + 1;
    data.progress = data.progress.filter(progress => progress.wordId !== word.id);
  }
  updateWord(id: string, body: Record<string, unknown>, availableImage: (url: string) => boolean) {
    this.mutate(data => {
      const word = data.words.find(w => w.id === id && !w.deletedAt); if (!word) throw new AppError('找不到单词。', 'NOT_FOUND', 404);
      this.changeWord(data, word, body);
      if (data.words.some(other => other.id !== id && !other.deletedAt && other.packId === word.packId && other.term.toLowerCase() === word.term.toLowerCase())) throw new AppError('词表中已有相同的英文，请合并重复词。');
      if (body.assetStatus !== undefined) {
        if (!['approved','draft','review'].includes(String(body.assetStatus))) throw new AppError('图片状态无效。');
        if (body.assetStatus === 'approved' && (word.imageUrl === '/assets/placeholder.svg' || !availableImage(word.imageUrl))) throw new AppError('请先生成或提供可用的图片，再批准。');
        word.assetStatus = body.assetStatus as Word['assetStatus']; delete word.error;
      }
    });
  }
  approveGameMaterial(wordId:string,kind:string,input:unknown,availableImage:(url:string)=>boolean) {
    return this.mutate(data=>{
      const word=data.words.find(w=>w.id===wordId&&!w.deletedAt),material=structuredClone(input) as import('../shared/contracts.ts').GameMaterial;
      if(!word||!extendedKinds.has(kind)||!validGameMaterial(kind,material)||material.wordVersion!==(word.learningVersion??0)||!material.wordIds.includes(wordId))throw new AppError('素材格式或所见词义版本已变化，请重新预览。','GAME_MATERIAL_INVALID');
      if(material.wordIds.some(id=>!data.words.some(w=>w.id===id&&!w.deletedAt&&w.assetStatus==='approved'&&(w.learningVersion??0)===material.wordVersions[id]))||material.tiles.some(t=>t.imageUrl&&!availableImage(t.imageUrl)))throw new AppError('关联词义或图片已变化，请重新备课。','GAME_MATERIAL_STALE',409);
      if(kind==='chunks'&&material.chunks!.join('').toLowerCase()!==word.term.toLowerCase()||kind==='word-morph'&&!data.words.some(w=>material.wordIds.includes(w.id)&&w.term.toLowerCase()===material.source?.toLowerCase()))throw new AppError('字块或起始词与目标不一致。');
      material.approvedAt=this.clock().toISOString();if(material.origin==='proposal')delete material.origin;word.gameMaterials={...word.gameMaterials,[kind]:material};return word;
    });
  }
  reviewPackImages(packId: string, selections: unknown, availableImage: (url: string) => boolean): Word[] {
    if (!Array.isArray(selections) || !selections.length || selections.length > 1000) throw new AppError('请选中 1–1000 张实际查看过的图片。', 'PACK_IMAGE_REVIEW_INVALID');
    return this.mutate(data => {
      if (!data.packs.some(pack => pack.id === packId)) throw new AppError('找不到这本词表。', 'PACK_IMAGE_NOT_FOUND', 404);
      const seen = new Set<string>();
      const words = (selections as ImageReviewSelection[]).map(selection => {
        if (!selection || typeof selection !== 'object' || Array.isArray(selection) || typeof selection.wordId !== 'string' || typeof selection.imageUrl !== 'string' || typeof selection.term !== 'string' || typeof selection.meaning !== 'string' || (selection.learningVersion !== undefined && (!Number.isInteger(selection.learningVersion) || selection.learningVersion < 0)) || Object.keys(selection).some(key => !['wordId','imageUrl','term','meaning','learningVersion'].includes(key)) || seen.has(selection.wordId)) throw new AppError('图片审核选择不完整或重复，请重新查看后再确认。', 'PACK_IMAGE_REVIEW_INVALID');
        seen.add(selection.wordId);
        const word = data.words.find(word => word.id === selection.wordId && word.packId === packId);
        if (!word || !['review','approved'].includes(word.assetStatus) || word.imageUrl !== selection.imageUrl || word.term !== selection.term || word.meaning !== selection.meaning || (word.learningVersion ?? 0) !== (selection.learningVersion ?? 0)) throw new AppError('图片或词义已经变化，请重新查看后再确认。', 'PACK_IMAGE_REVIEW_STALE', 409);
        if (word.imageUrl === '/assets/placeholder.svg' || !availableImage(word.imageUrl)) throw new AppError('选中的图片尚不可用，请先完成生成。', 'PACK_IMAGE_REVIEW_UNAVAILABLE');
        return word;
      });
      // Every selection and its current asset have passed before any approval is written.
      for (const word of words) { word.assetStatus = 'approved'; delete word.error; }
      return words;
    });
  }
  createAssessment(body: Record<string, unknown>) { return this.mutate(data => createAssessment(data, body, this.clock())); }
  assessmentAction(id: string, body: Record<string, unknown>, imageAvailable: (url: string) => boolean = () => true) { return this.mutate(data => assessmentAction(data, id, body, this.clock(), imageAvailable)); }
  assessmentPractice(body: Record<string, unknown>) {
    return this.mutate(data => {
      if (Object.keys(body).some(key => !['sessionId', 'wordId', 'dimension', 'learningVersion','oralStatus','planVersion'].includes(key)) || body.oralStatus!==undefined&&!['recorded','skipped'].includes(String(body.oralStatus)) || !assessmentDimensions.includes(body.dimension as any)) throw new AppError('弱项练习请求无效。');
      const session = data.sessions.find(session => session.id === body.sessionId), dimension = body.dimension as import('../shared/contracts.ts').AssessmentDimension;
      const word = data.words.find(word => word.id === body.wordId), step = practiceStep(dimension);
      const id = `${body.sessionId}:${body.wordId}:${dimension}`;
      if(session)requireLearningPlanVersion(session,body.planVersion);
      if (data.assessmentPractices?.some(practice => practice.id === id)) return session;
      if (!session || session.completedAt || session.suspendedAt || !session.tasks || !word || word.assetStatus !== 'approved' || !data.packs.some(pack => pack.id === word.packId && pack.enabled) || (word.learningVersion ?? 0) !== body.learningVersion) throw new AppError('这道弱项练习已经变化。', 'ASSESSMENT_PRACTICE_STALE', 409);
      requireLearningPlanVersion(session, body.planVersion);
      requireCheckpointAcknowledged(session);
      const task = session.tasks.find(task => task.wordId === word.id), done = completedStepsFor(session, word.id), activity = currentActivity(session);
      if (!task || task.steps[done.length] !== step || (session.activities ? activity?.id !== `${word.id}:${step}` : session.wordIds.find(id => !session.completedWordIds.includes(id)) !== word.id)) throw new AppError('请先完成当前小任务。', 'SESSION_STEP_ORDER', 409);
      const oral=dimension==='read'||dimension==='zh-en',recorded=oral&&hasPracticeAudio(data,this.dataDir,session.id,`${word.id}:${step}`,word.learningVersion??0);
      if(body.oralStatus==='recorded'&&!recorded)throw new AppError('请先保存录音，或者明确选择跳过。','READ_RECORDING_REQUIRED',409);
      (data.assessmentPractices ??= []).push({ id, sessionId: session.id, wordId: word.id, learningVersion: word.learningVersion ?? 0, dimension, createdAt: this.clock().toISOString(),...(oral?{oralStatus:body.oralStatus==='skipped'||!recorded?'skipped' as const:'recorded' as const}:{}) });
      session.completedSteps = { ...session.completedSteps, [word.id]: [...done, step] };
      if (done.length + 1 === task.steps.length && !session.completedWordIds.includes(word.id)) session.completedWordIds.push(word.id);
      return session;
    });
  }
  saveLessonPlan(body: Record<string, unknown>, availableImage: (url: string) => boolean) {
    return this.mutate(data => {
      if (Object.keys(body).some(key => !['id','revision','newPlan','title','wordIds','focusWordIds','segmentMinutes'].includes(key)) || body.newPlan !== undefined && body.newPlan !== true) throw new AppError('课堂安排格式无效。');
      const previous = data.lessonPlan;
      if (body.id !== undefined ? !previous || previous.id !== body.id || previous.revision !== body.revision : previous && body.newPlan !== true) throw new AppError('课堂安排已变化，请刷新后再调整。', 'LESSON_STALE', 409);
      const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 500 && new Set(value).size === value.length && value.every(id => typeof id === 'string');
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 80 || /[\u0000-\u001f]/.test(body.title) || !list(body.wordIds) || !body.wordIds.length || !list(body.focusWordIds) || body.focusWordIds.some(id => !(body.wordIds as string[]).includes(id)) || !Number.isInteger(body.segmentMinutes) || (body.segmentMinutes as number) < 5 || (body.segmentMinutes as number) > 15) throw new AppError('请选择本课单词和本次重点，每段设为5–15分钟。');
      const enabled = new Set(data.packs.filter(pack => pack.enabled && !pack.isSample && !pack.deletedAt).map(pack => pack.id));
      const selected = body.wordIds.map(id => data.words.find(word => word.id === id && !word.deletedAt));
      if (selected.some(word => !word || !enabled.has(word.packId) || word.assetStatus !== 'approved' || !availableImage(word.imageUrl))) throw new AppError('有单词尚未交付或图片已变化，请先完成备课。', 'LESSON_WORDS', 409);
      const wordVersions = Object.fromEntries(selected.map(word => [word!.id, word!.learningVersion ?? 0]));
      const editing = body.id !== undefined;
      data.lessonPlan = { id: editing ? previous!.id : randomUUID(), title: body.title.trim(), revision: editing ? previous!.revision + 1 : 1, wordIds: body.wordIds, focusWordIds: body.focusWordIds, wordVersions,
        completedWordIds: editing ? previous!.completedWordIds.filter(id => (body.wordIds as string[]).includes(id) && previous!.wordVersions[id] === wordVersions[id]) : [],
        segmentMinutes: body.segmentMinutes as number, createdAt: editing ? previous!.createdAt : this.clock().toISOString(), updatedAt: this.clock().toISOString() };
      return data.lessonPlan;
    });
  }
  manageSession(body: Record<string, unknown>, gameOptions: GamePlanOptions = {}) {
    return this.mutate(data => {
      if (Object.keys(body).some(key => !['sessionId','action','planVersion'].includes(key)) || typeof body.sessionId !== 'string' || (typeof body.action !== 'string' || !['reselect','restart'].includes(body.action))) throw new AppError('请选择要结束的这一轮。');
      const saved = data.sessions.find(session => session.id === body.sessionId);
      if (!saved || saved.completedAt) throw new AppError('这一轮已结束，请回大厅重新选择。', 'SESSION_STALE', 409);
      requireLearningPlanVersion(saved,body.planVersion);
      if (saved.suspendedAt) {
        if (saved.endReason !== body.action) throw new AppError('这一轮已经结束或词义已变化，请刷新。', 'SESSION_STALE', 409);
        return saved.replacementSessionId ? data.sessions.find(session => session.id === saved.replacementSessionId) : undefined;
      }
      if (body.action === 'restart') {
        const ready = new Set(dailyLearningPlan(data, this.clock()).available.map(word => word.id));
        if (!saved.wordIds.length || saved.wordIds.some(id => !ready.has(id))) throw new AppError('这些单词的素材已变化，请重新选词。', 'SESSION_STALE', 409);
      }
      saved.suspendedAt = this.clock().toISOString(); saved.endReason = body.action as 'reselect' | 'restart';
      if (data.activeLearningSessionId === saved.id) data.activeLearningSessionId = null;
      if (body.action === 'reselect') return;
      const replacement = this.buildSession(data, 'random', gameOptions, { mode: saved.packGame ? 'practice' : 'relearn', wordIds: saved.packGame?.scopeWordIds ?? saved.wordIds, ...(saved.practicePackId ? {packId:saved.practicePackId} : {}), ...(saved.packGame ? {game:saved.packGame.selection} : {}), strategy: saved.learningPolicy ? 'memory-loop' : 'classic', requestId: `restart-${saved.id}` });
      if (saved.lessonPlanId) for (const key of ['lessonPlanId','lessonPlanRevision','lessonTitle','lessonScopeCount','lessonWordVersions'] as const) Object.assign(replacement, { [key]: clone(saved[key]) });
      saved.replacementSessionId = replacement.id;
      return replacement;
    });
  }
  startSession(withGames: boolean | 'random' = false, gameOptions: GamePlanOptions = {}, input: LearningStartRequest = {}) {
    return this.mutate(data => this.buildSession(data, withGames, gameOptions, input));
  }
  private buildSession(data: StoredData, withGames: boolean | 'random', gameOptions: GamePlanOptions, input: LearningStartRequest) {
      const body = { ...input } as Record<string, unknown>, requestedMode = body.mode ?? 'recommended', mode = requestedMode === 'lesson' ? 'practice' : requestedMode;
      if (body.strategy !== undefined && (typeof body.strategy!=='string'||!['classic','memory-loop'].includes(body.strategy))) throw new AppError('学习策略无效。');
      const memoryLoop = body.game === undefined && (body.strategy ?? data.settings.learningStrategy) === 'memory-loop';
      if ((typeof requestedMode !== 'string' || !['recommended','relearn','practice','resume','lesson'].includes(requestedMode)) || Object.keys(body).some(key => !['mode','wordIds','packId','game','sessionId','requestId','strategy','lessonPlanId','lessonRevision'].includes(key)) || body.requestId !== undefined && (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(body.requestId))) throw new AppError('学习请求无效。');
      if (body.packId !== undefined && (typeof body.packId !== 'string' || !['practice','relearn'].includes(mode as string) || requestedMode === 'lesson')) throw new AppError('词表练习范围无效。');
      if (body.game !== undefined && (typeof body.game !== 'string' || body.game !== 'random' && !gameDefinition(body.game) || typeof body.packId !== 'string' || !['practice','relearn'].includes(mode as string))) throw new AppError('请选择当前词表可玩的玩法。');
      if (mode === 'resume') {
        if (typeof body.sessionId !== 'string' || body.wordIds !== undefined) throw new AppError('请选择要继续的学习。');
        const saved = data.sessions.find(s => s.id === body.sessionId && !s.completedAt && !s.suspendedAt);
        if (!saved) throw new AppError('这轮学习已结束或素材已变化。', 'SESSION_STALE', 409);
        saved.lastResumedAt = this.clock().toISOString(); data.activeLearningSessionId = saved.id; return saved;
      }
      if (body.sessionId !== undefined || mode === 'recommended' && body.wordIds !== undefined) throw new AppError('学习范围无效。');
      const existing = body.requestId && data.sessions.find(s => s.requestId === body.requestId);
      if (existing) {
        if (existing.suspendedAt || existing.completedAt && !existing.rewardGranted) throw new AppError('这轮学习的词书或素材已变化，请重新选词。', 'SESSION_STALE', 409);
        if (body.game === undefined && body.strategy !== undefined && (existing.learningPolicy?.kind ?? 'classic') !== body.strategy || existing.packGame?.selection !== body.game || (existing.mode ?? 'recommended') !== mode || existing.practicePackId !== body.packId || mode !== 'recommended' && requestedMode !== 'lesson' && JSON.stringify(existing.packGame?.scopeWordIds ?? existing.wordIds) !== JSON.stringify(body.wordIds) || requestedMode === 'lesson' && (existing.lessonPlanId !== body.lessonPlanId || existing.lessonPlanRevision !== body.lessonRevision)) throw new AppError('这次启动请求已用于另一轮学习。', 'SESSION_REQUEST_CONFLICT', 409);
        if (!existing.completedAt && !existing.suspendedAt) data.activeLearningSessionId = existing.id;
        return existing;
      }
      if (requestedMode === 'lesson') {
        const lesson = data.lessonPlan;
        if (!lesson || lesson.id !== body.lessonPlanId || lesson.revision !== body.lessonRevision || body.wordIds !== undefined) throw new AppError('课堂安排已变化，请刷新后继续。', 'LESSON_STALE', 409);
        const pending = [...data.sessions].reverse().find(session => session.lessonPlanId === lesson.id && !session.completedAt && !session.suspendedAt);
        if (pending) { data.activeLearningSessionId = pending.id; return pending; }
        const segment = lessonSegment(lesson, data);
        if (segment.unavailable.length) throw new AppError('课堂中的词义或素材已变化，请家长重新保存安排。', 'LESSON_STALE', 409);
        if (!segment.tasks.length) throw new AppError('本次重点已经练完，可以请家长安排下一组。', 'LESSON_COMPLETE', 409);
        body.wordIds = segment.tasks.map(task => task.wordId);
      } else if (body.lessonPlanId !== undefined || body.lessonRevision !== undefined) throw new AppError('课堂安排参数无效。');
      if (mode === 'recommended') {
        const active = this.activeLearningSession(data);
        const current = active && (active.mode ?? 'recommended') === 'recommended' ? active : [...data.sessions].reverse().find(s => !s.completedAt && !s.suspendedAt && (s.mode ?? 'recommended') === 'recommended');
        if (current && (current.mode ?? 'recommended') === 'recommended') { data.activeLearningSessionId = current.id; return current; }
      }
      const planData = memoryLoop ? {...data, settings:{...data.settings, learningStrategy:'memory-loop' as const}} : {...data, settings:{...data.settings, learningStrategy:'classic' as const}};
      let plan = dailyLearningPlan(planData, this.clock());
      let practiceOnly = mode !== 'recommended';
      if (mode === 'recommended' && !plan.tasks.length) { plan = supplementalLearningPlan(planData, this.clock()); practiceOnly = true; }
      if (mode === 'relearn' || mode === 'practice') {
        const ids = body.wordIds;
        const availableIds = new Set(plan.available.map(word => word.id));
        if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !availableIds.has(id))) throw new AppError('请选择至少一个已经准备好的单词，不能重复选择。', 'SESSION_WORDS');
        if (typeof body.packId === 'string') {
          const pack = data.packs.find(pack => pack.id === body.packId && pack.enabled && !pack.deletedAt && !pack.isSample);
          if (!pack || ids.some(id => !data.words.some(word => word.id === id && word.packId === pack.id))) throw new AppError('词表或素材已变化，请重新选择。', 'SESSION_WORDS', 409);
          const pending = [...data.sessions].reverse().find(saved => saved.practicePackId === pack.id && saved.packGame?.selection === body.game && !saved.completedAt && !saved.suspendedAt);
          if (pending) { pending.lastResumedAt = this.clock().toISOString(); data.activeLearningSessionId = pending.id; return pending; }
        }
        const tasks = selectedLearningTasks(data, ids, mode), taskCount = tasks.reduce((sum, task) => sum + task.steps.length, 0);
        plan = { ...plan, tasks, taskCount, taskLimit: Math.max(plan.taskLimit, taskCount), estimatedMinutes: Math.ceil(taskCount * SECONDS_PER_LEARNING_TASK / 60) };
      }
      if (memoryLoop) plan.tasks = memoryLoopTasks(plan.tasks);
      const session: LearningSession = { id: randomUUID(), mode: mode as LearningSession['mode'], practiceOnly, ...(typeof body.requestId === 'string' ? {requestId: body.requestId} : {}), exposures: [], wordIds: [...new Set(plan.tasks.map(task => task.wordId))], completedWordIds: [], startedAt: this.clock().toISOString(), rewardGranted: false, goalVersion:1, tasks: clone(plan.tasks), completedSteps: {}, taskLimit: plan.taskLimit, estimatedMinutes: plan.estimatedMinutes };
      if (typeof body.packId === 'string') {
        session.practicePackId = body.packId;
        session.practicePackTitle = data.packs.find(pack => pack.id === body.packId)!.title;
      }
      if (requestedMode === 'lesson') {
        const lesson = data.lessonPlan!;
        session.lessonPlanId = lesson.id; session.lessonPlanRevision = lesson.revision; session.lessonTitle = lesson.title; session.lessonScopeCount = lesson.wordIds.length;
        session.lessonWordVersions = Object.fromEntries(session.wordIds.map(id => [id, lesson.wordVersions[id]]));
      }
      if (body.game !== undefined) {
        session.gameSeed = randomUUID();
        const scope = plan.available.filter(word => (body.wordIds as string[]).includes(word.id));
        const options:GamePlanOptions = {familyEnabled:data.settings.familyGamesEnabled===true,contextEnabled:data.settings.contextGamesEnabled===true,...gameOptions,
          allowedKinds:gameOptions.allowedKinds?.filter(kind=>data.settings.spellingEnabled||gameDefinition(kind)?.step!=='spell') ?? (data.settings.spellingEnabled?undefined:gameRegistry.filter(game=>game.step!=='spell').map(game=>game.kind))};
        const random=seededRandom(session.gameSeed);
        session.activities = body.game === 'random' ? randomPackGame(scope,options,random) : fixedPackGame(scope,body.game as import('../shared/contracts.ts').GameKind,options,random);
        if(!session.activities.length)throw new AppError('这个玩法暂时没有合适的单词或素材，请换一个玩法。','PACK_GAME_UNAVAILABLE',409);
        session.activityStates = {};
        session.wordIds = session.activities.map(activity=>activity.wordId);
        session.tasks = session.activities.map(activity=>({wordId:activity.wordId,mode:'review',steps:[activity.step]}));
        session.taskLimit = session.activities.length; session.estimatedMinutes = Math.ceil(session.activities.length*SECONDS_PER_LEARNING_TASK/60);
        session.packGame = {selection:body.game as import('../shared/contracts.ts').GameKind|'random',scopeWordIds:[...(body.wordIds as string[])]};
      } else if (withGames || session.goalVersion === 1) {
        session.gameSeed = randomUUID();
        const recentKinds = data.sessions.slice(-6).flatMap(previous => previous.activities?.filter(activity => activityDone(previous, activity)).map(activity => activity.kind) ?? []);
        session.activities = buildActivities(plan.tasks, session.practicePackId ? plan.available.filter(word => word.packId === session.practicePackId) : plan.available, seededRandom(session.gameSeed), { recentKinds, familyEnabled: data.settings.familyGamesEnabled === true, contextEnabled:data.settings.contextGamesEnabled===true, ...gameOptions, ...(memoryLoop ? {allowedKinds:[...memoryLoopKinds],wordBatchSize:2 as const} : {}), ...(session.practicePackId ? {allowedKinds:[]} : {}), practiceRounds:session.practiceOnly===true, randomize: withGames === 'random' }); session.activityStates = {};
        if(!withGames||session.practicePackId)for(const a of session.activities){a.kind='standard';if(!isGoalCheckpoint(a.step)&&!session.practicePackId)a.choices=[];delete a.groupId;delete a.cueWord;delete a.targets;delete a.direction;delete a.routeStart;delete a.routeCells;delete a.letterGrid;delete a.material;delete a.spellingBoard;}
        if(!withGames)session.activities.sort((a,b)=>session.tasks!.findIndex(t=>t.wordId===a.wordId)-session.tasks!.findIndex(t=>t.wordId===b.wordId)||session.tasks!.find(t=>t.wordId===a.wordId)!.steps.indexOf(a.step)-session.tasks!.find(t=>t.wordId===b.wordId)!.steps.indexOf(b.step));
      }
      if (memoryLoop && session.activities) {
        session.activities = arrangeMemoryLoop(session.tasks!, session.activities);
        const version = withGames && !session.practicePackId ? 3 : 1;
        if (version === 3) session.activities = adaptiveMainlineActivities(session.activities, plan.available, session.gameSeed!, 0, freezeMemoryLoop(session.activities).checkpoints, {familyEnabled:data.settings.familyGamesEnabled===true,contextEnabled:data.settings.contextGamesEnabled===true,...gameOptions});
        session.learningPolicy = freezeMemoryLoop(session.activities, version); session.acknowledgedCheckpoints = [];
      }
      if (!session.wordIds.length) return session;
      data.sessions.push(session); data.activeLearningSessionId = session.id; return session;
  }
  attempt(body: Record<string, unknown>) {
    return this.mutate(data => {
      if (typeof body.id === 'string') { const existing = data.attempts.find(a => a.id === body.id); if (existing) { const owner=data.sessions.find(row=>row.id===existing.sessionId);if(owner)requireLearningPlanVersion(owner,body.planVersion);return existing; } }
      const session = data.sessions.find(s => s.id === body.sessionId);
      if (!session || session.completedAt || session.suspendedAt || !session.wordIds.includes(String(body.wordId))) throw new AppError('这道题不在当前学习中。', 'SESSION_INVALID');
      requireLearningPlanVersion(session, body.planVersion);
      requireCheckpointAcknowledged(session);
      if (!SKILLS.includes(body.skill as Skill) || typeof body.correct !== 'boolean' || typeof body.hinted !== 'boolean' || !['click','speech','keyboard'].includes(String(body.source))) throw new AppError('学习记录格式无效。');
      if (body.practiceOnly !== undefined && typeof body.practiceOnly !== 'boolean') throw new AppError('体验模式格式无效。');
      if (body.step !== undefined && (!STEPS.includes(body.step as LearningStep) || stepSkill(body.step as LearningStep) !== body.skill)) throw new AppError('答题步骤与学习技能不匹配。');
      const step = (body.step ?? body.skill) as LearningStep;
      if (session.learningPolicy && (currentActivity(session)?.wordId !== body.wordId || currentActivity(session)?.step !== step)) throw new AppError('请先完成当前小任务。','SESSION_STEP_ORDER',409);
      if(isGoalCheckpoint(step))throw new AppError('请通过认读任务提交结果，朗读完成需要已保存的录音。','GAME_EVIDENCE');
      if (session.activities?.some(activity => activity.wordId === body.wordId && activity.step === step && activity.kind !== 'standard')) throw new AppError('请通过游戏提交本题结果。', 'GAME_EVIDENCE');
      const attempt: LearningAttempt = { id: typeof body.id === 'string' && body.id.length <= 100 ? body.id : randomUUID(), wordId: String(body.wordId), sessionId: session.id, skill: body.skill as Skill, step, learningVersion: data.words.find(word => word.id === body.wordId)?.learningVersion ?? 0, correct: body.correct, hinted: body.hinted, source: body.source as LearningAttempt['source'], practiceOnly: body.practiceOnly === true || (body.skill === 'spell' && !data.settings.spellingEnabled), createdAt: this.clock().toISOString() };
      const planned=currentActivity(session);
      if(session.learningPolicy&&planned?.kind==='standard'&&['listen','sound'].includes(step)&&planned.choices.length<2){attempt.practiceOnly=true;attempt.correct=false;attempt.hinted=true;}
      return this.saveAttempt(data, attempt);
    });
  }
  private saveAttempt(data: StoredData, attempt: LearningAttempt) {
      const existing = data.attempts.find(item => item.id === attempt.id); if (existing) return existing;
      if (data.sessions.find(session => session.id === attempt.sessionId)?.practiceOnly) {attempt.practiceOnly = true;attempt.sessionPracticeOnly=true;}
      const advancedToday = data.attempts.some(a => a.wordId === attempt.wordId && (a.learningVersion ?? 0) === attempt.learningVersion && a.skill === attempt.skill && a.correct && !a.hinted && !a.practiceOnly && localDay(new Date(a.createdAt)) === localDay(this.clock()));
      data.attempts.push(attempt);
      // A supported practice attempt is evidence of participation, never a scheduling fact.
      if (attempt.practiceOnly) return attempt;
      let progress = data.progress.find(p => p.wordId === attempt.wordId && p.skill === attempt.skill);
      if (!progress) { progress = { wordId: attempt.wordId, skill: attempt.skill, stage: 0, dueAt: this.clock().toISOString(), successes: 0, attempts: 0 }; data.progress.push(progress); }
      progress.attempts++;
      if (attempt.correct && !attempt.hinted) { progress.successes++; if (!advancedToday) { progress.stage = Math.min(INTERVALS.length, progress.stage + 1); progress.dueAt = new Date(this.clock().getTime() + INTERVALS[progress.stage - 1] * DAY).toISOString(); } }
      else { progress.stage = Math.max(0, progress.stage - 1); progress.dueAt = new Date(this.clock().getTime() + 10 * 60_000).toISOString(); }
      return attempt;
  }
  activityEvent(body: Record<string, unknown>) {
    return this.mutate(data => {
      const session = data.sessions.find(item => item.id === body.sessionId);
      if (!session || session.suspendedAt || !session.activities || typeof body.activityId !== 'string' || !gameActions.includes(body.action as any) || body.selectedId !== undefined && typeof body.selectedId !== 'string' || Object.keys(body).some(key => !['sessionId','activityId','action','selectedId','planVersion'].includes(key))) throw new AppError('游戏请求无效。', 'GAME_INVALID');
      requireLearningPlanVersion(session, body.planVersion);
      const activity = session.activities.find(item => item.id === body.activityId);
      if (!activity || activity.kind === 'standard'&&!isGoalCheckpoint(activity.step)) throw new AppError('这不是当前游戏。', 'GAME_INVALID');
      // Network retries of a finished game cannot create another attempt or reward.
      if (activityDone(session, activity)) return session;
      requireCheckpointAcknowledged(session);
      if (session.completedAt || currentActivity(session)?.id !== activity.id) throw new AppError('请先完成当前小任务。', 'GAME_ORDER', 409);
      const word = data.words.find(word => word.id === activity.wordId);
      const enabled = new Set(data.packs.filter(pack => pack.enabled).map(pack => pack.id));
      const valid = (snapshot: typeof activity.word) => data.words.some(item => item.id === snapshot.id && enabled.has(item.packId) && item.assetStatus === 'approved' && item.term === snapshot.term && item.meaning === snapshot.meaning && item.imageUrl === snapshot.imageUrl && (item.learningVersion ?? 0) === snapshot.learningVersion);
      if (!word || !valid(activity.word) || activity.choices.some(choice => !valid(choice)) || activity.targets?.some(choice=>!valid(choice)) || activity.cueWord && !valid(activity.cueWord)) throw new AppError('词义或素材已变化，请回首页继续更新后的学习。', 'GAME_STALE', 409);
      const members=pairedGame(activity.kind) ? session.activities.filter(item=>item.kind===activity.kind&&item.groupId===activity.groupId) : [activity];
      const scene=activity.kind==='associate'&&activity.step==='recall' ? session.activityStates?.[`${activity.wordId}:sound`] : undefined;
      const previous=session.activityStates?.[activity.id] ?? (scene?.composed ? { selectedIds:scene.selectedIds,composed:true } : {});
      if(activity.step==='read'&&['finish','reveal','listen-option'].includes(String(body.action))){
        const hasAudio=hasPracticeAudio(data,this.dataDir,session.id,activity.id,activity.word.learningVersion);
        if(!hasAudio)throw new AppError('请先录音并保存；麦克风暂不可用时可以选择跳过。','READ_RECORDING_REQUIRED',409);
      }
      const memoryRecall = recallFirstActivity(session, activity);
      if (memoryRecall && body.action === 'finish' && !hasPracticeAudio(data,this.dataDir,session.id,activity.id,activity.word.learningVersion)) throw new AppError('请先录音并保存，或者选择跳过。','READ_RECORDING_REQUIRED',409);
      let transition: ReturnType<typeof transitionGame>;
      try { transition = memoryRecall ? transitionMemoryRecall(previous, body.action as any) : transitionGame(activity, previous, body.action as any, body.selectedId as string | undefined); }
      catch (error) { throw new AppError(error instanceof Error ? error.message : '游戏请求无效。', 'GAME_EVIDENCE'); }
      for(const member of members) {
        if (transition.attempt) {
          const input = transition.attempt, answerKey = ['practice','yes','no','extended-ok','extended-try'].includes(input.key)||input.key.startsWith('goal-')||/^(pair|letters)-[\d-]+$/.test(input.key) ? input.key : String(activity.choices.findIndex(choice => choice.id === input.key));
          this.saveAttempt(data, { id: `${session.id}:game:${session.activities.indexOf(member)}:${answerKey}`, activityId: member.id, wordId: member.wordId, sessionId: session.id, skill: stepSkill(member.step)!, step: member.step, learningVersion: member.word.learningVersion, correct: input.correct, hinted: input.hinted, practiceOnly: input.practiceOnly, source: (member.step==='read'||memoryRecall)&&input.key==='goal-recorded'?'speech':'click', ...((member.step==='read'||memoryRecall)?{oralStatus:input.key==='goal-recorded'?'recorded' as const:'skipped' as const}:{}), createdAt: this.clock().toISOString() });
        }
        if (transition.complete) {
          session.completedSteps = { ...session.completedSteps, [member.wordId]: [...completedStepsFor(session, member.wordId), member.step] };
          const task = session.tasks!.find(task => task.wordId === member.wordId)!;
          if (completedStepsFor(session, member.wordId).length === task.steps.length && !session.completedWordIds.includes(member.wordId)) session.completedWordIds.push(member.wordId);
        }
        session.activityStates = { ...session.activityStates, [member.id]: clone(transition.state) };
      }
      return session;
    });
  }
  upgradeExperience(body: Record<string, unknown>,gameOptions:GamePlanOptions={}) {
    return this.mutate(data => {
      const targetVersion=body.targetVersion??2;
      if (Object.keys(body).some(key => !['sessionId','checkpointId','expectedVersion','targetVersion'].includes(key)) || ![1,2].includes(body.expectedVersion as number) || ![2,3].includes(targetVersion as number) || Number(targetVersion)<=Number(body.expectedVersion) || typeof body.checkpointId !== 'string') throw new AppError('学习体验升级请求无效。');
      const session = data.sessions.find(row => row.id === body.sessionId && !row.suspendedAt);
      if (!session || session.completedAt || this.activeLearningSession(data)?.id !== session.id) throw new AppError('请先回到当前学习轮次。','SESSION_PLAN_CHANGED',409);
      if (session.experienceUpgrade?.checkpointId === body.checkpointId&&session.learningPolicy?.version===targetVersion&&session.experienceUpgrade.fromVersion===body.expectedVersion) return session;
      if (session.learningPolicy?.version !== body.expectedVersion || !session.activities || pendingLearningCheckpoint(session) !== body.checkpointId) throw new AppError('先完成当前小段，再接新的玩法。','SESSION_PLAN_CHANGED',409);
      const boundary = session.activities.findIndex(a => a.id === body.checkpointId);
      if (session.activities.slice(boundary + 1).some(a => activityDone(session,a) || Object.keys(session.activityStates?.[a.id] ?? {}).length || data.attempts.some(row=>row.sessionId===session.id&&row.activityId===a.id) || data.practiceRecordings?.some(row=>row.sessionId===session.id&&row.activityId===a.id))) throw new AppError('后面的题目已经开始，保持原有进度。','SESSION_PLAN_CHANGED',409);
      session.experienceUpgrade = { fromVersion:body.expectedVersion as 1|2,toVersion:targetVersion as 2|3, at:this.clock().toISOString(),checkpointId:body.checkpointId,previousActivities:clone(session.activities),...(session.experienceUpgrade?{previousUpgrade:clone(session.experienceUpgrade)}:{}) };
      const arrange=targetVersion===3?adaptiveMainlineActivities:mainlineActivities;
      session.activities = arrange(session.activities, data.words.filter(w => session.wordIds.includes(w.id)), session.gameSeed ?? session.id, boundary + 1, session.learningPolicy!.checkpoints,{familyEnabled:data.settings.familyGamesEnabled===true,contextEnabled:data.settings.contextGamesEnabled===true,...gameOptions});
      session.learningPolicy = { ...session.learningPolicy!, version:targetVersion as 2|3 };
      (session.acknowledgedCheckpoints ??= []).push(body.checkpointId);
      return session;
    });
  }
  updateSession(body: Record<string, unknown>) {
    return this.mutate(data => {
      if (body.sessionId === undefined && data.sessions.filter(s => !s.completedAt && !s.suspendedAt).length > 1) throw new AppError('有多轮学习未完成，请明确指定这一轮。', 'SESSION_ID_REQUIRED', 409);
      const session = body.sessionId === undefined ? this.activeLearningSession(data) ?? [...data.sessions].reverse().find(s => !s.suspendedAt) : data.sessions.find(s => s.id === body.sessionId && !s.suspendedAt);
      if (!session) throw new AppError('没有进行中的这轮学习，请返回大厅重新连接。', 'SESSION_INVALID');
      requireLearningPlanVersion(session, body.planVersion);
      if (body.checkpointId !== undefined) {
        if (Object.keys(body).some(key=>!['sessionId','checkpointId','planVersion'].includes(key)) || typeof body.checkpointId !== 'string' || !session.learningPolicy?.checkpoints.includes(body.checkpointId)) throw new AppError('小段进度无效。');
        if (session.acknowledgedCheckpoints?.includes(body.checkpointId)) return session;
        if (pendingLearningCheckpoint(session) !== body.checkpointId || session.completedAt) throw new AppError('请先完成当前小段。','SESSION_STEP_ORDER',409);
        (session.acknowledgedCheckpoints ??= []).push(body.checkpointId); return session;
      }
      if (body.completedStep !== undefined) {
        const input = body.completedStep as Record<string, unknown>;
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.wordId !== 'string' || !STEPS.includes(input.step as LearningStep) || Object.keys(input).some(key => !['wordId','step'].includes(key))) throw new AppError('完成步骤格式无效。');
        const task = session.tasks?.find(task => task.wordId === input.wordId);
        if (!task) throw new AppError('该步骤不在当前学习计划中。');
        const step = input.step as LearningStep, done = completedStepsFor(session, task.wordId);
        if (!done.includes(step)) {
          requireCheckpointAcknowledged(session);
          const activity = currentActivity(session);
          if (session.completedAt || (session.activities ? activity?.wordId !== task.wordId || activity?.step !== step : session.wordIds.find(id => !session.completedWordIds.includes(id)) !== task.wordId) || task.steps[done.length] !== step) throw new AppError('请先完成当前单词的前一步。', 'SESSION_STEP_ORDER');
          if (activity && (activity.kind !== 'standard'||isGoalCheckpoint(activity.step))) throw new AppError('请通过当前游戏完成这一题。', 'GAME_EVIDENCE');
          if (practiceDimension(step) || !stepEvidence(data.attempts, session.id, task.wordId, step)) throw new AppError('请先完成这一题，或选择跟着练习。', 'SESSION_STEP_EVIDENCE');
          session.completedSteps = { ...session.completedSteps, [task.wordId]: [...done, step] };
          if (step === 'learn') {
            const word = data.words.find(word => word.id === task.wordId)!;
            (session.exposures ??= []).push({wordId: word.id, learningVersion: word.learningVersion ?? 0, introducedAt: this.clock().toISOString()});
          }
          if (done.length + 1 === task.steps.length && !session.completedWordIds.includes(task.wordId)) session.completedWordIds.push(task.wordId);
        }
      }
      if (body.completedWordId !== undefined) {
        const id = String(body.completedWordId); if (!session.wordIds.includes(id)) throw new AppError('该单词不在学习中。');
        const task = session.tasks?.find(task => task.wordId === id);
        if (task && completedStepsFor(session,id).length !== task.steps.length) throw new AppError('请先按计划完成这个单词的步骤。', 'SESSION_STEP_ORDER');
        if (!session.completedWordIds.includes(id)) {
          session.completedWordIds.push(id);
          if (!task && !session.exposures?.some(entry => entry.wordId === id)) {
            const word = data.words.find(word => word.id === id)!;
            (session.exposures ??= []).push({wordId:id, learningVersion:word.learningVersion ?? 0, introducedAt:this.clock().toISOString()});
          }
        }
      }
      if (body.complete === true) {
        requireCheckpointAcknowledged(session);
        if (!session.wordIds.length || session.completedWordIds.length < session.wordIds.length) throw new AppError('请先完成今天这一轮的单词。');
        if (!session.completedAt) data.lastCompletedLearningSessionId = session.id;
        session.completedAt ??= this.clock().toISOString();
        if (!session.rewardGranted) { data.stickers.push(`sticker-${session.id}`); session.rewardGranted = true; }
        if (data.activeLearningSessionId === session.id || data.activeLearningSessionId === undefined) data.activeLearningSessionId = null;
      }
      return session;
    });
  }
  reserve(kind: 'tts' | 'stt', estimate: number, units: number) {
    if (!Number.isFinite(estimate) || estimate < 0) throw new AppError('费用估算无效。', 'COST_INVALID', 500);
    return this.mutate(data => { const month = monthKey(this.clock()), used = data.charges.filter(c => c.month === month).reduce((s,c) => s + (c.actual ?? c.reserved), 0); if (used + estimate > data.settings.monthlyBudgetCny + 1e-9) throw new AppError('本月语音预算已用完，请在家长页调整预算或使用本机朗读与点击。', 'BUDGET_EXCEEDED', 402);
      const charge = { id: randomUUID(), month, reserved: estimate, kind, units }; data.charges.push(charge); return charge.id; });
  }
  settle(id: string, actual: number, units?: number) { this.mutate(data => { const charge = data.charges.find(c => c.id === id); if (charge && Number.isFinite(actual) && actual >= 0) { charge.actual = actual; if (units !== undefined && Number.isFinite(units) && units >= 0) charge.units = units; } }); }
  exportBackup() {
    const data = this.read(), files: { path: string; content: string }[] = [], seen = new Set<string>();
    for (const word of data.words) if (word.imageUrl.startsWith('/media/')) {
      const relative = decodeURIComponent(word.imageUrl.slice('/media/'.length)); const absolute = path.resolve(this.dataDir, relative);
      if (safeRelative(relative) && absolute.startsWith(this.dataDir + path.sep) && existsSync(absolute) && !seen.has(relative)) { files.push({ path: relative, content: readFileSync(absolute).toString('base64') }); seen.add(relative); }
    }
    const addDirectory = (directory: string) => {
      if (!existsSync(directory)) return;
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, item.name);
        if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) { addDirectory(absolute); continue; }
        const relative = path.relative(this.dataDir, absolute).split(path.sep).join('/');
        if (safeRelative(relative) && realpathSync(absolute).startsWith(realpathSync(this.dataDir) + path.sep) && !seen.has(relative)) { files.push({ path: relative, content: readFileSync(absolute).toString('base64') }); seen.add(relative); }
      }
    };
    addDirectory(path.join(this.dataDir, 'speech')); addDirectory(path.join(this.dataDir, 'images'));
    return { format: 'little-word-playroom', version: 1, exportedAt: this.clock().toISOString(), data, files };
  }
  restoreBackup(input: unknown) {
    const backup = validateBackup(input);
    for(const recording of backup.data.practiceRecordings??[])recording.status='missing';
    // Raw recordings never travel in a backup. Restored pending answers require a new challenge.
    for (const session of backup.data.assessments ?? []) if (session.workflow === 'recorded') {
      for (const item of session.items) if (item.response?.recording && !item.reviews?.length) item.response.recording.status = 'missing';
      if (session.job && session.job.status !== 'review') { session.job.status = 'interrupted'; session.job.error = '备份不含原音，待核验回答请重新测试。'; }
    }
    for (const file of backup.files) {
      let ancestor = path.dirname(path.join(this.dataDir, file.path));
      while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
      const actual = realpathSync(ancestor), root = realpathSync(this.dataDir);
      if (actual !== root && !actual.startsWith(root + path.sep)) throw new AppError('备份目标目录指向本机素材目录之外。');
      const target = path.join(this.dataDir, file.path);
      if (existsSync(target) && !realpathSync(target).startsWith(root + path.sep)) throw new AppError('备份素材目标路径无效。');
    }
    const snapshotDir = path.join(this.dataDir, 'backups'); mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(path.join(snapshotDir, `before-restore-${Date.now()}.json`), JSON.stringify(this.exportBackup()));
    for (const file of backup.files) { const target = path.join(this.dataDir, file.path); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, Buffer.from(file.content, 'base64')); }
    this.mutate(data => {
      // Learning content can be restored; already incurred or reserved provider usage cannot be undone.
      // The current local ledger is authoritative for ids found in both copies.
      const charges = new Map(backup.data.charges.map(charge => [charge.id, charge]));
      for (const charge of data.charges) charges.set(charge.id, charge);
      const awards = new Map((backup.data.badgeAwards ?? []).map(award => [award.badgeId, award]));
      for (const award of data.badgeAwards ?? []) awards.set(award.badgeId, award);
      Object.assign(data, backup.data); data.activeLearningSessionId = backup.data.activeLearningSessionId; data.lastCompletedLearningSessionId = backup.data.lastCompletedLearningSessionId; data.charges = [...charges.values()]; data.badgeAwards = [...awards.values()]; migrateSamplePack(data, this.clock());
      for (const job of data.jobs) if (job.status === 'running' || job.status === 'queued') { job.status = 'cancelled'; job.error = '从备份恢复后，请重新开始生成。'; }
    });
  }
}
export function safeRelative(relative: string) { return /^(images|speech)\/[A-Za-z0-9_\-./]+\.(png|jpg|jpeg|webp|gif|wav|mp3|ogg)$/i.test(relative) && !relative.split('/').includes('..') && !relative.includes('\\'); }
export function validateBackup(input: unknown): { data: StoredData; files: { path: string; content: string }[] } {
  const value = input as Record<string, any>;
  if (!value || value.format !== 'little-word-playroom' || value.version !== 1 || value.data?.version !== 1 || !Array.isArray(value.files)) throw new AppError('备份格式或版本不支持。');
  const d = value.data;
  if (!d.profile || typeof d.profile.nickname !== 'string' || !Array.isArray(d.profile.interests) || !d.settings || !Array.isArray(d.packs) || !Array.isArray(d.words) || !Array.isArray(d.progress) || !Array.isArray(d.attempts) || !Array.isArray(d.sessions) || !Array.isArray(d.stickers) || !Array.isArray(d.jobs) || !Array.isArray(d.charges)) throw new AppError('备份缺少必要的数据。');
  const text = (x: unknown, max = 100) => typeof x === 'string' && x.length > 0 && x.length <= max;
  const count = (x: unknown, max = 1_000_000) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max;
  const date = (x: unknown) => typeof x === 'string' && x.length < 40 && Number.isFinite(Date.parse(x));
  const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const unique = (rows: any[]) => rows.every(row => row && typeof row === 'object' && text(row.id)) && new Set(rows.map(row => row.id)).size === rows.length;
  const media = (url: unknown) => { if (typeof url !== 'string') return false; if (/^\/assets\/(?:placeholder\.svg|words\/[a-z-]+\.svg)$/.test(url)) return true; try { return url.startsWith('/media/') && safeRelative(decodeURIComponent(url.slice(7))); } catch { return false; } };
  if (!text(d.profile.nickname,30) || d.profile.interests.length > 8 || d.profile.interests.some((x:unknown) => !text(x,40)) || !count(d.profile.interestVersion) || typeof d.profile.onboardingCompleted !== 'boolean') throw new AppError('备份孩子资料无效。');
  if ((d.settings.feedbackSoundsEnabled !== undefined && typeof d.settings.feedbackSoundsEnabled !== 'boolean') || (d.settings.learningStrategy !== undefined && !['classic','memory-loop'].includes(d.settings.learningStrategy)) || (d.settings.contextGamesEnabled !== undefined && typeof d.settings.contextGamesEnabled !== 'boolean') || d.settings.familyGamesEnabled !== undefined && typeof d.settings.familyGamesEnabled !== 'boolean' || Object.entries(defaults).some(([key,val]) => typeof d.settings[key] !== typeof val) || Object.values(d.settings).some(val => typeof val === 'number' && (!Number.isFinite(val) || val < 0)) || !count(d.settings.dailyNewWords,20) || d.settings.dailyNewWords < 1 || !count(d.settings.dailyReviewWords,50) || !count(d.settings.sessionMinutes,30) || d.settings.sessionMinutes < 3 || d.settings.monthlyBudgetCny > 10000) throw new AppError('备份设置无效。');
  if (d.packs.length > 20000 || !unique(d.packs) || d.packs.some((p:any) => !text(p.title,80) || !date(p.createdAt) || typeof p.enabled !== 'boolean' || (p.isSample !== undefined && typeof p.isSample !== 'boolean') || (p.confirmedAt !== undefined && !date(p.confirmedAt)) || (p.deletedAt !== undefined && (!date(p.deletedAt) || p.enabled)))) throw new AppError('备份词表无效。');
  const packIds = new Set(d.packs.map((p:any) => p.id));
  if (d.words.length > 20000 || !unique(d.words) || d.words.some((w:any) => !packIds.has(w.packId) || !['approved','draft','review','error','generating'].includes(w.assetStatus) || !['builtin','codex','upload'].includes(w.imageSource) || validateRows([w]).errors.length || !media(w.imageUrl) || (w.imageTheme !== undefined && (!text(w.imageTheme,80) || !/^[a-z0-9-]+$/.test(w.imageTheme))) || (w.error !== undefined && !text(w.error,2000)) || (w.learningResetAt !== undefined && !date(w.learningResetAt)) || (w.learningVersion !== undefined && !count(w.learningVersion)) || (w.deletedAt !== undefined && (!date(w.deletedAt) || w.assetStatus !== 'draft')))) throw new AppError('备份单词或素材路径无效。');
  const wordIds = new Set(d.words.map((w:any) => w.id));
  if (d.lessonPlan !== undefined && !validLessonPlan(d.lessonPlan, wordIds as Set<string>)) throw new AppError('备份课堂安排无效。');
  if(d.words.some((w:any)=>w.gameMaterials!==undefined&&(!w.gameMaterials||typeof w.gameMaterials!=='object'||Array.isArray(w.gameMaterials)||Object.entries(w.gameMaterials).some(([kind,m])=>!validGameMaterial(kind,m)||(m as any).origin==='proposal'))))throw new AppError('备份游戏素材无效。');
  if (d.progress.length > 100000 || d.progress.some((p:any) => !p || !wordIds.has(p.wordId) || !SKILLS.includes(p.skill) || !count(p.stage,5) || !date(p.dueAt) || !count(p.successes) || !count(p.attempts))) throw new AppError('备份学习进度无效。');
  if (new Set(d.progress.map((p:any) => `${p.wordId}:${p.skill}`)).size !== d.progress.length) throw new AppError('备份学习进度重复。');
  if (d.sessions.length > 100000 || !unique(d.sessions) || d.sessions.some((s:any) => !Array.isArray(s.wordIds) || !Array.isArray(s.completedWordIds) || s.wordIds.some((id:unknown) => typeof id !== 'string' || !wordIds.has(id)) || s.completedWordIds.some((id:unknown) => !s.wordIds.includes(id)) || new Set(s.wordIds).size !== s.wordIds.length || new Set(s.completedWordIds).size !== s.completedWordIds.length || !date(s.startedAt) || (s.completedAt !== undefined && !date(s.completedAt)) || (s.suspendedAt !== undefined && (!date(s.suspendedAt) || s.completedAt !== undefined || s.rewardGranted)) || typeof s.rewardGranted !== 'boolean')) throw new AppError('备份学习会话无效。');
  if (d.sessions.some((s:any) => s.mode !== undefined && !['recommended','relearn','practice'].includes(s.mode) || s.practiceOnly !== undefined && typeof s.practiceOnly !== 'boolean' || s.mode && s.mode !== 'recommended' && s.practiceOnly !== true || s.requestId !== undefined && (typeof s.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(s.requestId)) || s.lastResumedAt !== undefined && !date(s.lastResumedAt) || s.exposures !== undefined && (!Array.isArray(s.exposures) || s.exposures.length > 20000 || new Set(s.exposures.map((entry:any)=>entry?.wordId)).size !== s.exposures.length || s.exposures.some((entry:any)=>!entry || !wordIds.has(entry.wordId) || !count(entry.learningVersion) || !date(entry.introducedAt))))) throw new AppError('备份学习模式或接触记录无效。');
  if (d.sessions.some((s:any) => s.practicePackId !== undefined && (!text(s.practicePackId,120) || !text(s.practicePackTitle,80) || !['practice','relearn'].includes(s.mode) || s.practiceOnly !== true || s.lessonPlanId !== undefined || !d.packs.some((pack:any) => pack.id === s.practicePackId) || s.wordIds.some((id:string) => !d.words.some((word:any) => word.id === id && word.packId === s.practicePackId))) || s.practicePackId === undefined && s.practicePackTitle !== undefined)) throw new AppError('备份词表练习范围无效。');
  if (d.sessions.some((s:LearningSession) => s.packGame !== undefined && (!s.packGame || typeof s.packGame !== 'object' || Array.isArray(s.packGame) || Object.keys(s.packGame).some(key=>!['selection','scopeWordIds'].includes(key)) || typeof s.packGame.selection !== 'string' || s.packGame.selection !== 'random' && !gameDefinition(s.packGame.selection) || !s.practicePackId || !s.practiceOnly || s.learningPolicy !== undefined || !Array.isArray(s.packGame.scopeWordIds) || !s.packGame.scopeWordIds.length || new Set(s.packGame.scopeWordIds).size !== s.packGame.scopeWordIds.length || s.packGame.scopeWordIds.some(id=>!d.words.some((w:Word)=>w.id===id&&w.packId===s.practicePackId)) || s.wordIds.some(id=>!s.packGame!.scopeWordIds.includes(id)) || !s.activities?.length || s.activities.some(a=>a.kind==='standard'||s.packGame!.selection!=='random'&&a.kind!==s.packGame!.selection||[...a.choices,...(a.targets??[]),...(a.cueWord?[a.cueWord]:[])].some(word=>!s.packGame!.scopeWordIds.includes(word.id))||a.material?.wordIds.some(id=>!s.packGame!.scopeWordIds.includes(id)))))) throw new AppError('备份词表游戏计划无效。');
  if (d.sessions.some((s:any) => s.endReason !== undefined && (!['reselect','restart'].includes(s.endReason) || !s.suspendedAt) || s.replacementSessionId !== undefined && (s.endReason !== 'restart' || !d.sessions.some((other:any) => other.id === s.replacementSessionId && other.id !== s.id)) || s.lessonPlanId !== undefined && (typeof s.lessonPlanId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(s.lessonPlanId) || !count(s.lessonPlanRevision) || s.lessonPlanRevision < 1 || !text(s.lessonTitle,80) || !count(s.lessonScopeCount,500) || s.lessonScopeCount < Math.max(1,s.wordIds.length) || !s.lessonWordVersions || typeof s.lessonWordVersions !== 'object' || Array.isArray(s.lessonWordVersions) || s.wordIds.some((id:string) => !count(s.lessonWordVersions[id]))))) throw new AppError('备份课堂轮次或结束记录无效。');
  if (d.lessonPlan) {
    const verified = structuredClone(d.lessonPlan); verified.completedWordIds = []; syncLessonProgress(verified, d.sessions);
    if (JSON.stringify(verified.completedWordIds) !== JSON.stringify(d.lessonPlan.completedWordIds)) throw new AppError('备份课堂进度与实际练习不一致。');
  }
  if (d.lastCompletedLearningSessionId !== undefined && !d.sessions.some((s:any)=>s.id===d.lastCompletedLearningSessionId && s.completedAt && s.rewardGranted && !s.suspendedAt)) throw new AppError('备份最近完成会话无效。');
  const requestIds = d.sessions.filter((s:any)=>s.requestId !== undefined).map((s:any)=>s.requestId);
  if (new Set(requestIds).size !== requestIds.length || d.activeLearningSessionId !== undefined && d.activeLearningSessionId !== null && !d.sessions.some((s:any)=>s.id===d.activeLearningSessionId && !s.completedAt && !s.suspendedAt)) throw new AppError('备份当前学习或启动请求无效。');
  if (d.sessions.some((s:any) => {
    if (s.tasks === undefined) return ['completedSteps','taskLimit','estimatedMinutes'].some(key => s[key] !== undefined);
    if (!Array.isArray(s.tasks) || s.tasks.length !== s.wordIds.length || !s.completedSteps || typeof s.completedSteps !== 'object' || Array.isArray(s.completedSteps) || !count(s.taskLimit,100000) || !finite(s.estimatedMinutes)) return true;
    if (s.tasks.some((task:any,index:number) => !task || task.wordId !== s.wordIds[index] || !['new','review'].includes(task.mode) || !Array.isArray(task.steps) || !task.steps.length || task.steps.length > STEPS.length || new Set(task.steps).size !== task.steps.length || task.steps.some((step:any) => !STEPS.includes(step)))) return true;
    if (s.tasks.reduce((sum:number,task:any) => sum + task.steps.length,0) > s.taskLimit || Object.keys(s.completedSteps).some(id => !s.wordIds.includes(id))) return true;
    let previousComplete = true;
    for (const task of s.tasks) {
      const done = Object.hasOwn(s.completedSteps,task.wordId) ? s.completedSteps[task.wordId] : [];
      if (!Array.isArray(done) || done.length > task.steps.length || done.some((step:any,index:number) => step !== task.steps[index]) || (!s.activities && !previousComplete && done.length)) return true;
      const complete = done.length === task.steps.length;
      if (s.completedWordIds.includes(task.wordId) !== complete) return true;
      previousComplete = previousComplete && complete;
    }
    return s.rewardGranted && (!s.completedAt || s.completedWordIds.length !== s.wordIds.length);
  })) throw new AppError('备份学习任务或完成步骤无效。');
  if (d.sessions.some((session: LearningSession) => !validGameSession(session, wordIds as Set<string>, media) || !validMemoryLoopPolicy(session))) throw new AppError('备份游戏计划或检查点无效。');
  for(const session of d.sessions as LearningSession[]) {
    const validateUpgrade=(upgrade:any,expectedVersion:number,depth=0)=>{
      if(upgrade===undefined)return;
      if(depth>1||!upgrade||typeof upgrade!=='object'||Array.isArray(upgrade)||Object.keys(upgrade).some(k=>!['fromVersion','toVersion','at','checkpointId','previousActivities','previousUpgrade'].includes(k))||![1,2].includes(upgrade.fromVersion)||(upgrade.toVersion??2)!==expectedVersion||upgrade.fromVersion>=expectedVersion||!date(upgrade.at)||!Array.isArray(upgrade.previousActivities)||upgrade.previousActivities.length!==session.activities?.length||!session.acknowledgedCheckpoints?.includes(upgrade.checkpointId))throw new AppError('备份体验升级快照无效。');
      const boundary=session.activities!.findIndex(a=>a.id===upgrade.checkpointId);
      if(boundary<0||upgrade.previousActivities.some((a:any,i:number)=>!a||a.id!==session.activities![i].id||a.wordId!==session.activities![i].wordId||a.step!==session.activities![i].step||JSON.stringify(a.word)!==JSON.stringify(session.activities![i].word)||i<=boundary&&JSON.stringify(a)!==JSON.stringify(session.activities![i])))throw new AppError('备份升级改变了既有学习任务。');
      const old={...session,experienceUpgrade:undefined,activities:upgrade.previousActivities,completedSteps:{},completedWordIds:[],activityStates:{},acknowledgedCheckpoints:[],learningPolicy:{...session.learningPolicy!,version:upgrade.fromVersion}};
      if(!validGameSession(old,wordIds as Set<string>,media)||!validMemoryLoopPolicy(old))throw new AppError('备份旧编排快照无效。');
      if(upgrade.previousUpgrade&&session.activities!.findIndex(a=>a.id===upgrade.previousUpgrade.checkpointId)>boundary)throw new AppError('备份升级快照顺序无效。');
      validateUpgrade(upgrade.previousUpgrade,upgrade.fromVersion,depth+1);
    };
    validateUpgrade(session.experienceUpgrade,session.learningPolicy?.version??1);
  }
  const sessionIds = new Set(d.sessions.map((s:any) => s.id));
  if(d.practiceRecordings!==undefined&&(!validPracticeRecordings(d.practiceRecordings)||d.practiceRecordings.some((r:PracticeRecording)=>!sessionIds.has(r.sessionId)||!wordIds.has(r.word.id)||!media(r.word.imageUrl)||!d.sessions.some((s:LearningSession)=>s.id===r.sessionId&&(s.activities?s.activities.some(a=>a.id===r.activityId&&a.wordId===r.word.id&&a.kind===r.kind&&a.step===r.step&&a.word.term===r.word.term&&a.word.meaning===r.word.meaning&&(a.word.learningVersion??0)===(r.word.learningVersion??0)):s.wordIds.includes(r.word.id)&&r.activityId===`${r.word.id}:${r.step}`)))))throw new AppError('备份口头练习录音记录无效。');
  const assessmentData = validateAssessmentData(d, media);
  if (d.attempts.length > 1_000_000 || !unique(d.attempts) || d.attempts.some((a:any) => !wordIds.has(a.wordId) || !sessionIds.has(a.sessionId) || !SKILLS.includes(a.skill) || !['click','speech','keyboard'].includes(a.source) || typeof a.correct !== 'boolean' || typeof a.hinted !== 'boolean' || (a.practiceOnly !== undefined && typeof a.practiceOnly !== 'boolean') || (a.learningVersion !== undefined && !count(a.learningVersion)) || (a.activityId !== undefined && !text(a.activityId,120)) || (a.step !== undefined && (!STEPS.includes(a.step) || stepSkill(a.step) !== a.skill)) || !date(a.createdAt))) throw new AppError('备份答题记录无效。');
  if(d.sessions.some((s:LearningSession)=>s.goalVersion!==undefined&&(s.goalVersion!==1||s.tasks?.some(t=>t.mode==='new'&&!['learn','recognize','listen','sound','read','recall'].every(step=>t.steps.includes(step as LearningStep))))))throw new AppError('备份认听读目标不完整。');
  if(d.attempts.some((a:LearningAttempt)=>a.sessionPracticeOnly!==undefined&&(a.sessionPracticeOnly!==true||!a.practiceOnly||!d.sessions.some((session:LearningSession)=>session.id===a.sessionId&&session.practiceOnly))))throw new AppError('备份额外练习来源无效。');
  if(d.attempts.some((a:LearningAttempt)=>a.step==='recall'&&d.sessions.some((session:LearningSession)=>session.id===a.sessionId&&session.learningPolicy?.kind==='memory-loop')&&(a.correct||!a.practiceOnly||!a.oralStatus)))throw new AppError('回忆录音只能记练习，不能直接写正式成绩。');
  if(d.progress.some((p:SkillProgress)=>p.skill==='read')||d.attempts.some((a:LearningAttempt)=>a.skill==='read'&&(a.oralStatus===undefined||a.correct||!a.practiceOnly)))throw new AppError('朗读保存只能记练习，不能直接写正式成绩。');
  if(d.attempts.some((a:LearningAttempt)=>a.oralStatus!==undefined&&(!(a.skill==='read'&&a.step==='read'||a.skill==='recall'&&a.step==='recall'&&d.sessions.some((session:LearningSession)=>session.id===a.sessionId&&session.activities?.some(activity=>activity.id===a.activityId&&recallFirstActivity(session,activity))))||!['recorded','skipped'].includes(a.oralStatus)||a.correct||!a.practiceOnly||a.oralStatus==='recorded'&&!((d.practiceRecordings??[]) as PracticeRecording[]).some(r=>r.sessionId===a.sessionId&&r.activityId===a.activityId&&r.word.id===a.wordId&&r.word.learningVersion===(a.learningVersion??0)))))throw new AppError('备份朗读证据无效。');
  const evidenceKeys = new Set<string>(d.attempts.filter((a:LearningAttempt) => a.step && (a.correct || a.practiceOnly)).map((a:LearningAttempt) => JSON.stringify([a.sessionId,a.wordId,a.step])));
  for (const practice of assessmentData.assessmentPractices) evidenceKeys.add(JSON.stringify([practice.sessionId, practice.wordId, practiceStep(practice.dimension)]));
  if (d.sessions.some((session:LearningSession) => session.tasks?.some(task => completedStepsFor(session,task.wordId).some(step => step !== 'learn' && !evidenceKeys.has(JSON.stringify([session.id,task.wordId,step])))))) throw new AppError('备份完成步骤缺少答题或练习记录。');
  if (d.sessions.some((session: LearningSession) => session.activities?.some(activity => activity.kind !== 'standard' && (activityDone(session, activity) || gameAccepted(session.activityStates?.[activity.id] ?? {})) && !d.attempts.some((attempt: LearningAttempt) => attempt.sessionId === session.id && attempt.activityId === activity.id && attempt.wordId === activity.wordId && attempt.step === activity.step && (attempt.correct || attempt.practiceOnly) && (isGoalCheckpoint(activity.step) || !gameDefinition(activity.kind)?.practiceOnly || attempt.practiceOnly))))) throw new AppError('备份游戏完成缺少练习证据。');
  if (d.jobs.length > 100000 || !unique(d.jobs) || d.jobs.some((j:any) => !wordIds.has(j.wordId) || !['queued','running','review','error','cancelled'].includes(j.status) || !date(j.createdAt) || (j.imageUrl !== undefined && !media(j.imageUrl)) || (j.error !== undefined && !text(j.error,2000)))) throw new AppError('备份图片任务无效。');
  if (d.charges.length > 1_000_000 || !unique(d.charges) || d.charges.some((c:any) => !/^\d{4}-\d{2}$/.test(c.month) || !['tts','stt'].includes(c.kind) || !finite(c.reserved) || (c.actual !== undefined && !finite(c.actual)) || !finite(c.units)) || d.stickers.some((s:unknown) => !text(s,120))) throw new AppError('备份用量或奖励记录无效。');
  if (d.badgeAwards !== undefined && (!Array.isArray(d.badgeAwards) || d.badgeAwards.length > badgeCatalog.length || new Set(d.badgeAwards.map((award:any) => award?.badgeId)).size !== d.badgeAwards.length || d.badgeAwards.some((award:any) => !award || !badgeById.has(award.badgeId) || !date(award.recordedAt) || !Number.isInteger(award.value) || award.value < badgeById.get(award.badgeId)!.target || !['progress', 'backfill'].includes(award.source)))) throw new AppError('备份奖章记录无效。');
  const files = value.files as { path: string; content: string }[];
  const seenPaths = new Set<string>(); let totalBytes = 0;
  if (files.length > 20000 || files.some(f => { if (!f || typeof f.path !== 'string' || !safeRelative(f.path) || typeof f.content !== 'string' || f.content.length > 30_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.content) || seenPaths.has(f.path.toLowerCase())) return true; seenPaths.add(f.path.toLowerCase()); totalBytes += f.content.length; return totalBytes > 55_000_000; })) throw new AppError('备份素材格式不正确、路径重复或总量过大。');
  const pick = (object: Record<string,unknown>, keys:string[]) => Object.fromEntries(keys.filter(key => object[key] !== undefined).map(key => [key,object[key]]));
  const cleanActivity=(activity:any)=>({...pick(activity,['id','wordId','step','kind','groupId','direction','routeStart','routeCells','letterGrid','material','spellingBoard']),word:pick(activity.word,['id','term','meaning','imageUrl','learningVersion']),choices:activity.choices.map((word:any)=>pick(word,['id','term','meaning','imageUrl','learningVersion'])),...(activity.targets?{targets:activity.targets.map((word:any)=>pick(word,['id','term','meaning','imageUrl','learningVersion']))}:{}),...(activity.cueWord?{cueWord:pick(activity.cueWord,['id','term','meaning','imageUrl','learningVersion'])}:{})});
  const cleanUpgrade=(upgrade:any):unknown=>({...pick(upgrade,['fromVersion','toVersion','at','checkpointId']),previousActivities:upgrade.previousActivities.map(cleanActivity),...(upgrade.previousUpgrade?{previousUpgrade:cleanUpgrade(upgrade.previousUpgrade)}:{})});
  const clean = { version: 1, ...(d.lessonPlan === undefined ? {} : { lessonPlan: structuredClone(d.lessonPlan) }), ...assessmentData, ...{practiceRecordings:(d.practiceRecordings??[]).map((r:PracticeRecording)=>({...pick(r as unknown as Record<string,unknown>,['id','sessionId','activityId','kind','step','mode','round','createdAt','seconds','bytes','sha256','status']),word:pick(r.word as unknown as Record<string,unknown>,['id','term','meaning','imageUrl','learningVersion'])}))}, profile: pick(d.profile,['nickname','interests','interestVersion','onboardingCompleted']), settings:pick(d.settings,[...Object.keys(defaults),'familyGamesEnabled','contextGamesEnabled','learningStrategy','feedbackSoundsEnabled']),
    packs:d.packs.map((p:any)=>pick(p,['id','title','enabled','createdAt','isSample','confirmedAt','deletedAt'])), words:d.words.map((w:any)=>pick(w,['id','packId','term','meaning','partOfSpeech','pictureHint','usageNote','imageTheme','imageUrl','assetStatus','imageSource','error','learningResetAt','learningVersion','gameMaterials','deletedAt'])),
    progress:d.progress.map((p:any)=>pick(p,['wordId','skill','stage','dueAt','successes','attempts'])), attempts:d.attempts.map((a:any)=>pick(a,['id','wordId','sessionId','skill','step','learningVersion','correct','hinted','practiceOnly','source','createdAt','activityId','oralStatus','sessionPracticeOnly'])),
    sessions:d.sessions.map((s:any)=>({...pick(s,['id','wordIds','completedWordIds','startedAt','completedAt','suspendedAt','rewardGranted','taskLimit','estimatedMinutes','gameSeed','mode','practiceOnly','requestId','lastResumedAt','goalVersion','learningPolicy','acknowledgedCheckpoints','endReason','replacementSessionId','practicePackId','practicePackTitle','packGame','lessonPlanId','lessonPlanRevision','lessonTitle','lessonScopeCount','lessonWordVersions']),...(s.experienceUpgrade===undefined?{}:{experienceUpgrade:cleanUpgrade(s.experienceUpgrade)}),...(s.exposures === undefined ? {} : {exposures:s.exposures.map((entry:any)=>pick(entry,['wordId','learningVersion','introducedAt']))}),...(s.tasks === undefined ? {} : {tasks:s.tasks.map((task:any)=>pick(task,['wordId','mode','steps'])),completedSteps:Object.fromEntries(Object.entries(s.completedSteps).map(([id,steps])=>[id,steps]))}),...(s.activities === undefined ? {} : {activities:s.activities.map((activity:any)=>({...pick(activity,['id','wordId','step','kind','groupId','direction','routeStart','routeCells','letterGrid','material','spellingBoard']),word:pick(activity.word,['id','term','meaning','imageUrl','learningVersion']),choices:activity.choices.map((word:any)=>pick(word,['id','term','meaning','imageUrl','learningVersion'])),...(activity.targets ? {targets:activity.targets.map((word:any)=>pick(word,['id','term','meaning','imageUrl','learningVersion']))} : {}),...(activity.cueWord ? {cueWord:pick(activity.cueWord,['id','term','meaning','imageUrl','learningVersion'])} : {})})),activityStates:Object.fromEntries(Object.entries(s.activityStates).map(([id,state])=>[id,pick(state as Record<string,unknown>,activityStateKeys)]))})})), stickers:d.stickers,
    jobs:d.jobs.map((j:any)=>pick(j,['id','wordId','status','error','imageUrl','createdAt'])), charges:d.charges.map((c:any)=>pick(c,['id','month','reserved','actual','kind','units'])) } as unknown as StoredData;
  if (d.lastCompletedLearningSessionId !== undefined) clean.lastCompletedLearningSessionId = d.lastCompletedLearningSessionId;
  if (d.activeLearningSessionId !== undefined) clean.activeLearningSessionId = d.activeLearningSessionId;
  if (d.badgeAwards !== undefined) clean.badgeAwards = d.badgeAwards.map((award:any) => pick(award, ['badgeId', 'recordedAt', 'value', 'source'])) as BadgeAward[];
  return { data: clean, files };
}

function requireCheckpointAcknowledged(session: LearningSession) {
  if (pendingLearningCheckpoint(session)) throw new AppError('这一小段完成啦，休息一下，准备好了再继续。','LEARNING_CHECKPOINT',409);
}
