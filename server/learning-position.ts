import type {StoredData} from './store.ts';
import {AppError,requireLearningPlanVersion} from './store.ts';
import {currentActivity} from '../shared/game-plan.ts';
import {currentReviewRetry} from '../shared/review-support.ts';
import {pendingLearningCheckpoint} from '../shared/learning-policy.ts';
import {validLearningPause} from '../shared/learning-pause.ts';
export function saveLearningPosition(data:StoredData,body:Record<string,unknown>,now:Date){
      const session=data.sessions.find(row=>row.id===body.sessionId);
      if(!session||session.completedAt||session.suspendedAt||Object.keys(body).some(key=>!['sessionId','planVersion','reason','activityId','draft'].includes(key))||!['pause','rest','leave'].includes(String(body.reason)))throw new AppError('保存位置无效，请回到当前轮次。','SESSION_SAVE_INVALID',409);
      requireLearningPlanVersion(session,body.planVersion);
      const activity=currentActivity(session)??currentReviewRetry(session);
      if(body.activityId!==activity?.id)throw new AppError('位置已变化，请重试保存当前题。','SESSION_SAVE_CONFLICT',409);
      const saved={version:1 as const,at:now.toISOString(),reason:body.reason as 'pause'|'rest'|'leave',...(activity?{activityId:activity.id}:{}),...(pendingLearningCheckpoint(session)?{checkpointId:pendingLearningCheckpoint(session)}:{}),...(body.draft===undefined?{}:{draft:body.draft as any})};
      if(!validLearningPause({...session,pauseState:saved}))throw new AppError('当前草稿无效，请重试。','SESSION_SAVE_INVALID');
      session.pauseState=saved;return session;

}
