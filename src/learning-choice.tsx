import { ActionBar, BackButton, PageHeading } from './ui-layout';
import {useState} from 'react';
import type {AppState} from '../shared/contracts';
import {learningChoiceSummary,choiceDay} from '../shared/daily-learning-choice';
import {dailyLearningPlan} from '../shared/learning';
import {buildStudyAgenda} from '../shared/study-agenda';
import {entryRecommendation} from '../shared/entry-recommendation';
import {learningEncounters} from '../shared/learning-history';
import {api,errorMessage} from './api';
import './learning-choice.css';

/** An explicit daily choice. Persistent parent settings and in-progress rounds remain separate. */
function LegacyLearningChoice({state,mode,onSaved,onBack}:{state:AppState;mode:'goal'|'words';onSaved:(next:AppState)=>void;onBack:()=>void}){
  const now=new Date(state.learningNow??Date.now()),summary=learningChoiceSummary(state,now);
  const [goal,setGoal]=useState(summary.goal),[selected,setSelected]=useState(state.dailyLearningChoice?.wordIds??[]),[pack,setPack]=useState('all'),[preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const data={...state,settings:{...state.settings,learningStrategy:state.settings.learningStrategy??'memory-loop' as const}},base=dailyLearningPlan(data,now,'learn');
  const known=new Set(learningEncounters(state).filter(row=>Date.parse(row.introducedAt)<=now.getTime()).map(row=>row.wordId));
  const ready=base.available.filter(word=>!known.has(word.id)),byId=new Map(ready.map(word=>[word.id,word]));
  const ids=selected.filter(id=>byId.has(id)),words=ids.map(id=>byId.get(id)!),missing=selected.length-ids.length;
  const simulated={...data,dailyLearningChoice:{day:summary.day,revision:summary.revision+1,goal,...(ids.length?{wordIds:ids,wordVersions:Object.fromEntries(words.map(w=>[w.id,w.learningVersion??0]))}:{})}};
  const plan=entryRecommendation(simulated,'learn',now),remaining=plan.remainingNew;
  const visible=base.available.filter(word=>pack==='all'||word.packId===pack);
  const move=(id:string,offset:number)=>setSelected(current=>{const next=[...current],i=next.indexOf(id),j=i+offset;if(i>=0&&j>=0&&j<next.length)[next[i],next[j]]=[next[j],next[i]];return next;});
  const save=async()=>{setBusy(true);setError('');try{
    const next=await api<AppState>('/api/session/daily-choice',{method:'POST',body:JSON.stringify({day:summary.day,revision:summary.revision,goal,...(ids.length?{wordIds:ids,wordVersions:Object.fromEntries(words.map(w=>[w.id,w.learningVersion??0]))}:{})})});onSaved(next);
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}};
  return <main className="learning-hub learning-choice page-enter"><nav className="hub-nav"><BackButton disabled={busy} onClick={onBack}>回学习</BackButton></nav><PageHeading title={mode==='goal'?'调整今日词量':preview?'确认选词':'选择新词'}/>
    <section className="hub-current choice-summary"><h2>今天已认识 {base.usedNewToday} 个新词</h2><p>今日目标 {goal} 词 · 未完成已安排 {base.reservedNew} 词 · 可新安排 {remaining} 词</p><p>原来的学习进度保留；修改只影响下一轮。每天的默认目标由家长设置，今天可自己调整。</p>
      <div className="choice-goals" role="group" aria-label="今日新词目标">{Array.from({length:20},(_,i)=>i+1).map(n=><button key={n} disabled={busy} aria-pressed={goal===n} onClick={()=>setGoal(n)}>{n} 词</button>)}</div>
    </section>
    {mode==='words'&&!preview&&<><section className="picker-toolbar"><label>选择词书 <select value={pack} disabled={busy} onChange={e=>setPack(e.target.value)}><option value="all">所有已交付词书</option>{state.packs.filter(p=>base.available.some(w=>w.packId===p.id)).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label><button disabled={busy||!visible.some(word=>!known.has(word.id))} onClick={()=>setSelected(current=>[...new Set([...current,...visible.filter(word=>!known.has(word.id)).map(w=>w.id)])])}>全选当前未学词</button><button disabled={busy||!selected.length} onClick={()=>setSelected([])}>清空，恢复默认推荐</button><p>已学过 {visible.filter(word=>known.has(word.id)).length} 词 · 未学习 {visible.filter(word=>!known.has(word.id)).length} 词。已学词可到复习或自选加练；已学过不等于测试通过。</p></section>
      <section className="picker-grid" aria-label="选择学习新词">{visible.map(word=><article key={word.id} className={ids.includes(word.id)?'is-selected':''}><button className="picker-card" aria-label={`${known.has(word.id)?'已学过':'选择'}${word.term}，${word.meaning}`} aria-pressed={ids.includes(word.id)} disabled={busy||known.has(word.id)} onClick={()=>setSelected(current=>current.includes(word.id)?current.filter(id=>id!==word.id):[...current,word.id])}><span className="picker-check">{known.has(word.id)?'✓':ids.includes(word.id)?'✓':'+'}</span><span className="picker-picture"><img src={word.imageUrl} alt=""/></span><strong>{word.term}</strong><span>{word.meaning}</span><small className={known.has(word.id)?'is-familiar':'is-new'}>{known.has(word.id)?'已学过':'未学习'}</small></button></article>)}</section>{!ready.length&&<p>当前没有已备好、尚未认识的新词。已学词可到复习入口，缺素材请家长准备。</p>}</>}
    {(preview||mode==='goal')&&<section className="hub-current choice-summary"><h2>{words.length?`已选 ${words.length} 词，按这个顺序学习`:'沿用默认推荐范围'}</h2><p>{plan.resume?`原来的学习仍可继续；下一次新学习可安排 ${plan.fresh.length} 词。`:`下一轮安排 ${plan.fresh.length} 词。`}{words.length>remaining?`今日目标外的 ${Math.max(0,words.length-remaining)} 词保留在选定范围，后续再学；也可在上方提高今日目标。`:''}</p><p>按短段学习，可保存休息；词数受预算影响时剩余范围仍保留。选词范围跨天保留，今日目标次日恢复家长默认。</p>
      <ol className="choice-word-order">{words.map((word,index)=><li key={word.id}><img src={word.imageUrl} alt={word.meaning}/><span><strong>{word.term}</strong> · {word.meaning}</span><button aria-label={`${word.term}前移`} disabled={busy||index===0} onClick={()=>move(word.id,-1)}>↑</button><button aria-label={`${word.term}后移`} disabled={busy||index===words.length-1} onClick={()=>move(word.id,1)}>↓</button></li>)}</ol>
    </section>}
    {missing>0&&<p role="status">原选择有 {missing} 词已学过或素材需确认，本次不会代换其他词；确认保存后按当前预览范围安排。</p>}{error&&<p role="alert">{error}</p>}
    <footer className="choice-actions">{mode==='words'&&!preview?<button className="hub-start" disabled={busy} onClick={()=>setPreview(true)}>预览 {ids.length} 个已选词 →</button>:<><button disabled={busy} onClick={()=>mode==='words'?setPreview(false):onBack()}>{mode==='words'?'返回选词':'取消'}</button><button className="hub-start" disabled={busy} onClick={()=>void save()}>{busy?'保存中…':'确认保存，回学习'}</button></>}</footer>
  </main>;
}

export function LearningChoice(props:{state:AppState;mode:'goal'|'words';onSaved:(next:AppState)=>void;onBack:()=>void}){
  return props.state.learningTaskPolicy===1&&props.mode==='goal'?<DailyGoalChoice {...props}/>:<LegacyLearningChoice {...props}/>;
}
function DailyGoalChoice({state,onSaved,onBack}:{state:AppState;onSaved:(next:AppState)=>void;onBack:()=>void}){
  const now=new Date(state.learningNow??Date.now()),summary=learningChoiceSummary(state,now);
  const [goal,setGoal]=useState(summary.goal),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const learnedToday=new Set(learningEncounters(state).filter(row=>Date.parse(row.introducedAt)<=now.getTime()&&choiceDay(new Date(row.introducedAt))===summary.day&&state.packs.some(pack=>pack.id===state.words.find(word=>word.id===row.wordId)?.packId&&!pack.isSample)).map(row=>row.wordId)).size;
  const plan=buildStudyAgenda({...state,dailyLearningChoice:{day:summary.day,revision:summary.revision+1,goal}},{now,purpose:'learn'},state.study?.profiles);
  const group=state.study?.plans.learn.agenda.learningGroup;
  const waitingForMastery=!!group&&group.mastered<group.wordIds.length;
  const save=async()=>{setBusy(true);setError('');try{onSaved(await api<AppState>('/api/session/daily-choice',{method:'POST',body:JSON.stringify({day:summary.day,revision:summary.revision,goal})}));}catch(error){setError(errorMessage(error));}finally{setBusy(false);}};
  return <main className="learning-hub learning-choice page-enter"><nav className="hub-nav"><BackButton disabled={busy} onClick={onBack}>回学习</BackButton></nav><PageHeading title="调整今日词量" description={`明天恢复每天 ${state.settings.dailyNewWords} 个新词。`}/><section className="hub-current choice-summary" aria-label="选择今日词量"><div className="choice-goals" role="group" aria-label="今日新词目标">{Array.from({length:20},(_,i)=>i+1).map(n=><button key={n} disabled={busy} aria-pressed={goal===n} onClick={()=>setGoal(n)}>{n} 个</button>)}</div><div className="choice-goal-result"><span>今天已认识 <strong>{learnedToday}</strong> 个</span>{waitingForMastery?<span>学会当前这组后，再安排新词</span>:<span>还可安排 <strong>{plan.newWordCount}</strong> 个新词</span>}</div></section>{error&&<p role="alert">{error}</p>}<ActionBar className="choice-actions" primary={<button className="hub-start" disabled={busy} onClick={()=>void save()}>{busy?'保存中…':`设为 ${goal} 个新词`}</button>}><button className="ui-secondary" disabled={busy} onClick={onBack}>取消</button></ActionBar></main>;
}
