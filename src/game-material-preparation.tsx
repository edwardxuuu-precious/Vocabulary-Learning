import { useEffect, useRef, useState } from 'react';
import type { AppState, AssessmentGrant, PackGameAudioStatus } from '../shared/contracts';
import { buildGameMaterialProposals, derivedGameKinds, derivedWordMaterial, type GameMaterialProposal } from '../shared/game-material-builder';
import { activityTitles } from '../shared/game-plan';
import { GameMaterialTile } from './extended-games';
import { api, errorMessage } from './api';
import { ParentGate } from './parent-gate';

export function GameMaterialPreparation({state,grant,onGrant,reload}:{state:AppState;grant?:AssessmentGrant;onGrant:(grant?:AssessmentGrant)=>void;reload:()=>Promise<AppState>}) {
  const packs=state.packs.filter(p=>!p.isSample),[packId,setPackId]=useState(packs[0]?.id??'');
  const words=state.words.filter(w=>w.packId===packId&&!w.deletedAt&&w.assetStatus==='approved');
  const proposals=buildGameMaterialProposals(words),[selected,setSelected]=useState<string[]>([]),[ready,setReady]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[verify,setVerify]=useState(false),[open,setOpen]=useState<string[]>([]);
  const [status,setStatus]=useState<PackGameAudioStatus>();
  const controller=useRef<AbortController|null>(null);
  const fingerprint=JSON.stringify(words.map(w=>[w.id,w.learningVersion,w.imageUrl,w.gameMaterials]));
  useEffect(()=>{setSelected([]);setReady([]);setOpen([]);controller.current?.abort();},[fingerprint]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;setStatus(undefined);
    const refresh=async()=>{try{const value=await api<PackGameAudioStatus>(`/api/packs/${encodeURIComponent(packId)}/game-audio`);if(cancelled)return;setStatus(value);if(value.status==='running')timer=setTimeout(()=>void refresh(),1500);}catch{if(!cancelled)setStatus(undefined);}};
    if(packId)void refresh();return()=>{cancelled=true;if(timer)clearTimeout(timer);};
  },[packId,ready.length,fingerprint]);
  const key=(p:GameMaterialProposal)=>`${p.wordId}:${p.kind}`;
  const stopAutomatic=async()=>{if(!grant||Date.parse(grant.expiresAt)<=Date.now()){setVerify(true);return;}try{const value=await api<PackGameAudioStatus>(`/api/packs/${encodeURIComponent(packId)}/game-audio/cancel`,{method:'POST',headers:{Authorization:`Bearer ${grant.token}`},body:'{}'});setStatus(value);setMessage('自动准备已停止，已有缓存保留。');}catch(error){setMessage(errorMessage(error));}};
  const run=async(action:'prepare'|'approve')=>{
    if(!grant||Date.parse(grant.expiresAt)<=Date.now()){setVerify(true);return;}
    const job=new AbortController();controller.current=job;setBusy(true);setMessage('');
    const automatic=words.flatMap(word=>derivedGameKinds.map(kind=>({wordId:word.id,kind,material:derivedWordMaterial(word,kind)!,note:''})));
    const items:GameMaterialProposal[]=action==='prepare'?[...automatic,...proposals.filter(p=>selected.includes(key(p)))]:proposals.filter(p=>selected.includes(key(p))&&ready.includes(key(p)));
    let completed=0;
    try{
      for(const p of items){
        if(job.signal.aborted)break;
        setMessage(`${action==='prepare'?'准备发音':'确认素材'} ${completed+1}/${items.length} · ${activityTitles[p.kind]}`);
        await api(`/api/words/${encodeURIComponent(p.wordId)}/game-materials/${p.kind}${action==='prepare'?'/prepare':''}`,{method:'POST',headers:{Authorization:`Bearer ${grant.token}`},body:JSON.stringify({approve:true,material:p.material}),signal:job.signal});
        completed++;if(action==='prepare')setReady(previous=>[...new Set([...previous,key(p)])]);
      }
      if(job.signal.aborted)setMessage(`准备已停止，已完成 ${completed} 项，缓存保留。`);
      else setMessage(action==='prepare'?'配套发音已备好。拼图和中文回忆会自动用于新轮次；勾选的额外素材请再确认。':`已确认 ${completed} 份素材，会在条件合适的新轮次中自动使用。`);
    }catch(error){setMessage(job.signal.aborted?`准备已停止，已完成 ${completed} 项，缓存保留。`:`已完成 ${completed} 项。${errorMessage(error)} 已有缓存保留。`);}
    finally{if(action==='approve')await reload().catch(error=>setMessage(errorMessage(error)));setBusy(false);if(controller.current===job)controller.current=null;}
  };
  return <div className="game-preparation">
    <h3>自动补齐这本词书的游戏</h3>
    <p className="muted">已确认的图片自动变成拼图，中文词义自动变成开口回忆题。其他合适的玩法会生成候选，查看并确认后使用。</p>
    <label>选择词书<select aria-label="准备游戏的词书" value={packId} disabled={busy} onChange={e=>setPackId(e.target.value)}>{packs.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
    <p>{words.length} 个已批准单词 · 可自动准备 {words.length*2} 份拼图与中文回忆素材</p>
    {status&&status.total>0&&<p role="status">{status.status==='running'?'正在自动补齐游戏发音':status.status==='ready'?'拼图与中文回忆已备好':'游戏发音准备情况'}：{status.ready}/{status.total}{status.error&&`。${status.error}`}</p>}
    {status?.status==='running'&&<button className="text-button" disabled={busy} onClick={()=>void stopAutomatic()}>停止自动准备</button>}
    <div className="game-proposal-list">{proposals.map(p=>{const id=key(p),word=words.find(w=>w.id===p.wordId)!;return <details key={id} onToggle={e=>{if(e.currentTarget.open)setOpen(previous=>[...new Set([...previous,id])]);}}><summary>{word.term} · {activityTitles[p.kind]} {ready.includes(id)?'· 发音已备好':''}</summary><div className="game-proposal-content"><p>{p.material.instruction}</p>{p.material.prompt&&<p>题目：{p.material.prompt.text}</p>}{p.material.sentence&&<p>完整句子：{p.material.sentence.join(' ')}</p>}{p.material.chunks&&<p>记忆分块：{p.material.chunks.join(' + ')}</p>}{p.material.source&&<p>起始词：{p.material.source}</p>}<div className="game-proposal-tiles">{p.material.tiles.map(t=><figure key={t.id}><GameMaterialTile tile={t}/><figcaption>{t.label}</figcaption></figure>)}</div><p>答案：{p.material.answer.map(id=>p.material.tiles.find(t=>t.id===id)?.label).join('、')}{p.material.placements&&`；放入：${p.material.slots?.find(s=>s.id===Object.values(p.material.placements!)[0])?.label}`}</p><p className="muted">{p.note}</p><label><input type="checkbox" disabled={busy||!open.includes(id)} checked={selected.includes(id)} onChange={e=>{setSelected(xs=>e.target.checked?[...xs,id]:xs.filter(v=>v!==id));}}/>我已查看并核对题目、图片和答案；孩子熟悉涉及的表达。</label></div></details>;})}</div>
    {!proposals.length&&<p className="muted">当前单词没有新的关系类候选，已确认素材继续保留。</p>}
    <div className="game-preparation-actions"><button className="button secondary compact-button" disabled={busy||!words.length} onClick={()=>void run('prepare')}>补齐配套发音</button><button className="button primary compact-button" disabled={busy||!selected.some(id=>ready.includes(id))} onClick={()=>void run('approve')}>确认使用所选素材</button>{busy&&<button className="text-button" onClick={()=>controller.current?.abort()}>停止准备</button>}</div>
    <p className="muted">只补缺失发音，使用当前 ElevenLabs 免费额度，不足即停止。拼写、亲子和进阶开关继续按家长设置；每个新轮次自动搭配合适玩法。</p>
    {message&&<p role="status">{message}</p>}{verify&&<ParentGate onClose={()=>setVerify(false)} onUnlock={next=>{onGrant(next);setVerify(false);}}/>}
  </div>;
}
