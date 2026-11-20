import type { LearningEntry, LearningSession, LearningStartRequest, SessionEntrySource } from './contracts.ts';
import { availableLearningWords,learningEncounters,type LearningHistoryData } from './learning-history.ts';

export function requestEntrySource(request:LearningStartRequest):SessionEntrySource|undefined {
  if(!request.entry)return;
  return {entry:request.entry,kind:request.mode==='lesson'?'lesson':request.game?'game':request.packId?'book':(request.mode??'recommended')==='recommended'?'recommended':'selected'};
}
export const sameLearningEntry=(session:LearningSession,entry:LearningEntry|undefined)=>session.entrySource?.entry===entry;
export const learningEntryLabel=(session:LearningSession)=>!session.entrySource?'以前的综合练习':session.entrySource.entry==='review'?'复习进度':'学习进度';
export const isEntryRecommendation=(session:LearningSession,entry:LearningEntry)=>session.entrySource?.entry===entry&&session.entrySource.kind==='recommended'
  &&(session.mode??'recommended')==='recommended'&&!session.practiceOnly&&!!session.tasks?.length
  &&session.tasks.every(task=>task.mode===(entry==='learn'?'new':'review'));
export const learningReturn=(session:LearningSession|null|undefined):'hub'|'review'|'books'|'book-games'=>
  session?.entrySource?.entry==='review'&&session.studyPlan?.purpose!=='learn'?(session.packGame?'book-games':session.practicePackId?'books':'review'):'hub';

/** Only actual current-meaning encounters, never progress/reservation/selection alone. */
export function learnedReviewWords(data:LearningHistoryData,now=new Date()) {
  const known=new Set(learningEncounters(data).filter(fact=>Date.parse(fact.introducedAt)<=now.getTime()).map(fact=>fact.wordId));
  const packs=new Set(data.packs.filter(pack=>pack.enabled&&!pack.isSample&&!pack.deletedAt).map(pack=>pack.id));
  return availableLearningWords(data).filter(word=>packs.has(word.packId)&&!word.deletedAt&&known.has(word.id));
}
export function validEntrySource(session:LearningSession):boolean {
  const source=session.entrySource;
  if(source===undefined)return true;
  if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(key=>!['entry','kind'].includes(key))
    ||!['learn','review'].includes(source.entry)||!['recommended','selected','book','game','lesson'].includes(source.kind))return false;
  if(source.kind==='game')return !!session.packGame&&!!session.practicePackId;
  if(source.kind==='book')return !!session.practicePackId&&!session.packGame;
  if(source.kind==='lesson')return source.entry==='learn'&&!!session.lessonPlanId;
  return !session.practicePackId&&!session.packGame&&!session.lessonPlanId;
}
export function entryScopeCurrent(data:LearningHistoryData,session:LearningSession):boolean {
  if(!session.entrySource)return true;
  const ready=availableLearningWords(data).filter(word=>!word.deletedAt&&!data.packs.find(pack=>pack.id===word.packId)?.isSample);
  const snapshots=session.activities?.flatMap(activity=>[activity.word,...activity.choices,...(activity.targets??[]),...(activity.cueWord?[activity.cueWord]:[])])??[];
  return session.wordIds.every(id=>ready.some(word=>word.id===id))&&snapshots.every(snapshot=>ready.some(word=>word.id===snapshot.id
    &&(word.learningVersion??0)===snapshot.learningVersion&&word.term===snapshot.term&&word.meaning===snapshot.meaning&&word.imageUrl===snapshot.imageUrl));
}
