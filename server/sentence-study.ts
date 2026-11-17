import type {StoredData} from './store.ts';
import {AppError} from './store.ts';
import {assessmentWords} from '../shared/assessment.ts';
import {gameWord} from '../shared/game-plan.ts';
import {sentenceLesson,sentenceKey,sentenceChoices,studiedSentence,type SentenceStudy} from '../shared/sentence-study.ts';
import {validAssessmentCue} from '../shared/assessment-cues.ts';
import type {GameWord} from '../shared/contracts.ts';

export function requireSentenceStudy(data:StoredData,word:GameWord){if(sentenceLesson(word)&&!studiedSentence(data,word))throw new AppError('先学这句的用法，再来测试。','SENTENCE_STUDY_REQUIRED',409);}
export function sentenceStudyAction(data:StoredData,body:Record<string,unknown>,now:Date){
  if(Object.keys(body).some(key=>!['wordId','key','action','source','term'].includes(key))||!['start','demonstrate','choose'].includes(String(body.action)))throw new AppError('短句学习动作无效。');
  const pool=assessmentWords(data),word=pool.find(word=>word.id===body.wordId),lesson=word&&sentenceLesson(word);
  if(!word||!lesson||body.key!==sentenceKey({...word,learningVersion:word.learningVersion??0}))throw new AppError('这个短句已更新，请回到学习页重新打开。','SENTENCE_STUDY_STALE',409);
  const rows=data.sentenceStudies??=[],key=sentenceKey({...word,learningVersion:word.learningVersion??0});let row=rows.find(row=>sentenceKey(row.word)===key);
  if(body.action==='start'){
    if(!row){row={word:gameWord(word),cue:lesson.cue,startedAt:now.toISOString(),attempts:[]};rows.push(row);data.sentenceStudies=rows;}return row;
  }
  if(!row)throw new AppError('先打开这一句的学习。');
  if(body.action==='demonstrate'){
    if(body.source!=='audio'&&body.source!=='adult')throw new AppError('先听示范，或请大人带着读。');
    if(!row.demonstratedAt){row.demonstratedAt=now.toISOString();row.model=body.source;}return row;
  }
  if(!row.demonstratedAt)throw new AppError('先听一遍完整短句，再练一练。');
  if(typeof body.term!=='string'||!sentenceChoices(word,pool).includes(body.term))throw new AppError('请选择这题里的词。');
  if(!row.completedAt){row.attempts.push({term:body.term,at:now.toISOString()});if(body.term===word.term)row.completedAt=now.toISOString();}
  return row;
}
export function validSentenceStudies(value:unknown,wordIds:Set<string>):value is SentenceStudy[]{
  if(value===undefined)return true;
  if(!Array.isArray(value)||value.length>20000)return false;
  const date=(v:unknown):v is string=>typeof v==='string'&&v.length<40&&Number.isFinite(Date.parse(v));const keys=new Set<string>();
  return value.every((row:SentenceStudy)=>{
    if(!row||typeof row!=='object'||Object.keys(row).some(k=>!['word','cue','startedAt','demonstratedAt','model','attempts','completedAt'].includes(k)))return false;
    const w=row.word;let safeImage=false;try{safeImage=typeof w?.imageUrl==='string'&&/^(?:\/media\/|\/assets\/words\/)/.test(w.imageUrl)&&!decodeURIComponent(w.imageUrl).split(/[\\/]/).includes('..');}catch{}
    if(!w||Object.keys(w).sort().join()!=='id,imageUrl,learningVersion,meaning,term'||!wordIds.has(w.id)||typeof w.term!=='string'||typeof w.meaning!=='string'||!safeImage||!Number.isSafeInteger(w.learningVersion)||w.learningVersion<0||!date(row.startedAt)||!validAssessmentCue(row.cue,w)||row.cue.version!==2||!sentenceLesson(w)||!Array.isArray(row.attempts)||row.attempts.length>10000)return false;
    const key=sentenceKey(w);if(keys.has(key))return false;keys.add(key);
    if(Boolean(row.demonstratedAt)!==Boolean(row.model)||row.demonstratedAt&&(!date(row.demonstratedAt)||Date.parse(row.demonstratedAt)<Date.parse(row.startedAt)||!['audio','adult'].includes(row.model!)))return false;
    let previous=row.demonstratedAt??row.startedAt,success=false;
    for(const attempt of row.attempts){if(!row.demonstratedAt||success||!attempt||Object.keys(attempt).sort().join()!=='at,term'||typeof attempt.term!=='string'||attempt.term.length>80||!date(attempt.at)||Date.parse(attempt.at)<Date.parse(previous))return false;previous=attempt.at;success=attempt.term===w.term;}
    return success?row.completedAt===previous:row.completedAt===undefined;
  });
}
