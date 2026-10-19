import type { AppState, LearningSession, LearningStartRequest } from './contracts.ts';
import { availableLearningWords, learningEncounters } from './learning-history.ts';
import { learningSegmentProgress } from './learning-policy.ts';

/** Whole-book practice is independent of the daily recommendation and its reservations. */
export function packPracticeOptions(data: Pick<AppState, 'settings' | 'packs' | 'words' | 'progress' | 'learningHistory' | 'attempts' | 'resumableSessions' | 'activeSession'>) {
  const available = availableLearningWords(data);
  const learned = new Set(learningEncounters(data).map(row => row.wordId));
  for (const row of data.progress) learned.add(row.wordId);
  const pending = data.resumableSessions ?? (data.activeSession ? [data.activeSession] : []);
  return data.packs.filter(pack => pack.enabled && !pack.deletedAt && !pack.isSample).map(pack => {
    const words = available.filter(word => word.packId === pack.id);
    const total = data.words.filter(word => word.packId === pack.id).length;
    const resume = pending.find(session => session.practicePackId === pack.id && !session.packGame && !session.completedAt && !session.suspendedAt);
    const request: LearningStartRequest = resume ? {mode:'resume', sessionId:resume.id}
      : {mode:'practice', packId:pack.id, wordIds:words.map(word => word.id), strategy:data.settings.learningStrategy ?? 'memory-loop'};
    return {pack, words, total, learned:words.filter(word => learned.has(word.id)).length, resume, segment:resume?learningSegmentProgress(resume):null, request};
  });
}

export function packReplayRequest(data:AppState,session:LearningSession|null):LearningStartRequest|undefined {
  const book=packPracticeOptions(data).find(book=>book.pack.id===session?.practicePackId);
  if(!book?.words.length||!session)return;
  return {mode:'practice',packId:book.pack.id,wordIds:book.words.map(word=>word.id),strategy:session.packGame?'classic':data.settings.learningStrategy??'memory-loop',...(session.packGame?{game:session.packGame.selection}:{})};
}
