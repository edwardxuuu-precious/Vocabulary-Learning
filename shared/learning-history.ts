import type { LearningAttempt, LearningExposure, LearningSession, Word, WordPack } from './contracts.ts';

export interface LearningHistoryData {
  words: Word[]; packs: WordPack[]; attempts?: LearningAttempt[];
  sessions?: LearningSession[]; resumableSessions?: LearningSession[]; learningHistory?: LearningExposure[];
  lastCompletedSession?: LearningSession | null; lastCompletedLearningSessionId?: string;
}

export const availableLearningWords = (data: Pick<LearningHistoryData, 'words' | 'packs'>) => {
  const enabled = new Set(data.packs.filter(pack => pack.enabled).map(pack => pack.id));
  return data.words.filter(word => enabled.has(word.packId) && word.assetStatus === 'approved');
};

/** First contact with the current meaning, derived from actual exposure/answer records. */
export function learningEncounters(data: LearningHistoryData): LearningExposure[] {
  const words = new Map(data.words.map(word => [word.id, word])), first = new Map<string, LearningExposure>();
  const add = (entry: LearningExposure) => {
    const word = words.get(entry.wordId), time = Date.parse(entry.introducedAt);
    if (!word || entry.learningVersion !== (word.learningVersion ?? 0) || !Number.isFinite(time) || time < Date.parse(word.learningResetAt ?? '')) return;
    if (!first.has(word.id) || time < Date.parse(first.get(word.id)!.introducedAt)) first.set(word.id, entry);
  };
  for (const entry of data.learningHistory ?? []) add(entry);
  for (const attempt of data.attempts ?? []) add({ wordId: attempt.wordId, learningVersion: attempt.learningVersion ?? 0, introducedAt: attempt.createdAt });
  for (const session of data.sessions ?? data.resumableSessions ?? []) {
    for (const entry of session.exposures ?? []) add(entry);
    // Legacy sessions have no exposure timestamp. Only infer an encounter for an actually completed introduction.
    if (session.exposures === undefined) for (const id of session.wordIds) {
      if (first.has(id)) continue;
      if (!session.completedSteps?.[id]?.includes('learn') && !(session.tasks === undefined && session.completedWordIds.includes(id))) continue;
      const word = words.get(id), snapshot = session.activities?.find(activity => activity.wordId === id)?.word;
      if (word && (!snapshot || snapshot.learningVersion === (word.learningVersion ?? 0))) add({ wordId: id, learningVersion: snapshot?.learningVersion ?? 0, introducedAt: session.startedAt });
    }
  }
  return [...first.values()];
}

/** Deterministic interleaving for equal-priority words; frozen sessions never call this again. */
export function interleavePacks(words: Word[], seed = ''): Word[] {
  const hash = (value: string) => { let n = 2166136261; for (const char of seed + value) n = Math.imul(n ^ char.charCodeAt(0), 16777619); return n >>> 0; };
  const groups = new Map<string, Word[]>();
  for (const word of [...words].sort((a, b) => hash(a.id) - hash(b.id))) {
    if (!groups.has(word.packId)) groups.set(word.packId, []);
    groups.get(word.packId)!.push(word);
  }
  const queues = [...groups.entries()].sort(([a], [b]) => hash(a) - hash(b)).map(([, group]) => group), result: Word[] = [];
  while (queues.some(group => group.length)) for (const group of queues) if (group.length) result.push(group.shift()!);
  return result;
}
