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
  const [selected, setSelected] = useState<Record<string, AssessmentResult>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now());
  const [audio, setAudio] = useState<{ id: string; url: string }>(); const audioUrl = useRef(''), lock = useRef(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(timer); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); }; }, []);
  const refresh = async () => { const state = await reload(); setSessions([...(state.assessments ?? [])].reverse().filter(row => row.workflow === 'recorded' && row.submittedAt)); setSelected({}); };
  const validGrant = grant && Date.parse(grant.expiresAt) > now;
  const operation = async (work: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (error) { setError(errorMessage(error)); if (errorMessage(error).includes('家长验证已失效')) onGrant(undefined); }
    finally { lock.current = false; setBusy(false); }
  };
  const hear = (sessionId: string, itemId: string) => void operation(async () => {
    const response = await fetch(`/api/assessments/${sessionId}/audio?itemId=${encodeURIComponent(itemId)}`, { headers: { Authorization: `Bearer ${grant!.token}` } });
    if (!response.ok) { let message = '原音暂不可用。'; try { message = (await response.json()).error; } catch {} throw new Error(message); }
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = URL.createObjectURL(await response.blob()); setAudio({ id: `${sessionId}:${itemId}`, url: audioUrl.current });
  });
  const defaultResult = (item: AssessmentItem): AssessmentResult => item.reviews?.at(-1)?.result ?? (item.response?.kind === 'skipped' ? 'skipped' : item.proposal?.verdict === 'matched' ? 'correct' : item.proposal?.verdict === 'practice' ? 'incorrect' : 'unconfirmed');
  if (!validGrant) return <ParentGate onClose={onExit} onUnlock={onGrant} />;
  return <section className="assessment-card assessment-review"><h1>集中核验挑战</h1><p>先回听、核对转写与本次义项，再勾选要确认的题目。AI 建议不计入正式成绩。朗读初判只比较识别到的内容。</p><p>核验保存后删除原音，保留文字与结论。未听清请选“未确认”，以后重新测试。</p><p role="alert">{error}</p><div className="assessment-review-toolbar"><button disabled={busy} onClick={() => void operation(refresh)}>刷新待核验记录</button><button className="assessment-primary" disabled={busy || !Object.keys(selected).length} onClick={() => void operation(async () => {
    for (const session of sessions) {
      const items = session.items.filter(item => selected[`${session.id}:${item.id}`]).map(item => ({ itemId: item.id, responseVersion: item.response!.version, proposalVersion: item.proposal?.version ?? 0, reviewVersion: item.reviews?.length ?? 0, result: selected[`${session.id}:${item.id}`] }));
      if (items.length) await api(`/api/assessments/${session.id}/review`, { method: 'POST', headers: { Authorization: `Bearer ${grant.token}` }, body: JSON.stringify({ items }) });
    }
    if (audioUrl.current) { URL.revokeObjectURL(audioUrl.current); audioUrl.current = ''; setAudio(undefined); }
    await refresh();
  })}>确认选中的 {Object.keys(selected).length} 项</button></div>
    {!sessions.length && <p>还没有待核验的录音挑战。</p>}
    {sessions.map(session => <section className="assessment-review-round" key={session.id}><h2>{new Date(session.startedAt).toLocaleString('zh-CN')} · {session.wordIds.length} 词 / {session.items.length} 项</h2><p>{session.items.filter(item => item.dimension !== 'look').every(item => item.reviews?.length) ? '本轮已核验；未确认项需重新测试' : session.job && statuses[session.job.status]} {session.job?.error}</p>{['failed', 'interrupted'].includes(session.job?.status ?? '') && <button disabled={busy} onClick={() => void operation(async () => { await api(`/api/assessments/${session.id}/retry`, { method: 'POST', headers: { Authorization: `Bearer ${grant.token}` } }); await refresh(); })}>重试未完成的批改阶段</button>}
      {session.items.filter(item => item.dimension !== 'look').map(item => {
        const key = `${session.id}:${item.id}`, checked = key in selected, recording = item.response?.recording;
        return <article className="assessment-review-item" key={key}>
          <label className="assessment-review-select"><input type="checkbox" checked={checked} disabled={busy} onChange={event => setSelected(previous => { const next = { ...previous }; if (event.target.checked) next[key] = defaultResult(item); else delete next[key]; return next; })} /><strong>{item.word.term} · {item.word.meaning}</strong></label>
          <p>{assessmentLabels[item.dimension]} · 作答 {new Date(item.response!.answeredAt).toLocaleString('zh-CN')} · 第 {item.response!.version} 版</p>
          <div className="assessment-review-audio">{recording?.status === 'ready' && !item.reviews?.length ? <button disabled={busy} onClick={() => hear(session.id, item.id)}><PlaybackIcon size={20}/> 回听原音</button> : <span>{recording?.status === 'missing' ? '原音缺失，待重测' : recording?.status === 'purge-pending' ? '原音待清理' : recording?.status === 'deleted' ? '核验后原音已删除' : '本题未录音'}</span>}{audio?.id === key && <audio src={audio.url} controls autoPlay />}</div>
          <p><strong>转写：</strong>{item.transcript?.text || (item.transcript ? '（未识别出内容）' : '尚未转写')}</p><p><strong>Codex 建议：</strong>{item.proposal ? `${proposalLabels[item.proposal.verdict]} · ${item.proposal.reason}` : '尚无建议，可直接根据原音核验'}</p>
          {item.reviews?.length ? <p>家长已确认：{assessmentResultLabels[item.reviews.at(-1)!.result]} · {new Date(item.reviews.at(-1)!.at).toLocaleString('zh-CN')} · 可改判</p> : <p>尚未写入口头正式成绩</p>}
          <label>家长结论 <select aria-label={`${item.word.term}${assessmentLabels[item.dimension]}家长结论`} disabled={busy} value={selected[key] ?? defaultResult(item)} onChange={event => setSelected(previous => ({ ...previous, [key]: event.target.value as AssessmentResult }))}>{(['correct', 'incorrect', 'hinted', 'unconfirmed', 'skipped'] as const).map(result => <option key={result} value={result}>{assessmentResultLabels[result]}</option>)}</select></label>
        </article>;
      })}
    </section>)}
  </section>;
}
