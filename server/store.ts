import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { dailyLearningPlan, learningDay } from '../shared/learning.ts';
import type { AppState, ChildProfile, Settings, Word, WordPack, SkillProgress, LearningAttempt, LearningSession, IllustrationJob, IntegrationStatus, ImportRow, Skill, LearningStep } from '../shared/contracts.ts';

export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, code = 'INVALID_REQUEST', status = 400) { super(message); this.code = code; this.status = status; }
}
interface Charge { id: string; month: string; reserved: number; actual?: number; kind: 'tts' | 'stt'; units: number }
export interface StoredData {
  version: 1; profile: ChildProfile; settings: Settings; packs: WordPack[]; words: Word[];
  progress: SkillProgress[]; attempts: LearningAttempt[]; sessions: LearningSession[];
  stickers: string[]; jobs: IllustrationJob[]; charges: Charge[];
}
const DAY = 86_400_000;
const INTERVALS = [1, 3, 7, 14, 30];
const SKILLS: Skill[] = ['listen', 'recall', 'spell'];
const STEPS: LearningStep[] = ['learn', 'listen', 'sound', 'recall', 'spell'];
const stepSkill = (step: LearningStep): Skill | undefined => step === 'sound' ? 'listen' : step === 'learn' ? undefined : step;
const completedStepsFor = (session: LearningSession, wordId: string): LearningStep[] => session.completedSteps && Object.hasOwn(session.completedSteps, wordId) ? session.completedSteps[wordId] : [];
const stepEvidence = (attempts: LearningAttempt[], sessionId: string, wordId: string, step: LearningStep) => step === 'learn' || attempts.some(a => a.sessionId === sessionId && a.wordId === wordId && a.step === step && a.skill === stepSkill(step) && (a.correct || a.practiceOnly));
const defaults: Settings = { dailyNewWords: 3, dailyReviewWords: 6, sessionMinutes: 10, spellingEnabled: false, monthlyBudgetCny: 30, voiceEnabled: true };
export const localDay = learningDay;
export const monthKey = (date = new Date()) => localDay(date).slice(0, 7);
const clone = <T>(value: T): T => structuredClone(value);

function seed(now: Date): StoredData {
  const rows = [['apple','苹果'],['banana','香蕉'],['cat','猫'],['dog','狗'],['ball','球'],['car','汽车'],['sun','太阳'],['moon','月亮'],['fish','鱼'],['bird','鸟'],['jump','跳跃'],['run','跑步']];
  return { version: 1, profile: { nickname: '小探险家', interests: [], interestVersion: 1, onboardingCompleted: false }, settings: { ...defaults },
    packs: [{ id: 'starter', title: '第一盒单词', enabled: true, createdAt: now.toISOString() }],
    words: rows.map(([term, meaning]) => ({ id: `starter-${term}`, packId: 'starter', term, meaning, imageUrl: `/assets/words/${term}.svg`, assetStatus: 'approved', imageSource: 'builtin' })),
    progress: [], attempts: [], sessions: [], stickers: [], jobs: [], charges: [] };
}

export function validateRows(rows: unknown): { rows: ImportRow[]; errors: string[] } {
  const result: ImportRow[] = [], errors: string[] = [], seen = new Map<string, string>();
  if (!Array.isArray(rows)) return { rows: [], errors: ['词表必须是列表。'] };
  if (rows.length > 500) return { rows: [], errors: ['每次最多导入 500 个单词。'] };
  rows.forEach((row, i) => {
    const term = typeof row?.term === 'string' ? row.term.trim().replace(/\s+/g, ' ') : '';
    const meaning = typeof row?.meaning === 'string' ? row.meaning.trim() : '';
    if (!term || !meaning) { errors.push(`第 ${i + 1} 行需要英文和中文意思。`); return; }
    if (term.length > 80 || !/^[A-Za-z][A-Za-z '\-]*$/.test(term)) { errors.push(`第 ${i + 1} 行英文格式不正确，请只填单词或短语。`); return; }
    if (meaning.length > 160 || /[\u0000-\u001f]/.test(meaning)) { errors.push(`第 ${i + 1} 行中文意思太长或含控制字符。`); return; }
    const key = term.toLowerCase();
    if (seen.has(key)) { errors.push(`第 ${i + 1} 行「${term}」${seen.get(key) === meaning ? '重复，请删除重复行' : '有多个意思，请为本次学习保留一个明确义项'}。`); return; }
    seen.set(key, meaning); result.push({ term, meaning });
  });
  if (!rows.length) errors.push('词表为空，请输入英文和中文意思。');
  return { rows: result, errors };
}

export function parseImport(text: unknown): { rows: ImportRow[]; errors: string[] } {
  if (typeof text !== 'string' || !text.trim()) return { rows: [], errors: ['请粘贴两列词表，或选择 CSV 文件。'] };
  if (text.length > 200_000) return { rows: [], errors: ['词表文件太大。'] };
  text = text.replace(/^\uFEFF/, '');
  const delimiter = (text as string).split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const table: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const source = text as string;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else if (!quoted && cell.trim()) return { rows: [], errors: ['CSV 引号位置错误。'] }; else quoted = !quoted; }
    else if (!quoted && ch === delimiter) { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) { if (ch === '\r' && source[i + 1] === '\n') i++; row.push(cell); if (row.some(s => s.trim())) table.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (quoted) return { rows: [], errors: ['CSV 引号未闭合，请检查文件。'] };
  row.push(cell); if (row.some(s => s.trim())) table.push(row);
  if (table.length && /^(term|word|english|英文|单词)$/i.test(table[0][0].trim())) table.shift();
  const bad = table.findIndex(r => r.length !== 2);
  if (bad !== -1) return { rows: [], errors: [`第 ${bad + 1} 行不是两列，请用制表符或 CSV 分隔英文和中文。`] };
  return validateRows(table.map(([term, meaning]) => ({ term, meaning })));
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
      for (const job of data.jobs) if (job.status === 'queued' || job.status === 'running') { job.status = 'error'; job.error = '服务重启，生成任务已中断，可以重新生成。'; const word = data.words.find(w => w.id === job.wordId); if (word?.assetStatus === 'generating') word.assetStatus = word.imageSource === 'builtin' ? 'approved' : 'error'; }
    });
  }
  close() { this.db.close(); }
  read(): StoredData { return JSON.parse((this.db.prepare('SELECT body FROM documents WHERE id=1').get() as { body: string }).body); }
  mutate<T>(fn: (data: StoredData) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const data = this.read(); const result = fn(data); this.reconcileSessions(data); this.db.prepare('UPDATE documents SET body=? WHERE id=1').run(JSON.stringify(data)); this.db.exec('COMMIT'); return clone(result); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private reconcileSessions(data: StoredData) {
    const packs = new Set(data.packs.filter(p => p.enabled).map(p => p.id));
    const approved = new Set(data.words.filter(w => packs.has(w.packId) && w.assetStatus === 'approved').map(w => w.id));
    for (const session of data.sessions) if (!session.completedAt) {
      session.wordIds = session.wordIds.filter(id => approved.has(id));
      session.completedWordIds = session.completedWordIds.filter(id => session.wordIds.includes(id));
      if (session.tasks) {
        session.tasks = session.tasks.filter(task => session.wordIds.includes(task.wordId));
        session.completedSteps = Object.fromEntries(Object.entries(session.completedSteps ?? {}).filter(([id]) => session.wordIds.includes(id)));
      }
      if (!session.wordIds.length) session.completedAt = this.clock().toISOString();
    }
  }
  state(integrations: IntegrationStatus): AppState {
    const data = this.read(), month = monthKey(this.clock()), charges = data.charges.filter(c => c.month === month);
    return { profile: data.profile, settings: data.settings, packs: data.packs, words: data.words, progress: data.progress, attempts: data.attempts,
      activeSession: [...data.sessions].reverse().find(s => !s.completedAt) ?? [...data.sessions].reverse().find(s => s.rewardGranted && s.completedAt && localDay(new Date(s.completedAt)) === localDay(this.clock())) ?? null,
      stickers: data.stickers, integrations, usage: { month, budgetCny: data.settings.monthlyBudgetCny, estimatedCny: Number(charges.reduce((s,c) => s + (c.actual ?? c.reserved), 0).toFixed(6)),
        ttsCharacters: charges.filter(c => c.kind === 'tts').reduce((s,c) => s+c.units, 0), sttSeconds: charges.filter(c => c.kind === 'stt').reduce((s,c) => s+c.units, 0), imageJobs: data.jobs.filter(j => monthKey(new Date(j.createdAt)) === month).length } };
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
        else if (['spellingEnabled','voiceEnabled'].includes(key)) { if (typeof value !== 'boolean') throw new AppError(`设置 ${key} 需要布尔值。`); }
        else throw new AppError(`不支持的设置：${key}`);
        (data.settings as unknown as Record<string, unknown>)[key] = value;
      }
    });
  }
  createPack(title: unknown, rows: unknown) {
    const checked = validateRows(rows); if (checked.errors.length) throw new AppError(checked.errors.join(' '));
    if (typeof title !== 'string' || !title.trim() || title.length > 80) throw new AppError('词表名称需要 1–80 个字。');
    return this.mutate(data => { const pack: WordPack = { id: randomUUID(), title: title.trim(), enabled: false, createdAt: this.clock().toISOString() }; data.packs.push(pack);
      data.words.push(...checked.rows.map(row => {
        const cached = data.words.find(w => w.term.toLowerCase() === row.term.toLowerCase() && w.meaning === row.meaning && w.assetStatus === 'approved' && w.imageSource === 'builtin' && w.imageUrl !== '/assets/placeholder.svg');
        return { ...row, id: randomUUID(), packId: pack.id, imageUrl: cached?.imageUrl ?? '/assets/placeholder.svg', imageSource: 'builtin' as const, assetStatus: cached ? 'approved' as const : 'draft' as const };
      })); return pack; });
  }
  enablePack(id: string, enabled: unknown) { this.mutate(data => { const pack = data.packs.find(p => p.id === id); if (!pack) throw new AppError('找不到词表。', 'NOT_FOUND', 404); if (typeof enabled !== 'boolean') throw new AppError('enabled 需要布尔值。'); pack.enabled = enabled; }); }
  updateWord(id: string, body: Record<string, unknown>, availableImage: (url: string) => boolean) {
    this.mutate(data => {
      const word = data.words.find(w => w.id === id); if (!word) throw new AppError('找不到单词。', 'NOT_FOUND', 404);
      const changed = (body.term !== undefined && body.term !== word.term) || (body.meaning !== undefined && body.meaning !== word.meaning);
      if (changed) { const checked = validateRows([{ term: body.term ?? word.term, meaning: body.meaning ?? word.meaning }]); if (checked.errors.length) throw new AppError(checked.errors.join(' ')); Object.assign(word, checked.rows[0]); word.assetStatus = 'draft'; word.learningResetAt = this.clock().toISOString(); word.learningVersion = (word.learningVersion ?? 0) + 1; data.progress = data.progress.filter(p => p.wordId !== id); }
      if (body.assetStatus !== undefined) {
        if (!['approved','draft','review'].includes(String(body.assetStatus))) throw new AppError('图片状态无效。');
        if (body.assetStatus === 'approved' && (word.imageUrl === '/assets/placeholder.svg' || !availableImage(word.imageUrl))) throw new AppError('请先生成或提供可用的图片，再批准。');
        word.assetStatus = body.assetStatus as Word['assetStatus']; delete word.error;
      }
    });
  }
  startSession() {
    return this.mutate(data => {
      const current = [...data.sessions].reverse().find(s => !s.completedAt); if (current) return current;
      const today = [...data.sessions].reverse().find(s => s.rewardGranted && s.completedAt && localDay(new Date(s.completedAt)) === localDay(this.clock())); if (today) return today;
      const plan = dailyLearningPlan(data, this.clock());
      const session: LearningSession = { id: randomUUID(), wordIds: [...new Set(plan.tasks.map(task => task.wordId))], completedWordIds: [], startedAt: this.clock().toISOString(), rewardGranted: false, tasks: clone(plan.tasks), completedSteps: {}, taskLimit: plan.taskLimit, estimatedMinutes: plan.estimatedMinutes };
      if (!session.wordIds.length) return session;
      data.sessions.push(session); return session;
    });
  }
  attempt(body: Record<string, unknown>) {
    return this.mutate(data => {
      if (typeof body.id === 'string') { const existing = data.attempts.find(a => a.id === body.id); if (existing) return existing; }
      const session = data.sessions.find(s => s.id === body.sessionId);
      if (!session || session.completedAt || !session.wordIds.includes(String(body.wordId))) throw new AppError('这道题不在当前学习中。', 'SESSION_INVALID');
      if (!SKILLS.includes(body.skill as Skill) || typeof body.correct !== 'boolean' || typeof body.hinted !== 'boolean' || !['click','speech','keyboard'].includes(String(body.source))) throw new AppError('学习记录格式无效。');
      if (body.practiceOnly !== undefined && typeof body.practiceOnly !== 'boolean') throw new AppError('体验模式格式无效。');
      if (body.step !== undefined && (!STEPS.includes(body.step as LearningStep) || stepSkill(body.step as LearningStep) !== body.skill)) throw new AppError('答题步骤与学习技能不匹配。');
      const step = (body.step ?? body.skill) as LearningStep;
      const attempt: LearningAttempt = { id: typeof body.id === 'string' && body.id.length <= 100 ? body.id : randomUUID(), wordId: String(body.wordId), sessionId: session.id, skill: body.skill as Skill, step, learningVersion: data.words.find(word => word.id === body.wordId)?.learningVersion ?? 0, correct: body.correct, hinted: body.hinted, source: body.source as LearningAttempt['source'], practiceOnly: body.practiceOnly === true || (body.skill === 'spell' && !data.settings.spellingEnabled), createdAt: this.clock().toISOString() };
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
    });
  }
  updateSession(body: Record<string, unknown>) {
    return this.mutate(data => {
      const session = [...data.sessions].reverse().find(s => !s.completedAt) ?? data.sessions.at(-1); if (!session) throw new AppError('没有进行中的学习。');
      if (body.completedStep !== undefined) {
        const input = body.completedStep as Record<string, unknown>;
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.wordId !== 'string' || !STEPS.includes(input.step as LearningStep) || Object.keys(input).some(key => !['wordId','step'].includes(key))) throw new AppError('完成步骤格式无效。');
        const task = session.tasks?.find(task => task.wordId === input.wordId);
        if (!task) throw new AppError('该步骤不在当前学习计划中。');
        const step = input.step as LearningStep, done = completedStepsFor(session, task.wordId);
        if (!done.includes(step)) {
          if (session.completedAt || session.wordIds.find(id => !session.completedWordIds.includes(id)) !== task.wordId || task.steps[done.length] !== step) throw new AppError('请先完成当前单词的前一步。', 'SESSION_STEP_ORDER');
          if (!stepEvidence(data.attempts, session.id, task.wordId, step)) throw new AppError('请先完成这一题，或选择跟着练习。', 'SESSION_STEP_EVIDENCE');
          session.completedSteps = { ...session.completedSteps, [task.wordId]: [...done, step] };
          if (done.length + 1 === task.steps.length && !session.completedWordIds.includes(task.wordId)) session.completedWordIds.push(task.wordId);
        }
      }
      if (body.completedWordId !== undefined) {
        const id = String(body.completedWordId); if (!session.wordIds.includes(id)) throw new AppError('该单词不在学习中。');
        const task = session.tasks?.find(task => task.wordId === id);
        if (task && completedStepsFor(session,id).length !== task.steps.length) throw new AppError('请先按计划完成这个单词的步骤。', 'SESSION_STEP_ORDER');
        if (!session.completedWordIds.includes(id)) session.completedWordIds.push(id);
      }
      if (body.complete === true) {
        if (!session.wordIds.length || session.completedWordIds.length < session.wordIds.length) throw new AppError('请先完成今天的单词。');
        session.completedAt ??= this.clock().toISOString();
        if (!session.rewardGranted) { data.stickers.push(`sticker-${session.id}`); session.rewardGranted = true; }
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
      Object.assign(data, backup.data); data.charges = [...charges.values()];
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
  if (Object.entries(defaults).some(([key,val]) => typeof d.settings[key] !== typeof val) || Object.values(d.settings).some(val => typeof val === 'number' && (!Number.isFinite(val) || val < 0)) || !count(d.settings.dailyNewWords,20) || d.settings.dailyNewWords < 1 || !count(d.settings.dailyReviewWords,50) || !count(d.settings.sessionMinutes,30) || d.settings.sessionMinutes < 3 || d.settings.monthlyBudgetCny > 10000) throw new AppError('备份设置无效。');
  if (d.packs.length > 20000 || !unique(d.packs) || d.packs.some((p:any) => !text(p.title,80) || !date(p.createdAt) || typeof p.enabled !== 'boolean')) throw new AppError('备份词表无效。');
  const packIds = new Set(d.packs.map((p:any) => p.id));
  if (d.words.length > 20000 || !unique(d.words) || d.words.some((w:any) => !packIds.has(w.packId) || !['approved','draft','review','error','generating'].includes(w.assetStatus) || !['builtin','codex','upload'].includes(w.imageSource) || validateRows([{ term:w.term,meaning:w.meaning }]).errors.length || !media(w.imageUrl) || (w.error !== undefined && !text(w.error,2000)) || (w.learningResetAt !== undefined && !date(w.learningResetAt)) || (w.learningVersion !== undefined && !count(w.learningVersion)))) throw new AppError('备份单词或素材路径无效。');
  const wordIds = new Set(d.words.map((w:any) => w.id));
  if (d.progress.length > 60000 || d.progress.some((p:any) => !p || !wordIds.has(p.wordId) || !SKILLS.includes(p.skill) || !count(p.stage,5) || !date(p.dueAt) || !count(p.successes) || !count(p.attempts))) throw new AppError('备份学习进度无效。');
  if (new Set(d.progress.map((p:any) => `${p.wordId}:${p.skill}`)).size !== d.progress.length) throw new AppError('备份学习进度重复。');
  if (d.sessions.length > 100000 || !unique(d.sessions) || d.sessions.some((s:any) => !Array.isArray(s.wordIds) || !Array.isArray(s.completedWordIds) || s.wordIds.some((id:unknown) => !wordIds.has(id)) || s.completedWordIds.some((id:unknown) => !s.wordIds.includes(id)) || new Set(s.wordIds).size !== s.wordIds.length || new Set(s.completedWordIds).size !== s.completedWordIds.length || !date(s.startedAt) || (s.completedAt !== undefined && !date(s.completedAt)) || typeof s.rewardGranted !== 'boolean')) throw new AppError('备份学习会话无效。');
  if (d.sessions.some((s:any) => {
    if (s.tasks === undefined) return ['completedSteps','taskLimit','estimatedMinutes'].some(key => s[key] !== undefined);
    if (!Array.isArray(s.tasks) || s.tasks.length !== s.wordIds.length || !s.completedSteps || typeof s.completedSteps !== 'object' || Array.isArray(s.completedSteps) || !count(s.taskLimit,100000) || !finite(s.estimatedMinutes)) return true;
    if (s.tasks.some((task:any,index:number) => !task || task.wordId !== s.wordIds[index] || !['new','review'].includes(task.mode) || !Array.isArray(task.steps) || !task.steps.length || task.steps.length > STEPS.length || new Set(task.steps).size !== task.steps.length || task.steps.some((step:any) => !STEPS.includes(step)))) return true;
    if (s.tasks.reduce((sum:number,task:any) => sum + task.steps.length,0) > s.taskLimit || Object.keys(s.completedSteps).some(id => !s.wordIds.includes(id))) return true;
    let previousComplete = true;
    for (const task of s.tasks) {
      const done = Object.hasOwn(s.completedSteps,task.wordId) ? s.completedSteps[task.wordId] : [];
      if (!Array.isArray(done) || done.length > task.steps.length || done.some((step:any,index:number) => step !== task.steps[index]) || (!previousComplete && done.length)) return true;
      const complete = done.length === task.steps.length;
      if (s.completedWordIds.includes(task.wordId) !== complete) return true;
      previousComplete = previousComplete && complete;
    }
    return s.rewardGranted && (!s.completedAt || s.completedWordIds.length !== s.wordIds.length);
  })) throw new AppError('备份学习任务或完成步骤无效。');
  const sessionIds = new Set(d.sessions.map((s:any) => s.id));
  if (d.attempts.length > 1_000_000 || !unique(d.attempts) || d.attempts.some((a:any) => !wordIds.has(a.wordId) || !sessionIds.has(a.sessionId) || !SKILLS.includes(a.skill) || !['click','speech','keyboard'].includes(a.source) || typeof a.correct !== 'boolean' || typeof a.hinted !== 'boolean' || (a.practiceOnly !== undefined && typeof a.practiceOnly !== 'boolean') || (a.learningVersion !== undefined && !count(a.learningVersion)) || (a.step !== undefined && (!STEPS.includes(a.step) || stepSkill(a.step) !== a.skill)) || !date(a.createdAt))) throw new AppError('备份答题记录无效。');
  const evidenceKeys = new Set<string>(d.attempts.filter((a:LearningAttempt) => a.step && (a.correct || a.practiceOnly)).map((a:LearningAttempt) => JSON.stringify([a.sessionId,a.wordId,a.step])));
  if (d.sessions.some((session:LearningSession) => session.tasks?.some(task => completedStepsFor(session,task.wordId).some(step => step !== 'learn' && !evidenceKeys.has(JSON.stringify([session.id,task.wordId,step])))))) throw new AppError('备份完成步骤缺少答题或练习记录。');
  if (d.jobs.length > 100000 || !unique(d.jobs) || d.jobs.some((j:any) => !wordIds.has(j.wordId) || !['queued','running','review','error','cancelled'].includes(j.status) || !date(j.createdAt) || (j.imageUrl !== undefined && !media(j.imageUrl)) || (j.error !== undefined && !text(j.error,2000)))) throw new AppError('备份图片任务无效。');
  if (d.charges.length > 1_000_000 || !unique(d.charges) || d.charges.some((c:any) => !/^\d{4}-\d{2}$/.test(c.month) || !['tts','stt'].includes(c.kind) || !finite(c.reserved) || (c.actual !== undefined && !finite(c.actual)) || !finite(c.units)) || d.stickers.some((s:unknown) => !text(s,120))) throw new AppError('备份用量或奖励记录无效。');
  const files = value.files as { path: string; content: string }[];
  const seenPaths = new Set<string>(); let totalBytes = 0;
  if (files.length > 20000 || files.some(f => { if (!f || typeof f.path !== 'string' || !safeRelative(f.path) || typeof f.content !== 'string' || f.content.length > 30_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.content) || seenPaths.has(f.path.toLowerCase())) return true; seenPaths.add(f.path.toLowerCase()); totalBytes += f.content.length; return totalBytes > 55_000_000; })) throw new AppError('备份素材格式不正确、路径重复或总量过大。');
  const pick = (object: Record<string,unknown>, keys:string[]) => Object.fromEntries(keys.filter(key => object[key] !== undefined).map(key => [key,object[key]]));
  const clean = { version: 1, profile: pick(d.profile,['nickname','interests','interestVersion','onboardingCompleted']), settings:pick(d.settings,Object.keys(defaults)),
    packs:d.packs.map((p:any)=>pick(p,['id','title','enabled','createdAt'])), words:d.words.map((w:any)=>pick(w,['id','packId','term','meaning','imageUrl','assetStatus','imageSource','error','learningResetAt','learningVersion'])),
    progress:d.progress.map((p:any)=>pick(p,['wordId','skill','stage','dueAt','successes','attempts'])), attempts:d.attempts.map((a:any)=>pick(a,['id','wordId','sessionId','skill','step','learningVersion','correct','hinted','practiceOnly','source','createdAt'])),
    sessions:d.sessions.map((s:any)=>({...pick(s,['id','wordIds','completedWordIds','startedAt','completedAt','rewardGranted','taskLimit','estimatedMinutes']),...(s.tasks === undefined ? {} : {tasks:s.tasks.map((task:any)=>pick(task,['wordId','mode','steps'])),completedSteps:Object.fromEntries(Object.entries(s.completedSteps).map(([id,steps])=>[id,steps]))})})), stickers:d.stickers,
    jobs:d.jobs.map((j:any)=>pick(j,['id','wordId','status','error','imageUrl','createdAt'])), charges:d.charges.map((c:any)=>pick(c,['id','month','reserved','actual','kind','units'])) } as unknown as StoredData;
  return { data: clean, files };
}
