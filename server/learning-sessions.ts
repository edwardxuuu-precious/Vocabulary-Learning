import type {LearningStartRequest,LearningTask} from '../shared/contracts.ts';
import {AppError,type StoredData} from './store.ts';
import {currentReviewRetry,orderReviewSteps,reviewActivitySkins,reviewDirection,validReviewSupport} from '../shared/review-support.ts';
import { protectNewWordRecallGap } from '../shared/new-word-flow.ts';
import { entryRecommendation, recommendedEntrySession } from '../shared/entry-recommendation.ts';
import { adaptiveMainlineActivities } from '../shared/adaptive-mainline.ts';
import { blankGuidance, ruleGuide, validGuidance } from '../shared/learning-guidance.ts';
import {entryScopeCurrent,learnedReviewWords,requestEntrySource,sameLearningEntry,validEntrySource} from '../shared/learning-entry.ts';
import { fixedPackGame, randomPackGame } from '../shared/pack-games.ts';
import { lessonSegment, syncLessonProgress, validLessonPlan } from '../shared/lesson-plan.ts';
import { createHash, randomUUID } from 'node:crypto';
import { dailyLearningPlan, learningDay, selectedLearningTasks, supplementalLearningPlan, SECONDS_PER_LEARNING_TASK } from '../shared/learning.ts';
import { activityDone, buildActivities, currentActivity } from '../shared/game-plan.ts';
import { memoryLoopKinds, memoryLoopTasks, arrangeMemoryLoop, freezeMemoryLoop, pendingLearningCheckpoint, recallFirstActivity, transitionMemoryRecall, validMemoryLoopPolicy } from '../shared/learning-policy.ts';
import { seededRandom, recallGame, gameDefinition, gameRegistry, type GamePlanOptions } from '../shared/game-registry.ts';
import { isGoalCheckpoint } from '../shared/learning-goals.ts';
import { latestNewWordGroup } from '../shared/learning-progression.ts';
import { learningEncounters } from '../shared/learning-history.ts';
import type { AppState, ChildProfile, Settings, Word, WordPack, SkillProgress, LearningAttempt, LearningSession, IllustrationJob, IntegrationStatus, ImportRow, Skill, LearningStep, ImageReviewSelection } from '../shared/contracts.ts';
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function buildLearningSession(data:StoredData,{clock,activeLearningSession}:{clock:()=>Date;activeLearningSession:(data:StoredData)=>LearningSession|null},withGames:boolean|'random',gameOptions:GamePlanOptions,input:LearningStartRequest,readyWordIds?:string[],studyTasks?:LearningTask[]){
      const body = { ...input } as Record<string, unknown>, requestedMode = body.mode ?? 'recommended', mode = requestedMode === 'lesson' ? 'practice' : requestedMode;
      if(body.entry!==undefined&&(typeof body.entry!=='string'||!['learn','review'].includes(body.entry))||body.entry==='review'&&['lesson','relearn'].includes(String(requestedMode)))throw new AppError('请选择正确的学习或复习入口。','SESSION_ENTRY');
      if (body.strategy !== undefined && (typeof body.strategy!=='string'||!['classic','memory-loop'].includes(body.strategy))) throw new AppError('学习策略无效。');
      const memoryLoop = body.game === undefined && (body.strategy ?? data.settings.learningStrategy ?? (body.entry&&mode==='recommended'?'memory-loop':undefined)) === 'memory-loop';
      if ((typeof requestedMode !== 'string' || !['recommended','relearn','practice','resume','lesson'].includes(requestedMode)) || Object.keys(body).some(key => !['entry','mode','startNew','wordIds','packId','game','sessionId','requestId','strategy','lessonPlanId','lessonRevision'].includes(key)) || body.requestId !== undefined && (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(body.requestId))) throw new AppError('学习请求无效。');
      if (body.startNew !== undefined && (body.startNew !== true || body.entry !== 'learn' || mode !== 'recommended' || typeof body.requestId !== 'string')) throw new AppError('新学习需要明确的新词入口和启动标识。', 'SESSION_NEW_REQUEST');
      if (body.packId !== undefined && (typeof body.packId !== 'string' || !['practice','relearn'].includes(mode as string) || requestedMode === 'lesson')) throw new AppError('词表练习范围无效。');
      if (body.game !== undefined && (typeof body.game !== 'string' || body.game !== 'random' && !gameDefinition(body.game) || typeof body.packId !== 'string' || !['practice','relearn'].includes(mode as string))) throw new AppError('请选择当前词表可玩的玩法。');
      if (mode === 'resume') {
        if (typeof body.sessionId !== 'string' || body.wordIds !== undefined) throw new AppError('请选择要继续的学习。');
        const saved = data.sessions.find(s => s.id === body.sessionId && !s.completedAt && !s.suspendedAt);
        if (!saved) throw new AppError('这轮学习已结束或素材已变化。', 'SESSION_STALE', 409);
        if(body.entry!==undefined&&!sameLearningEntry(saved,body.entry as 'learn'|'review'))throw new AppError('这轮进度属于另一个入口，请回原入口继续。','SESSION_ENTRY_CONFLICT',409);
        if(!entryScopeCurrent(data,saved))throw new AppError('本轮词义或素材已变化，原进度已保留，请家长确认。','SESSION_STALE',409);
        saved.lastResumedAt = clock().toISOString(); data.activeLearningSessionId = saved.id; return saved;
      }
      if (body.sessionId !== undefined || mode === 'recommended' && body.wordIds !== undefined) throw new AppError('学习范围无效。');
      const existing = body.requestId && data.sessions.find(s => s.requestId === body.requestId);
      if (existing) {
        if(existing.entrySource?.entry!==body.entry)throw new AppError('这次启动请求已用于另一个入口。','SESSION_REQUEST_CONFLICT',409);
        if(!existing.completedAt&&!entryScopeCurrent(data,existing))throw new AppError('本轮词义或素材已变化，请家长确认。','SESSION_STALE',409);
        if (existing.suspendedAt || existing.completedAt && !existing.rewardGranted) throw new AppError('这轮学习的词书或素材已变化，请重新选词。', 'SESSION_STALE', 409);
        if (body.game === undefined && body.strategy !== undefined && (existing.learningPolicy?.kind ?? 'classic') !== body.strategy || existing.packGame?.selection !== body.game || (existing.mode ?? 'recommended') !== mode || existing.practicePackId !== body.packId || mode !== 'recommended' && requestedMode !== 'lesson' && JSON.stringify(existing.packGame?.scopeWordIds ?? existing.wordIds) !== JSON.stringify(body.wordIds) || requestedMode === 'lesson' && (existing.lessonPlanId !== body.lessonPlanId || existing.lessonPlanRevision !== body.lessonRevision)) throw new AppError('这次启动请求已用于另一轮学习。', 'SESSION_REQUEST_CONFLICT', 409);
        if (!existing.completedAt && !existing.suspendedAt) data.activeLearningSessionId = existing.id;
        return existing;
      }
      if (requestedMode === 'lesson') {
        const lesson = data.lessonPlan;
        if (!lesson || lesson.id !== body.lessonPlanId || lesson.revision !== body.lessonRevision || body.wordIds !== undefined) throw new AppError('课堂安排已变化，请刷新后继续。', 'LESSON_STALE', 409);
        const pending = data.learningTaskPolicy!==1&&[...data.sessions].reverse().find(session => session.lessonPlanId === lesson.id && !session.completedAt && !session.suspendedAt && sameLearningEntry(session,body.entry as 'learn'|'review'|undefined));
        if (pending) { data.activeLearningSessionId = pending.id; return pending; }
        const segment = lessonSegment(lesson, data);
        if (segment.unavailable.length) throw new AppError('课堂中的词义或素材已变化，请家长重新保存安排。', 'LESSON_STALE', 409);
        if (!segment.tasks.length) throw new AppError('本次重点已经练完，可以请家长安排下一组。', 'LESSON_COMPLETE', 409);
        body.wordIds = segment.tasks.map(task => task.wordId);
      } else if (body.lessonPlanId !== undefined || body.lessonRevision !== undefined) throw new AppError('课堂安排参数无效。');
      if (mode === 'recommended' && !body.startNew && !studyTasks) {
        const active = activeLearningSession(data);
        const current = body.entry?recommendedEntrySession(data,body.entry as 'learn'|'review'):active && (active.mode ?? 'recommended') === 'recommended' && sameLearningEntry(active,body.entry as 'learn'|'review'|undefined) ? active : [...data.sessions].reverse().find(s => !s.completedAt && !s.suspendedAt && (s.mode ?? 'recommended') === 'recommended' && sameLearningEntry(s,body.entry as 'learn'|'review'|undefined));
        if (current) {if(readyWordIds&&current.wordIds.some(id=>!readyWordIds.includes(id)))throw new AppError('本轮图片或缓存发音需要家长检查，进度仍保留。','RECOMMENDATION_NOT_READY',409);if(!entryScopeCurrent(data,current))throw new AppError('本轮词义或素材已变化，请家长确认。','SESSION_STALE',409); data.activeLearningSessionId = current.id; return current; }
      }
      const sourceData={...data,...(readyWordIds?{learningReadyWordIds:readyWordIds}:{})};
      const planData = memoryLoop ? {...sourceData, settings:{...data.settings, learningStrategy:'memory-loop' as const}} : {...sourceData, settings:{...data.settings, learningStrategy:'classic' as const}};
      const recommendation=!studyTasks&&body.entry&&mode==='recommended'?entryRecommendation(planData,body.entry as 'learn'|'review',clock()):undefined;
      let plan = recommendation??dailyLearningPlan(planData, clock());
      if(studyTasks){const taskCount=studyTasks.reduce((sum,task)=>sum+task.steps.length,0);plan={...plan,tasks:clone(studyTasks),taskCount,taskLimit:Math.max(plan.taskLimit,taskCount),estimatedMinutes:Math.ceil(taskCount*SECONDS_PER_LEARNING_TASK/60)};}
      if(recommendation&&!recommendation.tasks.length)throw new AppError(recommendation.description,'RECOMMENDATION_EMPTY',409);
      let practiceOnly = mode !== 'recommended';
      if (mode === 'recommended' && !body.entry && !plan.tasks.length) { plan = supplementalLearningPlan(planData, clock()); practiceOnly = true; }
      const learnedIds=body.entry==='review'?new Set(learnedReviewWords(data,clock()).map(word=>word.id)):undefined;
      if(learnedIds){
        const tasks=plan.tasks.filter(task=>learnedIds.has(task.wordId));
        plan={...plan,available:plan.available.filter(word=>learnedIds.has(word.id)),review:plan.review.filter(word=>learnedIds.has(word.id)),due:plan.due.filter(word=>learnedIds.has(word.id)),tasks,taskCount:tasks.reduce((sum,task)=>sum+task.steps.length,0),estimatedMinutes:Math.ceil(tasks.reduce((sum,task)=>sum+task.steps.length,0)*SECONDS_PER_LEARNING_TASK/60),fresh:[],newWordLimit:0};
      }
      if (mode === 'relearn' || mode === 'practice') {
        const ids = body.wordIds;
        if(learnedIds&&Array.isArray(ids)&&ids.some(id=>typeof id==='string'&&!learnedIds.has(id)))throw new AppError('复习只使用当前词义已经认识的词，请先去学习。','SESSION_UNLEARNED',409);
        const availableIds = new Set(plan.available.map(word => word.id));
        if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !availableIds.has(id))) throw new AppError('请选择至少一个已经准备好的单词，不能重复选择。', 'SESSION_WORDS');
        if(data.learningTaskPolicy!==1&&body.entry!==undefined&&body.packId===undefined&&requestedMode!=='lesson'){
          const pending=[...data.sessions].reverse().find(saved=>sameLearningEntry(saved,body.entry as 'learn'|'review')&&saved.entrySource?.kind==='selected'&&saved.mode===mode&&!saved.completedAt&&!saved.suspendedAt&&JSON.stringify(saved.wordIds)===JSON.stringify(ids));
          if(pending){if(!entryScopeCurrent(data,pending))throw new AppError('本轮词义或素材已变化，请家长确认。','SESSION_STALE',409);pending.lastResumedAt=clock().toISOString();data.activeLearningSessionId=pending.id;return pending;}
        }
        if (typeof body.packId === 'string') {
          const pack = data.packs.find(pack => pack.id === body.packId && pack.enabled && !pack.deletedAt && !pack.isSample);
          if (!pack || ids.some(id => !data.words.some(word => word.id === id && word.packId === pack.id))) throw new AppError('词表或素材已变化，请重新选择。', 'SESSION_WORDS', 409);
          const pending = data.learningTaskPolicy!==1&&[...data.sessions].reverse().find(saved => saved.practicePackId === pack.id && saved.packGame?.selection === body.game && !saved.completedAt && !saved.suspendedAt && sameLearningEntry(saved,body.entry as 'learn'|'review'|undefined));
          if (pending) {if(!entryScopeCurrent(data,pending))throw new AppError('本轮词义或素材已变化，请家长确认。','SESSION_STALE',409); pending.lastResumedAt = clock().toISOString(); data.activeLearningSessionId = pending.id; return pending; }
        }
        const tasks = selectedLearningTasks(data, ids, mode), taskCount = tasks.reduce((sum, task) => sum + task.steps.length, 0);
        plan = { ...plan, tasks, taskCount, taskLimit: Math.max(plan.taskLimit, taskCount), estimatedMinutes: Math.ceil(taskCount * SECONDS_PER_LEARNING_TASK / 60) };
      }
      if(data.learningTaskPolicy===1){
        const now=clock(),encountered=new Set(learningEncounters(data).filter(row=>Date.parse(row.introducedAt)<=now.getTime()).map(row=>row.wordId));
        if(plan.tasks.some(task=>!encountered.has(task.wordId))){
          const group=latestNewWordGroup(data,now);
          if(group&&group.mastered<group.wordIds.length)throw new AppError('先完成这组词的学习与核验，再开始下一组。','NEW_WORD_MASTERY_REQUIRED',409);
        }
      }
      if (memoryLoop) plan.tasks = memoryLoopTasks(plan.tasks);
      const session: LearningSession = { id: randomUUID(), mode: mode as LearningSession['mode'], practiceOnly, ...(typeof body.requestId === 'string' ? {requestId: body.requestId} : {}), exposures: [], wordIds: [...new Set(plan.tasks.map(task => task.wordId))], completedWordIds: [], startedAt: clock().toISOString(), rewardGranted: false, goalVersion:1, tasks: clone(plan.tasks), completedSteps: {}, taskLimit: plan.taskLimit, estimatedMinutes: plan.estimatedMinutes };
      const entrySource=requestEntrySource(input);if(entrySource)session.entrySource=entrySource;
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
        const teachingSequence=body.entry==='learn'&&(studyTasks?session.tasks!.some(task=>task.mode==='new'):session.tasks!.every(task=>task.mode==='new'))?'meaning-recall-v1' as const:undefined;
        const supportedReview=body.entry==='review'&&!session.practicePackId&&session.tasks!.every(task=>task.mode==='review');
        if(supportedReview)session.tasks=session.tasks!.map(task=>({...task,steps:orderReviewSteps(task.steps)}));
        session.activities = arrangeMemoryLoop(session.tasks!, session.activities,teachingSequence,supportedReview?1:undefined);
        const version = withGames && !session.practicePackId ? 3 : 1;
        const guidedLearning=body.entry==='learn'&&!session.practicePackId;
        if (version === 3) session.activities = adaptiveMainlineActivities(session.activities, plan.available, session.gameSeed!, 0, freezeMemoryLoop(session.activities).checkpoints, {familyEnabled:data.settings.familyGamesEnabled===true,contextEnabled:data.settings.contextGamesEnabled===true,...gameOptions});
        if(supportedReview)session.activities=reviewActivitySkins(session.activities);
        if(teachingSequence)session.activities=protectNewWordRecallGap(session.tasks!,session.activities);
        session.learningPolicy = freezeMemoryLoop(session.activities, version,teachingSequence); session.acknowledgedCheckpoints = [];
        if(supportedReview){session.learningPolicy.reviewSequence=1;session.reviewSupport={version:1,entries:{}};}
        if(guidedLearning){
          session.learningPolicy.guidanceVersion=1;
          const keys=new Set(session.activities.map(activity=>ruleGuide(activity)?.key));
          const seen=[...new Set(data.sessions.flatMap(prior=>prior.guidance?.seen??[]))].filter(key=>keys.has(key));
          if(seen.length)session.guidance={...blankGuidance(),seen};
        }
      }
      if (!session.wordIds.length) return session;
      data.sessions.push(session); data.activeLearningSessionId = session.id; return session;
}
