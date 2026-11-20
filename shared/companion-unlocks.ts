import {conclusiveAssessment} from './formal-mastery.ts';
import type { AssessmentData, AssessmentDimension, Word, WordPack } from './contracts.ts';
import { assessmentDay, assessmentDimensions } from './assessment.ts';
import { companionCharacters, companionIds, originalCompanionIds, type CompanionCharacter } from './companions.ts';
import { currentAssessmentAttempts } from './learning-evidence.ts';

export const companionUnlockSize = 10;
export const starterCompanions: CompanionCharacter[] = ['optimus', 'megatron'];
const added = companionIds.filter(id => !originalCompanionIds.includes(id));
const addedAutobots = added.filter(id => companionCharacters[id].faction === 'autobot');
const addedDecepticons = added.filter(id => companionCharacters[id].faction === 'decepticon');
// Keep all previously awarded identities stable; extend with alternating factions.
export const unlockableCompanions = [
  ...originalCompanionIds.filter(id => !starterCompanions.includes(id)),
  ...Array.from({ length: Math.max(addedAutobots.length, addedDecepticons.length) }, (_, at) => [addedDecepticons[at], addedAutobots[at]].filter((id): id is CompanionCharacter => id !== undefined)).flat(),
];
export interface CompanionWordCredit { term: string; day: string }
/** Reward history is permanent; it does not claim that current mastery is permanent. */
interface RewardCredits { learned: CompanionWordCredit[]; reviewed: CompanionWordCredit[] }
export interface LegacyCompanionRewardLedger extends RewardCredits { version: 1 }
export interface CurrentCompanionRewardLedger extends RewardCredits { version: 2; legacyReviewUnlocks: number; parentGrantedOptimusAnimation?: true }
export type CompanionRewardLedger = LegacyCompanionRewardLedger | CurrentCompanionRewardLedger;
export interface CompanionNextReward { kind: 'character' | 'animation'; companionId: CompanionCharacter; progress: number; remaining: number }
export interface CompanionUnlockSummary {
  ruleVersion: 3; newWords: number; newWordProgress: number; nextReward: CompanionNextReward | null;
  unlockedIds: CompanionCharacter[]; animationUnlockedIds: CompanionCharacter[]; allUnlocked: boolean;
  parentGrantedOptimusAnimation?: true;
}
type RewardData = AssessmentData & { words: Word[]; packs: WordPack[]; companionRewards?: CompanionRewardLedger };
const termKey = (term: string) => term.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const reviewKey = (credit: CompanionWordCredit) => JSON.stringify([credit.term, credit.day]);
// Freeze rewards already earned through the old review track; new reviews cannot add to this count.
const legacyReviewUnlocks = (ledger?: CompanionRewardLedger) => ledger?.version === 1
  ? Math.min(unlockableCompanions.length, Math.floor(ledger.reviewed.length / 20)) : ledger?.legacyReviewUnlocks ?? 0;

/** Only completed, version-matched, independently verified tests can earn credits. */
export function earnedCompanionCredits(data: RewardData, now = new Date()): CurrentCompanionRewardLedger {
  const learned = new Map((data.companionRewards?.learned ?? []).map(credit => [credit.term, credit]));
  const reviewed = new Map((data.companionRewards?.reviewed ?? []).map(credit => [reviewKey(credit), credit]));
  const packs = new Set(data.packs.filter(pack => !pack.isSample).map(pack => pack.id));
  const candidates: { term: string; day: string; at: number }[] = [];
  for (const word of data.words) {
    if (!packs.has(word.packId) || word.deletedAt) continue;
    const term = termKey(word.term), latest = new Map<AssessmentDimension, boolean>();
    const sessions = new Map<string, Map<AssessmentDimension, { correct: boolean; at: string }>>();
    for (const attempt of currentAssessmentAttempts(data, word, now)) {
      if(!conclusiveAssessment(attempt))continue;
      const dimensions = sessions.get(attempt.sessionId) ?? new Map();
      dimensions.set(attempt.dimension, { correct: attempt.result === 'correct', at: attempt.createdAt });
      sessions.set(attempt.sessionId, dimensions);
    }
    // Apply a completed test as a whole. Intermediate answers must not hide a later failure in that test.
    let firstSuccess = false;
    const tests = [...sessions.values()].map(dimensions => ({ dimensions, at: Math.max(...[...dimensions.values()].map(item => Date.parse(item.at))) })).sort((a, b) => a.at - b.at);
    for (const { dimensions, at } of tests) {
      for (const [dimension, value] of dimensions) latest.set(dimension, value.correct);
      if (!firstSuccess && assessmentDimensions.every(dimension => latest.get(dimension))) {
        candidates.push({ term, day: assessmentDay(new Date(at)), at });
        firstSuccess = true;
      }
    }
  }
  candidates.sort((a, b) => a.at - b.at);
  for (const credit of candidates) {
    const previous = learned.get(credit.term);
    if (!previous || credit.day < previous.day) learned.set(credit.term, { term: credit.term, day: credit.day });
  }
  const previous = data.companionRewards;
  return { version: 2, learned: [...learned.values()], reviewed: [...reviewed.values()], legacyReviewUnlocks: legacyReviewUnlocks(previous),
    ...(previous?.version === 2 && previous.parentGrantedOptimusAnimation === true ? { parentGrantedOptimusAnimation: true } : {}) };
}

export function companionUnlockSummary(ledger?: CompanionRewardLedger): CompanionUnlockSummary {
  const newWords = ledger?.learned.length ?? 0, legacy = legacyReviewUnlocks(ledger), cycleSize = companionUnlockSize * 2;
  const completed = Math.floor(newWords / cycleSize), characterCount = legacy + Math.floor((newWords + companionUnlockSize) / cycleSize);
  const unlockedIds = [...starterCompanions, ...unlockableCompanions.slice(0, characterCount)];
  const parentGrantedOptimusAnimation = ledger?.version === 2 && ledger.parentGrantedOptimusAnimation === true;
  const earnedStarterCount = Math.floor(newWords / companionUnlockSize);
  // The parent may grant the Optimus animation independently of any word credit.
  const starterAnimations = starterCompanions.filter((id, index) => index < earnedStarterCount || id === 'optimus' && parentGrantedOptimusAnimation);
  const animationUnlockedIds = [...starterAnimations, ...unlockableCompanions.slice(0, legacy + completed)];
  const allUnlocked = animationUnlockedIds.length === companionIds.length, progress = newWords % companionUnlockSize;
  const companionId = unlockableCompanions[legacy + completed];
  const starterAnimation = starterCompanions.find((id, index) => !starterAnimations.includes(id) && (index === earnedStarterCount || !companionId));
  const remaining = starterAnimation ? (starterCompanions.indexOf(starterAnimation) + 1) * companionUnlockSize - newWords : companionUnlockSize - progress;
  return { ruleVersion: 3, newWords, newWordProgress: progress, unlockedIds, animationUnlockedIds, allUnlocked,
    ...(parentGrantedOptimusAnimation ? { parentGrantedOptimusAnimation: true } : {}),
    nextReward: allUnlocked ? null : { kind: starterAnimation ? 'animation' : newWords % cycleSize < companionUnlockSize ? 'character' : 'animation', companionId: starterAnimation ?? companionId, progress, remaining } };
}

/** Each starter detail needs its own remaining count, including the later milestone. */
export function companionAnimationRemaining(progress: CompanionUnlockSummary, id: CompanionCharacter): number | undefined {
  if (id === 'optimus' && progress.parentGrantedOptimusAnimation === true) return 0;
  const starterAt = starterCompanions.indexOf(id);
  if (starterAt >= 0) return Math.max(0, (starterAt + 1) * companionUnlockSize - progress.newWords);
  if (progress.animationUnlockedIds?.includes(id)) return 0;
  return progress.nextReward?.kind === 'animation' && progress.nextReward.companionId === id ? progress.nextReward.remaining : undefined;
}

export function recordCompanionRewards(data: RewardData, now: Date) { data.companionRewards = earnedCompanionCredits(data, now); }

/** Historical rewards may outlive edited/deleted words, but backup shape stays strict. */
export function validCompanionRewards(value: unknown): value is CompanionRewardLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ledger = value as CompanionRewardLedger;
  const valid = (items: unknown): items is CompanionWordCredit[] => Array.isArray(items) && items.length <= 1_000_000 && items.every(item =>
    item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).every(key => ['term', 'day'].includes(key))
    && typeof item.term === 'string' && item.term.length > 0 && item.term.length <= 80 && item.term === termKey(item.term)
    && /^[a-z][a-z '\-]*$/.test(item.term) && typeof item.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.day)
    && Number.isFinite(Date.parse(item.day)) && new Date(item.day).toISOString().slice(0, 10) === item.day);
  if (![1, 2].includes(ledger.version) || Object.keys(ledger).some(key => !['version', 'learned', 'reviewed', ...(ledger.version === 2 ? ['legacyReviewUnlocks', 'parentGrantedOptimusAnimation'] : [])].includes(key)) || !valid(ledger.learned) || !valid(ledger.reviewed)) return false;
  if (ledger.version === 2 && ledger.parentGrantedOptimusAnimation !== undefined && ledger.parentGrantedOptimusAnimation !== true) return false;
  if (ledger.version === 2 && (!Number.isInteger(ledger.legacyReviewUnlocks) || ledger.legacyReviewUnlocks < 0 || ledger.legacyReviewUnlocks > Math.min(unlockableCompanions.length, Math.floor(ledger.reviewed.length / 20)))) return false;
  const learned = new Map(ledger.learned.map(item => [item.term, item.day]));
  return learned.size === ledger.learned.length && new Set(ledger.reviewed.map(reviewKey)).size === ledger.reviewed.length
    && ledger.reviewed.every(item => learned.has(item.term) && learned.get(item.term)! < item.day);
}

export function mergeCompanionRewards(a?: CompanionRewardLedger, b?: CompanionRewardLedger): CurrentCompanionRewardLedger {
  const learned = new Map<string, CompanionWordCredit>(), reviewed = new Map<string, CompanionWordCredit>();
  for (const item of [...(a?.learned ?? []), ...(b?.learned ?? [])]) if (!learned.has(item.term) || item.day < learned.get(item.term)!.day) learned.set(item.term, item);
  for (const item of [...(a?.reviewed ?? []), ...(b?.reviewed ?? [])]) reviewed.set(reviewKey(item), item);
  const parentGrantedOptimusAnimation = [a, b].some(ledger => ledger?.version === 2 && ledger.parentGrantedOptimusAnimation === true);
  return { version: 2, learned: [...learned.values()], reviewed: [...reviewed.values()], legacyReviewUnlocks: Math.max(legacyReviewUnlocks(a), legacyReviewUnlocks(b)),
    ...(parentGrantedOptimusAnimation ? { parentGrantedOptimusAnimation: true } : {}) };
}
