import type { AssessmentData, AssessmentDimension, AssessmentAttempt, BadgeAward, GrowthSummary, LearningAttempt, LearningSession, Word } from './contracts.ts';
import { assessmentDay, assessmentDimensions } from './assessment.ts';
import { buildBadges } from './badge-catalog.ts';

type GrowthData = AssessmentData & { words: Word[]; attempts: LearningAttempt[]; sessions: LearningSession[]; badgeAwards?: BadgeAward[] };
const DAY = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const termKey = (term: string) => term.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const shiftGrowthDay = (day: string, offset: number) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);

/** Read-only projection of saved evidence; never awards mastery from a sticker or a practice result. */
export function childGrowth(data: GrowthData, now = new Date()): GrowthSummary {
  const today = assessmentDay(now), nowTime = now.getTime();
  const dayCache = new Map<string, string>();
  const dayOf = (time: string) => { let day = dayCache.get(time); if (!day) { day = dayFormatter.format(new Date(time)); dayCache.set(time, day); } return day; };
  const validTime = (time: string) => Number.isFinite(Date.parse(time)) && Date.parse(time) <= nowTime;
  const wordMap = new Map(data.words.map(word => [word.id, word]));
  const sessions = new Map(data.sessions.map(session => [session.id, session]));
  const learning = data.attempts.filter(attempt => wordMap.has(attempt.wordId) && validTime(attempt.createdAt) && sessions.get(attempt.sessionId)?.wordIds.includes(attempt.wordId));
  const assessmentItems = new Map((data.assessments ?? []).flatMap(session => session.items.map(item => [`${session.id}:${item.id}`, item] as const)));
  const completedAssessments = new Set((data.assessments ?? []).filter(session => session.completedAt && validTime(session.completedAt) && session.items.length && (session.workflow === 'recorded' ? session.submittedAt && session.items.every(item => item.response) : session.items.every(item => item.result !== undefined))).map(session => session.id));
  const assessmentAttempts = (data.assessmentAttempts ?? []).filter(attempt => {
    const item = assessmentItems.get(`${attempt.sessionId}:${attempt.itemId}`);
    return wordMap.has(attempt.wordId) && validTime(attempt.createdAt) && item?.word.id === attempt.wordId && item.word.learningVersion === attempt.learningVersion && item.dimension === attempt.dimension && item.result === attempt.result && (attempt.dimension === 'look' ? attempt.source === 'server' : attempt.source === 'parent');
  });
  const days = new Set<string>();
  for (const attempt of learning) days.add(dayOf(attempt.createdAt));
  for (const attempt of assessmentAttempts) if (!['skipped', 'unavailable', 'unconfirmed'].includes(attempt.result)) days.add(dayOf(attempt.createdAt));
  for (const session of data.sessions) if (session.completedAt && session.wordIds.length && session.rewardGranted && validTime(session.completedAt) && session.wordIds.every(id => session.completedWordIds.includes(id))) days.add(dayOf(session.completedAt));
  const sortedDays = [...days].sort();
  let currentStreak = 0, longestStreak = 0, run = 0, previous = '';
  for (const day of sortedDays) { run = previous && shiftGrowthDay(previous, 1) === day ? run + 1 : 1; longestStreak = Math.max(longestStreak, run); previous = day; }
  for (let day = days.has(today) ? today : shiftGrowthDay(today, -1); days.has(day); day = shiftGrowthDay(day, -1)) currentStreak++;

  const latest = new Map<string, AssessmentAttempt>();
  const successDays = new Map<string, Set<string>>();
  const progressByDimension = new Map((data.assessmentProgress ?? []).map(item => [`${item.wordId}:${item.learningVersion}:${item.dimension}`, item]));
  for (const attempt of assessmentAttempts) {
    const word = wordMap.get(attempt.wordId)!, item = assessmentItems.get(`${attempt.sessionId}:${attempt.itemId}`)!;
    if (attempt.learningVersion !== (word.learningVersion ?? 0) || item.word.term !== word.term || item.word.meaning !== word.meaning || !completedAssessments.has(attempt.sessionId)) continue;
    if (word.learningResetAt && Date.parse(attempt.createdAt) < Date.parse(word.learningResetAt)) continue;
    const key = `${word.id}:${attempt.dimension}`, prior = latest.get(key);
    if (!prior || Date.parse(attempt.createdAt) >= Date.parse(prior.createdAt)) latest.set(key, attempt);
    if (attempt.result === 'correct') { const days = successDays.get(key) ?? new Set<string>(); days.add(dayOf(attempt.createdAt)); successDays.set(key, days); }
  }
  const practiced = new Set(learning.filter(attempt => (attempt.learningVersion ?? 0) === (wordMap.get(attempt.wordId)?.learningVersion ?? 0) && (!wordMap.get(attempt.wordId)?.learningResetAt || Date.parse(attempt.createdAt) >= Date.parse(wordMap.get(attempt.wordId)!.learningResetAt!))).map(attempt => attempt.wordId));
  const words = data.words.map(word => {
    const dimensions = assessmentDimensions.map(dimension => {
      const attempt = latest.get(`${word.id}:${dimension}`);
      const progress = progressByDimension.get(`${word.id}:${word.learningVersion ?? 0}:${dimension}`);
      return { dimension, result: attempt?.result, passed: attempt?.result === 'correct', dueAt: progress?.dueAt };
    });
    const verified = dimensions.every(item => item.passed);
    const stable = verified && dimensions.every(item => (successDays.get(`${word.id}:${item.dimension}`)?.size ?? 0) >= 2);
    return { wordId: word.id, term: word.term, meaning: word.meaning, practiced: practiced.has(word.id) || dimensions.some(item => item.result !== undefined), verified, stable, dimensions };
  }).filter(word => word.practiced);
  // A repeated English entry across books counts once; the word list still shows its tested meaning.
  const count = (rows: typeof words) => new Set(rows.map(word => termKey(word.term))).size;
  const verifiedWords = count(words.filter(word => word.verified));
  const skills = Object.fromEntries(assessmentDimensions.map(dimension => [dimension, count(words.filter(word => word.dimensions.find(item => item.dimension === dimension)?.passed))])) as Record<AssessmentDimension, number>;
  const stableWords = count(words.filter(word => word.stable));
  const badges = buildBadges({ days: sortedDays.length, practicedWords: count(words), verifiedWords, stableWords, ...skills }, data.badgeAwards?.filter(award => validTime(award.recordedAt)));
  const ranks = [{ target: 0, title: '新晋探险家' }, ...badges.filter(item => item.series === 'verifiedWords').map(item => ({ target: item.target, title: item.title }))];
  const rank = [...ranks].reverse().find(item => verifiedWords >= item.target)!;
  return { asOf: now.toISOString(), days: sortedDays, totalDays: sortedDays.length, currentStreak, longestStreak, todayCheckedIn: days.has(today),
    todayPracticedWords: new Set(learning.filter(attempt => dayOf(attempt.createdAt) === today).map(attempt => termKey(wordMap.get(attempt.wordId)!.term))).size,
    practicedWords: count(words), verifiedWords, stableWords, dueWords: count(words.filter(word => word.dimensions.some(item => item.dueAt && Date.parse(item.dueAt) <= nowTime))), skills, words, badges,
    rank: { title: rank.title, nextTarget: badges.find(item => item.series === 'verifiedWords' && !item.unlocked)?.target } };
}

/** First attainment is recorded once, within the store transaction; reads never write awards. */
export function recordBadgeAwards(data: GrowthData, now: Date) {
  const source: BadgeAward['source'] = data.badgeAwards === undefined ? 'backfill' : 'progress';
  const awards = data.badgeAwards ?? [], known = new Set(awards.map(award => award.badgeId));
  const newlyEarned = childGrowth(data, now).badges.filter(badge => badge.current >= badge.target && !known.has(badge.id));
  data.badgeAwards = [...awards, ...newlyEarned.map(badge => ({ badgeId: badge.id, recordedAt: now.toISOString(), value: badge.current, source }))];
}
