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
  const [historyLimit, setHistoryLimit] = useState(4);
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
  const resumes = (state.assessments ?? []).filter(session => session.workflow === 'recorded').toSorted((a, b) => Number(Boolean(a.submittedAt)) - Number(Boolean(b.submittedAt)) || b.startedAt.localeCompare(a.startedAt));
  const resume = mode !== 'full' ? resumes.find(row => !row.submittedAt) : undefined;
  const resumeDone = resume?.items.filter(item => item.response).length ?? 0;
  const historyRows = resumes.filter(row => row.id !== resume?.id);
  const previewWords = selected.slice(0, 3).flatMap(id => { const word = available.find(word => word.id === id); return word ? [word] : []; });
  const resumeWords = resume?.wordIds.slice(0, 3).flatMap(id => { const word = resume.items.find(item => item.word.id === id)?.word; return word ? [word] : []; }) ?? [];
  const plannedDimensions = assessmentDimensions.filter(dimension => mode === 'full' ? selected.length > 0 : mode === 'recommended' ? recommended.some(item => item.dimension === dimension) : due.some(item => selected.includes(item.wordId) && item.dimension === dimension));
  const start = () => void request('/api/assessments', { ...(mode === 'recommended' ? {} : {wordIds: selected}), mode, workflow: 'recorded' });
  const chooseWords = () => { setMode('full'); setChoosing(true); setPickerPage(0); };
  const done = session?.items.filter(item => item.response).length ?? 0, recording = phase === 'recording';
  const stage = current && challengeStages[current.dimension], recordingBusy = recording || phase === 'preparing';
  const counts = <span className="quest-counts"><strong>{session?.wordIds.length ?? selected.length}<small>个单词</small></strong><i /><strong>{session?.items.length ?? count}<small>项挑战</small></strong></span>;
  return <main className={`child-challenge ${!session ? 'quest-lobby' : current ? 'quest-in-progress' : ''}`}>
    <div className="quest-shell">
      {!session ? <nav className="quest-lobby-nav" aria-label="挑战导航"><button onClick={exit}><ChallengeIcon name="back" />返回</button></nav> : <nav className="quest-nav" aria-label="挑战导航"><button className="quest-nav-button" aria-label="返回" onClick={exit}><ChallengeIcon name="back" /></button><span className="quest-brand"><span><ChallengeIcon name="flag" /></span><strong>单词挑战</strong></span>{current && <button className="quest-nav-button" aria-label="休息一下" disabled={busy} onClick={() => { resetTake(); setPaused(true); }}><ChallengeIcon name="pause" /></button>}</nav>}
      {error && <div className="quest-error" role="alert"><span>!</span><p>{error}</p></div>}
      {!session && <>
        <header className="quest-lobby-heading"><h1>记住了多少？</h1><Mascot small character="bumblebee" /></header>
        {resume && <button className="quest-resume-card" disabled={busy} onClick={() => void request(`/api/assessments/${resume.id}`)}>
          <span className="quest-resume-copy"><strong>继续上次挑战</strong><small>已答 {resumeDone}/{resume.items.length} 项{resumeDone === resume.items.length ? ' · 还没提交' : ''}</small><span className="quest-resume-progress" aria-hidden="true"><span style={{width: `${resume.items.length ? resumeDone / resume.items.length * 100 : 0}%`}} /></span><span className="quest-resume-action"><ChallengeIcon name="play" />{busy ? '准备中…' : resumeDone === resume.items.length ? '检查回答' : '继续挑战'}</span></span>
          <span className="quest-plan-pictures" aria-hidden="true">{resumeWords.map(word => <span key={word.id}><img src={word.imageUrl} alt="" /></span>)}</span>
        </button>}
        <div className="quest-setup-bar"><div className="quest-mode-switch" role="group" aria-label="挑战范围"><button disabled={busy} aria-pressed={mode === 'recommended'} onClick={() => setMode('recommended')}><ChallengeIcon name="refresh" />推荐短测</button><button disabled={busy} aria-pressed={mode === 'full'} onClick={() => setMode('full')}><ChallengeIcon name="flag" />{initialWordIds?.length ? '本轮挑战' : '自己选词'}</button></div>{mode === 'full' && <span>最多选 5 个学过的词</span>}</div>
        {mode !== 'full' && <section className={`quest-plan-card ${!resume && count ? 'is-primary' : ''}`} aria-label="准备新挑战">
          <div className="quest-plan-copy"><h2>{count ? '试试这些老朋友' : '现在没有推荐挑战'}</h2>{count ? <p className="quest-plan-count"><strong>{selected.length}</strong> 个词 · <strong>{count}</strong> 项挑战</p> : <p>{available.length ? '也可以自己选词，试试还记得吗。' : '先学几个词，再回来试一试。'}</p>}<button className={`quest-button ${resume ? 'quest-secondary' : 'quest-primary'}`} disabled={busy} onClick={count ? start : available.length ? chooseWords : exit}><ChallengeIcon name={count ? 'play' : available.length ? 'picture' : 'back'} />{busy ? '准备中…' : count ? '开始挑战' : available.length ? '自己选词挑战' : '先去学习'}</button></div>
          <div className="quest-plan-pictures" aria-hidden="true">{previewWords.length ? previewWords.map(word => <span key={word.id}><img src={word.imageUrl} alt="" /></span>) : <span className="quest-plan-symbol"><ChallengeIcon name="flag" /></span>}</div>
        </section>}
        {mode === 'full' && <section className="quest-word-selection" aria-label="选择挑战单词">
          {initialWordIds?.length ? <button className="quest-change-words" disabled={busy} aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>{choosing ? '收起选词' : '改选单词'}<ChallengeIcon name="down" /></button> : null}
          {!choosing && <div className="quest-selected-preview" aria-label="本轮已选单词">{selected.map(id => {const word = available.find(word => word.id === id)!; return <span key={id}><img src={word.imageUrl} alt="" /><strong>{word.term}</strong></span>;})}</div>}
          {choosing && <><div className="quest-word-grid">{available.slice(pickerPage * 12, pickerPage * 12 + 12).map(word => <button key={word.id} aria-label={`测试${word.term}`} aria-pressed={selected.includes(word.id)} disabled={busy || !selected.includes(word.id) && selected.length >= 5} onClick={() => setCustomIds(selected.includes(word.id) ? selected.filter(id => id !== word.id) : [...selected, word.id])}><span className="quest-word-picture"><img src={word.imageUrl} alt="" loading="lazy" decoding="async" /></span><strong>{word.term}</strong><small>{word.meaning}</small><span className="quest-word-check">{selected.includes(word.id) ? <ChallengeIcon name="check" /> : '+'}</span></button>)}</div>{available.length > 12 && <nav className="quest-word-pages" aria-label="挑战单词翻页"><button disabled={busy || !pickerPage} onClick={() => setPickerPage(pickerPage - 1)}>← 上一页</button><span>{pickerPage + 1}/{Math.ceil(available.length / 12)}</span><button disabled={busy || (pickerPage + 1) * 12 >= available.length} onClick={() => setPickerPage(pickerPage + 1)}>下一页 →</button></nav>}</>}
          {!available.length && <div className="quest-no-words"><ChallengeIcon name="book" /><strong>先认识几个单词吧</strong><p>学过的词会出现在这里。</p><button className="quest-button quest-secondary" onClick={exit}><ChallengeIcon name="back" />先去学习</button></div>}
        </section>}
        {count > 0 && <details className="quest-stage-details"><summary>本次 {plannedDimensions.length} 个关卡<ChallengeIcon name="down" /></summary><ChallengeRoute dimensions={plannedDimensions} /><p><ChallengeIcon name="pause" />可以随时休息，已保存的回答会保留。</p></details>}
        {historyRows.length > 0 && <details className="quest-history-details"><summary>挑战记录<span>{historyRows.length}</span><ChallengeIcon name="down" /></summary><div className="quest-history-list">{historyRows.slice(0, historyLimit).map(row => <button key={row.id} disabled={busy} onClick={() => void request(`/api/assessments/${row.id}`)}><span className={`quest-history-icon ${row.submittedAt ? 'is-finished' : ''}`}><ChallengeIcon name={row.submittedAt ? 'check' : 'play'} /></span><span><strong>{row.submittedAt ? '查看已提交挑战' : '继续上次挑战'}</strong><small>{new Date(row.startedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · 已答 {row.items.filter(item => item.response).length}/{row.items.length} 项</small></span><ChallengeIcon name="arrow" /></button>)}</div>{historyLimit < historyRows.length && <button className="quest-more-history" onClick={() => setHistoryLimit(value => value + 4)}>查看更多记录</button>}</details>}
        {mode === 'full' && available.length > 0 && <footer className="quest-selection-footer"><div><strong>已选 {selected.length}/5 词</strong><span role="status">{selected.length === 5 ? '选好 20 项挑战，点已选图片可换词' : selected.length ? `${count} 项挑战 · 没答完，下次继续` : '点图片选词，选好了就出发'}</span></div><button className="quest-button quest-primary" disabled={busy || !count} onClick={start}><ChallengeIcon name="play" />{busy ? '准备中…' : '开始挑战'}</button></footer>}
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
