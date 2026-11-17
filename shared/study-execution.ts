import type {GameWord,AppState,LearningSession} from './contracts.ts';
import type {AgendaPurpose,StudyAgenda} from './study-agenda.ts';
import type {StudyMode,LegacySessionMapping} from './study-continuity.ts';
import type {WordLearningProfile} from './word-learning.ts';

export type StudyTarget={kind:'learning';sessionId:string}|{kind:'assessment';assessmentId:string}|{kind:'usage';wordIds:string[];followUpWordIds?:string[]}|{kind:'empty';reason:string};
export interface StudyStartRequest {version:1;planId:string;mode:StudyMode;purpose:AgendaPurpose;action:'recommended'|'new'|'resume'|'follow-up'|'resume-assessment';requestId:string;wordIds?:string[];sessionId?:string;activityId?:string;assessmentId?:string}
export interface StudyReceipt {requestId:string;payload:string;mode:StudyMode;at:string;target:StudyTarget;scope?:GameWord[]}
export interface StudyExecutionData {studyReceipts?:StudyReceipt[]}
export interface StudyCoveredActivity {activityId:string;at:string;evidenceIds:string[]}
export interface StudySessionPlan {version:1;purpose:AgendaPurpose;goalIds:string[];covered:StudyCoveredActivity[]}
export interface StudyPlanView {planId:string;agenda:StudyAgenda}
export interface StudyRuntimeState {version:1;mode:StudyMode;profiles:WordLearningProfile[];plans:Record<AgendaPurpose,StudyPlanView>;continuity:Omit<LegacySessionMapping,'targets'>[]}
export interface StudyStartResponse {target:StudyTarget}

export function studyPracticedWordIds(state:AppState,session:LearningSession|null){
  if(!session)return [];
  const ids=new Set(session.completedWordIds);
  if(session.studyPlan)for(const activity of session.activities??[])if(session.completedSteps?.[activity.wordId]?.includes(activity.step)&&state.words.some(word=>word.id===activity.wordId&&(word.learningVersion??0)===activity.word.learningVersion&&word.term===activity.word.term&&word.meaning===activity.word.meaning&&word.imageUrl===activity.word.imageUrl))ids.add(activity.wordId);
  return [...ids];
}
