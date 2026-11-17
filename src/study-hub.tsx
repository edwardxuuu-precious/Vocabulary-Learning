import './study-hub.css';
import {useState} from 'react';
import type {AppState,LearningSession,Word} from '../shared/contracts';
import {currentActivity} from '../shared/game-plan';
import {learningSegmentProgress} from '../shared/learning-policy';
import {sessionTaskProgress} from './learning-session';
import {learningChoiceSummary} from '../shared/daily-learning-choice';
import {Mascot} from './mascot';
import type {StudyIntent} from './study-controller';

export function StudyHub({state,busy,entry='learn',onStudyStart,onHome,onSelect,onBooks,onGames,onSwitch,onChoose,onTest,onLessonSettings,onParentReview}:{state:AppState;busy:boolean;entry?:'learn'|'review';onStudyStart:(intent:StudyIntent)=>void;onHome:()=>void;onSelect:()=>void;onBooks?:()=>void;onGames?:()=>void;onSwitch?:()=>void;onChoose?:(mode:'goal'|'words')=>void;onTest:()=>void;onLessonSettings?:()=>void;onParentReview?:()=>void}){
  const [fresh,setFresh]=useState(false),view=state.study!,review=entry==='review',agenda=view.plans[entry].agenda;
  const resume=state.activeSession&&!state.activeSession.completedAt&&!state.activeSession.suspendedAt?state.activeSession:undefined;
  const continuing=!!resume&&!fresh;
  const challenge=review&&!resume?[...(state.assessments??[])].reverse().find(test=>test.workflow==='recorded'&&!test.submittedAt):undefined;
  const goals=agenda.goals.filter(goal=>!fresh||goal.kind==='introduce'),first=goals[0];
  const mode=first?.kind==='check'?'check':first?.kind==='teach-usage'?'usage':review?'review':'learn';
  const ids=continuing?resume.wordIds:[...new Set(goals.filter(goal=>goal.kind===first?.kind).map(goal=>goal.wordId))];
  const words=ids.slice(0,5).flatMap(id=>{const word=state.words.find(word=>word.id===id);return word?[word]:[];});
  const blocked=continuing&&view.continuity.find(row=>row.sessionId===resume.id)?.action==='prepare-content';
  const progress=continuing?(learningSegmentProgress(resume)??sessionTaskProgress(resume)):null;
  const title=continuing?(resume.entrySource?.entry==='review'?'继续上次复习':'继续上次学习'):mode==='usage'?'学会怎么用':mode==='check'?'看看还记得吗':review?'练一练，再记牢':`认识 ${ids.length} 个新词`;
  const choice=learningChoiceSummary(state,new Date(state.learningNow??Date.now()));
  const scopeChanged=agenda.deferred.some(row=>row.reason==='scope-changed'),quotaDone=agenda.deferred.some(row=>row.reason==='new-limit');
  const scope=state.learningTaskPolicy===1?undefined:state.dailyLearningChoice?.wordIds??state.lessonPlan?.focusWordIds;
  const scopeProfiles=view.profiles.filter(profile=>(!scope||scope.includes(profile.wordId))&&state.packs.some(pack=>pack.id===profile.packId&&!pack.isSample&&!pack.deletedAt));
  const needsPreparation=!review&&scopeProfiles.some(profile=>!profile.encountered&&!profile.available);
  const waiting=review&&agenda.waitingReviewWordIds.length>0;
  const emptyTitle=waiting?'回答待家长核验':scopeChanged?'学习词语已更新':!review&&quotaDone?'今日新词目标已完成':needsPreparation?'新词素材待准备':review?'今天没有待办复习':scopeProfiles.length&&scopeProfiles.every(profile=>profile.encountered)?'所选新词已经认识':'暂无可学习的新词';
  const emptyAction=waiting&&onParentReview?onParentReview:scopeChanged&&onChoose?()=>onChoose('words'):!review&&quotaDone&&onChoose?()=>onChoose('goal'):needsPreparation?onHome:!review&&onSwitch?onSwitch:onHome;
  const emptyActionLabel=waiting&&onParentReview?'请家长核验':scopeChanged&&onChoose?'重新选择词语':!review&&quotaDone&&onChoose?'调整今日词量':needsPreparation?'回首页找家长':!review&&onSwitch?'去复习':'回首页';

  const startResume=(session:LearningSession)=>onStudyStart({purpose:session.entrySource?.entry??entry,action:'resume',sessionId:session.id,activityId:currentActivity(session)?.id});
  const start=()=>continuing?startResume(resume):onStudyStart({purpose:entry,action:!review&&fresh?'new':'recommended'});
  const familiar=(word:Word)=>view.profiles.find(profile=>profile.wordId===word.id)?.encountered;
  return <main className={`learning-hub hub-home hub-single-task page-enter${review?'':' hub-new-learning'}`}>
    <nav className="hub-nav"><button onClick={onHome}>← 回首页</button></nav>
    <header className="hub-heading"><div><h1>{review?'复习老朋友':'学习新词'}</h1>{review?<p className="hub-day-summary">只练今天需要再遇见的内容</p>:<div className="hub-goal-controls"><span>今日新词 <strong>{choice.goal}</strong> 个{choice.choice&&<small>仅今天</small>}</span>{onChoose&&<button disabled={busy} onClick={()=>onChoose('goal')}>调整词量</button>}</div>}</div><Mascot small/></header>
    <section className="hub-current" aria-label={continuing?'继续上次':'今天的学习安排'} data-session-id={continuing?resume.id:undefined}>
      <div className="hub-current-top"><span className={`hub-status ${continuing?'is-saved':''}`}>{continuing?'✓ 进度已保存':goals.length?(review?'本次安排':'新学习'):'当前状态'}</span>{agenda.waitingReviewWordIds.length>0&&<span className="hub-review-state">待核验 {agenda.waitingReviewWordIds.length} 词</span>}</div>
      <div className="hub-current-main"><div className="hub-current-copy"><h2>{goals.length||continuing?title:emptyTitle}</h2>
        {blocked&&<><p role="status">词义或素材已更新。</p><button className="hub-text-button" onClick={onHome}>回首页找家长</button></>}
        {progress&&<div className="hub-current-progress"><div className="hub-progress-label"><span>这小段的进度</span><strong>{progress.completed}<span> / {progress.total} 项</span></strong></div><div className="hub-progress-track" role="progressbar" aria-label="任务进度" aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.total}><span style={{width:`${progress.total?progress.completed/progress.total*100:0}%`}}/></div></div>}
        {continuing||goals.length?<button className="hub-start" disabled={busy||!!blocked} onClick={start}>▶ {busy?'准备中…':continuing?'继续学习':mode==='usage'?'学会怎么用':mode==='check'?'自己试一试':review?'开始复习':'开始学习'}<span>→</span></button>:<button className="hub-start" disabled={busy} onClick={emptyAction}>{emptyActionLabel}<span>→</span></button>}
      </div><div className="hub-word-preview" aria-label="这次学习的词图">{words.map(word=><span key={word.id}><img src={word.imageUrl} alt={word.meaning}/><small className={familiar(word)?'is-familiar':'is-new'}>{familiar(word)?'已学过':'未学习'}</small></span>)}</div></div>
    </section>
    {!review&&resume&&<section className="hub-new-choice"><div><h3>{fresh?'当前任务':'开始新的学习'}</h3></div><button disabled={busy} onClick={()=>setFresh(value=>!value)}>{fresh?'回到当前任务':'查看新词'} →</button></section>}
    {challenge&&<section className="hub-new-choice"><div><h3>未完成的检查</h3><p>已回答 {challenge.items.filter(item=>item.response).length} / {challenge.items.length} 项</p></div><button disabled={busy} onClick={()=>onStudyStart({purpose:'review',action:'resume-assessment',assessmentId:challenge.id})}>继续检查 →</button></section>}

    <section className="hub-options"><h2>也可以自己选择</h2><div className="hub-option-grid"><button className="hub-option" disabled={busy} onClick={onSelect}>自己选词 →</button>{onBooks&&<button className="hub-option" disabled={busy} onClick={onBooks}>按书复习 →</button>}{onGames&&<button className="hub-option" disabled={busy} onClick={onGames}>玩游戏 →</button>}<button className="hub-option" disabled={busy} onClick={onTest}>自己检查一下 →</button>{onSwitch&&<button className="hub-option" disabled={busy} onClick={onSwitch}>{review?'去学习新词':'去复习老朋友'} →</button>}</div></section>
    {!review&&onLessonSettings&&<div className="hub-adjustment-actions"><button disabled={busy} onClick={onLessonSettings}>家长课堂安排</button></div>}
  </main>;
}
