import {StudyHub} from './study-hub';
import type {StudyIntent} from './study-controller';
import {learningChoiceSummary} from '../shared/daily-learning-choice';
import {currentReviewRetry} from '../shared/review-support';
import { sessionTaskProgress } from './learning-session';
import { useEffect, useRef, useState } from 'react';
import {learningEntryLabel,learnedReviewWords} from '../shared/learning-entry';
import type { AppState, LearningSession, LearningStartRequest, Word } from '../shared/contracts';
import { dailyLearningPlan } from '../shared/learning';
import { entryRecommendation } from '../shared/entry-recommendation';
import { recommendedAssessmentItems } from '../shared/assessment';
import { Mascot } from './mascot';
import './learning-hub.css';
import { lessonSegment } from '../shared/lesson-plan';
import { gameDefinition } from '../shared/game-registry';
import { learningSegmentProgress } from '../shared/learning-policy';

const hubProgress = (session:LearningSession) => learningSegmentProgress(session) ?? sessionTaskProgress(session);

function resumeDetail(session:import('../shared/contracts').LearningSession) {const p=hubProgress(session);return session.learningPolicy&&p?`本轮 ${session.wordIds.length} 词 · ${session.learningPolicy?'本小段':'小任务'} ${p.completed}/${p.total} · 进度已保存`:`本轮 ${session.wordIds.length} 词 · 已完成 ${session.completedWordIds.length}/${session.wordIds.length} 词`;}
function resumePercent(session:import('../shared/contracts').LearningSession) {const p=hubProgress(session);return session.learningPolicy&&p?p.completed/Math.max(1,p.total):session.completedWordIds.length/Math.max(1,session.wordIds.length);}

function HubSymbol({ kind }: {kind: 'play' | 'cards' | 'flag' | 'back' | 'check' | 'sound' | 'down' | 'more' | 'refresh' | 'close'}) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'more' ? <><circle cx="7" cy="16" r="1.7" fill="currentColor"/><circle cx="16" cy="16" r="1.7" fill="currentColor"/><circle cx="25" cy="16" r="1.7" fill="currentColor"/></> : kind === 'refresh' ? <><path d="M26 8v8h-8M6 24v-8h8"/><path d="M7 10a11 11 0 0 1 18-3l1 9M6 16l1 9a11 11 0 0 0 18-3"/></> : kind === 'close' ? <path d="m9 9 14 14M9 23 23 9"/> : kind === 'play' ? <path d="m12 7 14 9-14 9Z" fill="currentColor" stroke="none" /> : kind === 'cards' ? <><rect x="9" y="5" width="18" height="23" rx="4" /><path d="M5 24 3 8a4 4 0 0 1 4-4m8 10 3-4 4 4m-7 7h8" /></> : kind === 'flag' ? <><path d="M7 28V4m0 1c7-6 11 6 19 0v14c-8 6-12-6-19 0" /></> : kind === 'back' ? <path d="m14 7-9 9 9 9M5 16h23" /> : kind === 'sound' ? <><path d="M5 12h6l7-6v20l-7-6H5Z" /><path d="M23 11a8 8 0 0 1 0 10m4-14a14 14 0 0 1 0 18" /></> : kind === 'down' ? <path d="m8 12 8 8 8-8" /> : <path d="m7 17 6 6L26 9" />}
  </svg>;
}

interface Props { state: AppState; busy: boolean; onStart: (request: LearningStartRequest) => void; onHome: () => void; onTest: () => void; onSpeak: (word: Word) => void }

function LegacyLearningHub({ state, busy, onStart, onHome, onTest, onSelect, onManage, onLessonSettings, onBooks, onGames, entry='learn',onSwitch,onChoose,onCompleted }: Props & {entry?:'learn'|'review';onChoose?:(mode:'goal'|'words')=>void;onSwitch?:()=>void;onSelect: () => void; onBooks?:()=>void; onGames?:()=>void; onManage?: (id:string, action:'reselect'|'restart')=>void; onLessonSettings?:()=>void;onCompleted?:()=>void}) {
  const [managed,setManaged]=useState<string>(),[confirm,setConfirm]=useState<'reselect'|'restart'>(),[showAll,setShowAll]=useState(false),[showNew,setShowNew]=useState(false);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const allPending=state.resumableSessions??(state.activeSession?[state.activeSession]:[]);
  const review=entry==='review';
  const now=new Date(state.learningNow??Date.now()),planData={...state,settings:{...state.settings,learningStrategy:state.settings.learningStrategy??'memory-loop' as const}};
  const plan=entryRecommendation(planData,entry,now),resume=plan.resume;
  const learned=new Set(learnedReviewWords(state,now).map(word=>word.id));
  const managedSession=allPending.find(session=>session.id===managed);
  const otherPending=allPending.filter(session=>session.id!==resume?.id&&(session.entrySource?.entry===entry||!review&&!session.entrySource));
  const closeAdjustment=()=>{setManaged(undefined);setConfirm(undefined);};
  const adjust=(session:LearningSession)=>{setManaged(session.id);setConfirm(undefined);};
  useEffect(()=>{
    const dialog=dialogRef.current;
    if(!managedSession||!dialog)return;
    if(!dialog.open)dialog.showModal();
    return()=>{if(dialog.open)dialog.close();};
  },[managedSession?.id]);
  const lesson=state.lessonPlan,lessonPreview=lesson?lessonSegment(lesson,state):undefined;
  const canRecommend=!!plan.tasks.length;
  const continuing=!!resume&&(review||!showNew),choice=learningChoiceSummary(state,now);
  const previewIds=continuing?resume!.wordIds:plan.tasks.map(task=>task.wordId);
  const previewWords=previewIds.slice(0,3).map(id=>state.words.find(word=>word.id===id)).filter((word):word is Word=>!!word);
  const managedWords=managedSession?.wordIds.slice(0,3).map(id=>state.words.find(word=>word.id===id)).filter((word):word is Word=>!!word)??[];
  const adjustGoal=!review&&!continuing&&!canRecommend&&plan.reason==='daily-limit'&&!!onChoose;
  const switchEmpty=!continuing&&!canRecommend&&['no-new','scope-complete','no-due','reviewed-today','not-learned',...(review?['daily-limit']:[])].includes(plan.reason)&&!!onSwitch;
  const testCount=new Set(recommendedAssessmentItems(state,now).map(item=>item.wordId)).size;
  const progress=continuing&&resume&&hubProgress(resume);
  const title=continuing?currentReviewRetry(resume!)?'隔开后，再想一次':'继续上次':!review&&canRecommend?`认识 ${plan.fresh.length} 个新词`:plan.title;
  const start=()=>adjustGoal?onChoose?.('goal'):switchEmpty?onSwitch?.():onStart(continuing?{mode:'resume',sessionId:resume!.id,entry}:{mode:'recommended',entry,...(!review?{startNew:true as const}:{})});
  return <main className={`learning-hub hub-home page-enter${review?'':' hub-new-learning'}`}>
    <nav className="hub-nav" aria-label="页面导航"><button onClick={onHome}><HubSymbol kind="back"/>回首页</button></nav>
    <header className="hub-heading"><div><h1>{review?'复习老朋友':'学习新词'}</h1>{!review&&<p className="hub-day-summary">今天计划认识 {choice.goal} 个新词</p>}</div><Mascot small/></header>
    <section className="hub-current" data-session-id={continuing?resume!.id:undefined} aria-label={continuing?review?'继续未完成的复习':'继续未完成的学习':review?'推荐复习':'新学习预览'}>
      <div className="hub-current-top"><span className={`hub-status ${continuing?'is-saved':''}`}><HubSymbol kind={continuing?'check':'play'}/>{continuing?'进度已保存':showNew&&!review?'新学习预览':canRecommend?'为你准备好了':'今天的安排'}</span>
        {continuing&&onManage&&<button className="hub-context-button" aria-label="更多：调整本次学习" title="换词或从头再练" disabled={busy} onClick={()=>adjust(resume!)}><span>更多</span><HubSymbol kind="more"/></button>}
      </div>
      <div className="hub-current-main"><div className="hub-current-copy"><h2>{title}</h2><p>{continuing&&plan.stale?'本轮图片或词义、发音需要家长检查，进度仍保留。':continuing?`本轮 ${resume!.wordIds.length} 个词 · 从上次停下的位置继续`:!review&&canRecommend?'先看图、听发音，再接着练一小段。':plan.description}</p>
        {continuing&&<div className="hub-current-progress"><div className="hub-progress-label"><span>{progress?resume!.learningPolicy?'本小段进度':'小任务进度':'单词进度'}</span><strong>{progress?progress.completed:resume!.completedWordIds.length}<span> / {progress?progress.total:resume!.wordIds.length} {progress?'项':'词'}</span></strong></div><div className="hub-progress-track" role="progressbar" aria-label={resume!.learningPolicy?'本小段已完成进度':'本轮已完成进度'} aria-valuemin={0} aria-valuemax={progress?progress.total:resume!.wordIds.length} aria-valuenow={progress?progress.completed:resume!.completedWordIds.length}><span style={{width:`${resumePercent(resume!)*100}%`}}/></div></div>}
        <button className="hub-start" disabled={busy||(continuing&&plan.stale)||(!continuing&&!canRecommend&&!switchEmpty&&!adjustGoal)} onClick={start}><HubSymbol kind="play"/>{busy?'准备中…':continuing?review?'继续复习':'继续学习':adjustGoal?'调整今日词量':switchEmpty?review?'去学习新词':'去复习':canRecommend?review?'开始复习':'开始学习':'等准备好再来'}<span aria-hidden="true">→</span></button>
        {!review&&!continuing&&!canRecommend&&onChoose&&<div className="hub-empty-choices"><button className="hub-text-button" disabled={busy} onClick={()=>onChoose('words')}>选择学习词语</button><button className="hub-text-button" disabled={busy||!plan.available.length} onClick={onSelect}>自己选词</button></div>}
      </div><div className="hub-word-preview" aria-label={continuing?'这轮的单词':review?'这次复习的词':'准备学习的单词'}>{previewWords.map(word=><span key={word.id}><img src={word.imageUrl} alt={word.meaning}/><small className={learned.has(word.id)?'is-familiar':'is-new'}>{learned.has(word.id)?'已学过':'未学习'}</small></span>)}</div></div>
    </section>
    {!review&&onCompleted&&state.lastCompletedSession?.entrySource?.entry==='learn'&&<section className="hub-completed-followup" aria-label="上轮学习的后续安排"><div><h2>上轮 {state.lastCompletedSession.completedWordIds.length} 词学完了</h2><p>接着做本轮测试，核验后才计入动画；明天再来复习。</p></div><button className="hub-outline-button" disabled={busy} onClick={onCompleted}>查看测试与复习<HubSymbol kind="play"/></button></section>}
    {!review&&resume&&<section className="hub-new-start" aria-label={showNew?'保留的上次学习':'开始新的学习'}><div><h2>{showNew?'上次的学习还在':'想认识其他新词？'}</h2><p>{showNew?`原来的 ${resume.wordIds.length} 个词和进度继续保留。`:canRecommend?`下一组 ${plan.fresh.length} 个新词，开始前先看看。`:plan.reservedNew?'未学完的词已有安排，也可以调整词量或自己选词。':'先看看新的安排，原来的进度继续保留。'}</p></div><button className="hub-outline-button" disabled={busy} onClick={()=>setShowNew(!showNew)}>{showNew?'回到上次的学习':'开始新的学习'}<HubSymbol kind={showNew?'back':'play'}/></button></section>}
    {!review&&<div className="hub-entry-tools"><button className="hub-text-button" disabled={busy||!plan.available.length} onClick={onSelect}><HubSymbol kind="cards"/>自己选词</button>{onChoose&&<details className="hub-arrangement"><summary>调整安排<HubSymbol kind="down"/></summary><div className="hub-arrangement-body"><p>今日目标 {choice.goal} 词 · 已认识 {plan.usedNewToday} 词</p><p>未完成已安排 {plan.reservedNew} 词 · 可新安排 {plan.remainingNew} 词</p><div><button className="hub-outline-button" disabled={busy} onClick={()=>onChoose('goal')}>选择今日词量</button><button className="hub-outline-button" disabled={busy} onClick={()=>onChoose('words')}>选择学习词语</button></div>{state.dailyLearningChoice?.wordIds&&<p>已选范围 {state.dailyLearningChoice.wordIds.length} 词，保留原词图与顺序。</p>}</div></details>}</div>}
    {review&&!resume&&<details className="hub-recommendation-note"><summary>推荐量说明</summary><p>跨词书安排已经认识的到期目标，每轮最多 {state.settings.dailyReviewWords} 词；另有 {plan.deferredReviewCount} 个到期词留在后续推荐。另有 {plan.unreadyDueCount} 个到期词需家长准备。今天已结束的同一目标不重复推荐；主动加练和挑战分别选择，没有到期词时不自动加练。</p></details>}
    {otherPending.length>0&&<section className="hub-other-rounds" aria-label={review?'其他复习进度':'其他学习进度'}><button className="hub-other-toggle" aria-expanded={showAll} aria-controls="hub-other-sessions" onClick={()=>setShowAll(!showAll)}>{review?'其他复习进度':'其他进度（含以前的练习）'}<span>{otherPending.length}</span><HubSymbol kind="down"/></button>
      {showAll&&<div id="hub-other-sessions" className="hub-other-list">{otherPending.map((saved,index)=><div className="hub-other-row" key={saved.id}><button className="hub-other-resume" disabled={busy} onClick={()=>onStart({mode:'resume',sessionId:saved.id,...(saved.entrySource?{entry:saved.entrySource.entry}:{})})}><span className="hub-other-pictures">{saved.wordIds.slice(0,2).map(id=><img key={id} src={state.words.find(word=>word.id===id)?.imageUrl} alt=""/>)}</span><span><strong>{(saved.packGame?`${saved.practicePackTitle} · ${saved.packGame.selection==='random'?'随机游戏':gameDefinition(saved.packGame.selection)?.title}`:saved.practicePackTitle)??saved.lessonTitle??(saved.mode==='relearn'?'从头学':saved.practiceOnly?'一起练习':'推荐学习')}</strong><small>{learningEntryLabel(saved)} · {new Date(saved.startedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})} · {resumeDetail(saved)}</small></span><HubSymbol kind="play"/></button>{onManage&&<button className="hub-context-button" aria-label={`更多：调整第${index+2}轮学习`} disabled={busy} onClick={()=>adjust(saved)}><HubSymbol kind="more"/></button>}</div>)}</div>}
    </section>}
    {!review&&<details className="hub-more-activities"><summary>更多练习<HubSymbol kind="down"/></summary><div><button className="hub-text-button" disabled={busy} onClick={onSwitch}>去复习</button><button className="hub-text-button" disabled={busy} onClick={onTest}>挑战测试{testCount?` · ${testCount} 词`:''}</button></div></details>}
    {review&&<section className="hub-options" aria-labelledby="hub-options-title"><h2 id="hub-options-title">也可以主动加练</h2><div className="hub-options-grid">
      {review&&onBooks&&<button className="hub-option hub-option-books" disabled={busy||!state.packs.some(pack=>pack.enabled&&!pack.isSample&&!pack.deletedAt)} onClick={onBooks}><span className="hub-option-icon"><HubSymbol kind="cards"/></span><span><strong>按书加练</strong><small>只选已经认识的词</small></span><span className="hub-option-arrow" aria-hidden="true">→</span></button>}
      {review&&onGames&&<button className="hub-option hub-option-games" disabled={busy||!state.packs.some(pack=>pack.enabled&&!pack.isSample&&!pack.deletedAt)} onClick={onGames}><span className="hub-option-icon"><HubSymbol kind="play"/></span><span><strong>玩游戏</strong><small>用已经认识的词加练</small></span><span className="hub-option-arrow" aria-hidden="true">→</span></button>}
      <button className="hub-option hub-option-select" disabled={busy||!plan.available.length} onClick={onSelect}><span className="hub-option-icon"><HubSymbol kind="cards"/></span><span><strong>{review?'自选已学词':'自己选词'}</strong><small>{review?'挑几个老朋友再练练':'按词书挑选想学的词'}</small></span><span className="hub-option-arrow" aria-hidden="true">→</span></button>
      {onSwitch&&<button className="hub-option" disabled={busy} onClick={onSwitch}><span className="hub-option-icon"><HubSymbol kind="cards"/></span><span><strong>{review?'去学习新词':'去复习'}</strong><small>{review?'认识新的朋友':'把认识过的词再想一想'}</small></span><span className="hub-option-arrow" aria-hidden="true">→</span></button>}
      <button className="hub-option hub-option-test" disabled={busy} onClick={onTest}><span className="hub-option-icon"><HubSymbol kind="flag"/></span><span><strong>挑战测试</strong><small>{testCount?`${testCount} 个老朋友，等你来挑战`:'试试看，还记得吗？'}</small></span><span className="hub-option-arrow" aria-hidden="true">→</span></button>
    </div></section>}
    {!review&&lesson&&lessonPreview&&<section className="hub-classroom" aria-label="课堂练习"><div className="hub-classroom-heading"><span className="hub-option-icon"><HubSymbol kind="cards"/></span><div><small>课堂练习</small><h2>{lesson.title}</h2></div></div><p className="hub-classroom-counts">本课 {lesson.wordIds.length} 词<span>本次重点 {lesson.focusWordIds.length} 词</span><span>已练完 {lesson.focusWordIds.filter(id=>lesson.completedWordIds.includes(id)).length} 词</span></p><p>{lessonPreview.unavailable.length?'有词义或素材已变化，请家长检查课堂安排。':lessonPreview.words.length?`下一段 ${lessonPreview.words.length} 词，约 ${lessonPreview.minutes} 分钟`:'本次重点练完啦，可以安排下一组。'}</p><div className="hub-classroom-actions"><button className="hub-outline-button" disabled={busy||!lessonPreview.words.length||!!lessonPreview.unavailable.length} onClick={()=>onStart({mode:'lesson',lessonPlanId:lesson.id,lessonRevision:lesson.revision})}>课堂词练一小段<HubSymbol kind="play"/></button>{onLessonSettings&&<button className="hub-text-button" disabled={busy} onClick={onLessonSettings}>家长调整课堂安排</button>}</div></section>}
    {!review&&onLessonSettings&&!lesson&&<footer className="hub-parent-link"><button className="hub-text-button" disabled={busy} onClick={onLessonSettings}><HubSymbol kind="cards"/>{lesson?'家长调整课堂安排':'家长安排课堂'}</button></footer>}
    {onManage&&<dialog className="hub-adjust-dialog" ref={dialogRef} aria-labelledby="hub-adjust-title" onCancel={event=>{event.preventDefault();if(!busy)closeAdjustment();}} onClick={event=>{if(event.target===event.currentTarget&&!busy)closeAdjustment();}}>{managedSession&&<>
      <header className="hub-adjust-heading"><div><span>调整这次学习</span><h2 id="hub-adjust-title">{confirm==='reselect'?'换一组单词？':confirm==='restart'?'这些词再练一遍？':'这次想怎么调整？'}</h2></div><button className="hub-dialog-close" aria-label="关闭调整窗口" disabled={busy} onClick={closeAdjustment}><HubSymbol kind="close"/></button></header>
      <div className="hub-adjust-body"><div className="hub-adjust-preview"><div>{managedWords.map(word=><img key={word.id} src={word.imageUrl} alt={word.meaning}/>)}</div><span>这轮 {managedSession.wordIds.length} 个词</span></div>
        {confirm?<p className="hub-adjust-explanation">{confirm==='reselect'?'会结束这轮还没做完的任务，然后重新选词。已经练过的记录和录音都会保留。':review?'会为这些已学词新开一轮加练。以前的学习记录和录音都会保留。':'会从认识单词开始新一轮练习。以前的学习记录和录音都会保留。'}</p>:<div className="hub-adjust-choices"><button disabled={busy} onClick={()=>setConfirm('reselect')}><span className="hub-option-icon"><HubSymbol kind="cards"/></span><span><strong>换一组词</strong><small>结束这轮，再选想学的词</small></span><span aria-hidden="true">→</span></button><button disabled={busy} onClick={()=>setConfirm('restart')}><span className="hub-option-icon"><HubSymbol kind="refresh"/></span><span><strong>这些词再练一遍</strong><small>{review?'重新加练，保留原来的记录':'从认识开始，保留原来的记录'}</small></span><span aria-hidden="true">→</span></button></div>}
      </div><footer className="hub-adjust-footer">{confirm?<><button className="hub-outline-button" disabled={busy} onClick={()=>setConfirm(undefined)}>返回</button><button className="hub-start" disabled={busy} onClick={()=>{const action=confirm;closeAdjustment();onManage(managedSession.id,action);}}>{confirm==='reselect'?'结束这轮，去选词':'从头开始'}<span aria-hidden="true">→</span></button></>:<button className="hub-outline-button" disabled={busy} onClick={closeAdjustment}>先不调整</button>}</footer>
    </>}</dialog>}
  </main>;
}

export function WordPicker({ state, busy, onStart, onHome, onSpeak,entry='learn',initialPackId }: Props & {entry?:'learn'|'review';initialPackId?:string}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pack, setPack] = useState(initialPackId??'all'), [filter, setFilter] = useState<'all' | 'new' | 'learned'>(initialPackId?'new':'all'), [page, setPage] = useState(0);
  const now=new Date(state.learningNow??Date.now());
  const originalPlan = dailyLearningPlan({...state,settings:{...state.settings,learningStrategy:state.settings.learningStrategy??'memory-loop'}}, now);
  const knownWords=learnedReviewWords(state,now),plan=entry==='review'?{...originalPlan,available:knownWords.filter(word=>state.learningReadyWordIds===undefined||state.learningReadyWordIds.includes(word.id))}:originalPlan;
  const learned = new Set(knownWords.map(word => word.id));
  const visible = plan.available.filter(word => (pack === 'all' || word.packId === pack) && (filter === 'all' || learned.has(word.id) === (filter === 'learned')));
  const selectedIds = new Set(selected), allVisibleSelected = visible.every(word => selectedIds.has(word.id));
  const visibleIds = new Set(visible.map(word => word.id));
  const hiddenSelected = selected.filter(id => !visibleIds.has(id)).length;
  const packs = state.packs.filter(item => item.enabled && plan.available.some(word => word.packId === item.id));
  const pages = Math.max(1, Math.ceil(visible.length / 12)), currentPage = Math.min(page, pages - 1);
  const hasFamiliarSelection = selected.some(id => learned.has(id));
  const toggle = (word: Word) => {
    setSelected(current => current.includes(word.id) ? current.filter(id => id !== word.id) : [...current, word.id]);
  };
  const resetFilters = () => { setPack('all'); setFilter('all'); setPage(0); };
  return <main className="learning-hub word-picker page-enter">
    <nav className="hub-nav" aria-label="页面导航"><button onClick={onHome}><HubSymbol kind="back" />回大厅</button></nav>
    <header className="hub-heading"><h1>{entry==='review'?'这次想复习哪些？':'这次想学哪些？'}</h1><Mascot small /></header>
    <section className="picker-toolbar" aria-label="筛选和选择单词">
      <div className="picker-filter-row">
        <div className="picker-filters" role="group" aria-label="筛选学习状态">{([{id:'all', label:'全部'}, {id:'new', label:'未学习'}, {id:'learned', label:'已学过'}] as const).filter(item=>entry==='learn'||item.id!=='new').map(item => <button key={item.id} disabled={busy} aria-pressed={filter === item.id} onClick={() => {setFilter(item.id); setPage(0);}}>{item.label}</button>)}</div>
        {packs.length > 1 && <div className="picker-pack-select"><select aria-label="筛选词书" disabled={busy} value={pack} onChange={event => {setPack(event.target.value); setPage(0);}}><option value="all">所有词书</option>{packs.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><HubSymbol kind="down" /></div>}
      </div>
      <div className="picker-bulk-actions" role="group" aria-label="批量选择单词">
        <span>共 {visible.length} 个词</span>
        <button disabled={busy || !visible.length || allVisibleSelected} onClick={() => setSelected(current => [...new Set([...current, ...visible.map(word => word.id)])])}>全选</button>
        {selected.length > 0 && <button disabled={busy} onClick={() => setSelected([])}>清空已选</button>}
      </div>
      {hiddenSelected > 0 && <button className="picker-hidden-selection" disabled={busy} onClick={resetFilters}>另有 {hiddenSelected} 个已选词在其他筛选中 · 查看全部</button>}
    </section>
    <section className="picker-grid" aria-label="选择单词图片">{visible.slice(currentPage * 12, currentPage * 12 + 12).map(word => <article key={word.id} className={selected.includes(word.id) ? 'is-selected' : ''}>
      <button className="picker-card" aria-label={`选择${word.term}，${word.meaning}，${learned.has(word.id)?'已学过':'未学习'}`} aria-pressed={selected.includes(word.id)} disabled={busy} onClick={() => toggle(word)}><span className="picker-check">{selected.includes(word.id) ? <HubSymbol kind="check" /> : '+'}</span><span className="picker-picture"><img src={word.imageUrl} alt="" loading="lazy" decoding="async" /></span><strong>{word.term}</strong><span className="picker-meaning">{word.meaning}</span><small className={learned.has(word.id) ? 'is-familiar' : 'is-new'}>{learned.has(word.id) ? '已学过' : '未学习'}</small></button>
      <button className="picker-listen" aria-label={`听${word.term}的发音`} disabled={busy} onClick={() => onSpeak(word)}><HubSymbol kind="sound" /></button>
    </article>)}</section>
    {!visible.length && <div className="picker-empty"><HubSymbol kind="cards" /><strong>{plan.available.length ? '这里还没有这样的词' : '单词还在准备中'}</strong>{plan.available.length ? <button disabled={busy} onClick={resetFilters}>看看全部单词</button> : <p>请家长先准备好词书。</p>}</div>}
    {pages > 1 && <nav className="picker-pagination" aria-label="单词翻页"><button disabled={busy || !currentPage} onClick={() => setPage(currentPage - 1)}>← 上一页</button><span>{currentPage + 1} / {pages}</span><button disabled={busy || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页 →</button></nav>}
    <footer className={`picker-footer ${hasFamiliarSelection?'has-familiar':''}`}>
      <div className="picker-selection">
        <div className="picker-selection-heading"><strong>已选 {selected.length} 词</strong></div>
        <span className="picker-selection-status" role="status">{entry==='review' ? '只复习已经认识的词，选好就可以开始' : hasFamiliarSelection ? '没记牢？从头学一遍，也可以直接练习' : selected.length?'新单词先认识，再玩游戏':'点图片选词，选好了就出发'}</span>
      </div>
      {hasFamiliarSelection&&entry==='learn'?<div className="picker-learning-actions" role="group" aria-label="开始学习">
        <button className="picker-start" disabled={busy} onClick={()=>onStart({mode:'relearn',wordIds:selected})}><HubSymbol kind="cards"/>{busy?'准备中…':'从头学'}</button>
        <button className="picker-practice" disabled={busy} onClick={()=>onStart({mode:'practice',wordIds:selected})}><HubSymbol kind="play"/>直接练习</button>
      </div>:<button className="picker-start" disabled={busy || !selected.length} onClick={() => onStart({mode:'practice',entry, wordIds: selected})}><HubSymbol kind="play" />{busy ? '准备中…' : entry==='review'?'开始复习':'开始学'}</button>}
    </footer>
  </main>;
}

export function LearningHub(props:Parameters<typeof LegacyLearningHub>[0]&{onStudyStart?:(intent:StudyIntent)=>void;onParentReview?:()=>void}){return props.state.study&&props.onStudyStart?<StudyHub {...props} onStudyStart={props.onStudyStart}/>:<LegacyLearningHub {...props}/>;}
