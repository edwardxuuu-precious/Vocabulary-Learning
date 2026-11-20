import {useMemo,useState} from 'react';
import type {AppState} from '../shared/contracts';
import {wordAbilityLabels,wordLearningLabels,type AbilityState,type WordNextAction} from '../shared/word-learning';
import './word-learning-archive.css';
const actionLabels:Record<WordNextAction,string>={learn:'认识这个词',continue:'继续未完成目标','learn-usage':'先学句子用法',check:'检查缺少结论的方向',practice:'巩固薄弱方向',review:'到期复习','wait-review':'待家长核验',none:'暂无到期目标','prepare-content':'准备图片和发音'};
const abilityLabels:Record<AbilityState,string>={unassessed:'未检查',practised:'练过','independent-practice':'练习独立答对','awaiting-review':'待核验',assisted:'需要帮助',incorrect:'需巩固',passed:'已通过',stable:'较稳定'};
export function WordLearningArchive({state}:{state:AppState}){
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(0);
  const profiles=state.study?.profiles??[];
  const selected=useMemo(()=>profiles.filter(profile=>(!query||`${profile.term} ${profile.meaning}`.toLowerCase().includes(query.trim().toLowerCase()))&&(filter==='all'||filter==='pending'?filter==='all'||Object.values(profile.abilities).some(row=>row.pendingReview):profile.status===filter)),[profiles,query,filter]);
  if(!state.study)return null;
  const pages=Math.max(1,Math.ceil(selected.length/12)),current=Math.min(page,pages-1);
  return <section className="parent-panel word-learning-archive" aria-labelledby="word-archive-title"><h2 id="word-archive-title">单词长期档案</h2>
    <div className="word-archive-filters"><label>查找词语<input value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} placeholder="英文或中文"/></label><label>查看状态<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(0);}}><option value="all">全部词档案</option><option value="pending">有回答待核验</option>{Object.entries(wordLearningLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><span>{selected.length} 个词</span></div>
    <div className="word-archive-grid">{selected.slice(current*12,current*12+12).map(profile=><article key={profile.wordId} className="word-archive-card"><header><img loading="lazy" src={profile.imageUrl} alt={profile.meaning}/><div><h3>{profile.term}</h3><p>{profile.meaning}</p><span className={`word-archive-state state-${profile.status}`}>{wordLearningLabels[profile.status]}</span>{!profile.available&&<small>内容待准备或词书已停用</small>}</div></header>
      <dl>{Object.values(profile.abilities).filter(row=>row.ability!=='spell'||state.settings.spellingEnabled||row.practiceCount).map(row=><div key={row.ability}><dt>{wordAbilityLabels[row.ability]}</dt><dd>{abilityLabels[row.state]}{row.pendingReview&&row.state!=='awaiting-review'?' · 新回答待核验':''}</dd></div>)}</dl><p className="word-archive-next">下一步：{actionLabels[profile.next.action]}{profile.next.abilities.length?' · '+profile.next.abilities.map(ability=>wordAbilityLabels[ability]).join('、'):''}</p>
      <details><summary>查看有效依据</summary>{Object.values(profile.abilities).filter(row=>row.judgment).map(row=><p key={row.ability} data-evidence-id={row.judgment!.id}>{wordAbilityLabels[row.ability]} · {row.judgment!.kind==='assessment'?'正式检查':'练习作答'} · {row.judgment!.result==='correct'?'独立答对':row.judgment!.result==='hinted'?'用过帮助':'需要巩固'} · {new Date(row.judgment!.at).toLocaleString('zh-CN')}{row.independentDays>0&&` · ${row.independentDays} 天独立通过`}{row.nextDueAt&&` · ${new Date(row.nextDueAt).toLocaleDateString('zh-CN')} 复习`}</p>)}{!Object.values(profile.abilities).some(row=>row.judgment)&&<p>还没有可判定的回答。</p>}</details>
    </article>)}</div>{!selected.length&&<p>没有符合条件的词语。</p>}
    {pages>1&&<nav className="word-archive-pagination" aria-label="词档案分页"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {pages}</span><button disabled={current===pages-1} onClick={()=>setPage(current+1)}>下一页</button></nav>}
  </section>;
}
