import {createHash} from 'node:crypto';
import {buildStudyAgenda,type AgendaPurpose} from '../shared/study-agenda.ts';
import type {LearningData} from '../shared/learning.ts';
import {wordLearningProfiles,type WordLearningData} from '../shared/word-learning.ts';
import {STUDY_CONTINUITY_VERSION,studyContinuity,type StudyMode} from '../shared/study-continuity.ts';

function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Read-only adapter for the next API. No Store, credentials, provider or mutation dependencies. */
export function studyReadModel(data:LearningData&WordLearningData,{now=new Date(),mode,purpose='today'}:{now?:Date;mode:StudyMode;purpose?:AgendaPurpose}){
  if(!['child','test'].includes(mode))throw Error('需要明确隔离的学习模式。');
  const profiles=wordLearningProfiles(data,now),agenda=buildStudyAgenda(data,{now,purpose},profiles),continuity=studyContinuity(data,now,profiles);
  const sourceRevision=digest(data);
  const planId=digest({version:STUDY_CONTINUITY_VERSION,sourceRevision,mode,purpose,profiles,agenda,continuity});
  return {version:STUDY_CONTINUITY_VERSION,mode,readOnly:true as const,planId,sourceRevision,day:agenda.day,createdAt:now.toISOString(),profiles,agenda,continuity};
}
