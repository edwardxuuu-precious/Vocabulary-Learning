import {reconcileStudySession} from './study-migration.ts';
import type {GameWord,LearningTask,LearningSession} from '../shared/contracts.ts';
import type {AgendaPurpose} from '../shared/study-agenda.ts';
import type {StudyStartRequest,StudyTarget,StudyRuntimeState} from '../shared/study-execution.ts';
import {abilityDimension} from '../shared/word-learning.ts';
import {assessmentPicturePool,maxAssessmentWords,sameAssessmentWord} from '../shared/assessment.ts';
import {gameWord,currentActivity} from '../shared/game-plan.ts';
import {studyReadModel} from './study-read-model.ts';
import {createAssessment} from './assessments.ts';
import {AppError,type StoredData} from './store.ts';
import {entryScopeCurrent} from '../shared/learning-entry.ts';
import {pendingSentenceWords} from '../shared/sentence-study.ts';

export function studyRuntimeState(data:StoredData,readyWordIds:string[],now:Date,mode:'child'|'test'):StudyRuntimeState{
  const input={...data,learningReadyWordIds:readyWordIds},today=studyReadModel(input,{now,mode});
  const plans=Object.fromEntries((['today','learn','review'] as const).map(purpose=>{const model=purpose==='today'?today:studyReadModel(input,{now,mode,purpose});return [purpose,{planId:model.planId,agenda:{...model.agenda,mode:'execution'}}];})) as StudyRuntimeState['plans'];
  return {version:1,mode,profiles:today.profiles,plans,continuity:today.continuity.map(({targets,...row})=>row)};
}

interface Context {now:Date;mode:'child'|'test';readyWordIds:string[];build:(tasks:LearningTask[],purpose:AgendaPurpose,requestId:string)=>LearningSession}
/** Runs inside the Store transaction, including the idempotency receipt and artifact creation. */
export function startStudyExecution(data:StoredData,body:Record<string,unknown>,ctx:Context):StudyTarget{
  if(Object.keys(body).some(key=>!['version','planId','mode','purpose','action','requestId','sessionId','activityId','wordIds','assessmentId'].includes(key))||body.version!==1||typeof body.planId!=='string'||!['learn','review','today'].includes(String(body.purpose))||!['recommended','new','resume','follow-up','resume-assessment'].includes(String(body.action))||typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(body.requestId)||body.sessionId!==undefined&&typeof body.sessionId!=='string'||body.activityId!==undefined&&typeof body.activityId!=='string')throw new AppError('学习安排请求无效。','STUDY_INVALID');
  const request=body as unknown as StudyStartRequest;
  if(request.mode!==ctx.mode)throw new AppError('请回到正确的学习入口。','STUDY_MODE_CONFLICT',409);
  const payload=JSON.stringify([request.version,request.planId,request.mode,request.purpose,request.action,request.sessionId,request.activityId,request.wordIds,request.assessmentId]);
  const previous=data.studyReceipts?.find(row=>row.requestId===request.requestId);
  if(previous){
    if(previous.payload!==payload||previous.mode!==ctx.mode)throw new AppError('这次操作已用于另一项安排。','STUDY_REQUEST_CONFLICT',409);
    if(previous.scope?.some(snapshot=>!data.words.some(word=>ctx.readyWordIds.includes(word.id)&&word.id===snapshot.id&&(word.learningVersion??0)===snapshot.learningVersion&&word.term===snapshot.term&&word.meaning===snapshot.meaning&&word.imageUrl===snapshot.imageUrl)))throw new AppError('素材或词义已更新，旧记录仍保留。','STUDY_CONTENT_CHANGED',409);
    if(previous.target.kind==='learning'&&data.activeLearningSessionId!==previous.target.sessionId&&!data.sessions.find(session=>session.id===(previous.target as {sessionId:string}).sessionId)?.completedAt)throw new AppError('已经接到另一份进度，请回当前学习继续。','STUDY_POSITION_CHANGED',409);
    return structuredClone(previous.target);
  }
  const model=studyReadModel({...data,learningReadyWordIds:ctx.readyWordIds},{now:ctx.now,mode:ctx.mode,purpose:request.purpose});
  if(request.planId!==model.planId)throw new AppError('学习安排已更新，请刷新后继续。','STUDY_PLAN_CHANGED',409);
  if(request.action==='follow-up'&&(!Array.isArray(request.wordIds)||request.purpose!=='review'))throw new AppError('请明确这次检查的已学词。','STUDY_INVALID');
  if(request.assessmentId!==undefined&&request.action!=='resume-assessment')throw new AppError('检查范围无效。','STUDY_INVALID');
  if(request.wordIds!==undefined&&(request.action!=='follow-up'||!Array.isArray(request.wordIds)||!request.wordIds.length||request.wordIds.length>40||new Set(request.wordIds).size!==request.wordIds.length||request.wordIds.some(id=>typeof id!=='string'||!model.profiles.some(profile=>profile.wordId===id&&profile.encountered&&profile.available))))throw new AppError('这些词需要先学习或检查素材。','STUDY_SCOPE_CHANGED',409);
  let target:StudyTarget;
  if(request.action==='resume-assessment'){
    const assessment=data.assessments?.find(row=>row.id===request.assessmentId&&row.workflow==='recorded'&&!row.submittedAt);
    const pictures=assessmentPicturePool(data);
    if(!assessment||assessment.items.some(item=>!data.words.some(word=>ctx.readyWordIds.includes(word.id)&&sameAssessmentWord(word,item.word))
      ||item.choices.some(choice=>!pictures.some(word=>sameAssessmentWord(word,choice)))))throw new AppError('原检查记录保留，请先检查词义或素材。','STUDY_CONTENT_CHANGED',409);
    target={kind:'assessment',assessmentId:assessment.id};
  }else if(request.action==='resume'){
    const session=data.sessions.find(session=>session.id===request.sessionId&&!session.completedAt&&!session.suspendedAt);
    if(!session||model.continuity.find(row=>row.sessionId===session.id)?.action==='prepare-content'||!entryScopeCurrent(data,session)||session.wordIds.some(id=>!ctx.readyWordIds.includes(id)))throw new AppError('原进度保留，请先检查词语或素材。','STUDY_CONTENT_CHANGED',409);
    if(request.activityId!==currentActivity(session)?.id)throw new AppError('当前题已变化，请重新连接。','STUDY_POSITION_CHANGED',409);
    reconcileStudySession(data,session,ctx.now);session.lastResumedAt=ctx.now.toISOString();data.activeLearningSessionId=session.id;
    target={kind:'learning',sessionId:session.id};
  }else{
    if(request.sessionId!==undefined||request.activityId!==undefined||request.action==='new'&&request.purpose!=='learn')throw new AppError('学习安排范围无效。','STUDY_INVALID');
    const agenda=request.action==='follow-up'&&request.wordIds?studyReadModel({...data,words:data.words.filter(word=>request.wordIds!.includes(word.id)),learningReadyWordIds:ctx.readyWordIds},{now:ctx.now,mode:ctx.mode,purpose:'review'}).agenda:model.agenda;
    const newGroup=agenda.learningGroup;
    const needsMastery=!!newGroup&&newGroup.mastered<newGroup.wordIds.length;
    const goals=request.action!=='new'?agenda.goals:agenda.goals.some(goal=>goal.kind==='introduce')?agenda.goals.filter(goal=>goal.kind==='introduce'||goal.kind==='consolidate'):[];
    const first=goals[0];
    if(!first)target={kind:'empty',reason:needsMastery?'先完成这组词的学习与核验，再开始下一组。':model.agenda.waitingReviewWordIds.length?'回答已保存，等待家长核验；可以休息或主动选择其他词。':'今天这部分已经完成，可以休息或选择其他内容。'};
    else if(first.kind==='continue'&&first.savedTarget){
      const session=data.sessions.find(session=>session.id===first.savedTarget!.sessionId&&!session.completedAt&&!session.suspendedAt);
      if(!session||model.continuity.find(row=>row.sessionId===session.id)?.action==='prepare-content'||!entryScopeCurrent(data,session))throw new AppError('这份进度需要检查，原记录仍保留。','STUDY_CONTENT_CHANGED',409);
      reconcileStudySession(data,session,ctx.now);session.lastResumedAt=ctx.now.toISOString();data.activeLearningSessionId=session.id;target={kind:'learning',sessionId:session.id};
    }else if(first.kind==='teach-usage'){
      const ids=goals.filter(goal=>goal.kind==='teach-usage').map(goal=>goal.wordId);
      target={kind:'usage',wordIds:ids,followUpWordIds:request.wordIds??ids};
    }else if(first.kind==='check'||first.kind==='review'&&goals.some(goal=>goal.kind==='review'&&goal.ability&&abilityDimension(goal.ability))){
      const candidates=goals.filter(goal=>goal.kind===first.kind&&abilityDimension(goal.ability!));
      const checkIds=new Set([...new Set(candidates.map(goal=>goal.wordId))].slice(0,maxAssessmentWords));
      const checks=candidates.filter(goal=>checkIds.has(goal.wordId)).map(goal=>({wordId:goal.wordId,dimension:abilityDimension(goal.ability!)!}));
      const words=data.words.filter(word=>checks.some(row=>row.wordId===word.id)),pending=pendingSentenceWords(data,words.filter(word=>checks.some(row=>row.wordId===word.id&&row.dimension==='zh-en')));
      if(pending.length)target={kind:'usage',wordIds:pending.map(word=>word.id),followUpWordIds:request.wordIds??checks.map(row=>row.wordId).filter((id,index,ids)=>ids.indexOf(id)===index)};
      else{
        const current=(snapshot:GameWord)=>data.words.some(word=>ctx.readyWordIds.includes(word.id)&&sameAssessmentWord(word,snapshot));
        const pictures=assessmentPicturePool(data);
        const existing=[...(data.assessments??[])].reverse().find(session=>session.workflow==='recorded'&&!session.submittedAt&&session.items.length===checks.length
          &&session.items.every(item=>checks.some(row=>row.wordId===item.word.id&&row.dimension===item.dimension)&&current(item.word)
            &&item.choices.every(choice=>pictures.some(word=>sameAssessmentWord(word,choice)))));
        const assessment=existing??createAssessment(data,{mode:'recommended',workflow:'recorded',cueVersion:2},ctx.now,Math.random,checks);
        target={kind:'assessment',assessmentId:assessment.id};
      }
    }else{
      const selected=goals.filter(goal=>goal.kind===first.kind||request.purpose==='learn'&&first.kind==='introduce'&&goal.kind==='consolidate');
      const tasks:LearningTask[]=[];
      for(const goal of selected){let task=tasks.find(task=>task.wordId===goal.wordId);if(!task){task={wordId:goal.wordId,mode:goal.kind==='introduce'?'new':'review',steps:[]};tasks.push(task);}for(const step of goal.steps)if(!task.steps.includes(step))task.steps.push(step);}
      const session=ctx.build(tasks,request.purpose,request.requestId);session.studyPlan={version:1,purpose:request.purpose,goalIds:selected.map(goal=>goal.id),covered:[]};target={kind:'learning',sessionId:session.id};
    }
  }
  if(data.learningTaskPolicy===1&&(target.kind==='usage'||target.kind==='assessment'))data.activeLearningSessionId=null;
  const ids=target.kind==='usage'?target.wordIds:target.kind==='learning'?data.sessions.find(session=>session.id===target.sessionId)?.wordIds:target.kind==='assessment'?data.assessments?.find(session=>session.id===target.assessmentId)?.wordIds:[];
  (data.studyReceipts??=[]).push({requestId:request.requestId,payload,mode:ctx.mode,at:ctx.now.toISOString(),target:structuredClone(target),scope:data.words.filter(word=>ids?.includes(word.id)).map(gameWord)});
  return target;
}
