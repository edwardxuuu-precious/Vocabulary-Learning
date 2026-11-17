import type {AssessmentDimension,AssessmentResult,GameWord,LearningAttempt,LearningSession,PracticeRecording,Word} from '../../shared/contracts.ts';
import type {LearningData} from '../../shared/learning.ts';
import type {WordLearningData} from '../../shared/word-learning.ts';

export const now=new Date('2026-11-16T04:00:00Z'),before='2026-11-14T02:00:00Z',later='2026-11-15T02:00:00Z';
export const word:Word={id:'w',packId:'p',term:'red',meaning:'红色的',imageUrl:'/media/approved-original.png',imageSource:'upload',assetStatus:'approved',learningVersion:0};
export const snapshot=(w:Word):GameWord=>({id:w.id,term:w.term,meaning:w.meaning,imageUrl:w.imageUrl,learningVersion:w.learningVersion??0});
export function fixture(words=[{...word}]):LearningData&WordLearningData&{practiceRecordings:PracticeRecording[]}{return {words,packs:[{id:'p',title:'工程词书',enabled:true,createdAt:before}],settings:{dailyNewWords:3,dailyReviewWords:6,sessionMinutes:10,spellingEnabled:false,monthlyBudgetCny:0,voiceEnabled:true,learningStrategy:'memory-loop'},progress:[],attempts:[],sessions:[],learningHistory:[],assessments:[],assessmentAttempts:[],assessmentProgress:[],assessmentPractices:[],sentenceStudies:[],practiceRecordings:[]};}
export function encountered(data:LearningData,w=word,at=before){data.learningHistory!.push({wordId:w.id,learningVersion:w.learningVersion??0,introducedAt:at});}
export function formal(data:LearningData,dimension:AssessmentDimension,result:AssessmentResult,at=before,w=word,confirmedAt=at){const id=`a-${data.assessmentAttempts!.length}`;data.assessments!.push({id,mode:'full',wordIds:[w.id],startedAt:at,completedAt:at,items:[{id,word:snapshot(w),dimension,choices:[],result}]});data.assessmentAttempts!.push({id,sessionId:id,itemId:id,wordId:w.id,learningVersion:w.learningVersion??0,dimension,result,source:dimension==='look'?'server':'parent',createdAt:at,confirmedAt});}
export function passed(data:LearningData,at=before,w=word){for(const dimension of ['look','read','en-zh','zh-en'] as const)formal(data,dimension,'correct',at,w);}
export function attempt(data:LearningData,extra:Partial<LearningAttempt>={}){data.attempts!.push({id:`l-${data.attempts!.length}`,wordId:word.id,learningVersion:0,sessionId:'learning',skill:'listen',step:'listen',source:'click',correct:true,hinted:false,createdAt:later,...extra});}
export function pending(data:LearningData,dimension:AssessmentDimension='read',status:'ready'|'missing'='ready'){const id=`pending-${data.assessments!.length}`;data.assessments!.push({id,workflow:'recorded',mode:'full',wordIds:[word.id],startedAt:later,submittedAt:later,job:{status:'review',stage:'grade',runs:1},items:[{id,word:snapshot(word),dimension,choices:[],response:{version:1,kind:'recording',answeredAt:later,recording:{id,bytes:16044,seconds:.5,sha256:'a'.repeat(64),status}}}]});}
export function saved(data:LearningData,step:'read'|'spell'='read'){
  const activity={id:`w:${step}`,wordId:word.id,word:snapshot(word),step,kind:'standard' as const,choices:[]};
  const session:LearningSession={id:'learning',wordIds:[word.id],completedWordIds:[],startedAt:before,rewardGranted:false,tasks:[{wordId:word.id,mode:'new',steps:['learn',step]}],completedSteps:{w:['learn']},activities:[activity],activityStates:{}};
  data.sessions!.push(session);data.activeSession=session;return session;
}
