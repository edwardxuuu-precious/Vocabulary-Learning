import { useEffect, useRef, useState } from 'react';
import type { AppState, AssessmentSession } from '../shared/contracts';
import { assessmentCurrent, assessmentDimensions, assessmentWords, dueAssessmentProgress, recommendedAssessmentItems } from '../shared/assessment';
import { api, errorMessage } from './api';
import { prepareChallengeRecording } from './challenge-recording';
import type { PreparedRecording } from './follow-along';
import { Mascot } from './mascot';
import { ChallengeIcon, ChallengeRoute, challengeStages } from './challenge-ui';
import './child-challenge.css';

export function ChildChallenge({ state, initialWordIds, reload, onExit }: { state: AppState; initialWordIds?: string[]; reload: () => Promise<AppState>; onExit: () => void }) {
  const now = new Date(state.learningNow ?? Date.now());
  const available = assessmentWords(state), due = dueAssessmentProgress(state, now), recommended = recommendedAssessmentItems(state, now);
  const [customIds, setCustomIds] = useState<string[]>(() => (initialWordIds ?? []).filter(id => available.some(word => word.id === id)).slice(0, 5));
  const [mode, setMode] = useState<AssessmentSession['mode']>(initialWordIds?.length ? 'full' : 'recommended');
  const [pickerPage, setPickerPage] = useState(0), [choosing, setChoosing] = useState(!initialWordIds?.length);
  const selected = mode === 'full' ? customIds.filter(id => available.some(word => word.id === id)) : mode === 'due' ? [...new Set(due.map(row => row.wordId))].slice(0, 5) : [...new Set(recommended.map(row => row.wordId))];
  const count = mode === 'full' ? selected.length * 4 : mode === 'recommended' ? recommended.length : due.filter(row => selected.includes(row.wordId)).length;
  const [session, setSession] = useState<AssessmentSession>();
  const [editId, setEditId] = useState<string>(), [paused, setPaused] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'ready'>('idle'), [take, setTake] = useState<Blob>(), [takeUrl, setTakeUrl] = useState('');
  const lock = useRef(false), mounted = useRef(true), capture = useRef<PreparedRecording | undefined>(undefined), abort = useRef<AbortController | undefined>(undefined);
  const current = session && (editId ? session.items.find(item => item.id === editId) : assessmentCurrent(session));
  const resetTake = () => { abort.current?.abort(); capture.current?.cancel(); setTake(undefined); setPhase('idle'); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); capture.current?.cancel(); }; }, []);
  useEffect(() => { if (!take) { setTakeUrl(''); return; } const url = URL.createObjectURL(take); setTakeUrl(url); return () => URL.revokeObjectURL(url); }, [take]);
  const request = async (path: string, body?: unknown, raw?: Blob) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await api<AssessmentSession>(path, raw ? { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: raw } : body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
      if (mounted.current) { setSession(next); history.replaceState(null, '', `#challenge/${encodeURIComponent(next.id)}`); setEditId(undefined); resetTake(); }
      await reload();
    } catch (error) { if (mounted.current) setError(errorMessage(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    const match = location.hash.match(/^#challenge\/([^/]+)$/);
    if (match) void request(`/api/assessments/${encodeURIComponent(decodeURIComponent(match[1]))}`);
  }, []);
  useEffect(() => {
    if (!session?.submittedAt || !['queued', 'transcribing', 'grading'].includes(session.job?.status ?? '')) return;
    let active = true;
    const timer = setInterval(() => { void api<AssessmentSession>(`/api/assessments/${session.id}`).then(next => { if (active) setSession(next); }).catch(() => {}); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [session?.id, session?.submittedAt, session?.job?.status]);
  const record = async () => {
    if (phase === 'preparing' || phase === 'recording' || busy || paused) return;
    resetTake(); setError(''); setPhase('preparing');
    const controller = new AbortController(); abort.current = controller;
    try {
      const recording = await prepareChallengeRecording(controller.signal);
      if (controller.signal.aborted) { recording.cancel(); return; }
      capture.current = recording; setPhase('recording');
      const blob = await recording.record();
      if (!mounted.current || controller.signal.aborted) return;
      if (!blob) { setPhase('idle'); setError('没有录到声音，再试一次或跳过吧。'); }
      else { setTake(blob); setPhase('ready'); }
    } catch { if (mounted.current && !controller.signal.aborted) { setPhase('idle'); setError('麦克风暂时不能用，可以重试或跳过。'); } }
  };
  const exit = () => { resetTake(); history.replaceState(null, '', location.pathname + location.search); onExit(); };
  const respond = (action: string, extra = {}) => current && void request(`/api/assessments/${session!.id}/responses`, { itemId: current.id, expectedVersion: current.response?.version ?? 0, action, ...extra });
  const resumes = [...(state.assessments ?? [])].reverse().filter(session => session.workflow === 'recorded').sort((a, b) => Number(Boolean(a.submittedAt)) - Number(Boolean(b.submittedAt)));
  const done = session?.items.filter(item => item.response).length ?? 0, recording = phase === 'recording';
  const stage = current && challengeStages[current.dimension], recordingBusy = recording || phase === 'preparing';
  const counts = <span className="quest-counts"><strong>{session?.wordIds.length ?? selected.length}<small>个单词</small></strong><i /><strong>{session?.items.length ?? count}<small>项挑战</small></strong></span>;
  return <main className={`child-challenge ${current ? 'quest-in-progress' : ''}`}>
    <div className="quest-shell">
      <nav className="quest-nav" aria-label="挑战导航"><button className="quest-nav-button" aria-label="返回" onClick={exit}><ChallengeIcon name="back" /></button><span className="quest-brand"><span><ChallengeIcon name="flag" /></span><strong>单词挑战<small>勇敢试一试，每一步都算数</small></strong></span>{current ? <button className="quest-nav-button" aria-label="休息一下" disabled={busy} onClick={() => { resetTake(); setPaused(true); }}><ChallengeIcon name="pause" /></button> : <span className="quest-nav-star" aria-hidden="true"><ChallengeIcon name="star" /></span>}</nav>
      {error && <div className="quest-error" role="alert"><span>!</span><p>{error}</p></div>}
      {!session && <>
        <section className="quest-welcome"><div className="quest-welcome-copy"><span className="quest-eyebrow"><ChallengeIcon name="star" /> 小小挑战家，集合！</span><h1>记住了多少？<br /><em>来挑战一下！</em></h1><p>用声音回答，用眼睛发现。<br />自己试一试，不用着急。</p><div className="quest-mode-switch" role="group" aria-label="挑战范围"><button aria-pressed={mode === 'recommended'} onClick={() => setMode('recommended')}><ChallengeIcon name="refresh" />推荐短测</button><button aria-pressed={mode === 'full'} onClick={() => setMode('full')}><ChallengeIcon name="flag" />{initialWordIds?.length ? '本轮挑战' : '自己选词'}</button></div></div>
          <div className="quest-companion-scene" aria-hidden="true"><span className="quest-orbit" /><span className="quest-spark quest-spark-one">✦</span><span className="quest-spark quest-spark-two">✧</span><span className="quest-companion-bubble">一起出发！</span><Mascot character="bumblebee" /><span className="quest-companion-ground" /></div>
        </section>
        {mode === 'full' && <section className="quest-word-selection" aria-label="选择挑战单词"><button className="quest-skip" onClick={() => setChoosing(!choosing)}>{choosing ? '收起选词' : '改选单词'} · 已选{selected.length}/5词</button>{choosing && <><div className="quest-word-grid">{available.slice(pickerPage * 12, pickerPage * 12 + 12).map(word => <button key={word.id} aria-label={`测试${word.term}`} aria-pressed={selected.includes(word.id)} disabled={!selected.includes(word.id) && selected.length >= 5} onClick={() => setCustomIds(selected.includes(word.id) ? selected.filter(id => id !== word.id) : [...selected, word.id])}><img src={word.imageUrl} alt={word.meaning} /><strong>{word.term}</strong><span>{selected.includes(word.id) ? '✓' : '+'}</span></button>)}</div>{available.length > 12 && <div className="quest-word-pages"><button disabled={!pickerPage} onClick={() => setPickerPage(pickerPage - 1)}>← 上一页</button><span>{pickerPage + 1}/{Math.ceil(available.length / 12)}</span><button disabled={(pickerPage + 1) * 12 >= available.length} onClick={() => setPickerPage(pickerPage + 1)}>下一页 →</button></div>}</>}</section>}
        <section className="quest-launch-card"><div className="quest-section-title"><h2>{mode === 'full' ? '四个小关卡，等你来闯' : mode === 'recommended' ? '老朋友，混着来挑战' : '看看哪些能力该复测了'}</h2>{counts}</div><ChallengeRoute /><div className="quest-launch-action"><span><ChallengeIcon name="pause" /> 随时可以休息，回答会保存</span><button className="quest-button quest-primary" disabled={busy || !count} onClick={() => void request('/api/assessments', { ...(mode === 'recommended' ? {} : {wordIds: selected}), mode, workflow: 'recorded' })}><ChallengeIcon name="play" />{busy ? '准备中…' : '开始挑战'}<ChallengeIcon name="arrow" /></button></div>{!count && <p className="quest-empty">{mode === 'recommended' ? '现在没有待测项目，可以自己选词挑战，或继续上次。' : mode === 'due' ? '现在没有到期的项目，试试自己选词吧。' : available.length ? '点图片，选1–5个学过的词。' : '先完成一轮学习，再来挑战吧。'}</p>}</section>
        {resumes.length > 0 && <section className="quest-history"><h2>你的挑战足迹</h2><div>{resumes.slice(0, 3).map(row => <button key={row.id} disabled={busy} onClick={() => void request(`/api/assessments/${row.id}`)}><span className={`quest-history-icon ${row.submittedAt ? 'is-finished' : ''}`}><ChallengeIcon name={row.submittedAt ? 'check' : 'play'} /></span><span><strong>{row.submittedAt ? '查看已完成挑战' : '继续上次挑战'}</strong><small>{new Date(row.startedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · 已答 {row.items.filter(item => item.response).length}/{row.items.length} 项</small></span><ChallengeIcon name="arrow" /></button>)}</div></section>}
      </>}
      {session && current && stage && !session.submittedAt && <>
        <ChallengeRoute session={session} />
        <section className={`quest-question quest-${stage.color}`} aria-label="当前挑战题" key={current.id}>
          <header className="quest-question-top"><span className="quest-question-kind"><ChallengeIcon name={stage.icon} />{stage.name}</span><span className="quest-question-number"><strong>{session.items.indexOf(current) + 1}</strong> / {session.items.length}<small>{editId ? '重新录一遍' : '当前题目'}</small></span></header>
          <div className="quest-question-body"><h1>{stage.title}</h1><p className="quest-question-instruction">{stage.instruction}</p><div className={`quest-word ${current.dimension === 'zh-en' ? 'quest-word-chinese' : ''} ${(current.dimension === 'zh-en' ? current.word.meaning : current.word.term).length > 25 ? 'quest-word-long' : ''}`}><span>{current.dimension === 'zh-en' ? '中文题面' : '英文单词'}</span><strong lang={current.dimension === 'zh-en' ? 'zh-CN' : 'en'}>{current.dimension === 'zh-en' ? current.word.meaning : current.word.term}</strong></div>
            {current.dimension === 'look' ? current.choices.length >= 2 ? <div className="quest-picture-choices">{current.choices.map((choice, index) => <button key={choice.id} aria-label={`选择图片${index + 1}`} disabled={busy || paused} onClick={() => respond('choose', { selectedId: choice.id })}><img src={choice.imageUrl} alt={`图片选项${index + 1}`} onError={() => { setPaused(true); setError('图片暂时打不开，已暂停。可以稍后再试。'); }} /><span>{String.fromCharCode(65 + index)}</span></button>)}</div> : <div className="quest-unavailable"><ChallengeIcon name="picture" /><p>图片暂时不够，这项留到以后。</p><button className="quest-button quest-secondary" disabled={busy} onClick={() => respond('unavailable')}>继续<ChallengeIcon name="arrow" /></button></div> : <div className={`quest-recorder ${recording ? 'is-recording' : ''} ${take ? 'has-take' : ''}`}>
              {take ? <><span className="quest-take-ready"><ChallengeIcon name="check" />录好啦，听听自己的声音</span><div className="quest-take-preview"><audio controls src={takeUrl} aria-label="听听刚才的录音" /><button className="quest-retake" disabled={busy || paused} onClick={() => void record()}><ChallengeIcon name="refresh" />重录</button></div></> : <><button className={`quest-mic-button ${recording ? 'is-recording' : ''} ${phase === 'preparing' ? 'is-preparing' : ''}`} disabled={busy || paused || phase === 'preparing'} aria-label={recording ? '说完了' : '开始录音'} onClick={() => recording ? capture.current?.stop() : void record()}><ChallengeIcon name={recording ? 'stop' : 'mic'} /><span>{phase === 'preparing' ? '准备中…' : recording ? '说完了' : '开始录音'}</span></button><span className="quest-recording-caption" role="status">{recording ? <><span className="quest-recording-dot" />正在录音，点一下结束</> : phase === 'preparing' ? '正在准备麦克风' : '点麦克风，把答案说出来'}</span></>}
              <small className="quest-recording-limit">每段最多20秒，不用着急</small>
            </div>}
          </div>
          <footer className="quest-question-actions"><button className="quest-skip" disabled={busy || paused || recordingBusy} onClick={() => { if (editId) { resetTake(); setEditId(undefined); } else respond('skip'); }}>{editId ? '取消重录' : '这题先跳过'}<ChallengeIcon name="arrow" /></button>{take ? <button className="quest-button quest-primary" disabled={busy || paused} onClick={() => void request(`/api/assessments/${session.id}/recordings?itemId=${encodeURIComponent(current.id)}&version=${current.response?.version ?? 0}`, undefined, take)}>{busy ? '保存中…' : '保存，下一题'}<ChallengeIcon name="arrow" /></button> : <span className="quest-encouragement">独立试一试，就很棒！</span>}</footer>
        </section>
        <div className="quest-overall-progress"><div role="progressbar" aria-label="挑战进度" aria-valuenow={done} aria-valuemin={0} aria-valuemax={session.items.length}><span style={{ width: `${100 * done / session.items.length}%` }} /></div><span>已作答 <strong>{done}</strong> / {session.items.length}</span></div>
      </>}
      {session && !current && !session.submittedAt && <section className="quest-review-card"><span className="quest-eyebrow"><ChallengeIcon name="check" /> 全部回答完啦</span><h1>最后，检查一下小背包</h1><p>回答都收好了，想重录的题目可以再试一次。</p><div className="quest-answer-groups">{assessmentDimensions.filter(dimension => dimension !== 'look' && session.items.some(item => item.dimension === dimension)).map(dimension => <section className={`quest-answer-group quest-${challengeStages[dimension].color}`} key={dimension}><h2><ChallengeIcon name={challengeStages[dimension].icon} />{challengeStages[dimension].name}</h2>{session.items.filter(item => item.dimension === dimension).map(item => <div key={item.id}><span><small>{String(session.items.indexOf(item) + 1).padStart(2, '0')}</small>{item.response?.kind === 'recording' ? '已录好' : '已跳过'}</span><button aria-label={`重录第${session.items.indexOf(item) + 1}题`} disabled={busy} onClick={() => { resetTake(); setEditId(item.id); }}><ChallengeIcon name="refresh" />重录</button></div>)}</section>)}</div><div className="quest-submit-row">{counts}<button className="quest-button quest-primary" disabled={busy} onClick={() => void request(`/api/assessments/${session.id}/submit`, {})}><ChallengeIcon name="flag" />{busy ? '提交中…' : '提交挑战'}<ChallengeIcon name="arrow" /></button></div></section>}
      {session?.submittedAt && <section className="quest-finish"><div className="quest-finish-art" aria-hidden="true"><span>✦</span><Mascot character="bumblebee" /><span>✧</span></div><span className="quest-eyebrow"><ChallengeIcon name="flag" /> 本轮挑战已保存</span><h1>挑战完成，真棒！</h1><p>勇敢说出答案，就是一次进步。</p>{counts}<div className="quest-processing" role="status"><span className={['queued', 'transcribing', 'grading'].includes(session.job?.status ?? '') ? 'quest-processing-dots' : 'quest-processing-icon'}>{['queued', 'transcribing', 'grading'].includes(session.job?.status ?? '') ? <><i /><i /><i /></> : <ChallengeIcon name="check" />}</span><span><strong>{session.items.filter(item => item.dimension !== 'look').every(item => item.reviews?.length) ? '家长已经核对啦' : session.job?.status === 'failed' || session.job?.status === 'interrupted' ? '回答都在，稍后再核对' : session.job?.status === 'review' ? '等家长来核对' : '正在批改你的挑战'}</strong><small>你可以先去休息，下次再来挑战。</small></span></div><button className="quest-button quest-primary" onClick={exit}>完成，返回<ChallengeIcon name="arrow" /></button></section>}
    </div>
    {paused && <div className="quest-modal-backdrop"><section className="quest-pause-modal" role="dialog" aria-modal="true" aria-labelledby="quest-pause-title"><span className="quest-pause-symbol"><ChallengeIcon name="pause" /></span><h2 id="quest-pause-title">歇一会儿，再出发</h2><p>已经保存的回答都还在。<br />刚才没保存的录音，下次重新录。</p><button className="quest-button quest-primary" onClick={() => setPaused(false)}><ChallengeIcon name="play" />继续挑战</button><button className="quest-skip" onClick={exit}>先返回</button></section></div>}
  </main>;
}
