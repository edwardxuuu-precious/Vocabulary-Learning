import {useEffect,useRef,useState} from 'react';
export type LearningSaveResult={ok:true}|{ok:false;message:string};
export class LearningSaveRegistry {
  private handlers=new Set<{save:()=>Promise<LearningSaveResult>;discard:()=>void}>();
  register(handler:{save:()=>Promise<LearningSaveResult>;discard:()=>void}){this.handlers.add(handler);return()=>{this.handlers.delete(handler);};}
  async flush(){for(const handler of [...this.handlers]){const result=await handler.save();if(!result.ok)return result;}return {ok:true} as const;}
  discard(){for(const handler of [...this.handlers])handler.discard();}
}
export const learningSaves=new LearningSaveRegistry();
export function useLearningSave(key:string,save:()=>Promise<LearningSaveResult>,discard:()=>void){const current=useRef({save,discard});current.current={save,discard};useEffect(()=>learningSaves.register({save:()=>current.current.save(),discard:()=>current.current.discard()}),[key]);}
export function LearningSaveDialog({save,onCancel,onComplete}:{save:(discard:boolean)=>Promise<LearningSaveResult>;onCancel:()=>void;onComplete:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),mounted=useRef(true),started=useRef(false),epoch=useRef(0),[saving,setSaving]=useState(true),[message,setMessage]=useState('');
  const callbacks=useRef({save,onComplete});callbacks.current={save,onComplete};
  const cancel=()=>{epoch.current++;onCancel();};
  const attempt=async(discard=false)=>{const token=++epoch.current;setSaving(true);setMessage('');try{const result=await callbacks.current.save(discard);if(!mounted.current||token!==epoch.current)return;if(result.ok)callbacks.current.onComplete();else setMessage(result.message);}catch{if(mounted.current&&token===epoch.current)setMessage('还没保存好，请重试或留在这题。');}finally{if(mounted.current&&token===epoch.current)setSaving(false);}};
  useEffect(()=>{mounted.current=true;dialog.current!.showModal();if(!started.current){started.current=true;void attempt();}return()=>{mounted.current=false;dialog.current?.close();};},[]);
  return <dialog className="flow-pause-dialog learning-save-dialog" ref={dialog} aria-labelledby="learning-save-title" onCancel={event=>{event.preventDefault();cancel();}}>
    <h2 id="learning-save-title">{saving?'正在保存…':'这次还没保存好'}</h2><p>{saving?'正在保留这题的位置，请稍等一下。':message}</p>
    <button className="flow-rest" onClick={cancel}>留在这题</button>
    {!saving&&<><button className="lesson-next" onClick={()=>void attempt()}>重试保存</button><button className="flow-rest" onClick={()=>void attempt(true)}>只保留已保存进度，继续退出</button></>}
  </dialog>;
}
