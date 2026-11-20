import type {ActivityAction,LearningActivity,LearningSession} from '../shared/contracts';
import {LearningTaskFrame,TaskActionBar,TaskIcon} from './learning-task-frame';
import './repair-task.css';

export function RepairTask({activity,session,busy,playing,onAction,onHome,onPause}:{activity:LearningActivity;session:LearningSession;busy:boolean;playing:boolean;onAction:(action:ActivityAction,selectedId?:string)=>void;onHome:()=>void;onPause:()=>void}){
  const state=session.activityStates?.[activity.id]??{},accepted=['correct','practice'].includes(state.outcome??'');
  const fixed=state.outcome==='correct';
  const target=Math.max(0,activity.choices.findIndex(word=>word.id===activity.wordId));
  const selected=activity.choices.findIndex(word=>word.id===state.selectedId),wire=fixed?target:selected>=0?selected:(target+1)%activity.choices.length;
  const height=activity.choices.length*108-12,center=height/2,end=wire*108+48;
  return <LearningTaskFrame session={session} kind="repair" wide title="听声音，修好连接" instruction="点左边听声音，再点右边对应的图片。" onHome={onHome} onPause={onPause}>
    <div className={`task-repair-board${fixed?' is-fixed':''}`} aria-label="图音连接维修台">
      <button className={`task-repair-speaker${playing?' is-playing':''}`} disabled={busy||accepted||playing} onClick={()=>onAction('listen')} aria-label="播放待修声音"><TaskIcon kind="sound"/><strong>{playing?'正在播放…':state.heard?'再听一遍':'听一听'}</strong></button>
      <svg className={`task-repair-wire${fixed?' is-fixed':''}`} viewBox={`0 0 100 ${height}`} style={{height}} preserveAspectRatio="none" aria-hidden="true"><path d={`M0 ${center} C40 ${center} 60 ${end} 100 ${end}`}/><circle cx="50" cy={(center+end)/2} r="14"/><text x="50" y={(center+end)/2+6} textAnchor="middle">{fixed?'✓':'×'}</text></svg>
      <div className="task-repair-choices" role="group" aria-label="为当前声音选择正确图片">{activity.choices.map((word,index)=><button key={word.id} className={`${state.selectedId===word.id?fixed?'is-correct':accepted?'is-chosen':'is-retry':''}`} disabled={busy||accepted||playing||!state.heard} onClick={()=>onAction('choose',word.id)} aria-label={`选择${word.meaning}`}><img src={word.imageUrl} alt={word.meaning}/><span>图片 {index+1}<strong>{fixed&&word.id===activity.wordId?'连接修好啦':accepted&&state.selectedId===word.id?'已选择':'选这张图'}</strong></span>{fixed&&word.id===activity.wordId&&<TaskIcon kind="check"/>}</button>)}</div>
    </div>
    <TaskActionBar status={accepted?fixed?'连接修好啦！':'这一步练过了，可以继续':state.audioUnavailable?'声音暂时播不了，可以重试或先跳过':state.outcome==='try'?'还没接对，再听一遍试试':playing?'正在听声音…':state.heard?'听清后，点右边的一张图片':'这条线接错了，先听听它在说什么'} tone={fixed?'success':state.audioUnavailable||state.outcome==='try'?'error':'normal'} skip={!accepted?{action:()=>onAction('skip'),disabled:busy||playing}:undefined} secondary={!accepted?<button disabled={busy||playing||!state.heard} onClick={()=>onAction('listen')}><TaskIcon kind="sound"/>再听一遍</button>:undefined} primary={accepted?<button disabled={busy||playing} onClick={()=>onAction('next')}>继续<TaskIcon kind="arrow"/></button>:undefined} waiting="听完，再点图片修好连接"/>
  </LearningTaskFrame>;
}
