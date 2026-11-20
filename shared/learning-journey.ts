import type {AppState,LearningSession} from './contracts.ts';
import {completedTestWordIds} from './learning-verification.ts';
import {pendingSentenceWords,sentenceLesson} from './sentence-study.ts';

/** Teaching readiness is separate from word-task completion and formal test results. */
export function learningJourney(state:AppState,session:LearningSession|null|undefined){
  const wordIds=completedTestWordIds(state,session);
  const words=wordIds.flatMap(id=>{const word=state.words.find(word=>word.id===id);return word?[word]:[];});
  const sentenceWords=words.filter(word=>sentenceLesson(word));
  const pending=pendingSentenceWords(state,sentenceWords).map(word=>word.id);
  const learning=!!session&&session.entrySource?.entry==='learn'&&!session.packGame;
  return {wordIds,sentenceWordIds:sentenceWords.map(word=>word.id),pendingSentenceWordIds:learning?pending:[],
    stage:!session?.completedAt?'words' as const:learning&&pending.length?'usage' as const:'complete' as const};
}
