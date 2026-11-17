import type {LearningActivity,LearningSession,LearningStep} from './contracts.ts';
export const studyActivityCovered=(session:LearningSession,activity:LearningActivity)=>!!session.studyPlan?.covered.some(row=>row.activityId===activity.id);
export const studyStepCovered=(session:LearningSession,wordId:string,step:LearningStep)=>!!session.activities?.some(activity=>activity.wordId===wordId&&activity.step===step&&studyActivityCovered(session,activity));
export const resolvedStudyStep=(session:LearningSession,wordId:string,step:LearningStep)=>!!session.completedSteps?.[wordId]?.includes(step)||studyStepCovered(session,wordId,step);
export const nextStudyStep=(session:LearningSession,wordId:string)=>session.tasks?.find(task=>task.wordId===wordId)?.steps.find(step=>!resolvedStudyStep(session,wordId,step));
