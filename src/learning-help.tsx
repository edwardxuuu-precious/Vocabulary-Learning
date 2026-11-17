import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import type { LearningActivity,LearningSession } from '../shared/contracts';
import { needsAutomaticRuleGuide,usesDirectTaskInteraction,ruleGuide,type RuleGuide } from '../shared/learning-guidance';
import { Mascot } from './mascot';
import { companionFor } from '../shared/companions';
import './learning-help.css';
import './task-help.css';

function Symbol({kind}:{kind:'sound'|'hand'|'mic'|'stop'|'arrow'|'check'|'cross'|'help'|'rest'}){
  return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind==='sound'?<><path d="m10 4-5 5H2v6h3l5 5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>:kind==='mic'?<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/></>:kind==='stop'?<rect x="5" y="5" width="14" height="14" rx="2"/>:kind==='check'?<path d="m4 12 5 5L20 6"/>:kind==='cross'?<path d="m6 6 12 12M18 6 6 18"/>:kind==='arrow'?<path d="M3 12h18m-7-7 7 7-7 7"/>:kind==='rest'?<path d="M8 4v16M16 4v16"/>:kind==='help'?<><circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 1 1 5 3c-2 1-2 2-2 3m0 3h.01"/></>:<><path d="M9 12V4a2 2 0 0 1 4 0v7l2-2 5 3-2 8H9l-5-6a2 2 0 0 1 3-2l2 2"/></>}</svg>;
}
/** A tiny, repeatable operation sandbox. No actual question, audio, recording or scoring is used. */
export function RuleDemo({guide}:{guide:RuleGuide}){
  const [stage,setStage]=useState(0),next=()=>setStage(value=>Math.min(3,value+1));
  const photo=<svg viewBox="0 0 64 50" width="60" height="48" fill="none" aria-hidden="true"><rect x="3" y="3" width="58" height="44" rx="9" stroke="currentColor" strokeWidth="2"/><circle cx="21" cy="18" r="5" fill="currentColor" opacity=".5"/><path d="m9 39 15-14 11 10 8-7 12 11" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>;
  return <div className="task-rule-demo" aria-label="玩法示意练习，不是本题答案">
    <div className={`task-rule-board demo-${guide.demo}`}>
      {guide.demo==='letters'?<div className="demo-spell"><div className="demo-letter-slots" aria-label="示意拼写位置"><button disabled={stage===0||stage===3} onClick={()=>setStage(0)} aria-label="示意：撤回第一个字母">{stage>0?'A':''}</button><button disabled={stage<2||stage===3} onClick={()=>setStage(1)} aria-label="示意：撤回第二个字母">{stage>1?'B':''}</button></div><div className="demo-letter-bank"><button onClick={next} disabled={stage!==0} aria-label="示意：点字母A">A</button><button onClick={next} disabled={stage!==1} aria-label="示意：点字母B">B</button></div><button className="demo-action" disabled={stage<2||stage===3} onClick={next}>{stage===3?'✓ 排好啦':'拼好啦'}</button></div>:
      guide.demo==='wires'?<div className={`demo-wire-board${stage>1?' is-fixed':''}`}><button className="demo-control" onClick={next} disabled={stage>0} aria-label="示意：先点声音"><Symbol kind="sound"/><span>听声音</span></button><span className="demo-wire-line">{stage>1?'✓':'×'}</span><button className="demo-control demo-photo" onClick={next} disabled={stage!==1} aria-label="示意：再点亮起的图片">{photo}<span>点图片</span></button>{stage>1&&<button className="demo-action" disabled={stage===3} onClick={next}>继续 <Symbol kind="arrow"/></button>}</div>:
      guide.demo==='oral'?<div className="demo-oral"><button className="demo-control" onClick={next} disabled={stage===3} aria-label={stage===0?'示意：点麦克风':stage===1?'示意：说完了':'示意：保存后继续'}><Symbol kind={stage===0?'mic':stage===1?'stop':stage===3?'check':'arrow'}/><span>{stage===0?'开始说':stage===1?'说完了':stage===3?'完成示意':'继续'}</span></button><small>这里只试按钮，不会录音</small></div>:
      guide.demo==='sounds'?<div className="demo-sound"><button className="demo-control" onClick={next} disabled={stage!==0}><Symbol kind="sound"/>先听声音</button><div className="demo-sound-pair">{[1,2].map(number=><button key={number} className="demo-control" disabled={stage!==1||number!==1} onClick={()=>setStage(3)} aria-label={`示意：选择声音${number}`}><Symbol kind="sound"/><span>声音 {number}</span></button>)}</div></div>:
      <div className="demo-picture-task"><button className="demo-control" disabled={stage!==0} onClick={next}>{guide.demo==='meaning'||guide.demo==='match'?<><Symbol kind="hand"/><span>先看题目</span></>:guide.demo==='sequence'||guide.demo==='place'?<><span className="demo-card-symbol">1</span><span>先选卡片</span></>:<><Symbol kind="sound"/><span>先听一听</span></>}</button><Symbol kind="arrow"/><button className="demo-control demo-photo" onClick={()=>setStage(3)} disabled={stage!==1} aria-label="示意：点对应图片">{stage===3?<Symbol kind="check"/>:photo}<span>{stage===3?'操作完成':'再点这里'}</span></button></div>}
    </div>
    <ol className="task-rule-steps">{guide.steps.map((label,index)=><li key={index} className={Math.min(stage,2)===index?'is-current':''}><b>{index+1}</b><span>{label}</span></li>)}</ol>
    <button className="task-rule-reset" onClick={()=>setStage(0)}>重看示意</button>
  </div>;
}

interface Props {session:LearningSession;activity:LearningActivity;busy:boolean;playing:boolean;enabled:boolean;audioEnabled:boolean;deviceUnavailable?:boolean;onOpen:(open:boolean)=>void;onAction:(action:'rules-help'|'rules-seen')=>Promise<boolean>;onSkip:()=>void;onRest:()=>void}
export function LearningHelp({session,activity,busy,playing,enabled,audioEnabled,deviceUnavailable,onOpen,onAction,onSkip,onRest}:Props){
  const guide=ruleGuide(activity),[mode,setMode]=useState<'rules'|'difficulty'|'device'>(),[saving,setSaving]=useState(false),[error,setError]=useState(''),[handled,setHandled]=useState(false),[introduced,setIntroduced]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),accepted=['correct','practice'].includes(session.activityStates?.[activity.id]?.outcome??'');
  const [toolbar,setToolbar]=useState<HTMLElement|null>(null);
  const directTask=usesDirectTaskInteraction(activity);
  useEffect(()=>{setToolbar(document.getElementById('learning-help-slot'));},[activity.id]);
  const struggles=session.guidance?.struggles[activity.id]??0,device=(deviceUnavailable||session.activityStates?.[activity.id]?.audioUnavailable===true)&&!session.reviewSupport?.entries[activity.id];
  const open=(next:typeof mode)=>{setError('');setMode(next);};
  useEffect(()=>{if(!guide||!enabled||busy||playing||accepted||mode)return;
    if(!directTask&&device&&!handled){setHandled(true);open('device');}
    else if(!directTask&&struggles>=2&&!handled){setHandled(true);open('difficulty');}
    else if(!introduced&&needsAutomaticRuleGuide(session,activity)){setIntroduced(true);open('rules');}
  },[enabled,busy,playing,accepted,struggles,device,guide?.key,handled,introduced,mode,directTask]);
  useEffect(()=>{if(!mode)return;onOpen(true);const node=dialog.current!;node.showModal();return()=>{node.close();onOpen(false);};},[mode]);
  const remember=async()=>{setSaving(true);setError('');try{if(await onAction('rules-seen'))setMode(undefined);else setError('还没保存好，可以再试一次。');}finally{setSaving(false);}};
  const help=async()=>{setSaving(true);setError('');try{if(await onAction('rules-help'))setMode('rules');else setError('还没接上，可以重试或先休息。');}finally{setSaving(false);}};
  const leave=(action:()=>void)=>{setMode(undefined);action();};
  if(!guide)return null;
  return <>
    {toolbar&&createPortal(<button className="learning-help-trigger" disabled={!enabled||busy||playing||saving||accepted||!!mode} onClick={()=>void help()} aria-label="看看怎么玩" aria-haspopup="dialog" aria-expanded={!!mode}><Symbol kind="help"/><span>帮助</span></button>,toolbar)}
    {mode&&<dialog className="task-help-dialog" ref={dialog} aria-labelledby="learning-help-title" onCancel={event=>{event.preventDefault();if(!saving)void remember();}}>
      <header className="task-help-header"><Mascot small character={companionFor(session.id,0)}/><div><h2 id="learning-help-title">{mode==='difficulty'?'一起试一试':mode==='device'?'声音暂时没接上':guide.title}</h2><p>{mode==='rules'?'可以在这里试一下按钮。':mode==='device'?'可以回到题目重试，也可以先跳过。':'看看操作，或者先休息一下。'}</p></div><button className="task-help-close" aria-label="关闭玩法帮助" disabled={saving} onClick={()=>void remember()}><Symbol kind="cross"/></button></header>
      <div className="task-help-content">{mode==='rules'?<RuleDemo key={guide.key} guide={guide}/>:<div className="task-help-symbol"><Symbol kind={mode==='device'?'sound':'help'}/></div>}{error&&<p className="task-help-error" role="status">{error}</p>}</div>
      <footer className="task-help-footer"><button className="help-skip" disabled={saving} onClick={()=>leave(onSkip)}>先跳过<Symbol kind="arrow"/></button><button className="help-rest" disabled={saving} onClick={()=>leave(onRest)}><Symbol kind="rest"/>休息</button><button className="help-primary" disabled={saving} onClick={()=>mode==='difficulty'?void help():void remember()}>{saving?'保存中…':mode==='difficulty'?'看看操作':'回到题目'}<Symbol kind="arrow"/></button></footer>
    </dialog>}
  </>;
}
