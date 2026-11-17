import {todayLearningChoice} from './daily-learning-choice.ts';
import type { LearningEntry, LearningSession } from './contracts.ts';
import { dailyLearningPlan, type LearningData } from './learning.ts';
import { learningEncounters } from './learning-history.ts';
import { entryScopeCurrent, isEntryRecommendation } from './learning-entry.ts';
import {routineReviewCompletions,reviewDay} from './review-history.ts';

/** Only an unfinished recommendation with this purpose occupies the primary card. Other rounds remain explicit. */
export function recommendedEntrySession(data:LearningData,entry:LearningEntry):LearningSession|undefined {
  return [...(data.sessions?[...data.sessions].reverse():data.resumableSessions??(data.activeSession?[data.activeSession]:[]))].filter(session=>!session.completedAt&&!session.suspendedAt
    &&isEntryRecommendation(session,entry))
    .sort((a,b)=>(b.lastResumedAt??b.startedAt).localeCompare(a.lastResumedAt??a.startedAt))[0];
}

/** The learning card follows the child's latest explicit round, including self-selected words. */
export function primaryEntrySession(data:LearningData,entry:LearningEntry):LearningSession|undefined {
  if(entry==='review')return recommendedEntrySession(data,entry);
  return [...(data.sessions?[...data.sessions].reverse():data.resumableSessions??(data.activeSession?[data.activeSession]:[]))]
    .filter(session=>!session.completedAt&&!session.suspendedAt&&session.entrySource?.entry==='learn'
      &&(isEntryRecommendation(session,'learn')||['selected','lesson'].includes(session.entrySource.kind)))
    .sort((a,b)=>(b.lastResumedAt??b.startedAt).localeCompare(a.lastResumedAt??a.startedAt))[0];
}

/** Shared preview/start contract. Empty recommendations never turn into supplemental play. */
export function entryRecommendation(data:LearningData,entry:LearningEntry,now=new Date()) {
  let plan=dailyLearningPlan(data,now,entry);
  const resume=primaryEntrySession(data,entry);
  const delivered=new Set(data.packs.filter(pack=>pack.enabled&&!pack.isSample&&!pack.deletedAt).map(pack=>pack.id));
  const eligible=data.words.filter(word=>delivered.has(word.packId)&&!word.deletedAt);
  const known=new Set(learningEncounters(data).filter(fact=>Date.parse(fact.introducedAt)<=now.getTime()).map(fact=>fact.wordId));
  const selected=entry==='learn'?data.dailyLearningChoice:undefined;
  const scope=entry==='learn'?(selected?.wordIds?{focusWordIds:selected.wordIds,wordVersions:selected.wordVersions!}:data.lessonPlan):undefined;
  const scopeChanged=!!scope&&scope.focusWordIds.some(id=>!eligible.some(word=>word.id===id&&(word.learningVersion??0)===scope.wordVersions[id]));
  if(scopeChanged)plan={...plan,tasks:[],fresh:[],newWordLimit:0,taskCount:0,estimatedMinutes:0};
  const remaining=eligible.filter(word=>!known.has(word.id)&&(!scope||scope.focusWordIds.includes(word.id)));
  const reserved=new Set((data.sessions??data.resumableSessions??(data.activeSession?[data.activeSession]:[])).filter(session=>!session.completedAt&&!session.suspendedAt&&isEntryRecommendation(session,'learn')).flatMap(session=>session.tasks?.filter(task=>task.mode==='new'&&!known.has(task.wordId)).map(task=>task.wordId)??session.wordIds.filter(id=>!known.has(id))));
  const reviewedToday=entry==='review'&&routineReviewCompletions(data,now).some(row=>reviewDay(new Date(row.completedAt))===reviewDay(now));
  const reason=plan.tasks.length?'ready':scopeChanged?'scope-changed':!eligible.length?'no-content':entry==='learn'
    ?!remaining.length?(scope?'scope-complete':'no-new'):remaining.every(word=>reserved.has(word.id))?'already-arranged':!plan.available.some(word=>remaining.some(row=>row.id===word.id)&&!reserved.has(word.id))?'not-ready':!plan.remainingNew?'daily-limit':'task-budget'
    :!eligible.some(word=>known.has(word.id))?'not-learned':!plan.due.length?(plan.unreadyDueCount?'not-ready':reviewedToday?'reviewed-today':'no-due'):!plan.available.some(word=>known.has(word.id))?'not-ready':'review-limit';
  const empty={
    'scope-changed':['选定词语需要确认','请家长检查选定范围中的词义和素材。'],
    'no-content':['单词还在准备中','请家长先交付准备好的词书。'],
    'scope-complete':['这组新词都认识过啦','可以去复习，或自己选择其他词。'],
    'no-new':['新词都认识过啦','去复习，把认识的词再想一想。'],
    'already-arranged':['这些新词已经在学习中','可以继续原来的学习，或自己选择其他词；已有进度继续保留。'],
    'not-ready':['词语还需准备','请家长检查图片和缓存发音。'],
    'daily-limit':['今天的新词先到这里',`今天已认识 ${plan.usedNewToday} 词，另有 ${plan.reservedNew} 词在未完成学习中。可以调整今日词量，或自己选择其他词。`],
    'task-budget':['这一段先休息一下','当前推荐时长不足以放下一个完整新词，可以自己选词。'],
    'not-learned':['先认识几个新朋友','去学习后，再来复习已经认识的词。'],
    'no-due':['今天没有到期复习','需要复习时再来，也可以主动按书加练。'],
    'reviewed-today':['今天的复习先到这里','今天已结束的目标先放下，下次需要时再来；也可以主动加练。'],
    'review-limit':['今天暂不安排推荐复习','可以请家长检查推荐量，或主动选已学词加练。'],
    'ready':[entry==='learn'?'认识新朋友':'今天的复习',entry==='learn'?`认识 ${plan.fresh.length} 个新词`:`复习 ${plan.review.length} 个已学到期词`],
  }[reason];
  const stale=!!resume&&(!entryScopeCurrent(data,resume)||data.learningReadyWordIds!==undefined&&resume.wordIds.some(id=>!data.learningReadyWordIds!.includes(id)));
  return {...plan,resume,stale,reason,title:empty[0],description:empty[1]};
}
