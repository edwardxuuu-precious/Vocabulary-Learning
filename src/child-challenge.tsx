import { ActionBar, ActivityNavigation, BackButton, PageHeading, TaskHeading } from './ui-layout';
import {pendingSentenceWords,sentenceLesson} from '../shared/sentence-study';
import {assessmentCue,activeAssessmentCue,repairableAssessmentItem} from '../shared/assessment-cues';
import {sentenceIllustration} from '../shared/sentence-illustrations';
import {ScreenRestContext} from './screen-time';
import {testModeActive} from './test-mode-context';
import { BufferedPlayer } from './buffered-player';
import { useContext, useEffect, useRef, useState } from 'react';
import type { AppState, AssessmentSession } from '../shared/contracts';
import { maxAssessmentWords, assessmentCurrent, assessmentDimensions, assessmentWords, dueAssessmentProgress, recommendedAssessmentItems } from '../shared/assessment';
import { api, errorMessage } from './api';
import { prepareChallengeRecording } from './challenge-recording';
import type { PreparedRecording } from './follow-along';
import { Mascot } from './mascot';
import { ChallengeIcon, ChallengeRoute, challengeStages } from './challenge-ui';
import './child-challenge.css';
import {learningVerification} from '../shared/learning-verification';

export function ChildChallenge({ state, initialWordIds:requestedWordIds, reload, onExit, onParentReview, onLearnUsage }: { state: AppState; initialWordIds?: string[]; reload: () => Promise<AppState>; onExit: () => void; onParentReview?:()=>void; onLearnUsage?:(wordIds:string[])=>void }) {
  const scopeKey=`playroom-learning-test-scope:${testModeActive?'test':'child'}`;
  const [initialWordIds]=useState<string[]|undefined>(()=>{
    if(requestedWordIds?.length)return requestedWordIds;
    try{if(typeof location==='undefined')return;const saved=JSON.parse(sessionStorage.getItem(scopeKey)??'null');if(saved&&location.hash===`#challenge/${encodeURIComponent(saved.testId)}`&&Array.isArray(saved.wordIds)&&saved.wordIds.length<=20000&&saved.wordIds.every((id:unknown)=>typeof id==='string'))return saved.wordIds;}catch{}return;
  });
  const forcedRest=useContext(ScreenRestContext);
  const now = new Date(state.learningNow ?? Date.now());
  const scoped=!!initialWordIds?.length,verification=learningVerification(state,initialWordIds??[],now);
  const available = assessmentWords(state).filter(word=>!scoped||initialWordIds!.includes(word.id)), due = dueAssessmentProgress(state, now), recommended = recommendedAssessmentItems(state, now);
  const [customIds, setCustomIds] = useState<string[]>(() => scoped?verification.resume?.wordIds??verification.nextWordIds:[]);
  const [mode, setMode] = useState<AssessmentSession['mode']>(initialWordIds?.length ? 'full' : 'recommended');
  const [pickerPage, setPickerPage] = useState(0), [choosing, setChoosing] = useState(!initialWordIds?.length);
  const [historyLimit, setHistoryLimit] = useState(4);
  const [hintAttempt,setHintAttempt]=useState(0);
  const pauseDialog = useRef<HTMLDialogElement>(null);
  const selected = mode === 'full' ? customIds.filter(id => available.some(word => word.id === id)) : mode === 'due' ? [...new Set(due.map(row => row.wordId))].slice(0, 5) : [...new Set(recommended.map(row => row.wordId))];
  const count = mode === 'full' ? selected.length * 4 : mode === 'recommended' ? recommended.length : due.filter(row => selected.includes(row.wordId)).length;
  const [session, setSession] = useState<AssessmentSession>();
  const [editId, setEditId] = useState<string>(), [paused, setPaused] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'ready'>('idle'), [take, setTake] = useState<Blob>(), [takeUrl, setTakeUrl] = useState('');
  const lock = useRef(false), mounted = useRef(true), capture = useRef<PreparedRecording | undefined>(undefined), abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => { const dialog=pauseDialog.current; if(!dialog)return; if(paused&&!dialog.open)dialog.showModal(); else if(!paused&&dialog.open)dialog.close(); return()=>{if(dialog.open)dialog.close();}; }, [paused]);
  const current = session && (editId ? session.items.find(item => item.id === editId) : assessmentCurrent(session));
  const repairs=session&&!session.submittedAt?session.items.filter(item=>repairableAssessmentItem(item,state.words)):[];
  const resetTake = () => { abort.current?.abort(); capture.current?.cancel(); setTake(undefined); setPhase('idle'); };
  useEffect(()=>{if(forcedRest){if(phase==='recording')capture.current?.stop();else if(phase==='preparing')resetTake();}},[forcedRest]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); capture.current?.cancel(); }; }, []);
  useEffect(() => { if (!take) { setTakeUrl(''); return; } const url = URL.createObjectURL(take); setTakeUrl(url); return () => URL.revokeObjectURL(url); }, [take]);
  const request = async (path: string, body?: unknown, raw?: Blob) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await api<AssessmentSession>(path, raw ? { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: raw } : body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
      if (mounted.current) { if(initialWordIds?.length)try{sessionStorage.setItem(scopeKey,JSON.stringify({testId:next.id,wordIds:initialWordIds}));}catch{} setSession(next); history.replaceState(null, '', `#challenge/${encodeURIComponent(next.id)}`); setEditId(undefined); resetTake(); }
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
    let operation:'cue'|'microphone'='cue';
    try {
      if(current?.dimension==='zh-en'){const prepared=await api<AssessmentSession>(`/api/assessments/${session!.id}/responses`,{method:'POST',body:JSON.stringify({itemId:current.id,expectedVersion:current.response?.version??0,action:'prepare-cue',cueVersion:cue!.version}),signal:controller.signal});if(controller.signal.aborted)return;setSession(prepared);}
      operation='microphone';
      const recording = await prepareChallengeRecording(controller.signal);
      if (controller.signal.aborted) { recording.cancel(); return; }
      capture.current = recording; setPhase('recording');
      const blob = await recording.record();
      if (!mounted.current || controller.signal.aborted) return;
      if (!blob) { setPhase('idle'); setError('没有录到声音，再试一次或跳过吧。'); }
      else { setTake(blob); setPhase('ready'); }
    } catch(error) { if (mounted.current && !controller.signal.aborted) { setPhase('idle'); setError(operation==='cue'?errorMessage(error):'麦克风暂时不能用，可以重试或跳过。'); } }
  };
  const exit = () => { resetTake(); history.replaceState(null, '', location.pathname + location.search); onExit(); };
  const respond = (action: string, extra = {}) => current && void request(`/api/assessments/${session!.id}/responses`, { itemId: current.id, expectedVersion: current.response?.version ?? 0, action,...(current.dimension==='zh-en'?{cueVersion:cue!.version}:{}), ...extra });
  const resumes = (state.assessments ?? []).filter(session => session.workflow === 'recorded').toSorted((a, b) => Number(Boolean(a.submittedAt)) - Number(Boolean(b.submittedAt)) || b.startedAt.localeCompare(a.startedAt));
  const resume = scoped?verification.resume:mode !== 'full' ? resumes.find(row => !row.submittedAt) : undefined;
  const frozenRound = scoped && resume;
  const resumeDone = resume?.items.filter(item => item.response).length ?? 0;
  const historyRows = resumes.filter(row => row.id !== resume?.id&&(!scoped||row.wordIds.every(id=>initialWordIds!.includes(id))));
  const previewWords = selected.slice(0, 3).flatMap(id => { const word = available.find(word => word.id === id); return word ? [word] : []; });
  const resumeWords = resume?.wordIds.slice(0, 3).flatMap(id => { const word = resume.items.find(item => item.word.id === id)?.word; return word ? [word] : []; }) ?? [];
  const plannedDimensions = assessmentDimensions.filter(dimension => mode === 'full' ? selected.length > 0 : mode === 'recommended' ? recommended.some(item => item.dimension === dimension) : due.some(item => selected.includes(item.wordId) && item.dimension === dimension));
  const start = () => {if(pendingUsageCount&&!(resume&&scoped))return;return resume&&scoped?void request(`/api/assessments/${resume.id}`):void request('/api/assessments', { ...(mode === 'recommended' ? {} : {wordIds: selected}), mode, workflow: 'recorded',cueVersion:2 });};
  const chooseWords = () => { setMode('full'); setChoosing(true); setPickerPage(0); };
  const done = session?.items.filter(item => item.response).length ?? 0, recording = phase === 'recording';
  const stage = current && challengeStages[current.dimension], recordingBusy = recording || phase === 'preparing';
  const cue=current?.dimension==='zh-en'?activeAssessmentCue(current,state.words):undefined;
  const hintPicture=cue&&current?(cue.sentence?sentenceIllustration(current.word,cue)?.src:current.word.imageUrl):undefined;
  const showPictureHint=async()=>{
    if(!current||!hintPicture||current.dimension!=='zh-en'||lock.current||paused||recordingBusy||take)return;
    lock.current=true;setBusy(true);setError('');const controller=new AbortController();abort.current=controller;
    try{const picture=new Image();picture.src=hintPicture;await picture.decode();if(controller.signal.aborted)return;const next=await api<AssessmentSession>(`/api/assessments/${session!.id}/responses`,{method:'POST',body:JSON.stringify({itemId:current.id,expectedVersion:current.response?.version??0,action:'picture-hint',cueVersion:cue!.version}),signal:controller.signal});if(mounted.current&&!controller.signal.aborted){setSession(next);setHintAttempt(value=>value+1);}}
    catch(error){if(mounted.current&&!controller.signal.aborted)setError('图片提示还没打开，可以重试。'+errorMessage(error));}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  };
  const counts = <span className="quest-counts"><strong>{session?.wordIds.length ?? selected.length}<small>个单词</small></strong><i /><strong>{session?.items.length ?? count}<small>项挑战</small></strong></span>;
  const studyIds=session&&!session.submittedAt?session.items.filter(item=>item.dimension==='zh-en'&&!item.response?.recording).map(item=>item.word.id):!session?mode==='full'?selected:mode==='due'?due.filter(item=>item.dimension==='zh-en'&&selected.includes(item.wordId)).map(item=>item.wordId):recommended.filter(item=>item.dimension==='zh-en').map(item=>item.wordId):[];
  const studyWords=[...new Set(studyIds)].flatMap(id=>{const word=state.words.find(word=>word.id===id);return word&&sentenceLesson(word)?[word]:[];});
  const pendingUsageCount=pendingSentenceWords(state,studyWords).length;
  const learnUsage=()=>{resetTake();onLearnUsage?onLearnUsage(studyWords.map(word=>word.id)):exit();};
  const usageNotice=<section className="quest-learning-needed" aria-label="测试前的学习状态"><h2>还有 {pendingUsageCount} 个短句没学</h2><p>先学完这些短句，就能开始测试。</p><button className={`quest-button ${resume?'quest-secondary':'quest-primary'}`} disabled={busy||recordingBusy} onClick={learnUsage}>去学短句<ChallengeIcon name="arrow"/></button></section>;
  const selectionAction=<button className={`quest-button ${resume?'quest-secondary':'quest-primary'}`} disabled={busy || !count || !!pendingUsageCount} onClick={start}>{busy?'准备中…':scoped?'开始测试':'开始挑战'}<ChallengeIcon name="arrow"/></button>;
  const canContinueTest=scoped&&verification.nextWordIds.length>0;
  const canRequestReview=scoped&&verification.pending>0&&!!onParentReview;
  const submittedOral=session?.items.filter(item=>item.dimension!=='look'&&item.response?.kind==='recording')??[];
  const pendingReview=submittedOral.some(item=>!item.reviews?.length);
  const processing=['queued','transcribing','grading'].includes(session?.job?.status??'');
  const submittedStatus=!submittedOral.length?'回答记录已保存':!pendingReview?'家长已核验':processing?'正在整理录音':session?.job?.status==='failed'||session?.job?.status==='interrupted'?'录音已保存，可以稍后核验':'待家长核验';
  const navigation=<ActivityNavigation
    label="挑战导航"
    back={<BackButton onClick={exit}>返回上一页</BackButton>}
    progress={session&&!session.submittedAt?{label:stage?.name??'独立测试',name:'挑战进度',completed:done,total:session.items.length,unit:'项'}:undefined}
    actions={current&&<button className="ui-secondary" aria-label="休息一下" disabled={busy} onClick={()=>{if(recordingBusy)resetTake();setPaused(true);}}><ChallengeIcon name="pause"/>休息</button>}
  />;
  if(current?.dimension==='zh-en'&&cue?.sentence&&pendingSentenceWords(state,[current.word]).length&&!session?.submittedAt)return <main className="child-challenge"><div className="quest-shell">{navigation}{usageNotice}<button className="quest-button quest-secondary" disabled={busy} onClick={()=>respond('unavailable')}>先放下这题，继续测试<ChallengeIcon name="arrow"/></button></div></main>;
  return <main className={`child-challenge ${!session ? 'quest-lobby' : current ? 'quest-in-progress' : ''}`}>
    <div className="quest-shell">
      {navigation}
      {!session&&<PageHeading title={scoped?'本轮独立测试':'独立测试'} description={scoped?`本轮 ${verification.total} 词 · 已通过 ${verification.passed} 词${verification.pending?` · 待核验 ${verification.pending} 词`:''}`:undefined}/>}
      {!session&&!frozenRound&&pendingUsageCount>0&&usageNotice}
      {repairs.length>0&&current&&!editId&&<aside className="quest-repaired-cue" aria-label="补好的题目"><span>刚才跳过的题，语境已补好。</span><button disabled={busy||paused||recordingBusy||!!take} onClick={()=>{resetTake();setEditId(repairs[0].id);}}>重测这道题<ChallengeIcon name="arrow"/></button></aside>}
      {error && <div className="quest-error" role="alert"><span>!</span><p>{error}</p></div>}
      {!session && <>
        {resume && <section className="quest-resume-card" aria-label="未完成的测试">
          <div className="quest-resume-copy"><h2>{scoped ? '继续本轮测试' : '继续上次挑战'}</h2><p>本次测试 {resume.wordIds.length} 词 · {resume.items.length} 项</p><small>已答 {resumeDone}/{resume.items.length} 项{resumeDone === resume.items.length ? ' · 还没提交' : ''}</small><progress value={resumeDone} max={resume.items.length || 1} aria-label="已答测试题数"/><button className="quest-button quest-primary" disabled={busy} onClick={() => void request(`/api/assessments/${resume.id}`)}>{busy ? '准备中…' : resumeDone === resume.items.length ? '检查回答' : '继续测试'}<ChallengeIcon name="arrow"/></button></div>
          <span className="quest-plan-pictures" aria-hidden="true">{resumeWords.map(word => <span key={word.id}><img src={word.imageUrl} alt="" /></span>)}</span>
        </section>}
        {!scoped&&<div className="quest-setup-bar"><div className="quest-mode-switch" role="group" aria-label="挑战范围"><button disabled={busy} aria-pressed={mode === 'recommended'} onClick={() => setMode('recommended')}><ChallengeIcon name="refresh" />推荐短测</button><button disabled={busy} aria-pressed={mode === 'full'} onClick={() => setMode('full')}><ChallengeIcon name="flag" />自己选词</button></div>{mode === 'full' && <span>一次可选 {maxAssessmentWords} 个已学过的词</span>}</div>}
        {mode !== 'full' && <section className={`quest-plan-card ${!resume && count ? 'is-primary' : ''}`} aria-label="准备新挑战">
          <div className="quest-plan-copy"><h2>{count ? '试试这些老朋友' : '现在没有推荐挑战'}</h2>{count ? <p className="quest-plan-count"><strong>{selected.length}</strong> 个词 · <strong>{count}</strong> 项挑战</p> : <p>{available.length ? '也可以自己选词，试试还记得吗。' : '先学几个词，再回来试一试。'}</p>}<button className={`quest-button ${resume ? 'quest-secondary' : 'quest-primary'}`} disabled={busy||!!pendingUsageCount&&!!count} onClick={count ? start : available.length ? chooseWords : exit}><ChallengeIcon name={count ? 'play' : available.length ? 'picture' : 'back'} />{busy ? '准备中…' : count ? '开始挑战' : available.length ? '自己选词挑战' : '先去学习'}</button></div>
          <div className="quest-plan-pictures" aria-hidden="true">{previewWords.length ? previewWords.map(word => <span key={word.id}><img src={word.imageUrl} alt="" /></span>) : <span className="quest-plan-symbol"><ChallengeIcon name="flag" /></span>}</div>
        </section>}
        {mode === 'full' && !frozenRound && <section className={`quest-word-selection${scoped?' quest-scope-summary':''}`} aria-label={scoped?'本轮学习验证进度':'选择挑战单词'}>
          {scoped&&<div className="quest-scope-heading"><div><h2>本次测试 {selected.length} 词 · {count} 项</h2><p>需要录音，也有看词选图。</p></div><button className="ui-secondary quest-change-words" disabled={busy} aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>{choosing ? '收起选词' : '改选单词'}<ChallengeIcon name="down"/></button></div>}
          {!choosing && <div className="quest-selected-preview" aria-label="本轮已选单词">{selected.map(id => {const word = available.find(word => word.id === id)!; return <span key={id}><img src={word.imageUrl} alt="" /><strong>{word.term}</strong></span>;})}</div>}
          {choosing && <><div className="quest-word-grid">{available.slice(pickerPage * 12, pickerPage * 12 + 12).map(word => <button key={word.id} aria-label={`测试${word.term}`} aria-pressed={selected.includes(word.id)} disabled={busy || !selected.includes(word.id) && selected.length >= maxAssessmentWords} onClick={() => setCustomIds(selected.includes(word.id) ? selected.filter(id => id !== word.id) : [...selected, word.id])}><span className="quest-word-picture"><img src={word.imageUrl} alt="" loading="lazy" decoding="async" /></span><strong>{word.term}</strong><small>{assessmentCue(word,available).kind==='needs-context'?`${word.meaning} · 需补语境`:word.meaning}</small><span className="quest-word-check">{selected.includes(word.id) ? <ChallengeIcon name="check" /> : '+'}</span></button>)}</div>{available.length > 12 && <nav className="quest-word-pages" aria-label="挑战单词翻页"><button disabled={busy || !pickerPage} onClick={() => setPickerPage(pickerPage - 1)}>← 上一页</button><span>{pickerPage + 1}/{Math.ceil(available.length / 12)}</span><button disabled={busy || (pickerPage + 1) * 12 >= available.length} onClick={() => setPickerPage(pickerPage + 1)}>下一页 →</button></nav>}</>}
          {!available.length && <div className="quest-no-words"><ChallengeIcon name="book" /><strong>先认识几个单词吧</strong><p>接触过的词会出现在这里。</p><button className="quest-button quest-secondary" onClick={exit}><ChallengeIcon name="back" />先去学习</button></div>}
          {available.length>0&&<ActionBar className="quest-selection-actions" context={<span role="status">{!selected.length?'点图片选词':scoped?'答到一半也可以稍后继续':`已选 ${selected.length}/${maxAssessmentWords} 词 · ${count} 项`}</span>} primary={selectionAction}/>}
        </section>}
        {!frozenRound && count > 0 && <details className="quest-stage-details"><summary>本次 {plannedDimensions.length} 个关卡<ChallengeIcon name="down" /></summary><ChallengeRoute dimensions={plannedDimensions} /><p><ChallengeIcon name="pause" />可以随时休息，已保存的回答会保留。</p></details>}
        {historyRows.length > 0 && <details className="quest-history-details"><summary>挑战记录<span>{historyRows.length}</span><ChallengeIcon name="down" /></summary><div className="quest-history-list">{historyRows.slice(0, historyLimit).map(row => <button key={row.id} disabled={busy} onClick={() => void request(`/api/assessments/${row.id}`)}><span className={`quest-history-icon ${row.submittedAt ? 'is-finished' : ''}`}><ChallengeIcon name={row.submittedAt ? 'check' : 'play'} /></span><span><strong>{row.submittedAt ? '查看已提交挑战' : '继续上次挑战'}</strong><small>{new Date(row.startedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · 已答 {row.items.filter(item => item.response).length}/{row.items.length} 项</small></span><ChallengeIcon name="arrow" /></button>)}</div>{historyLimit < historyRows.length && <button className="quest-more-history" onClick={() => setHistoryLimit(value => value + 4)}>查看更多记录</button>}</details>}
      </>}
      {session && current && stage && !session.submittedAt && <>
        <section className={`quest-question quest-${stage.color}`} aria-label="当前挑战题" key={current.id}>
          <TaskHeading title={cue?.kind==='needs-context'?'这题先放一放':cue?.sentence?'补一句，说英文':stage.title} instruction={cue?.instruction??stage.instruction}>
            {editId&&<small className="ui-task-state">{repairableAssessmentItem(current,state.words)?'这题已补好':'重新录一遍'}</small>}
          </TaskHeading>
          <div className="quest-question-body"><div className="ui-challenge-cue">{cue?.kind!=='needs-context'&&<div className={`quest-word ${current.dimension === 'zh-en' ? 'quest-word-chinese' : ''} ${(cue?.text??current.word.term).length > 25 ? 'quest-word-long' : ''}`}><strong lang={current.dimension === 'zh-en' ? 'zh-CN' : 'en'}>{cue?.text??current.word.term}</strong>{cue?.sentence&&<p className="quest-sentence" lang="en">{cue.sentence.split('___')[0]}<span className="quest-sentence-blank" aria-label="空白">___</span>{cue.sentence.split('___')[1]}</p>}</div>}{cue&&cue.kind!=='needs-context'&&hintPicture&&<div className="quest-picture-hint">{current.pictureHint&&<figure><img key={current.id+hintAttempt} src={hintPicture} alt="图片提示" onError={()=>setError('图片暂时没打开，可以重试。')}/><figcaption>图片提示</figcaption></figure>}{!recordingBusy&&!take&&<button className="quest-hint-button" disabled={busy||paused} onClick={()=>void showPictureHint()}><ChallengeIcon name="picture"/>{current.pictureHint?'再看图片':'看图提示'}</button>}</div>}</div>
            <div className="ui-challenge-response">{cue?.kind==='needs-context'?<div className="quest-cue-unavailable"><p>题目没说清，不算答错。</p><button className="quest-button quest-primary" disabled={busy||paused} onClick={()=>respond('unavailable')}>先放下，继续<ChallengeIcon name="arrow"/></button></div>:current.dimension === 'look' ? current.choices.length >= 2 ? <div className="quest-picture-choices">{current.choices.map((choice, index) => <button key={choice.id} aria-label={`选择图片${index + 1}`} disabled={busy || paused} onClick={() => respond('choose', { selectedId: choice.id })}><img src={choice.imageUrl} alt={`图片选项${index + 1}`} onError={() => { setPaused(true); setError('图片暂时打不开，已暂停。可以稍后再试。'); }} /><span>{String.fromCharCode(65 + index)}</span></button>)}</div> : <div className="quest-unavailable"><ChallengeIcon name="picture" /><p>图片暂时不够，这项留到以后。</p><button className="quest-button quest-secondary" disabled={busy} onClick={() => respond('unavailable')}>继续<ChallengeIcon name="arrow" /></button></div> : <div className={`quest-recorder ${recording ? 'is-recording' : ''} ${take ? 'has-take' : ''}`}>
              {take ? <><span className="quest-take-ready"><ChallengeIcon name="check" />录好啦，听听自己的声音</span><div className="quest-take-preview"><BufferedPlayer src={takeUrl} label="听听刚才的录音" disabled={paused||busy}/><button className="quest-retake" disabled={busy || paused} onClick={() => void record()}><ChallengeIcon name="refresh" />重录</button></div></> : <><button className={`quest-mic-button ${recording ? 'is-recording' : ''} ${phase === 'preparing' ? 'is-preparing' : ''}`} disabled={busy || paused || phase === 'preparing'} aria-label={recording ? '说完了' : '开始录音'} onClick={() => recording ? capture.current?.stop() : void record()}><ChallengeIcon name={recording ? 'stop' : 'mic'} /><span>{phase === 'preparing' ? '准备中…' : recording ? '说完了' : '开始录音'}</span></button>{(recording||phase==='preparing')&&<span className="quest-recording-caption" role="status">{recording?'正在录音':'正在准备麦克风'}</span>}</>}
              <small className="quest-recording-limit">每段最多20秒，不用着急</small>
            </div>}</div>
          </div>
          <ActionBar className="quest-question-actions" label="本题操作" primary={take && <button className="quest-button quest-primary" disabled={busy || paused} onClick={() => void request(`/api/assessments/${session.id}/recordings?itemId=${encodeURIComponent(current.id)}&version=${current.response?.version ?? 0}${current.dimension==='zh-en'?`&cueVersion=${cue!.version}`:''}`, undefined, take)}>{busy ? '保存中…' : '保存并继续'}<ChallengeIcon name="arrow" /></button>}>
            <button className="quest-skip" disabled={busy || paused || recordingBusy} onClick={() => { if (editId) { resetTake(); setEditId(undefined); } else respond('skip'); }}>{editId ? '取消重录' : '跳过这题'}</button>
          </ActionBar>
        </section>
      </>}
      {session && !current && !session.submittedAt && <section className="quest-review-card"><h1>检查本轮回答</h1><p>有想重录的题，可以再试一次。</p><div className="quest-answer-groups">{assessmentDimensions.filter(dimension => dimension !== 'look' && session.items.some(item => item.dimension === dimension)).map(dimension => <section className={`quest-answer-group quest-${challengeStages[dimension].color}`} key={dimension}><h2><ChallengeIcon name={challengeStages[dimension].icon} />{challengeStages[dimension].name}</h2>{session.items.filter(item => item.dimension === dimension).map(item => <div key={item.id}><span><small>{String(session.items.indexOf(item) + 1).padStart(2, '0')}</small>{repairableAssessmentItem(item,state.words)?'语境已补好，可重测':item.response?.kind === 'recording' ? '已录好' : item.response?.kind==='unavailable'?'题目待补充':'已跳过'}</span><button aria-label={`重录第${session.items.indexOf(item) + 1}题`} disabled={busy} onClick={() => { resetTake(); setEditId(item.id); }}><ChallengeIcon name="refresh" />{repairableAssessmentItem(item,state.words)?'开始这题':'重录'}</button></div>)}</section>)}</div><ActionBar className="quest-submit-row" context={counts} primary={<button className="quest-button quest-primary" disabled={busy} onClick={() => void request(`/api/assessments/${session.id}/submit`, {})}><ChallengeIcon name="flag" />{busy ? '提交中…' : '提交测试'}<ChallengeIcon name="arrow" /></button>}/></section>}
      {session?.submittedAt && <section className="quest-finish"><div className="quest-finish-art" aria-hidden="true"><Mascot character="bumblebee" /></div><h1>本轮测试已提交</h1>{counts}<div className="quest-processing" role="status"><span className={processing&&pendingReview?'quest-processing-dots':'quest-processing-icon'}>{processing&&pendingReview?<><i/><i/><i/></>:<ChallengeIcon name="check"/>}</span><strong>{submittedStatus}</strong></div><ActionBar className="quest-finish-actions" primary={canContinueTest?<button className="quest-button quest-primary" disabled={busy} onClick={()=>void request('/api/assessments',{wordIds:verification.nextWordIds,mode:'full',workflow:'recorded',cueVersion:2})}>继续测剩余 {verification.nextWordIds.length} 词<ChallengeIcon name="arrow"/></button>:canRequestReview?<button className="quest-button quest-primary" disabled={busy} onClick={onParentReview}>请家长核验<ChallengeIcon name="arrow"/></button>:<button className="quest-button quest-primary" onClick={exit}>完成<ChallengeIcon name="arrow"/></button>}>
        {(canContinueTest||canRequestReview)&&<button className="ui-secondary" onClick={exit}>返回上一页</button>}
        {canContinueTest&&canRequestReview&&<button className="ui-secondary" disabled={busy} onClick={onParentReview}>请家长核验</button>}
      </ActionBar></section>}
    </div>
    <dialog ref={pauseDialog} className="quest-pause-modal quest-native-pause" aria-labelledby="quest-pause-title" onCancel={event=>{event.preventDefault();setPaused(false);}}><span className="quest-pause-symbol"><ChallengeIcon name="pause" /></span><h2 id="quest-pause-title">歇一会儿，再出发</h2><p>{take?'刚录好的声音还在，接着玩就能继续保存。':'已保存的回答都还在，下次接着挑战。'}</p><button className="quest-button quest-primary" onClick={() => setPaused(false)}><ChallengeIcon name="play" />继续挑战</button><button className="quest-skip" onClick={exit}>{take?'先返回，这段录音暂不保存':'先返回'}</button></dialog>
  </main>;
}
