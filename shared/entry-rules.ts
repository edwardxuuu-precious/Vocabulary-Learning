import type { LearningExposure, Word, WordPack } from './contracts.ts';

export const entryRuleVersion='entry-rules-v1';
export type EntryIntent='learn'|'review';
export type EntryOrigin=EntryIntent|'legacy';
export interface EntryPoolInput {
  words:Word[];
  packs:WordPack[];
  /** Trusted completed introductions/current-version encounters, not selected or reserved words. */
  introductions:LearningExposure[];
  audioReadyWordIds:string[];
}
/** Preview adapter only for now. Does not approve, deliver, grade, or change schedules. */
export function entryPools(data:EntryPoolInput,now=new Date()) {
  const packs=new Set(data.packs.filter(pack=>pack.enabled&&!pack.isSample&&!pack.deletedAt).map(pack=>pack.id));
  const audio=new Set(data.audioReadyWordIds);
  const ready=data.words.filter(word=>packs.has(word.packId)&&!word.deletedAt&&word.assetStatus==='approved'
    &&word.imageUrl!=='/assets/placeholder.svg'&&audio.has(word.id));
  const known=new Set(data.introductions.filter(fact=>{
    const word=ready.find(word=>word.id===fact.wordId),time=Date.parse(fact.introducedAt);
    return word&&fact.learningVersion===(word.learningVersion??0)&&Number.isFinite(time)&&time<=now.getTime()
      &&!(time<Date.parse(word.learningResetAt??''));
  }).map(fact=>fact.wordId));
  return {ready,learn:ready.filter(word=>!known.has(word.id)),review:ready.filter(word=>known.has(word.id))};
}

export interface EntrySessionScope {
  id:string;
  intent:EntryOrigin;
  source:'recommended'|'book'|'legacy';
  packId?:string;
  status:'active'|'paused'|'completed';
  words:Pick<Word,'id'|'term'|'meaning'|'learningVersion'>[];
}
export function entryResume<T extends EntrySessionScope>(sessions:readonly T[],intent:EntryIntent,packId?:string) {
  return sessions.find(session=>session.intent===intent&&session.status!=='completed'
    &&session.source===(packId?'book':'recommended')&&session.packId===packId);
}
export function entryScopeIssue(session:EntrySessionScope,ready:readonly Word[]):'scope-changed'|undefined {
  return session.words.some(snapshot=>!ready.some(word=>word.id===snapshot.id
    &&(word.learningVersion??0)===(snapshot.learningVersion??0)&&word.term===snapshot.term&&word.meaning===snapshot.meaning))
    ?'scope-changed':undefined;
}
