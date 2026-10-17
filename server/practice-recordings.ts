import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LearningActivity, PracticeRecording, PracticeRecordingTarget } from '../shared/contracts.ts';
import { currentActivity } from '../shared/game-plan.ts';
import { newWordSteps } from '../shared/learning.ts';
import { oralActivity } from '../shared/oral-practice.ts';
import { validateChallengeWav } from './challenges.ts';
import { AppError, type Store } from './store.ts';

/** Practice audio stays private on this machine; saving never grades or advances learning. */
export function createPracticeRecordings(store: Store) {
  const root=path.join(store.dataDir,'practice-recordings');mkdirSync(root,{recursive:true});
  const file=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw new AppError('录音编号无效。');const target=path.join(root,id+'.wav');if(existsSync(target)&&!realpathSync(target).startsWith(realpathSync(root)+path.sep))throw new AppError('录音路径无效。');return target;};
  function current(target:PracticeRecordingTarget) {
    const data=store.read(),session=data.activeLearningSessionId===undefined?[...data.sessions].reverse().find(s=>!s.completedAt&&!s.suspendedAt):data.sessions.find(s=>s.id===data.activeLearningSessionId&&!s.completedAt&&!s.suspendedAt);
    if(!session||session.id!==target.sessionId)throw new AppError('这轮学习已结束，请在当前环节录音。','RECORDING_STALE',409);
    let a=currentActivity(session);
    if(!session.activities){const word=data.words.find(w=>w.id===session.wordIds.find(id=>!session.completedWordIds.includes(id)));if(word){const step=target.activityId.slice(word.id.length+1) as LearningActivity['step'];const steps=session.tasks?.find(t=>t.wordId===word.id)?.steps??newWordSteps(word,data.settings.spellingEnabled);if(target.activityId===`${word.id}:${step}`&&steps.includes(step))a={id:target.activityId,wordId:word.id,word:{...word,learningVersion:word.learningVersion??0},step,kind:'standard',choices:[]};}}
    const word=a&&data.words.find(w=>w.id===a.wordId);
    if(!a||a.id!==target.activityId||!oralActivity(a)||!word||word.assetStatus!=='approved'||!data.packs.some(p=>p.id===word.packId&&p.enabled)||(word.learningVersion??0)!==(a.word.learningVersion??0)||word.term!==a.word.term||word.meaning!==a.word.meaning)throw new AppError('当前环节或词义已变化，请刷新后再录。','RECORDING_STALE',409);
    const scene=session.activityStates?.[`${a.wordId}:sound`],state=session.activityStates?.[a.id]??(a.kind==='associate'&&scene?.composed?scene:{});
    if(a.kind==='pantomime'&&!state.gameStage||['clue','cloze'].includes(a.kind)&&!state.heard||a.kind==='information'&&!state.handedOver)throw new AppError('先准备好线索，再录音。','RECORDING_STALE',409);
    if(a.kind==='missing'&&!state.concealed||a.kind==='associate'&&!state.composed)throw new AppError('先完成当前游戏的准备步骤，再录音。','RECORDING_STALE',409);
    return {a,session};
  }
  const ready=(r:PracticeRecording):PracticeRecording=>({...r,status:r.status==='ready'&&existsSync(file(r.id))?'ready':'missing'});
  const rows=(target?:PracticeRecordingTarget)=>(store.read().practiceRecordings??[]).filter(r=>!target||r.sessionId===target.sessionId&&r.activityId===target.activityId).map(ready);
  return {
    current,
    list(target?:PracticeRecordingTarget){if(target)current(target);return rows(target);},
    upload(target:PracticeRecordingTarget,id:string,audio:Buffer){
      const {a,session}=current(target),seconds=validateChallengeWav(audio),sha256=createHash('sha256').update(audio).digest('hex');file(id);
      const existing=(store.read().practiceRecordings??[]).find(r=>r.id===id);
      if(existing){if(existing.sessionId!==target.sessionId||existing.activityId!==target.activityId||existing.sha256!==sha256)throw new AppError('录音编号已使用，请重新录音。');if(existing.status==='ready'&&existsSync(file(id)))return rows(target);throw new AppError('这段录音已失效，请重新录音。');}
      if((store.read().practiceRecordings??[]).length>=100000)throw new AppError('本机练习录音记录已满。');
      const saved=rows(target).filter(r=>r.status==='ready');if(saved.length>=3)throw new AppError('这个环节已录好三遍，可以回放或继续。');
      const state=session.activityStates?.[a.id]??{};
      const mode=['read','practice-read'].includes(a.step)&&!state.revealed?'read':a.kind==='standard'&&a.step==='recall'||state.revealed||state.optionsVisible||a.kind==='information'&&state.heardOptionIds?.length?'follow':'recall';
      const recording:PracticeRecording={...target,id,word:{id:a.word.id,term:a.word.term,meaning:a.word.meaning,imageUrl:a.word.imageUrl,learningVersion:a.word.learningVersion??0},kind:a.kind,step:a.step,mode,round:saved.length+1,createdAt:store.clock().toISOString(),seconds,bytes:audio.length,sha256,status:'ready'};
      writeFileSync(file(id),audio,{flag:'wx'});
      try{store.mutate(data=>{data.practiceRecordings??=[];data.practiceRecordings.push(recording);});}catch(error){unlinkSync(file(id));throw error;}
      return rows(target);
    },
    audio(id:string,target?:PracticeRecordingTarget){
      if(target)current(target);
      const recording=rows(target).find(r=>r.id===id);if(!recording||recording.status!=='ready')throw new AppError('这段录音暂不可用。','RECORDING_MISSING',404);
      const bytes=readFileSync(file(id));if(bytes.length!==recording.bytes||createHash('sha256').update(bytes).digest('hex')!==recording.sha256)throw new AppError('录音文件已变化，请重新录音。','RECORDING_MISSING',404);return bytes;
    },
  };
}
