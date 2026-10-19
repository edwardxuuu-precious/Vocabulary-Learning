import { useEffect, useState } from 'react';
import type { AppState, AssessmentGrant } from '../shared/contracts';
import { api, errorMessage } from './api';
import { lessonSegment } from '../shared/lesson-plan';
import './lesson-planner.css';

export function LessonPlanner({state,grant,reload,onBack}:{state:AppState;grant:AssessmentGrant;reload:()=>Promise<AppState>;onBack:()=>void}) {
  const plan=state.lessonPlan;
  useEffect(()=>{window.scrollTo({top:0,left:0});},[]);
  const [fresh,setFresh]=useState(false),[title,setTitle]=useState(plan?.title??'课堂词表');
  const [ids,setIds]=useState(plan?.wordIds??[]),[focus,setFocus]=useState(plan?.focusWordIds??[]);
  const [minutes,setMinutes]=useState(plan?.segmentMinutes??8),[pack,setPack]=useState('all'),[query,setQuery]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const enabled=new Set(state.packs.filter(p=>p.enabled&&!p.isSample).map(p=>p.id));
  const available=state.words.filter(w=>enabled.has(w.packId)&&w.assetStatus==='approved');
  const byId=new Map(state.words.map(w=>[w.id,w]));
  const visible=available.filter(w=>(pack==='all'||w.packId===pack)&&`${w.term} ${w.meaning}`.toLowerCase().includes(query.toLowerCase()));
  const add=(values:string[])=>{const added=values.filter(id=>!ids.includes(id));setIds(old=>[...new Set([...old,...added])]);setFocus(old=>[...new Set([...old,...added])]);};
  const previouslyDone=fresh?[]:(plan?.completedWordIds??[]).filter(id=>plan?.wordVersions[id]===(byId.get(id)?.learningVersion??0));
  const remove=(id:string)=>{setIds(old=>old.filter(v=>v!==id));setFocus(old=>old.filter(v=>v!==id));};
  const move=(index:number,delta:number)=>setIds(old=>{const next=[...old];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next;});
  const preview=ids.length?lessonSegment({id:plan?.id??'preview-plan',title,revision:1,createdAt:'',updatedAt:'',wordIds:ids,focusWordIds:ids.filter(id=>focus.includes(id)),wordVersions:Object.fromEntries(ids.map(id=>[id,byId.get(id)?.learningVersion??0])),completedWordIds:previouslyDone,segmentMinutes:minutes},state):undefined;
  const save=async()=>{
    setBusy(true);setMessage('');
    try {
      await api('/api/lesson-plan',{method:'POST',headers:{Authorization:`Bearer ${grant.token}`},body:JSON.stringify({...(plan&&!fresh?{id:plan.id,revision:plan.revision}:plan?{newPlan:true}:{}),title,wordIds:ids,focusWordIds:ids.filter(id=>focus.includes(id)),segmentMinutes:minutes})});
      await reload();setMessage('课堂安排已保存，孩子可以从大厅开始一小段。');
    } catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}
  };
  return <main className="lesson-planner learning-hub page-enter">
    <nav className="hub-nav"><button onClick={onBack}>← 回家长空间</button></nav>
    <header className="hub-heading"><h1>按上课进度安排</h1></header>
    <section className="lesson-plan-settings">
      <label>本课名称<input maxLength={80} value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>
      <label>每段大约<select value={minutes} onChange={e=>setMinutes(Number(e.target.value))} disabled={busy}>{[5,8,10,15].map(n=><option key={n} value={n}>{n}分钟</option>)}</select></label>
      <p>先确定整课范围，再勾选本次重点。系统按顺序拆成短段，新词先认识，学过的词直接练习。</p>
      {plan&&!fresh&&<button className="text-button" disabled={busy} onClick={()=>{setFresh(true);setTitle('新的课堂词表');setIds([]);setFocus([]);setMessage('');}}>新建另一课</button>}
    </section>
    <section className="lesson-scope" aria-label="本课单词顺序和本次重点">
      <h2>本课 {ids.length} 词 · 本次重点 {focus.length} 词</h2>
      <div className="lesson-focus-actions"><button disabled={busy||!ids.length} onClick={()=>setFocus([...ids])}>本课全部设为重点</button><button disabled={busy||!focus.length} onClick={()=>setFocus([])}>清空本次重点</button></div>
      {!ids.length&&<p>从下面加入老师这节课要覆盖的词。</p>}
      <ol>{ids.map((id,index)=>{const word=byId.get(id);return <li key={id}>
        <label><input type="checkbox" checked={focus.includes(id)} onChange={e=>setFocus(old=>e.target.checked?[...old,id]:old.filter(v=>v!==id))} disabled={busy}/><span><strong>{word?.term??'单词已移除'}</strong><small>{word?.meaning} · {previouslyDone.includes(id)?'本课已练完':'待安排'}</small></span></label>
        <div><button disabled={busy||index===0} aria-label={`${word?.term}上移`} onClick={()=>move(index,-1)}>↑</button><button disabled={busy||index===ids.length-1} aria-label={`${word?.term}下移`} onClick={()=>move(index,1)}>↓</button><button disabled={busy} aria-label={`移出本课${word?.term}`} onClick={()=>remove(id)}>移出</button></div>
      </li>;})}</ol>
    </section>
    <section className="lesson-add-words" aria-label="加入课堂单词">
      <h2>加入单词</h2><div className="lesson-word-filters"><select aria-label="词表" value={pack} onChange={e=>setPack(e.target.value)}><option value="all">所有已交付词表</option>{state.packs.filter(p=>enabled.has(p.id)).map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</select><input aria-label="搜索单词或中文" placeholder="搜索英文或中文" value={query} onChange={e=>setQuery(e.target.value)}/><button disabled={busy||!visible.some(word=>!ids.includes(word.id))} onClick={()=>add(visible.map(w=>w.id))}>加入筛选出的全部词</button></div>
      {!available.length&&<p>请先在备课中准备并交付词表，再安排课堂练习。</p>}
      {visible.length>0&&visible.every(word=>ids.includes(word.id))&&<p>当前筛选的单词都已在本课，可在上方调整重点和顺序。</p>}
      <div className="lesson-word-grid">{visible.filter(word=>!ids.includes(word.id)).map(word=><button key={word.id} disabled={busy||ids.includes(word.id)} onClick={()=>add([word.id])}><img src={word.imageUrl} alt="" loading="lazy"/><strong>{word.term}</strong><span>{word.meaning}</span><small>{ids.includes(word.id)?'已在本课':'＋ 加入本课'}</small></button>)}</div>
    </section>
    <footer className="picker-footer"><div className="picker-selection"><strong>本课 {ids.length} 词 · 本次 {focus.length} 词</strong><p>{preview?.words.length?`下一段 ${preview.words.length} 词，约 ${preview.minutes} 分钟`:focus.length?'本次重点已练完，或需要先补齐素材':'可先保存整课范围，稍后再选重点'}</p><small>保存后当前正在玩的段落保持原样。需要立即换词，可在大厅学习卡片右上角的“更多”中换词。</small></div><button className="picker-start" disabled={busy||!ids.length||!title.trim()} onClick={()=>void save()}>{busy?'保存中…':'保存安排'}</button></footer>
    {message&&<p className="lesson-plan-message" role="status">{message}</p>}
  </main>;
}
