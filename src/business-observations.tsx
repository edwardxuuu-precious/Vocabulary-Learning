import { useEffect, useState } from 'react';
import type { AppState, AssessmentGrant, BusinessObservationView, EffortObservation, OpportunityObservation, ProbeObservation } from '../shared/contracts';
import { learningEncounters } from '../shared/learning-history';
import { observationDayGap } from '../shared/business-observations';
import { api, errorMessage, ApiRequestError } from './api';
import { ParentGate } from './parent-gate';
import './business-observations.css';

const nullable=(value:string)=>value===''?null:value==='true';
const number=(value:string)=>value===''?null:Number(value);
const ratio=(row:{numerator:number;denominator:number;rate:number|null})=>row.rate===null?'尚无可判定样本':`${row.numerator}/${row.denominator}（${Math.round(row.rate*100)}%）`;
const opportunityRatio=(row:BusinessObservationView['k1']['learn'])=>`${row.missing?`已确认 ${row.numerator}/${row.denominator}，${row.missing} 次缺项，暂不判断完成率`:ratio(row)}；资格未知 ${row.eligibilityUnknown}、事前不合格 ${row.excluded}、休息 ${row.rest}、拒绝/疲劳 ${row.refused}、中途设备问题 ${row.deviceFailures}`;
const stopLabels={unknown:'不知道',entry:'选入口',meaning:'认识含义',understanding:'理解玩法',recall:'自己回忆',continue:'不知道怎么继续',audio:'声音',recording:'录音'};
const endLabels={unknown:'不知道',completed:'完成约定小段',rest:'主动保存休息',refused:'拒绝或疲劳',device:'中途设备问题'};
const directionLabels={listen:'听音理解',recognize:'看词认义',read:'看词朗读',recall:'由图/中文回忆英文'};
function NullableSelect({label,value,onChange}:{label:string;value:boolean|null;onChange:(value:boolean|null)=>void}){return <label>{label}<select value={value===null?'':String(value)} onChange={event=>onChange(nullable(event.target.value))}><option value="">不知道</option><option value="true">是</option><option value="false">否</option></select></label>;}
function NumberField({label,value,onChange}:{label:string;value:number|null;onChange:(value:number|null)=>void}){return <label>{label}<input type="number" min="0" max="10000" step="0.1" placeholder="未记" value={value??''} onChange={event=>onChange(number(event.target.value))}/></label>;}
const blankOpportunity=()=>({id:crypto.randomUUID() as string,expectedRevision:0,entry:'learn' as 'learn'|'review',eligibility:'unknown' as OpportunityObservation['eligibility'],voluntary:null as boolean|null,stepByStepHelp:null as boolean|null,completed:null as boolean|null,end:'unknown' as OpportunityObservation['end'],stopAt:'unknown' as OpportunityObservation['stopAt'],helpCount:null as number|null,sessionId:''});
const blankEffort=()=>({id:crypto.randomUUID() as string,expectedRevision:0,packId:'',completeCycle:false,activeMinutes:{preparation:null as number|null,repair:null as number|null,guidance:null as number|null,review:null as number|null},waitingMinutes:null as number|null,repairCount:null as number|null,reviewItems:null as number|null});
const blankProbe=()=>({id:crypto.randomUUID() as string,expectedRevision:0,wordIds:[] as string[],direction:'recall' as ProbeObservation['direction'],interval:'next-day' as ProbeObservation['interval'],externalContact:'unknown' as ProbeObservation['externalContact']});

export function BusinessObservationPanel({state,grant,onGrant}:{state:AppState;grant?:AssessmentGrant;onGrant:(grant?:AssessmentGrant)=>void}){
  const [view,setView]=useState<BusinessObservationView>(),[tab,setTab]=useState<'opportunity'|'effort'|'probe'>('opportunity'),[gate,setGate]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [opportunity,setOpportunity]=useState(blankOpportunity),[effort,setEffort]=useState(blankEffort),[probe,setProbe]=useState(blankProbe);
  const failed=(error:unknown)=>{if(error instanceof ApiRequestError&&error.status===403){setView(undefined);onGrant(undefined);}setMessage(errorMessage(error));};
  const headers={Authorization:`Bearer ${grant?.token??''}`};
  const load=async()=>{if(grant)setView(await api<BusinessObservationView>('/api/business',{headers}));};
  useEffect(()=>{setView(undefined);if(grant)void load().catch(failed);},[grant?.token]);
  const save=async(kind:string,body:unknown)=>{setBusy(true);setMessage('');try{await api(`/api/business/${kind}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});await load();setMessage('已保存实际观察。');return true;}catch(error){failed(error);return false;}finally{setBusy(false);}};
  const packs=state.packs.filter(pack=>!pack.isSample&&!pack.deletedAt),now=state.learningNow??new Date().toISOString(),encounters=learningEncounters(state);
  const selectable=state.words.filter(word=>packs.some(pack=>pack.id===word.packId&&pack.enabled)&&word.assetStatus==='approved'&&!word.deletedAt&&encounters.some(fact=>fact.wordId===word.id&&Date.parse(fact.introducedAt)<=Date.parse(now)&&observationDayGap(fact.introducedAt,now)<=(probe.interval==='next-day'?1:7)));
  const chooseOpportunity=(id:string)=>{const row=view?.opportunities.find(row=>row.id===id);setOpportunity(row?{id:row.id,expectedRevision:row.revision,entry:row.entry,eligibility:row.eligibility,voluntary:row.voluntary,stepByStepHelp:row.stepByStepHelp,completed:row.completed,end:row.end,stopAt:row.stopAt,helpCount:row.helpCount,sessionId:row.sessionId??''}:blankOpportunity());};
  const chooseEffort=(id:string)=>{const row=view?.efforts.find(row=>row.id===id);setEffort(row?{id:row.id,expectedRevision:row.revision,packId:row.packId,completeCycle:row.completeCycle,activeMinutes:row.activeMinutes,waitingMinutes:row.waitingMinutes,repairCount:row.repairCount,reviewItems:row.reviewItems}:blankEffort());};
  const chooseProbe=(id:string)=>{const row=view?.probes.find(row=>row.id===id);setProbe(row?{id:row.id,expectedRevision:row.revision,wordIds:row.targets.map(target=>target.word.id),direction:row.direction,interval:row.interval,externalContact:row.externalContact}:blankProbe());};
  return <section className="parent-panel business-observations" aria-label="本机使用简记">
    <h2>使用简记</h2><p>先记孩子停在哪里，其余可以留“不知道”。点击不能说明喜欢，普通录音不算答对。</p>
    {!grant?<button className="button primary" onClick={()=>setGate(true)}>家长解锁后查看与补记</button>:<>
      {view&&<p className="business-scope">{view.audience==='child'?'孩子实际观察':view.audience==='test'?'家长测试档案 · 不并入孩子数据':'工程隔离示例 · 不代表孩子表现'} · 仅存本机</p>}
      <div className="parent-record-tabs" role="group" aria-label="使用简记分类">{([{id:'opportunity',label:'一次使用机会'},{id:'effort',label:'家长投入'},{id:'probe',label:'延迟观察'}] as const).map(item=><button key={item.id} aria-pressed={tab===item.id} onClick={()=>{setTab(item.id);setMessage('');}}>{item.label}</button>)}</div>
      {tab==='opportunity'&&<>
        {view&&<p>学习：{opportunityRatio(view.k1.learn)}。复习：{opportunityRatio(view.k1.review)}。拒绝、休息和中途设备问题仍保留在合格机会中。</p>}
        <label>新记或补记<select aria-label="选择使用机会" value={opportunity.expectedRevision?opportunity.id:''} onChange={event=>chooseOpportunity(event.target.value)}><option value="">新记一次机会</option>{view?.opportunities.map((row,index)=><option key={row.id} value={row.id}>{row.entry==='learn'?'学习':'复习'}机会 {index+1} · {endLabels[row.end]}</option>)}</select></label>
        <form onSubmit={event=>{event.preventDefault();void save('opportunities',{...opportunity,...(opportunity.sessionId?{}:{sessionId:undefined})}).then(saved=>{if(saved)setOpportunity(blankOpportunity());});}}>
          <div className="business-fields"><label>选择的入口<select disabled={opportunity.expectedRevision>0} value={opportunity.entry} onChange={event=>setOpportunity({...opportunity,entry:event.target.value as 'learn'|'review'})}><option value="learn">学习</option><option value="review">复习</option></select></label>
            <label>开始前内容与设备可用吗<select value={opportunity.eligibility} onChange={event=>setOpportunity({...opportunity,eligibility:event.target.value as OpportunityObservation['eligibility']})}><option value="unknown">不知道</option><option value="eligible">已交付，设备也可用</option><option value="ineligible">事前有内容或设备问题</option></select></label>
            <label>停在哪里<select value={opportunity.stopAt} onChange={event=>setOpportunity({...opportunity,stopAt:event.target.value as OpportunityObservation['stopAt']})}>{Object.entries(stopLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          </div><details open={opportunity.expectedRevision>0}><summary>愿意开始、帮助与结束（可以后补记）</summary><div className="business-fields">
            <NullableSelect label="孩子是否自己愿意开始" value={opportunity.voluntary} onChange={voluntary=>setOpportunity({...opportunity,voluntary})}/>
            <NullableSelect label="是否需要大人逐步指点" value={opportunity.stepByStepHelp} onChange={stepByStepHelp=>setOpportunity({...opportunity,stepByStepHelp})}/>
            <NumberField label="逐步指点次数（没记可留空）" value={opportunity.helpCount} onChange={helpCount=>setOpportunity({...opportunity,helpCount})}/>
            <NullableSelect label="是否完成事先约定的小段" value={opportunity.completed} onChange={completed=>setOpportunity({...opportunity,completed})}/>
            <label>怎么结束<select value={opportunity.end} onChange={event=>setOpportunity({...opportunity,end:event.target.value as OpportunityObservation['end']})}>{Object.entries(endLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          </div></details><details><summary>关联实际轮次（可不填）</summary><select aria-label="关联实际轮次" value={opportunity.sessionId} onChange={event=>setOpportunity({...opportunity,sessionId:event.target.value})}><option value="">不关联</option>{[...(state.resumableSessions??[]),...(state.lastCompletedSession?[state.lastCompletedSession]:[])].map((session,index)=><option key={session.id} value={session.id}>轮次 {index+1} · {session.wordIds.length}词 · {session.entrySource?.entry==='review'?'复习':session.entrySource?'学习':'旧综合'}</option>)}</select></details>
          <button className="button primary" disabled={busy}>{busy?'保存中…':'保存这次简记'}</button>
        </form>
      </>}
      {tab==='effort'&&<>
        <p>按同一组词分别记主动分钟和纯等待；没有记就留空，不从页面停留估算。</p>
        <label>新记或补记<select aria-label="选择投入记录" value={effort.expectedRevision?effort.id:''} onChange={event=>chooseEffort(event.target.value)}><option value="">新建一组固定范围</option>{view?.efforts.map((row,index)=><option key={row.id} value={row.id}>投入 {index+1} · {row.plannedWords}词 · {row.completeCycle?'完整循环':'局部记录'}</option>)}</select></label>
        <form onSubmit={event=>{event.preventDefault();void save('efforts',effort).then(saved=>{if(saved)setEffort(blankEffort());});}}><div className="business-fields">
          <label>这组词的范围<select disabled={effort.expectedRevision>0} required value={effort.packId} onChange={event=>setEffort({...effort,packId:event.target.value})}><option value="">请选择词书</option>{packs.map(pack=><option key={pack.id} value={pack.id}>{pack.title}</option>)}</select></label>
          {([{id:'preparation',label:'备课主动分钟'},{id:'repair',label:'补缺主动分钟'},{id:'guidance',label:'指导主动分钟'},{id:'review',label:'核验主动分钟'}] as const).map(item=><NumberField key={item.id} label={item.label} value={effort.activeMinutes[item.id]} onChange={value=>setEffort({...effort,activeMinutes:{...effort.activeMinutes,[item.id]:value}})}/>)}
          <NumberField label="纯等待分钟（单列）" value={effort.waitingMinutes} onChange={waitingMinutes=>setEffort({...effort,waitingMinutes})}/><NumberField label="返工次数" value={effort.repairCount} onChange={repairCount=>setEffort({...effort,repairCount})}/><NumberField label="核验项数" value={effort.reviewItems} onChange={reviewItems=>setEffort({...effort,reviewItems})}/>
        </div><label className="business-check"><input type="checkbox" checked={effort.completeCycle} onChange={event=>setEffort({...effort,completeCycle:event.target.checked})}/>这组词的准备、实际使用与核验循环已经结束</label><button className="button primary" disabled={busy||!effort.packId}>保存投入</button></form>
        {view?.k3.map(({fact,metrics},index)=><p key={fact.id}>投入 {index+1}：原范围 {metrics.plannedWords}词，本次记录已交付 {metrics.deliveredWords}词；主动 {metrics.activeMinutes??'未知'} 分钟，等待 {metrics.waitingMinutes??'未知'} 分钟。{metrics.minutesPerTen===null?'循环或主动分项不完整，不计算每10词投入。':`每10个交付词 ${metrics.minutesPerTen.toFixed(1)} 主动分钟。`}</p>)}
      </>}
      {tab==='probe'&&<>
        <p>先冻结词和观察方向，再进行实际尝试。这里不会启动挑战或改成绩；口头答对仍须在“挑战核验”里合法确认。</p>
        <label>新记或补记<select aria-label="选择延迟观察" value={probe.expectedRevision?probe.id:''} onChange={event=>chooseProbe(event.target.value)}><option value="">先登记一组观察条件</option>{view?.probes.map((row,index)=><option key={row.id} value={row.id}>观察 {index+1} · {row.targets.length}词 · {directionLabels[row.direction]}</option>)}</select></label>
        <form onSubmit={event=>{event.preventDefault();void save('probes',probe).then(saved=>{if(saved)setProbe(blankProbe());});}}><div className="business-fields">
          <label>观察方向<select disabled={probe.expectedRevision>0} value={probe.direction} onChange={event=>setProbe({...probe,direction:event.target.value as ProbeObservation['direction']})}>{Object.entries(directionLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          <label>观察间隔<select disabled={probe.expectedRevision>0} value={probe.interval} onChange={event=>setProbe({...probe,interval:event.target.value as ProbeObservation['interval'],wordIds:[]})}><option value="next-day">认识后的次日</option><option value="day-7">认识后的第7天</option></select></label>
          <label>课外是否还接触过这些词<select value={probe.externalContact} onChange={event=>setProbe({...probe,externalContact:event.target.value as ProbeObservation['externalContact']})}><option value="unknown">不知道</option><option value="none">明确没有</option><option value="reported">有课外接触</option></select></label>
        </div>{probe.expectedRevision?<p>原范围已冻结，共 {probe.wordIds.length}词；只能补记课外接触。</p>:<fieldset className="business-word-options"><legend>选择已认识且尚未错过该间隔的词</legend>{selectable.map(word=><label key={word.id}><input type="checkbox" checked={probe.wordIds.includes(word.id)} onChange={event=>setProbe({...probe,wordIds:event.target.checked?[...probe.wordIds,word.id]:probe.wordIds.filter(id=>id!==word.id)})}/>{word.term} · {word.meaning}</label>)}{!selectable.length&&<p>当前没有符合条件的词。不要把事后成绩补成预先观察。</p>}</fieldset>}<button className="button primary" disabled={busy||!probe.wordIds.length}>{probe.expectedRevision?'补记课外接触':'冻结这组观察条件'}</button></form>
        {view?.k2.map((row,index)=><section className="business-probe-result" key={row.plan.id}><h3>观察 {index+1} · {directionLabels[row.plan.direction]} · {row.plan.interval==='next-day'?'次日':'第7天'}</h3>{row.metrics.map(metric=><p key={metric.scope}>{ratio(metric)}；可判定 {metric.denominator}/{metric.planned}；待核验 {metric.unconfirmed}，缺测 {metric.missing}，跳过 {metric.skipped}，不可用 {metric.unavailable}。</p>)}<ul>{row.observations.map(observation=><li key={observation.fact.id}>{row.plan.targets.find(target=>target.word.id===observation.fact.wordId)?.word.term}：{observation.reason}；实际间隔 {observation.actualDays??'尚无'} 天；期间另有 {observation.extraPractice} 次应用练习。</li>)}</ul></section>)}
      </>}
      {view&&<details className="business-technical"><summary>查看本机运行片段与缺项</summary><p>{view.timingLimitation}</p><p>收到 {view.eventCount} 个片段：前台可操作 {(view.timing.foreground/60000).toFixed(1)} 分钟、请求等待 {(view.timing['system-wait']/60000).toFixed(1)}、暂停 {(view.timing.paused/60000).toFixed(1)}、后台 {(view.timing.background/60000).toFixed(1)}。收到设备/请求问题 {view.issues.length} 次。</p></details>}
      <button className="button secondary" disabled={busy} onClick={()=>void load().catch(failed)}>刷新实际记录</button>{' '}
      <button className="button secondary" disabled={busy} onClick={()=>void api('/api/business/export',{headers}).then(data=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='private-business-observations.json';anchor.click();URL.revokeObjectURL(url);}).catch(failed)}>导出私有观察记录</button>
      <p className="muted">这些记录不进入项目工作台或普通学习备份；完整本机档案和单独导出需自行妥善保存。真实孩子数据、家长测试和工程示例分开计算。</p>
    </>}
    {message&&<p role="status">{message}</p>}{gate&&<ParentGate onClose={()=>setGate(false)} onUnlock={next=>{onGrant(next);setGate(false);}}/>}
  </section>;
}
