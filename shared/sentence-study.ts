import type {AssessmentData,GameWord,Word} from './contracts.ts';
import {assessmentCue,type AssessmentCue} from './assessment-cues.ts';

export interface SentenceStudy {word:GameWord;cue:AssessmentCue;startedAt:string;demonstratedAt?:string;model?:'audio'|'adult';attempts:{term:string;at:string}[];completedAt?:string}
export function sentenceLesson(word:Pick<GameWord,'term'|'meaning'>){
  const cue=assessmentCue(word);if(!cue.sentence)return;
  const full=cue.sentence.replace('___',cue.sentence.startsWith('___')?word.term[0].toUpperCase()+word.term.slice(1):word.term);
  const notes:Record<string,string>={am:'说“我是”，I 后面用 am。',are:'说“你是”，You 后面用 are。',is:'说“他是”，He 后面用 is。',be:'想当什么，用 want to be。to 后面用 be。',at:'说在某个地点，可以用 at。',ate:'说昨天吃了，用 ate。',came:'说昨天来了，用 came。',all:'说全部的小朋友，用 all。',but:'前后意思转了个弯，“但是”用 but。',black:'黑色的，英文是 black。',brown:'棕色的，英文是 brown。'};
  return {cue,full,note:notes[word.term.toLowerCase()]??word.meaning};
}
export function sentenceKey(word:Pick<Word,'id'|'term'|'meaning'|'learningVersion'|'imageUrl'>){return JSON.stringify([word.id,word.learningVersion??0,word.term,word.meaning,word.imageUrl,sentenceLesson(word)?.cue]);}
export function studiedSentence(data:AssessmentData,word:Word|GameWord){return (data.sentenceStudies??[]).find(row=>sentenceKey(row.word)===sentenceKey({...word,learningVersion:word.learningVersion??0})&&row.completedAt);}
export function pendingSentenceWords<T extends Word|GameWord>(data:AssessmentData,words:T[]){return words.filter(word=>sentenceLesson(word)&&!studiedSentence(data,word));}
export function sentenceChoices(word:Word|GameWord,pool:(Word|GameWord)[]){
  const family=['am','are','be','is'].includes(word.term.toLowerCase())?['am','are','be','is']:['black','brown'].includes(word.term.toLowerCase())?['black','brown']:[];
  const alternatives=[...pool.filter(w=>family.includes(w.term.toLowerCase())),...pool].map(w=>w.term).filter(term=>term!==word.term);
  const terms=[word.term,...new Set(alternatives)].slice(0,3),shift=word.term.charCodeAt(0)%terms.length;
  return [...terms.slice(shift),...terms.slice(0,shift)];
}
