import type { PackGameAudioStatus } from '../shared/contracts.ts';
import { derivedGameKinds, derivedWordMaterial } from '../shared/game-material-builder.ts';
import type * as providers from './integrations/index.ts';
import { gameMaterialAudioCues, prepareGameAudio } from './game-audio-preparation.ts';
import { AppError, type Store } from './store.ts';

/** Parent-authorized, bounded background preparation. It never approves extra meanings or images. */
export function createPackGameAudio({store,integration,dataDir,imageAvailable}:{store:Store;integration:Pick<typeof providers,'getCachedSpeech'|'synthesizeSpeech'|'estimateTtsCost'|'ttsStatus'>;dataDir:string;imageAvailable:(url:string)=>boolean}) {
  type Job={packId:string;fingerprint:string;controller:AbortController;done:Promise<void>};
  const active=new Map<string,Job>(),outcomes=new Map<string,{fingerprint:string;status:'stopped'|'error';error?:string}>();let closed=false;
  const snapshot=(packId:string)=>{
    const data=store.read(),pack=data.packs.find(p=>p.id===packId&&!p.deletedAt&&!p.isSample);
    if(!pack)throw new AppError('找不到正式词书。','NOT_FOUND',404);
    const words=data.words.filter(w=>w.packId===packId&&!w.deletedAt&&w.assetStatus==='approved'&&w.imageUrl!=='/assets/placeholder.svg'&&imageAvailable(w.imageUrl));
    return {words,fingerprint:JSON.stringify(words.map(w=>[w.id,w.term,w.meaning,w.imageUrl,w.learningVersion]))};
  };
  async function getStatus(packId:string):Promise<PackGameAudioStatus>{
    const value=snapshot(packId);let ready=0;
    for(const word of value.words)for(const kind of derivedGameKinds){const cues=gameMaterialAudioCues(word,kind,derivedWordMaterial(word,kind)!);if((await Promise.all(cues.map(cue=>integration.getCachedSpeech({...cue,tone:'clear',dataDir}).catch(()=>undefined)))).every(Boolean))ready++;}
    if(snapshot(packId).fingerprint!==value.fingerprint)return{packId,status:'error',total:0,ready:0,error:'词书已变化，请重新检查。'};
    const outcome=outcomes.get(packId),current=outcome?.fingerprint===value.fingerprint?outcome:undefined,total=value.words.length*2;
    return{packId,total,ready,status:active.has(packId)?'running':ready===total&&total>0?'ready':current?.status??'idle',...(current?.error?{error:current.error}:{})};
  }
  async function start(packId:string):Promise<PackGameAudioStatus>{
    if(closed)throw new AppError('游戏发音准备已关闭。');
    if(active.has(packId))return getStatus(packId);
    const value=snapshot(packId),job:Job={packId,fingerprint:value.fingerprint,controller:new AbortController(),done:Promise.resolve()};
    if(!value.words.length)return{packId,total:0,ready:0,status:'idle'};
    active.set(packId,job);outcomes.delete(packId);
    const check=()=>{if(closed||job.controller.signal.aborted||snapshot(packId).fingerprint!==job.fingerprint)throw new AppError('词书已变化或准备已停止。','GAME_MATERIAL_STALE',409);};
    job.done=(async()=>{
      try{
        const items=value.words.flatMap(word=>derivedGameKinds.map(kind=>({word,kind,material:derivedWordMaterial(word,kind)!})));
        const cues=[...new Map(items.flatMap(p=>gameMaterialAudioCues(p.word,p.kind,p.material)).map(c=>[c.locale+':'+c.text,c])).values()];
        let missing=0;for(const cue of cues){check();if(!await integration.getCachedSpeech({...cue,tone:'clear',dataDir,signal:job.controller.signal}))missing+=cue.text.length;}
        if(missing>5000)throw new AppError('本次缺失发音超过5000字符，请在家长页分批准备。','GAME_MATERIAL_LIMIT',409);
        for(const p of items){check();await prepareGameAudio({...p,integration,store,dataDir,signal:job.controller.signal,check});}
      }catch(error){outcomes.set(packId,{fingerprint:job.fingerprint,status:job.controller.signal.aborted?'stopped':'error',...(!job.controller.signal.aborted?{error:error instanceof Error&&'code'in error?error.message:'游戏发音未完成，已停止；已有缓存保留。'}:{})});}
      finally{if(active.get(packId)===job)active.delete(packId);}
    })();
    return getStatus(packId);
  }
  async function cancel(packId:string){const job=active.get(packId);if(job){job.controller.abort();await job.done;}const value=snapshot(packId);outcomes.set(packId,{fingerprint:value.fingerprint,status:'stopped'});return getStatus(packId);}
  return{start,getStatus,cancel,busy:()=>active.size>0,async close(){closed=true;const jobs=[...active.values()];jobs.forEach(j=>j.controller.abort());await Promise.all(jobs.map(j=>j.done));}};
}
