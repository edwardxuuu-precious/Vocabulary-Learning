import type {AssessmentData,GameWord,Word} from './contracts.ts';
import {assessmentCue,type AssessmentCue} from './assessment-cues.ts';

export interface SentenceStudy {word:GameWord;cue:AssessmentCue;startedAt:string;demonstratedAt?:string;model?:'audio'|'adult';attempts:{term:string;at:string}[];completedAt?:string}
const usagePairs:Record<string,{meaning:string;phrase:string}>={
  am:{meaning:'我是',phrase:'I am'},
  are:{meaning:'你是',phrase:'You are'},
  is:{meaning:'他是',phrase:'He is'},
  be:{meaning:'想当',phrase:'want to be'},
  at:{meaning:'在学校',phrase:'at school'},
  ate:{meaning:'吃了',phrase:'ate'},
  came:{meaning:'来了',phrase:'came'},
  all:{meaning:'所有的小朋友',phrase:'all the children'},
  but:{meaning:'但是',phrase:'but'},
  black:{meaning:'黑色的',phrase:'black'},
  brown:{meaning:'棕色的',phrase:'brown'},
};
export function sentenceLesson(word:Pick<GameWord,'term'|'meaning'>){
  const cue=assessmentCue(word);if(!cue.sentence)return;
  const full=cue.sentence.replace('___',cue.sentence.startsWith('___')?word.term[0].toUpperCase()+word.term.slice(1):word.term);
  return {cue,full,usage:usagePairs[word.term.toLowerCase()]??{meaning:word.meaning,phrase:word.term}};
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
