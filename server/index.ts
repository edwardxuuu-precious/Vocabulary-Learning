import { readyGameMaterialKeys } from './game-material-readiness.ts';
import { dailyLearningPlan,supplementalLearningPlan } from '../shared/learning.ts';
import { materialCues,validGameMaterial } from '../shared/game-materials.ts';
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError, Store, parseImport, safeRelative } from './store.ts';
import * as providers from './integrations/index.ts';
import { validateTtsInput, validateWav as validateSpeechWav } from './integrations/speech.ts';
import { createDialogueProvider } from './integrations/dialogue.ts';
import { attachLiveVoice } from './live-voice.ts';
import { validateChatReply, validateChatRequest } from './chat-policy.ts';
import type { ChatStreamEvent, IllustrationJob, IntegrationStatus, VoiceTone, Word } from '../shared/contracts.ts';
import { CHAT_ENABLED } from '../shared/features.ts';
import { createPackAudioManager } from './pack-audio.ts';
import { createPackImageManager } from './pack-images.ts';
import { createImportPreparation } from './import-preparation.ts';
import { isEnrichedRow } from '../shared/vocabulary.ts';
import { visualTheme } from '../shared/visual-theme.ts';
import { ParentGate } from './parent-gate.ts';
import { AssessmentGrants } from './assessment-grants.ts';
import { createChallengeManager, type ChallengeServices } from './challenges.ts';
import type { GamePlanOptions } from '../shared/game-registry.ts';
import { createPracticeRecordings } from './practice-recordings.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(projectRoot, '.env');
if (existsSync(envPath)) { try { process.loadEnvFile(envPath); } catch { console.error('无法读取 .env，请检查格式。'); } }
const unavailable: IntegrationStatus = {
  speech: { configured: false, available: false, status: 'checking', detail: '正在检查语音配置。' },
  codex: { configured: false, available: false, status: 'checking', detail: '正在检查 Codex 本机状态。' },
};
type Providers = typeof providers;
interface ImageSnapshot { term:string; meaning:string; partOfSpeech?:Word['partOfSpeech']; pictureHint?:string; assetStatus:Word['assetStatus']; interests:string[]; interestVersion:number }
type AppDialogue=Omit<ReturnType<typeof createDialogueProvider>,'prepare'|'prepareTurn'|'cancelPreparation'>&{prepare?:(conversationId?:string)=>Promise<unknown>;prepareTurn?:(conversationId?:string)=>Promise<void>;cancelPreparation?:()=>Promise<void>};
export interface AppOptions { rootDir?: string; dataDir?: string; integrations?: Partial<Providers>; dialogue?: AppDialogue; clock?: () => Date; diagnostics?: boolean; chatEnabled?: boolean; learningGames?: GamePlanOptions; challengeServices?: ChallengeServices }

export function createApp(options: AppOptions = {}) {
  const rootDir = options.rootDir ?? projectRoot;
  const dataDir = path.resolve(options.dataDir ?? process.env.PLAYROOM_DATA_DIR ?? path.join(rootDir, 'data'));
  const store = new Store(dataDir, options.clock);
  const parentGate = new ParentGate(dataDir);
  const assessmentGrants = new AssessmentGrants(options.clock ? () => options.clock!().getTime() : Date.now);
  const practiceRecordings = createPracticeRecordings(store);
  const integration = { ...providers, ...options.integrations };
  const dialogue:AppDialogue = options.dialogue ?? createDialogueProvider({ dataDir });
  const chatEnabled = options.chatEnabled ?? CHAT_ENABLED;
  const disabledChat = { configured: false, available: false, status: 'disabled', provider: 'codex' as const, detail: '当前只提供单词发音，聊天已关闭。' };
  let preparationStarted=false;
  let chatController: AbortController | undefined;
  let preparationLease:{id:string;timer:ReturnType<typeof setTimeout>;pending:Promise<void>}|undefined;
  const cancelledPreparations=new Set<string>();
  function rememberCancelledPreparation(id:string){cancelledPreparations.add(id);if(cancelledPreparations.size>128)cancelledPreparations.delete(cancelledPreparations.values().next().value!);}
  function claimPreparation(){if(preparationLease)clearTimeout(preparationLease.timer);preparationLease=undefined;}
  async function releasePreparation(id?:string){
    if(id)rememberCancelledPreparation(id);
    if(!preparationLease||id&&preparationLease.id!==id)return;
    claimPreparation();
    if(!chatController)await dialogue.cancelPreparation?.();
  }
  let status: IntegrationStatus = structuredClone(unavailable), statusTime = 0, statusPromise: Promise<IntegrationStatus> | null = null;
  const controllers = new Map<string, AbortController>();
  const imageSnapshots = new Map<string, ImageSnapshot>();
  const imageRuns = new Map<string, Promise<void>>();
  const batchImageControllers = new Map<string, AbortController>();
  const ttsControllers=new Set<AbortController>();
  let closed = false;
  async function serviceStatus(refresh = false): Promise<IntegrationStatus> {
    if (!refresh && Date.now() - statusTime < 30_000) return status;
    if (!statusPromise) statusPromise = Promise.all([integration.probeIntegrations(), chatEnabled ? dialogue.status().catch(() => ({ configured: false, available: false, status: 'error', provider: 'codex' as const, detail: 'Codex 对话状态检查失败，请重试。' })) : Promise.resolve(disabledChat)]).then(([result, chat]) => { status = { ...result, dialogue: chat }; statusTime = Date.now(); if(chatEnabled&&!preparationStarted&&!closed){preparationStarted=true;void dialogue.prepare?.().catch(()=>{});}return status; }).catch(() => { status = { speech: { configured: false, available: false, status: 'error', detail: '服务配置检查失败，请稍后再试。' }, codex: { configured: false, available: false, status: 'error', detail: 'Codex 状态检查失败，请检查安装或登录状态。' }, dialogue: chatEnabled ? { configured: false, available: false, status: 'error', provider: 'codex', detail: 'Codex 对话状态暂不可用。' } : disabledChat }; statusTime = Date.now(); return status; }).finally(() => { statusPromise = null; });
    return statusPromise!;
  }
  const state = async () => store.state(await serviceStatus());
  function toMediaUrl(filePath: string): string {
    const absolute = path.resolve(filePath), relative = path.relative(dataDir, absolute).split(path.sep).join('/');
    if (!safeRelative(relative) || !existsSync(absolute) || !realpathSync(absolute).startsWith(realpathSync(dataDir) + path.sep)) throw new AppError('生成素材不在允许的本地目录。', 'MEDIA_INVALID', 500);
    return '/media/' + relative.split('/').map(encodeURIComponent).join('/');
  }
  const packAudio = createPackAudioManager({ store, integration, dataDir, toMediaUrl });
  const challenges = createChallengeManager({ store, dataDir, imageAvailable: availableImage, services: options.challengeServices });
  const imports = createImportPreparation({ dataDir, enrich: integration.enrichVocabulary });
  function availableImage(url: string) {
    try {
      if (url.startsWith('/assets/')) { const absolute = path.resolve(rootDir, 'public', '.' + decodeURIComponent(url)); return absolute.startsWith(path.join(rootDir, 'public', 'assets') + path.sep) && existsSync(absolute); }
      if (url.startsWith('/media/')) { const relative = decodeURIComponent(url.slice(7)); return safeRelative(relative) && existsSync(path.join(dataDir, relative)); }
    } catch { return false; }
    return false;
  }
  function restoreImageStatus(word:Word, snapshot:ImageSnapshot, fallback:Word['assetStatus']) {
    if (word.term !== snapshot.term || word.meaning !== snapshot.meaning || word.partOfSpeech !== snapshot.partOfSpeech || word.pictureHint !== snapshot.pictureHint || word.assetStatus === 'draft') { word.assetStatus = 'draft'; return; }
    if (word.assetStatus === 'generating') word.assetStatus = availableImage(word.imageUrl) && word.imageUrl !== '/assets/placeholder.svg' ? snapshot.assetStatus : fallback;
  }
  async function runImage(job: IllustrationJob, snapshot: ImageSnapshot) {
    const controller = new AbortController(); controllers.set(job.id, controller);
    try {
      if (closed) return;
      const currentData = store.read();
      if (!currentData.words.some(w => w.id === job.wordId)) throw new AppError('单词已经不存在。');
      if (currentData.jobs.find(j => j.id === job.id)?.status === 'cancelled') return;
      store.mutate(data => { const current = data.jobs.find(j => j.id === job.id); if (current) current.status = 'running'; });
      const outputDir = path.join(dataDir, 'images', job.id); mkdirSync(outputDir, { recursive: true });
      const generated = await integration.generateIllustration({ jobId: job.id, term: snapshot.term, meaning: snapshot.meaning, partOfSpeech: snapshot.partOfSpeech, pictureHint: snapshot.pictureHint, interests: snapshot.interests, outputDir, signal: controller.signal });
      if (controller.signal.aborted || closed) return;
      const imageUrl = toMediaUrl(generated.filePath);
      store.mutate(data => {
        const current = data.jobs.find(j => j.id === job.id), currentWord = data.words.find(w => w.id === job.wordId);
        if (!current || current.status === 'cancelled' || !currentWord) return;
        current.status = 'review'; current.imageUrl = imageUrl;
        if (currentWord.term !== snapshot.term || currentWord.meaning !== snapshot.meaning || currentWord.partOfSpeech !== snapshot.partOfSpeech || currentWord.pictureHint !== snapshot.pictureHint || currentWord.assetStatus !== 'generating' || data.profile.interestVersion !== snapshot.interestVersion) { current.status = 'error'; current.error = '生成期间单词、素材状态或兴趣有变动，请按新内容重新生成。'; restoreImageStatus(currentWord,snapshot,'error'); return; }
        currentWord.imageUrl = imageUrl; currentWord.imageSource = 'codex'; currentWord.imageTheme = visualTheme.id; currentWord.assetStatus = 'review'; delete currentWord.error;
      });
    } catch (error) {
      if (closed) return;
      store.mutate(data => {
        const current = data.jobs.find(j => j.id === job.id), word = data.words.find(w => w.id === job.wordId);
        if (!current || current.status === 'cancelled') return;
        current.status = controller.signal.aborted ? 'cancelled' : 'error'; current.error = publicMessage(error);
        if (word) { restoreImageStatus(word,snapshot,'error'); word.error = current.error; }
      });
    } finally { controllers.delete(job.id); imageSnapshots.delete(job.id); }
  }
  function enqueueImage(id: string) {
    const result = store.mutate(data => {
      const word = data.words.find(w => w.id === id); if (!word) throw new AppError('找不到单词。', 'NOT_FOUND', 404);
      const existing = data.jobs.find(j => j.wordId === id && ['queued','running'].includes(j.status)); if (existing) return { job: existing, run: false };
      if (data.jobs.filter(j => ['queued','running'].includes(j.status)).length >= 3) throw new AppError('已有 3 个图片任务，请稍后再试。', 'QUEUE_FULL', 429);
      const snapshot: ImageSnapshot = { term:word.term, meaning:word.meaning, partOfSpeech:word.partOfSpeech, pictureHint:word.pictureHint, assetStatus:word.assetStatus, interests:[...data.profile.interests], interestVersion:data.profile.interestVersion };
      const job: IllustrationJob = { id:randomUUID(), wordId:id, status:'queued', createdAt:store.clock().toISOString() };
      data.jobs.push(job); word.assetStatus='generating'; delete word.error; return { job, snapshot, run:true };
    });
    if (result.run && result.snapshot) {
      const snapshot=result.snapshot; imageSnapshots.set(result.job.id,snapshot);
      const pending = new Promise<void>(resolve => setImmediate(() => { void runImage(result.job,snapshot).then(resolve,resolve); }));
      imageRuns.set(result.job.id,pending);
      void pending.finally(() => imageRuns.delete(result.job.id));
    }
    return { job:result.job, done:imageRuns.get(result.job.id) ?? Promise.resolve() };
  }
  function cancelImageJob(id:string) {
    controllers.get(id)?.abort();
    store.mutate(data => {
      const job=data.jobs.find(j=>j.id===id);if(!job)throw new AppError('找不到图片任务。','NOT_FOUND',404);
      if(!['queued','running'].includes(job.status))return;
      job.status='cancelled';
      const word=data.words.find(w=>w.id===job.wordId),snapshot=imageSnapshots.get(id);
      if(word&&snapshot)restoreImageStatus(word,snapshot,'draft');else if(word?.assetStatus==='generating')word.assetStatus='draft';
    });
  }
  const packImages=createPackImageManager({store,
    runWord:async (id:string)=>{
      const pending=new AbortController();batchImageControllers.set(id,pending);
      try {
        // Cancel may arrive during the account check, before an illustration job exists.
        const services=await serviceStatus();
        if(pending.signal.aborted||closed)throw new AppError('图片准备已停止。','CANCELLED',409);
        if(!services.codex.configured)throw new AppError('请先连接现有 Codex 账号，再继续准备图片。','CODEX_LOGIN_REQUIRED',503);
        const queued=enqueueImage(id);await queued.done;
        return store.read().jobs.find(job=>job.id===queued.job.id)!;
      } finally { if(batchImageControllers.get(id)===pending)batchImageControllers.delete(id); }
    },
    cancelWord:(id:string)=>{batchImageControllers.get(id)?.abort();for(const job of store.read().jobs.filter(job=>job.wordId===id&&['queued','running'].includes(job.status)))cancelImageJob(job.id);},
  });
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new AppError('仅允许本机访问。', 'HOST_FORBIDDEN', 403);
      const origin = req.headers.origin;
      const allowed = new Set([`http://${host}`, 'http://localhost:5173', 'http://127.0.0.1:5173', ...(process.env.DEV_WEB_ORIGIN ? [process.env.DEV_WEB_ORIGIN] : [])]);
      if (origin && allowed.has(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) {
        if ((origin && !allowed.has(origin)) || req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('请求来源不被允许。', 'ORIGIN_FORBIDDEN', 403);
      }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization'); res.writeHead(204); res.end(); return; }
      const url = new URL(req.url ?? '/', `http://${host}`), route = url.pathname;
      if (route.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'GET' && route === '/api/health') return json(res, { ok: true, app: 'little-word-playroom', status: 'ok', local: true });
      if (req.method === 'GET' && route === '/api/parent-gate') return json(res, parentGate.status());
      if (req.method === 'POST' && route === '/api/parent-gate') return json(res, { ...parentGate.setup((await readJson(req, 1024)).pin), assessmentGrant: assessmentGrants.issue() });
      if (req.method === 'POST' && route === '/api/parent-gate/unlock') return json(res, { ...parentGate.unlock((await readJson(req, 1024)).pin), assessmentGrant: assessmentGrants.issue() });
      if (req.method === 'POST' && route === '/api/parent-gate/assessment/revoke') { assessmentGrants.revoke(req.headers.authorization); return json(res, { ok: true }); }
      if (req.method === 'PATCH' && route === '/api/parent-gate/pin') {
        const body = await readJson(req, 1024);
        const changed = parentGate.change(body.currentPin, body.pin); assessmentGrants.clear(); return json(res, changed);
      }
      const assessmentMatch = route.match(/^\/api\/assessments\/([^/]+)(?:\/(actions|responses|recordings|submit|review|retry|audio))?$/);
      if (route === '/api/assessments' || assessmentMatch) {
        if (req.method === 'POST' && route === '/api/assessments') {
          const body = await readJson(req, 4096);
          if (body.workflow === 'parent') { assessmentGrants.require(req.headers.authorization); delete body.workflow; return json(res, store.createAssessment(body)); }
          return json(res, store.createAssessment({ ...body, workflow: 'recorded' }));
        }
        const id = assessmentMatch ? decodeURIComponent(assessmentMatch[1]) : '';
        const session = store.read().assessments?.find(session => session.id === id);
        if (!session) throw new AppError('找不到这轮测试。', 'NOT_FOUND', 404);
        const operation = assessmentMatch?.[2];
        if (session.workflow !== 'recorded' || ['review', 'retry', 'audio'].includes(operation ?? '')) assessmentGrants.require(req.headers.authorization);
        if (req.method === 'GET' && assessmentMatch && !assessmentMatch[2]) {
          return json(res, session);
        }
        if (req.method === 'POST' && operation === 'actions') return json(res, store.assessmentAction(id, await readJson(req, 4096), availableImage));
        if (req.method === 'POST' && operation === 'responses') return json(res, challenges.respond(id, await readJson(req, 4096)));
        if (req.method === 'POST' && operation === 'recordings') {
          if (req.headers['content-type'] !== 'audio/wav') throw new AppError('录音必须是 WAV。');
          const version = Number(url.searchParams.get('version'));
          if (!url.searchParams.has('version') || !Number.isSafeInteger(version) || version < 0) throw new AppError('录音版本无效。');
          return json(res, challenges.upload(id, url.searchParams.get('itemId') ?? '', version, await readBody(req, 640044)));
        }
        if (req.method === 'POST' && operation === 'submit') return json(res, challenges.submit(id));
        if (req.method === 'POST' && operation === 'review') return json(res, challenges.review(id, await readJson(req, 12000)));
        if (req.method === 'POST' && operation === 'retry') return json(res, challenges.retry(id));
        if (req.method === 'GET' && operation === 'audio') { const audio = challenges.audio(id, url.searchParams.get('itemId') ?? ''); res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length }); res.end(audio); return; }
        throw new AppError('不支持该测试操作。', 'METHOD_NOT_ALLOWED', 405);
      }
      if (req.method === 'GET' && route === '/api/state') return json(res, await state());
      if(route==='/api/practice-recordings'||/^\/api\/practice-recordings\/[^/]+\/audio$/.test(route)){
        const target=url.searchParams.has('sessionId')?{sessionId:url.searchParams.get('sessionId')??'',activityId:url.searchParams.get('activityId')??''}:undefined;
        if(!target||req.headers.authorization)assessmentGrants.require(req.headers.authorization);
        if(req.method==='GET'&&route==='/api/practice-recordings')return json(res,practiceRecordings.list(target));
        if(req.method==='POST'&&route==='/api/practice-recordings'&&target){
          if(req.headers['content-type']!=='audio/wav')throw new AppError('请上传本机录制的WAV声音。');
          return json(res,practiceRecordings.upload(target,url.searchParams.get('takeId')??'',await readBody(req,640044)));
        }
        if(req.method==='GET'&&route.endsWith('/audio')){const audio=practiceRecordings.audio(decodeURIComponent(route.split('/')[3]),target);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length});res.end(audio);return;}
        throw new AppError('不支持该录音操作。','METHOD_NOT_ALLOWED',405);
      }
      if (!chatEnabled && route.startsWith('/api/chat/')) {
        if (req.method === 'GET' && route === '/api/chat/status') return json(res, disabledChat);
        throw new AppError('当前聊天已关闭，请直接学习单词。', 'CHAT_DISABLED', 409);
      }
      if (req.method === 'GET' && route === '/api/chat/status') return json(res, await dialogue.status());
      if(req.method==='POST'&&(route==='/api/chat/prepare'||route==='/api/chat/prepare/cancel')){
        const body=await readJson(req,1024);
        if(typeof body.preparationId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(body.preparationId)||Object.keys(body).some(key=>!['preparationId','conversationId'].includes(key))||body.conversationId!==undefined&&(typeof body.conversationId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(body.conversationId)))throw new AppError('对话准备编号无效。');
        const id=body.preparationId;
        if(route.endsWith('/cancel')){await releasePreparation(id);return json(res,{ok:true});}
        if(closed||chatController||cancelledPreparations.has(id)||!dialogue.prepareTurn)return json(res,{prepared:false});
        if(preparationLease?.id===id){await preparationLease.pending;return json(res,{prepared:preparationLease?.id===id});}
        await releasePreparation();
        if(closed||chatController||cancelledPreparations.has(id)||preparationLease)return json(res,{prepared:false});
        const lease={id,timer:setTimeout(()=>{void releasePreparation(id).catch(()=>{});},60000),pending:Promise.resolve()};lease.timer.unref();preparationLease=lease;
        lease.pending=dialogue.prepareTurn(body.conversationId as string|undefined);
        try{await lease.pending;return json(res,{prepared:preparationLease===lease});}
        catch(error){if(preparationLease===lease)claimPreparation();throw error;}
      }
      if (req.method === 'POST' && route === '/api/chat/cancel') { chatController?.abort(); await releasePreparation(); await dialogue.cancel(); statusTime = 0; return json(res, { ok: true }); }
      if (req.method === 'POST' && route === '/api/chat/reset') { chatController?.abort(); claimPreparation(); await dialogue.reset(); statusTime = 0; return json(res, { ok: true }); }
      if (req.method === 'POST' && route === '/api/chat/turn') {
        const input = validateChatRequest(await readJson(req, 8_192));
        if (chatController) throw new AppError('小栗还在想上一句话，可以先点停止。', 'CODEX_BUSY', 409);
        const data = store.read();
        if (input.context.wordId && !data.words.some(w => w.id === input.context.wordId && w.assetStatus === 'approved')) throw new AppError('当前单词没有准备好。');
        const controller = new AbortController(); chatController = controller;
        claimPreparation(); // The real turn takes ownership of an in-flight restoration, without cancelling it.
        let done = false;
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        const event = (value: ChatStreamEvent) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(value)}\n\n`); };
        const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n'); }, 10_000);
        res.on('close', () => { if (!done) controller.abort(); });
        try {
          const result = await dialogue.turn({ ...input, profile: data.profile, words: data.words.filter(w => w.assetStatus === 'approved' && data.packs.some(p => p.id === w.packId && p.enabled)) }, { signal: controller.signal, onStatus: stage => event({ type: 'status', stage }),onTiming:options.diagnostics?timing=>event({type:'timing',phase:timing.phase,elapsedMs:Math.round(timing.elapsedMs)}):undefined });
          if (!controller.signal.aborted) event({ type: 'reply', conversationId: result.conversationId, reply: validateChatReply(result.reply, input.message) });
        } catch (error) {
          if (!controller.signal.aborted) event({ type: 'error', code: String((error as {code?:string})?.code ?? 'CODEX_UNAVAILABLE'), message: publicMessage(error) });
        } finally {
          done = true; clearInterval(heartbeat); statusTime = 0;
          if (chatController === controller) chatController = undefined;
          event({ type: 'done' }); res.end();
        }
        return;
      }
      if (req.method === 'GET' && route === '/api/jobs') return json(res, { jobs: store.read().jobs });
      if (req.method === 'GET' && route === '/api/backup') { res.setHeader('Content-Disposition', 'attachment; filename="word-playroom-backup.json"'); return json(res, store.exportBackup()); }
      if (req.method === 'POST' && route === '/api/speech/stt') {
        const audio = await readBody(req, 4_000_000), seconds = validateWav(audio), locale = url.searchParams.get('locale') ?? 'zh-CN';
        if (!['zh-CN','en-US'].includes(locale)) throw new AppError('仅支持中文或英文识别。');
        const services = await serviceStatus(), configured = (services.stt ?? services.speech).configured;
        const charge = store.reserve('stt', configured ? integration.estimateSttCost(seconds) : 0, configured ? seconds : 0);
        const result = await integration.transcribeSpeech({ audio, locale: locale as 'zh-CN' | 'en-US' }); store.settle(charge, result.costCny);
        return json(res, { transcript: result.transcript, status: result.status, message: result.message });
      }
      if (req.method === 'POST' && (route === '/api/speech/tts' || route === '/api/speech/tts/stream')) {
        const streamed=route.endsWith('/stream');
        const body = await readJson(req);
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1000 || !['zh-CN','en-US'].includes(String(body.locale))) throw new AppError('语音文字或语言无效，最多 500 个字符。');
        if (body.rate !== undefined && (typeof body.rate !== 'number' || body.rate < 0.5 || body.rate > 1.5)) throw new AppError('朗读速度需要在 0.5–1.5 之间。');
        validateTtsInput({ text:body.text, locale:body.locale as 'zh-CN'|'en-US', rate:body.rate as number|undefined });
        if (body.tone !== undefined && !['curious','cheerful','gentle','excited','clear'].includes(String(body.tone))) throw new AppError('语音风格无效。');
        const ttsController = new AbortController();
        ttsControllers.add(ttsController);
        const cancelTts = () => { if (!res.writableEnded) ttsController.abort(); };
        res.on('close', cancelTts);
        try{
          const ttsInput = { text: body.text, locale: body.locale as 'zh-CN' | 'en-US', rate: body.rate as number | undefined, tone: body.tone as VoiceTone | undefined, dataDir,signal:ttsController.signal, freeOnly: body.locale === 'zh-CN' };
          const cached = await integration.getCachedSpeech(ttsInput);
          if(ttsController.signal.aborted||closed)throw new AppError('朗读已停止。','CANCELLED',409);
          if(cached){
            const mediaUrl=toMediaUrl(cached);
            if(!streamed)return json(res, { audioUrl: mediaUrl, mode: 'api', cached: true });
            res.writeHead(200,{'Content-Type':'audio/mpeg','X-TTS-Cached':'true','X-TTS-Mode':'api','Content-Length':statSync(cached).size,'Cache-Control':'no-store'});
            await pipeline(createReadStream(cached),res,{signal:ttsController.signal});return;
          }
          if (body.cacheOnly === true) throw new AppError('这个单词的缓存发音暂不可用，可以跳过后继续。', 'AUDIO_CACHE_MISSING', 409);
          const services = await serviceStatus(), configured = (services.tts ?? services.speech).configured;
          if(ttsController.signal.aborted||closed)throw new AppError('朗读已停止。','CANCELLED',409);
          if(streamed){
            if(!configured)throw new AppError('云端朗读尚未配置完整，可以使用本机朗读。','SPEECH_STREAM_UNAVAILABLE',503);
            let charge:string|undefined;
            const audio=await integration.streamSpeech({...ttsInput,beforeRequest:()=>{if(ttsController.signal.aborted||closed)throw new AppError('朗读已停止。','CANCELLED',409);charge=store.reserve('tts',integration.estimateTtsCost(body.text as string),(body.text as string).length);}});
            try{
              if(ttsController.signal.aborted||closed)throw new AppError('朗读已停止。','CANCELLED',409);
              if(audio.contentType!=='audio/mpeg')throw new AppError('语音流格式无效。','SPEECH_INVALID_RESPONSE',502);
              res.writeHead(200,{'Content-Type':'audio/mpeg','X-TTS-Cached':String(audio.cached),'X-TTS-Mode':'api','Cache-Control':'no-store','X-Accel-Buffering':'no'});
              res.flushHeaders();
              await pipeline(Readable.from(audio.stream),res,{signal:ttsController.signal,end:false});
              const result=await audio.completed;
              if(charge&&!closed)store.settle(charge,result.costCny,body.text.length);
              res.end();return;
            }catch(error){audio.cancel();if(res.headersSent)res.destroy();throw error;}
          }
          // ElevenLabs arbitrates stream and file callers in one in-flight map. Reserve only for its actual request owner.
          const selectedTts=services.tts??services.speech;
          let charge:string|undefined;
          const reserve=()=>{if(ttsController.signal.aborted||closed)throw new AppError('朗读已停止。','CANCELLED',409);charge=store.reserve('tts',configured?integration.estimateTtsCost(body.text as string):0,configured?(body.text as string).length:0);};
          if(selectedTts.provider!=='elevenlabs')reserve();
          const result = await integration.synthesizeSpeech({...ttsInput,...(selectedTts.provider==='elevenlabs'?{beforeRequest:reserve}:{})});
          if(charge&&!closed)store.settle(charge, result.costCny, result.mode === 'local' ? 0 : body.text.length);
          return json(res, { audioUrl: result.filePath ? toMediaUrl(result.filePath) : undefined, mode: result.mode, cached: result.cached, message: result.message });
        }finally{res.off('close',cancelTts);ttsControllers.delete(ttsController);}
      }
      if (req.method === 'POST' && route === '/api/integrations/codex/connect') { const result = await integration.beginCodexLogin(); statusTime = 0; return json(res, result); }
      if (req.method === 'POST' && route === '/api/import/preview') return json(res, parseImport((await readJson(req)).text));
      if (req.method === 'POST' && route === '/api/import/enrich') { const body = await readJson(req); return json(res, imports.start(body.text, body.rows), 202); }
      const importMatch = route.match(/^\/api\/import\/enrich\/([^/]+)(\/cancel)?$/);
      if (importMatch) {
        const id = decodeURIComponent(importMatch[1]);
        if (req.method === 'GET' && !importMatch[2]) return json(res, imports.get(id));
        if (req.method === 'POST' && importMatch[2]) return json(res, await imports.cancel(id));
      }
      if (req.method === 'POST' && route === '/api/profile') { store.updateProfile(await readJson(req)); return json(res, await state()); }
      if (req.method === 'PATCH' && route === '/api/settings') { store.updateSettings(await readJson(req)); return json(res, await state()); }
      if (req.method === 'POST' && route === '/api/packs') {
        const body = await readJson(req);
        if (body.requireEnriched === true && (!Array.isArray(body.rows) || !body.rows.length || body.rows.some(row => !row || typeof row.meaning !== 'string' || !isEnrichedRow(row)))) throw new AppError('请先补全并确认每个词的中文、词性和配图思路。', 'VOCABULARY_INCOMPLETE');
        if (body.imageTheme !== undefined && body.imageTheme !== visualTheme.id) throw new AppError('图片主题已经更新，请刷新后重新确认。', 'IMAGE_THEME_CHANGED', 409);
        const pack = store.createPack(body.title, body.rows, body.imageTheme);
        // Confirmation saves the pack even if preparation cannot start. GET audio exposes actual cache readiness.
        try { await packAudio.start(pack.id); } catch { /* Another pack or unavailable service never rolls back confirmed rows. */ }
        packImages.start(pack.id);
        return json(res, await state());
      }
      const packImageMatch=route.match(/^\/api\/packs\/([^/]+)\/images(?:\/(cancel|approve))?$/);
      if(packImageMatch){
        const id=decodeURIComponent(packImageMatch[1]),action=packImageMatch[2];
        if(req.method==='GET'&&!action)return json(res,packImages.getStatus(id));
        if(req.method==='POST'){
          if(action==='approve'){
            const body=await readJson(req),pack=store.read().packs.find(pack=>pack.id===id);
            if(pack?.enabled&&!pack.isSample&&Array.isArray(body.selections)){
              const audio=await packAudio.getStatus(id);
              if(body.selections.some(item=>!item||typeof item.wordId!=='string'||!audio.words.find(word=>word.wordId===item.wordId)?.cached))throw new AppError('请先补齐所选单词的发音，再交给孩子学习。','PACK_AUDIO_PENDING');
            }
            store.reviewPackImages(id,body.selections,availableImage);return json(res,await state());
          }
          return json(res,action==='cancel'?await packImages.cancel(id):packImages.start(id));
        }
      }
      const packAudioMatch = route.match(/^\/api\/packs\/([^/]+)\/audio(\/cancel)?$/);
      if (packAudioMatch) {
        const id = decodeURIComponent(packAudioMatch[1]);
        if (req.method === 'GET' && !packAudioMatch[2]) return json(res, await packAudio.getStatus(id));
        if (req.method === 'POST') return json(res, packAudioMatch[2] ? await packAudio.cancel(id) : await packAudio.start(id));
      }
      const packMatch = route.match(/^\/api\/packs\/([^/]+)$/);
      if (req.method === 'PATCH' && packMatch) {
        const id = decodeURIComponent(packMatch[1]), body = await readJson(req);
        if (body.enabled === true) {
          const pack = store.read().packs.find(item => item.id === id);
          if (!pack) throw new AppError('找不到词表。', 'NOT_FOUND', 404);
          if (!pack.isSample) {
            const words = store.read().words.filter(word => word.packId === id && word.assetStatus === 'approved');
            if (!words.length) throw new AppError('请先准备并确认至少一张单词图片。', 'PACK_IMAGES_PENDING');
            const audio = await packAudio.getStatus(id);
            if (words.some(word => !audio.words.some(item => item.wordId === word.id && item.cached))) throw new AppError('可学习单词的发音还没有缓存好，请先补齐发音。', 'PACK_AUDIO_PENDING');
          }
        }
        store.enablePack(id, body.enabled); return json(res, await state());
      }
      const materialMatch=route.match(/^\/api\/words\/([^/]+)\/game-materials\/([^/]+)(?:\/(prepare))?$/);
      if(req.method==='POST'&&materialMatch){
        assessmentGrants.require(req.headers.authorization);
        const body=await readJson(req,60000),kind=decodeURIComponent(materialMatch[2]);
        if(body.approve!==true||!validGameMaterial(kind,body.material))throw new AppError('请先预览素材并确认审核。');
        const cues=materialCues(body.material);
        if(kind==='cloze'||kind==='sentence-repair'){const word=store.read().words.find(w=>w.id===decodeURIComponent(materialMatch[1])),material=body.material;if(!word)throw new AppError('找不到单词。');cues.push({text:material.sentence!.map((v,i)=>i===material.blank?word.term:v).join(' '),locale:'en-US'});}
        if(materialMatch[3]==='prepare'){
          const material=body.material,word=store.read().words.find(w=>w.id===decodeURIComponent(materialMatch[1]));
          if(!word||material.wordVersion!==(word.learningVersion??0)||!material.wordIds.includes(word.id)||material.tiles.some(t=>t.imageUrl&&!availableImage(t.imageUrl))||material.wordIds.some(id=>!store.read().words.some(w=>w.id===id&&(w.learningVersion??0)===material.wordVersions[id]&&w.assetStatus==='approved')))throw new AppError('素材或词义已经变化，请重新预览。','GAME_MATERIAL_STALE',409);
          const controller=new AbortController();ttsControllers.add(controller);const cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
          try{
            for(const cue of cues){
              if(controller.signal.aborted||closed)throw new AppError('音频准备已停止。','CANCELLED',409);
              if(await integration.getCachedSpeech({...cue,tone:'clear',dataDir}))continue;
              const status=(await serviceStatus()).tts;if(!status?.configured||status.provider!=='elevenlabs')throw new AppError('请先配置ElevenLabs；仅准备已包含的免费额度，其他服务不会替代。','GAME_MATERIAL_SERVICE',503);
              let charge:string|undefined;
              const audio=await integration.synthesizeSpeech({...cue,tone:'clear',dataDir,freeOnly:true,signal:controller.signal,beforeRequest:()=>{charge=store.reserve('tts',integration.estimateTtsCost(cue.text),cue.text.length);}});
              if(charge)store.settle(charge,audio.costCny,audio.mode==='local'?0:cue.text.length);
              if(!audio.filePath)throw new AppError('音频没有准备完成，请检查服务状态。','GAME_MATERIAL_AUDIO_PENDING',409);
            }
            return json(res,{ready:true});
          }finally{res.off('close',cancel);ttsControllers.delete(controller);}
        }
        for(const cue of cues)if(!await integration.getCachedSpeech({...cue,tone:'clear',dataDir}))throw new AppError('讲解或题目音频尚未缓存；先完成备课再确认。','GAME_MATERIAL_AUDIO_PENDING',409);
        store.approveGameMaterial(decodeURIComponent(materialMatch[1]),kind,body.material,availableImage);return json(res,await state());
      }
      const wordMatch = route.match(/^\/api\/words\/([^/]+)$/);
      if (req.method === 'PATCH' && wordMatch) {
        const id = decodeURIComponent(wordMatch[1]), body = await readJson(req), data = store.read();
        const word = data.words.find(item => item.id === id), pack = data.packs.find(item => item.id === word?.packId);
        if (body.assetStatus === 'approved' && word && pack?.enabled && !pack.isSample) {
          if (['term','meaning','partOfSpeech','pictureHint'].some(key => body[key] !== undefined && body[key] !== word[key as keyof Word])) throw new AppError('请先保存新词义、词性或配图说明，再准备并确认新图片。', 'PACK_AUDIO_PENDING');
          const audio = await packAudio.getStatus(pack.id);
          if (!audio.words.find(item => item.wordId === id)?.cached) throw new AppError('请先为这个单词补齐发音，再交给孩子学习。', 'PACK_AUDIO_PENDING');
        }
        store.updateWord(id, body, availableImage); return json(res, await state());
      }
      const imageMatch = route.match(/^\/api\/words\/([^/]+)\/illustrate$/);
      if (req.method === 'POST' && imageMatch) {
        return json(res,enqueueImage(decodeURIComponent(imageMatch[1])).job,202);
      }
      const cancelMatch = route.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancelMatch) {
        cancelImageJob(decodeURIComponent(cancelMatch[1]));
        return json(res, { jobs: store.read().jobs });
      }
      if (req.method === 'POST' && route === '/api/session/start') {
        const input=await readJson(req,8192,true),data=store.read(),daily=dailyLearningPlan(data,store.clock()),ids=Array.isArray(input.wordIds)?input.wordIds:(daily.tasks.length?daily.tasks:supplementalLearningPlan(data,store.clock()).tasks).map(t=>t.wordId);
        const readyMaterialKeys=await readyGameMaterialKeys(data.words,data.words.filter(w=>ids.includes(w.id)),availableImage,async cue=>!!await integration.getCachedSpeech({...cue,tone:'clear',dataDir}));
        return json(res,store.startSession('random',{...options.learningGames,readyMaterialKeys},input));
      }
      if (req.method === 'POST' && route === '/api/session/activity') { store.activityEvent(await readJson(req)); return json(res, await state()); }
      if (req.method === 'POST' && route === '/api/session/assessment-practice') { store.assessmentPractice(await readJson(req, 4096)); return json(res, await state()); }
      if (req.method === 'POST' && route === '/api/attempts') { const attempt = store.attempt(await readJson(req)); return json(res, attempt); }
      if (req.method === 'PATCH' && route === '/api/session') { store.updateSession(await readJson(req)); return json(res, await state()); }
      if (req.method === 'POST' && route === '/api/restore') { if (controllers.size || chatController || liveVoice.busy() || packAudio.busy() || packImages.busy() || challenges.busy()) throw new AppError('请先取消正在进行的任务，再恢复备份。'); store.restoreBackup(await readJson(req, 60_000_000)); assessmentGrants.clear(); await dialogue.reset(); return json(res, await state()); }
      if (route.startsWith('/api/')) throw new AppError('没有这个接口。', 'NOT_FOUND', 404);
      if (!['GET','HEAD'].includes(req.method ?? '')) throw new AppError('不支持该操作。', 'METHOD_NOT_ALLOWED', 405);
      const decoded = decodeURIComponent(route);
      if (decoded.startsWith('/media/')) {
        const relative = decoded.slice(7); if (!safeRelative(relative)) throw new AppError('素材路径无效。', 'NOT_FOUND', 404);
        return serveFile(req, res, path.join(dataDir, relative), dataDir);
      }
      if (decoded.startsWith('/assets/')) {
        for (const base of [path.join(rootDir, 'public'), path.join(rootDir, 'dist')]) {
          const candidate = path.resolve(base, '.' + decoded);
          if (!candidate.startsWith(base + path.sep)) throw new AppError('素材路径无效。', 'NOT_FOUND', 404);
          if (existsSync(candidate) && statSync(candidate).isFile()) return serveFile(req, res, candidate, base);
        }
        throw new AppError('素材不存在。', 'NOT_FOUND', 404);
      }
      const dist = path.join(rootDir, 'dist'), requested = path.resolve(dist, '.' + decoded);
      if (!requested.startsWith(dist + path.sep) && requested !== dist) throw new AppError('路径无效。', 'NOT_FOUND', 404);
      if (existsSync(requested) && statSync(requested).isFile()) return serveFile(req, res, requested, dist);
      if (existsSync(path.join(dist, 'index.html'))) return serveFile(req, res, path.join(dist, 'index.html'), dist);
      throw new AppError('前端尚未构建。开发请使用 npm run dev，或先 npm run build。', 'FRONTEND_NOT_BUILT', 404);
    } catch (error) { const appError = (error ?? {}) as AppError & { statusCode?:number }; const candidate = appError.status ?? appError.statusCode; const statusCode = typeof candidate === 'number' && candidate >= 400 && candidate <= 599 ? candidate : integrationHttpStatus(appError.code); if (!res.headersSent) json(res, { error: publicMessage(error), code: appError.code ?? 'INTERNAL_ERROR' }, statusCode); else res.end(); }
  });
  const liveVoice = attachLiveVoice(server, {
    status: async () => { const s = await serviceStatus(); return s.stt ?? s.speech; },
    open: input => integration.createLiveSttSession(input),
    vocabulary: () => { const data = store.read(); return data.words.filter(w => w.assetStatus === 'approved' && data.packs.some(p => p.id === w.packId && p.enabled)).map(w => w.term); },
    reserve: seconds => store.reserve('stt', integration.estimateSttCost(seconds), seconds),
    settle: (id, seconds) => store.settle(id, seconds === 0 ? 0 : integration.estimateSttCost(seconds), seconds),
  });
  return { server, store, dataDir, close: async () => { closed = true; claimPreparation();chatController?.abort(); for(const controller of ttsControllers)controller.abort();await Promise.all([packAudio.close(),packImages.close(),imports.close(),challenges.close()]);await dialogue.close(); liveVoice.close(); for (const c of controllers.values()) c.abort();await Promise.allSettled(imageRuns.values()); await new Promise<void>((resolve, reject) => { if (!server.listening) return resolve(); server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }); store.close(); } };
}

function publicMessage(error: unknown) {
  if (error instanceof AppError) return error.message;
  const e = error as { code?: string; message?: string };
  if (e?.code && /^(AZURE|CODEX|SPEECH|IMAGE|AUDIO|TTS|STT|BUDGET|ABORT|TIMEOUT|CANCEL|INVALID_)/.test(e.code)) return (e.message ?? '服务调用失败。').replace(/(?:Bearer\s+|[?&](?:key|token)=)[^\s&]+/gi, '[已隐藏]');
  return '操作没有完成，请稍后再试。';
}
function integrationHttpStatus(code?: string) {
  if (!code) return 500;
  if (code.startsWith('INVALID_')) return 400;
  if (code.includes('TIMEOUT')) return 504;
  if (code.includes('RATE_LIMIT')) return 429;
  if (/(NETWORK|NOT_FOUND|LOGIN_REQUIRED|UNAVAILABLE|CONFIG)/.test(code)) return 503;
  if (code === 'CANCELLED') return 409;
  if (/^(SPEECH|AZURE|CODEX|IMAGE)/.test(code)) return 502;
  return 500;
}
function json(res: http.ServerResponse, body: unknown, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
async function readBody(req: http.IncomingMessage, max: number) {
  if (Number(req.headers['content-length']) > max) throw new AppError('请求文件太大。', 'BODY_TOO_LARGE', 413);
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > max) throw new AppError('请求文件太大。', 'BODY_TOO_LARGE', 413); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
async function readJson(req: http.IncomingMessage, max = 1_000_000, allowEmpty = false): Promise<Record<string, unknown>> {
  const body = await readBody(req, max);
  if (allowEmpty && body.length === 0) return {};
  try { const parsed = JSON.parse(body.toString('utf8')); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed; } catch { throw new AppError('JSON 格式不正确。'); }
}
export function validateWav(audio: Buffer): number {
  return validateSpeechWav(audio).seconds;
}
const mime: Record<string,string> = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.ico':'image/x-icon','.json':'application/json','.woff2':'font/woff2' };
function serveFile(req: http.IncomingMessage, res: http.ServerResponse, absolute: string, base: string) {
  if (!existsSync(absolute) || !statSync(absolute).isFile() || !realpathSync(absolute).startsWith(realpathSync(base) + path.sep)) throw new AppError('素材不存在。', 'NOT_FOUND', 404);
  res.writeHead(200, { 'Content-Type': mime[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': statSync(absolute).size, 'Cache-Control': path.extname(absolute) === '.html' ? 'no-cache' : 'public, max-age=3600' });
  if (req.method === 'HEAD') res.end(); else createReadStream(absolute).pipe(res);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口。');
  app.server.listen(port, '127.0.0.1', () => console.log(`单词游乐园：http://127.0.0.1:${port}`));
  app.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => { process.exit(0); }); });
}
