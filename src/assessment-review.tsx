import { ActionBar } from './ui-layout';
import {challengeReviewResult} from '../shared/assessment-cues';
import {parentReviewSummary} from '../shared/parent-review';
import {sameAssessmentWord} from '../shared/assessment';
import { BufferedPlayer } from './buffered-player';
import { modeFetch } from './test-mode-context';
import { useEffect, useRef, useState } from 'react';
import type { AppState, AssessmentGrant, AssessmentItem, AssessmentResult } from '../shared/contracts';
import { assessmentLabels, assessmentResultLabels } from '../shared/assessment';
import { api, errorMessage } from './api';
import { ParentGate } from './parent-gate';
import { PlaybackIcon } from './playback-icon';

export const proposalLabels = { matched: '回答相符', practice: '需要练习', unclear: '无法判断' };
const statuses = { queued: '等待转写', transcribing: '正在转写', grading: 'Codex 初判中', review: '待家长核验', failed: '待处理', interrupted: '已中断' };
export function AssessmentReviewCenter({ state, grant, onGrant, reload, onExit }: { state: AppState; grant?: AssessmentGrant; onGrant: (grant?: AssessmentGrant) => void; reload: () => Promise<AppState>; onExit: () => void }) {
  const [sessions, setSessions] = useState(() => [...(state.assessments ?? [])].reverse().filter(row => row.workflow === 'recorded' && row.submittedAt));
  const [filter,setFilter]=useState<'pending'|'reviewed'|'all'>('pending');
  const [selected, setSelected] = useState<Record<string, AssessmentResult>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now());
  const [audio, setAudio] = useState<{ id: string; url: string }>(); const audioUrl = useRef(''), lock = useRef(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(timer); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); }; }, []);
  const refresh = async () => { const state = await reload(); setSessions([...(state.assessments ?? [])].reverse().filter(row => row.workflow === 'recorded' && row.submittedAt)); setSelected({}); };
  const review=parentReviewSummary({...state,assessments:sessions});
  const shown=sessions.filter(s=>filter==='all'||(filter==='pending'?review.pending(s)>0:review.pending(s)===0)).sort((a,b)=>Number(review.stale(b))-Number(review.stale(a))||Number(review.pending(b)>0)-Number(review.pending(a)>0)||a.startedAt.localeCompare(b.startedAt));
  const validGrant = grant && Date.parse(grant.expiresAt) > now;
  const operation = async (work: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (error) { setError(errorMessage(error)); if (errorMessage(error).includes('家长验证已失效')) onGrant(undefined); }
    finally { lock.current = false; setBusy(false); }
  };
  const hear = (sessionId: string, itemId: string) => void operation(async () => {
    const response = await modeFetch(`/api/assessments/${sessionId}/audio?itemId=${encodeURIComponent(itemId)}`, { headers: { Authorization: `Bearer ${grant!.token}` } });
    if (!response.ok) { let message = '原音暂不可用。'; try { message = (await response.json()).error; } catch {} throw new Error(message); }
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = URL.createObjectURL(await response.blob()); setAudio({ id: `${sessionId}:${itemId}`, url: audioUrl.current });
  });
  const defaultResult = (item: AssessmentItem): AssessmentResult => item.reviews?.at(-1)?.result ?? challengeReviewResult(item,item.response?.kind === 'skipped' ? 'skipped' : item.proposal?.verdict === 'matched' ? 'correct' : item.proposal?.verdict === 'practice' ? 'incorrect' : 'unconfirmed',state.words);
  if (!validGrant) return <ParentGate onClose={onExit} onUnlock={onGrant} />;
  return <section className="assessment-card assessment-review"><h1>集中核验挑战</h1><p>回听原音，对照本次义项，勾选并确认要保存的结论。未听清时选择「未确认」。</p><section className="review-plan-summary" aria-label="核验与下一步"><p>待核验 {review.waiting} 项 · 缺原音 {review.missing} 项 · 词义变化 {review.changed} 轮 · 处理中断 {review.failed} 轮</p>{review.suggestions.map(text=><p key={text}>{text}</p>)}<label>显示 <select value={filter} onChange={e=>{setFilter(e.target.value as typeof filter);setSelected({});}}><option value="pending">待核验</option><option value="reviewed">已核验/改判</option><option value="all">全部</option></select></label></section><p role="alert">{error}</p><button className="ui-secondary" disabled={busy} onClick={() => void operation(refresh)}>刷新核验记录</button>
    {!sessions.length && <p>暂无待核验的录音。</p>}
    {!shown.length&&sessions.length>0&&<p>此筛选没有记录，可切换已核验查看历史或改判。</p>}
    {shown.map(session => <section className="assessment-review-round" key={session.id}><h2>{new Date(session.startedAt).toLocaleString('zh-CN')} · {session.wordIds.length} 词 / {session.items.length} 项</h2><p>{session.items.filter(item => item.dimension !== 'look').every(item => item.reviews?.length) ? '本轮已核验；未确认项需重新测试' : session.job && statuses[session.job.status]} {session.job?.error}</p>{['failed', 'interrupted'].includes(session.job?.status ?? '') && <button disabled={busy} onClick={() => void operation(async () => { await api(`/api/assessments/${session.id}/retry`, { method: 'POST', headers: { Authorization: `Bearer ${grant.token}` } }); await refresh(); })}>重试未完成的批改阶段</button>}
      {session.items.filter(item => item.dimension !== 'look').map(item => {
        const stale=!sameAssessmentWord(state.words.find(w=>w.id===item.word.id&&!w.deletedAt),item.word);
        const key = `${session.id}:${item.id}`, checked = key in selected, recording = item.response?.recording;
        return <article className="assessment-review-item" key={key}>
          <label className="assessment-review-select"><input type="checkbox" checked={checked} disabled={busy||stale} onChange={event => setSelected(previous => { const next = { ...previous }; if (event.target.checked) next[key] = defaultResult(item); else delete next[key]; return next; })} /><strong>{item.word.term} · {item.word.meaning}</strong></label>
          <p>{stale?'词义或素材已变化，本项保留历史，请使用当前词义重新挑战。':''}</p><p>{assessmentLabels[item.dimension]} · 作答 {new Date(item.response!.answeredAt).toLocaleString('zh-CN')} · 第 {item.response!.version} 版</p>
          <div className="assessment-review-audio">{recording?.status === 'ready' && !item.reviews?.length ? <button disabled={busy} onClick={() => hear(session.id, item.id)}><PlaybackIcon size={20}/> 回听原音</button> : <span>{recording?.status === 'missing' ? '原音缺失，待重测' : recording?.status === 'purge-pending' ? '原音待清理' : recording?.status === 'deleted' ? '核验后原音已删除' : '本题未录音'}</span>}{audio?.id === key && <BufferedPlayer src={audio.url} autoPlay/>}</div>
          <p>{item.dimension==='zh-en'?`题面：${item.cue?.text??item.word.meaning}`:null}{item.cue?.sentence?` · ${item.cue.sentence}`:null}{item.response?.pictureHinted?' · 本次回答用了图片提示':''}{item.dimension==='zh-en'&&challengeReviewResult(item,'correct',state.words)==='unconfirmed'?' · 原作答未记录区分语境，不能据此判对错':''}</p><p><strong>转写：</strong>{item.transcript?.text || (item.transcript ? '（未识别出内容）' : '尚未转写')}</p><p><strong>Codex 建议：</strong>{item.proposal ? `${proposalLabels[item.proposal.verdict]} · ${item.proposal.reason}` : '尚无建议，可直接根据原音核验'}</p>
          {item.reviews?.length ? <p>家长已确认：{assessmentResultLabels[item.reviews.at(-1)!.result]} · {new Date(item.reviews.at(-1)!.at).toLocaleString('zh-CN')} · 可改判</p> : <p>尚未写入口头正式成绩</p>}
          <label>家长结论 <select aria-label={`${item.word.term}${assessmentLabels[item.dimension]}家长结论`} disabled={busy||stale} value={selected[key] ?? defaultResult(item)} onChange={event => setSelected(previous => ({ ...previous, [key]: event.target.value as AssessmentResult }))}>{(['correct', 'incorrect', 'hinted', 'unconfirmed', 'skipped',...(defaultResult(item)==='unavailable'?['unavailable' as const]:[])] as const).map(result => <option key={result} value={result} disabled={challengeReviewResult(item,result,state.words)!==result}>{assessmentResultLabels[result]}</option>)}</select></label>
        </article>;
      })}
    </section>)}
    {shown.length>0&&<ActionBar className="assessment-review-toolbar" context="确认后保存结论，并删除对应原音。" primary={<button className="assessment-primary" disabled={busy || !Object.keys(selected).length} onClick={() => void operation(async () => {
    for (const session of sessions) {
      const items = session.items.filter(item => selected[`${session.id}:${item.id}`]).map(item => ({ itemId: item.id, responseVersion: item.response!.version, proposalVersion: item.proposal?.version ?? 0, reviewVersion: item.reviews?.length ?? 0, result: selected[`${session.id}:${item.id}`] }));
      if (items.length) await api(`/api/assessments/${session.id}/review`, { method: 'POST', headers: { Authorization: `Bearer ${grant.token}` }, body: JSON.stringify({ items }) });
    }
    if (audioUrl.current) { URL.revokeObjectURL(audioUrl.current); audioUrl.current = ''; setAudio(undefined); }
    await refresh();
  })}>确认选中的 {Object.keys(selected).length} 项</button>}/>}
  </section>;
}
