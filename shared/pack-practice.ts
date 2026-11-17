import type { AppState, LearningSession, LearningStartRequest } from './contracts.ts';
import { availableLearningWords, learningEncounters } from './learning-history.ts';
import { learningSegmentProgress } from './learning-policy.ts';
import {entryScopeCurrent,learnedReviewWords} from './learning-entry.ts';

/** Whole-book practice is independent of the daily recommendation and its reservations. */
export function packPracticeOptions(data: Pick<AppState, 'learningReadyWordIds' | 'settings' | 'packs' | 'words' | 'progress' | 'learningHistory' | 'learningNow' | 'attempts' | 'resumableSessions' | 'activeSession'>) {
  const available = availableLearningWords(data);
  const learned = new Set(learnedReviewWords(data,new Date(data.learningNow??Date.now())).map(word=>word.id));
  const pending = data.resumableSessions ?? (data.activeSession ? [data.activeSession] : []);
  return data.packs.filter(pack => pack.enabled && !pack.deletedAt && !pack.isSample).map(pack => {
    const ready = available.filter(word => word.packId === pack.id&&!word.deletedAt&&(data.learningReadyWordIds===undefined||data.learningReadyWordIds.includes(word.id)));
    const words = ready.filter(word=>learned.has(word.id));
    const total = data.words.filter(word => word.packId === pack.id&&!word.deletedAt).length;
    const resume = pending.find(session => session.entrySource?.entry==='review' && session.practicePackId === pack.id && !session.packGame && !session.completedAt && !session.suspendedAt);
    const request: LearningStartRequest = resume ? {entry:'review',mode:'resume', sessionId:resume.id}
      : {entry:'review',mode:'practice', packId:pack.id, wordIds:words.map(word => word.id), strategy:data.settings.learningStrategy ?? 'memory-loop'};
    return {pack, words, total, ready:ready.length,unlearned:ready.length-words.length,learned:words.length,scopeChanged:!!resume&&(!entryScopeCurrent(data,resume)||data.learningReadyWordIds!==undefined&&resume.wordIds.some(id=>!data.learningReadyWordIds!.includes(id))),resume, segment:resume?learningSegmentProgress(resume):null, request};
  });
}

export function packReplayRequest(data:AppState,session:LearningSession|null):LearningStartRequest|undefined {
  const book=packPracticeOptions(data).find(book=>book.pack.id===session?.practicePackId);
  if(!book?.words.length||!session)return;
  return {entry:'review',mode:'practice',packId:book.pack.id,wordIds:book.words.map(word=>word.id),strategy:session.packGame?'classic':data.settings.learningStrategy??'memory-loop',...(session.packGame?{game:session.packGame.selection}:{})};
}
