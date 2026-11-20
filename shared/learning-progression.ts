import { assessmentDimensions } from './assessment.ts';
import { formalDimensionEvidence } from './formal-mastery.ts';
import { learningEncounters } from './learning-history.ts';
import type { LearningData } from './learning.ts';
import { learningVerification } from './learning-verification.ts';
import { wordLearningSessions, type WordLearningProfile } from './word-learning.ts';

export interface NewWordGroup {
  sessionId: string;
  wordIds: string[];
  mastered: number;
  pending: number;
  resumeAssessmentId?: string;
  blockedReason?: 'materials' | 'pictures' | 'context';
}

/** Replay the most recent group that actually introduced words, even after starting a review or restarting the app. */
export function latestNewWordGroup(data: LearningData, now: Date, profiles?: WordLearningProfile[]): NewWordGroup | undefined {
  const packs = new Set(data.packs.filter(pack => pack.enabled && !pack.deletedAt && !pack.isSample).map(pack => pack.id));
  const words = new Map(data.words.filter(word => !word.deletedAt && packs.has(word.packId)).map(word => [word.id, word]));
  const first = new Map(learningEncounters(data).map(row => [row.wordId, Date.parse(row.introducedAt)]));
  const sessions = wordLearningSessions(data).reverse().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  for (const session of sessions) {
    const started = Date.parse(session.startedAt);
    if (!(started <= now.getTime()) || session.entrySource?.entry === 'review' || session.practicePackId || session.packGame) continue;
    const introducedIds = session.tasks?.filter(task => task.mode === 'new' && task.steps.includes('learn')).map(task => task.wordId) ?? session.wordIds;
    const wordIds = introducedIds.filter(id => {
      const word = words.get(id), introduced = first.get(id);
      if (!word || introduced === undefined || introduced < started || introduced > now.getTime()) return false;
      const version = word.learningVersion ?? 0;
      if (session.exposures !== undefined) return session.exposures.some(row => row.wordId === id && row.learningVersion === version && Date.parse(row.introducedAt) === introduced);
      const snapshot = session.activities?.find(activity => activity.wordId === id)?.word;
      if (snapshot ? snapshot.learningVersion !== version || snapshot.term !== word.term || snapshot.meaning !== word.meaning : version !== 0) return false;
      return session.completedSteps?.[id]?.includes('learn') || !session.tasks && session.completedWordIds.includes(id);
    });
    if (!wordIds.length) continue;
    const verification = learningVerification(data, wordIds, now);
    const byId = new Map(profiles?.map(profile => [profile.wordId, profile]));
    const mastered = wordIds.filter(id => byId.get(id)?.formal.passed
      ?? assessmentDimensions.every(dimension => formalDimensionEvidence(data, words.get(id)!, dimension, now).passed)).length;
    const resume=verification.resume;
    const resumeAssessmentId=resume&&resume.wordIds.every(id=>byId.get(id)?.available??true)?resume.id:undefined;
    return { sessionId: session.id, wordIds, mastered, pending: verification.pending, resumeAssessmentId };
  }
}
