import { BackButton, PageHeading } from './ui-layout';
import './study-hub.css';
import {useState} from 'react';
import type {AppState,LearningSession,Word} from '../shared/contracts';
import {currentActivity} from '../shared/game-plan';
import {sessionTaskProgress} from './learning-session';
import {learningChoiceSummary} from '../shared/daily-learning-choice';
import {completedTestWordIds,learningVerification} from '../shared/learning-verification';
import {learningJourney} from '../shared/learning-journey';
import type {StudyIntent} from './study-controller';

export function StudyHub({state,busy,entry='learn',onStudyStart,onHome,onSelect,onBooks,onGames,onSwitch,onChoose,onTest,onLessonSettings,onParentReview,onCompleted}:{state:AppState;busy:boolean;entry?:'learn'|'review';onStudyStart:(intent:StudyIntent)=>void;onHome:()=>void;onSelect:()=>void;onBooks?:()=>void;onGames?:()=>void;onSwitch?:()=>void;onChoose?:(mode:'goal'|'words')=>void;onTest:()=>void;onLessonSettings?:()=>void;onParentReview?:()=>void;onCompleted?:()=>void}){
  const [fresh,setFresh]=useState(false),view=state.study!,review=entry==='review',agenda=view.plans[entry].agenda;
  const group=!review&&agenda.learningGroup&&agenda.learningGroup.mastered<agenda.learningGroup.wordIds.length?agenda.learningGroup:undefined;
  const resume=state.activeSession&&!state.activeSession.completedAt&&!state.activeSession.suspendedAt?state.activeSession:undefined;
  const continuing=!!resume&&(!fresh||!!group);
  const challenge=review&&!resume?[...(state.assessments??[])].reverse().find(test=>test.workflow==='recorded'&&!test.submittedAt):undefined;
  const goals=agenda.goals.filter(goal=>!fresh||!!group||goal.kind==='introduce'),first=goals[0];
  const mode=first?.kind==='check'?'check':first?.kind==='teach-usage'?'usage':review?'review':'learn';
  const ids=continuing?resume.wordIds:[...new Set(goals.filter(goal=>goal.kind===first?.kind).map(goal=>goal.wordId))];
  const words=ids.slice(0,5).flatMap(id=>{const word=state.words.find(word=>word.id===id);return word?[word]:[];});
  const blocked=continuing&&view.continuity.find(row=>row.sessionId===resume.id)?.action==='prepare-content';
  const progress=continuing?sessionTaskProgress(resume):null;
  const title=continuing?(resume.entrySource?.entry==='review'?'继续上次复习':'继续上次学习'):mode==='usage'?'学会怎么用':mode==='check'?'看看还记得吗':review?'练一练，再记牢':`认识 ${ids.length} 个新词`;
  const choice=learningChoiceSummary(state,new Date(state.learningNow??Date.now()));
  const scopeChanged=agenda.deferred.some(row=>row.reason==='scope-changed'),quotaDone=agenda.deferred.some(row=>row.reason==='new-limit');
  const scope=state.learningTaskPolicy===1?undefined:state.dailyLearningChoice?.wordIds??state.lessonPlan?.focusWordIds;
  const scopeProfiles=view.profiles.filter(profile=>(!scope||scope.includes(profile.wordId))&&state.packs.some(pack=>pack.id===profile.packId&&!pack.isSample&&!pack.deletedAt));
  const needsPreparation=!review&&scopeProfiles.some(profile=>!profile.encountered&&!profile.available);
  const waiting=review&&agenda.waitingReviewWordIds.length>0;
  const canReview=!review&&!!onSwitch&&view.plans.review.agenda.goals.length>0;
  const emptyTitle=waiting?'回答待家长核验':scopeChanged?'学习词语已更新':!review&&quotaDone?'今日新词目标已完成':needsPreparation?'新词素材待准备':review?'今天没有待办复习':scopeProfiles.length&&scopeProfiles.every(profile=>profile.encountered)?'所选新词已经认识':'暂无可学习的新词';
  const emptyAction=waiting&&onParentReview?onParentReview:scopeChanged&&onChoose?()=>onChoose('words'):canReview?onSwitch:!review&&quotaDone&&onChoose?()=>onChoose('goal'):needsPreparation?onHome:!review&&onSwitch?onSwitch:onHome;
  const emptyActionLabel=waiting&&onParentReview?'请家长核验':scopeChanged&&onChoose?'重新选择词语':canReview?'去复习':!review&&quotaDone&&onChoose?'调整今日词量':needsPreparation?'回首页找家长':!review&&onSwitch?'去复习':'回首页';
  const lastCompleted=state.lastCompletedSession;
  const completed=!review&&lastCompleted?.entrySource?.entry==='learn'&&!lastCompleted.packGame&&agenda.learningGroup?.sessionId!==lastCompleted.id?lastCompleted:undefined;
  const testIds=completedTestWordIds(state,completed),verification=learningVerification(state,testIds);
  const journey=learningJourney(state,completed),needsUsage=journey.stage==='usage';
  const showingCompletedUsage=needsUsage&&!!onCompleted&&!continuing;
  const canTest=!!verification.resume||verification.nextWordIds.length>0;
  const hasRoundAction=!!completed&&testIds.length>0&&!!onCompleted&&(needsUsage||canTest||!!verification.pending&&!!onParentReview);
  const groupButton=hasRoundAction?'hub-outline-button':'hub-start';

  const startResume=(session:LearningSession)=>onStudyStart({purpose:session.studyPlan?.purpose??session.entrySource?.entry??entry,action:'resume',sessionId:session.id,activityId:currentActivity(session)?.id});
  const start=()=>continuing?startResume(resume):onStudyStart({purpose:entry,action:!review&&fresh?'new':'recommended'});
  const familiar=(word:Word)=>view.profiles.find(profile=>profile.wordId===word.id)?.encountered;
  const showGroup=!!group&&(!continuing||!!blocked);
  const groupAction=first?.kind==='teach-usage'?'继续学短句':group?.resumeAssessmentId?'继续测试':first?.kind==='consolidate'?'练一练薄弱词':first?.kind==='check'?'开始测试':undefined;
  const groupHelp=group?.blockedReason==='materials'?'请家长检查这组词的图片和发音。':group?.blockedReason==='pictures'?'选图测试需要另一张不同的词图，请家长准备。':group?.blockedReason==='context'?'有一道题需要更明确的语境，请家长现场核验。':undefined;
  const groupStart=()=>onStudyStart(group?.resumeAssessmentId&&first?.kind!=='teach-usage'
    ?{purpose:'learn',action:'resume-assessment',assessmentId:group.resumeAssessmentId}
    :{purpose:'learn',action:'recommended'});
  const roundCard=completed&&testIds.length>0&&onCompleted&&<section className={`hub-round-test ${hasRoundAction?'hub-feature':'hub-quiet-row'}`} aria-label={needsUsage?'继续本轮学习':'本轮测试'} data-completed-session-id={completed.id}>
    <div><span className="hub-round-test-label">{needsUsage?'本轮短句':'本轮测试'}</span><h2>{needsUsage?'接着学短句':verification.resume?'继续本轮测试':`本轮 ${testIds.length} 个词已学完`}</h2>
      {needsUsage?<p>还有 {journey.pendingSentenceWordIds.length} 句待学</p>:verification.resume?<p>已答 {verification.resume.items.filter(item=>item.response).length} / {verification.resume.items.length} 项</p>:verification.pending?<p>待家长核验 {verification.pending} 个词</p>:verification.passed===verification.total?<p>测试已通过</p>:null}
    </div>
    {needsUsage||canTest?<button className="hub-start" disabled={busy} onClick={onCompleted}>{needsUsage?'继续学短句':verification.resume?'继续测试':'开始测试'}<span aria-hidden="true">→</span></button>:verification.pending&&onParentReview?<button className="hub-start" disabled={busy} onClick={onParentReview}>请家长核验<span aria-hidden="true">→</span></button>:null}
  </section>;
  const options=[
    !group&&{label:'自己选词',action:onSelect},
    onBooks&&{label:'按词书复习',action:onBooks},
    onGames&&{label:'玩单词游戏',action:onGames},
    !group&&{label:hasRoundAction?'测试其他词':'独立测试',action:onTest},
    onSwitch&&{label:review?'去学习新词':'去复习老朋友',action:onSwitch}
  ];
  return <main className={`learning-hub hub-home hub-single-task page-enter${review?'':' hub-new-learning'}`}>
    <nav className="hub-nav" aria-label="页面导航"><BackButton onClick={onHome}>回首页</BackButton></nav>
    <PageHeading title={review?'复习老朋友':'学习新词'} description={!review&&<>今日新词目标 <strong>{choice.goal} 个</strong>{choice.choice?' · 仅今天':''}</>} actions={!review&&onChoose&&<button className="ui-secondary" disabled={busy} onClick={()=>onChoose('goal')}>调整词量</button>}/>
    {hasRoundAction&&roundCard}
    {showGroup&&group&&<section className={`hub-round-test ${hasRoundAction?'hub-quiet-row':'hub-feature'}`} aria-label="本组学习进度" data-completed-session-id={group.sessionId}>
      <div><span className="hub-round-test-label">本组学习</span><h2>已学会 {group.mastered} / {group.wordIds.length} 词</h2>
        {group.pending>0&&<p>待家长核验 {group.pending} 词</p>}
        {!groupAction&&groupHelp&&<p>{groupHelp}</p>}
      </div>
      {groupAction?<button className={groupButton} disabled={busy} onClick={groupStart}>{groupAction}<span aria-hidden="true">→</span></button>
        :(group.pending>0||group.blockedReason==='context')&&onParentReview?<button className={groupButton} disabled={busy} onClick={onParentReview}>请家长核验<span aria-hidden="true">→</span></button>
        :<button className="hub-outline-button" disabled={busy} onClick={onHome}>回首页<span aria-hidden="true">→</span></button>}
    </section>}
    {!showGroup&&!showingCompletedUsage&&<section className={`hub-current ${hasRoundAction?'hub-quiet-row':'hub-feature'}`} aria-label={continuing?'继续上次':'今天的学习安排'} data-session-id={continuing?resume.id:undefined}>
      <div className="hub-current-top">{continuing&&<span className="hub-status is-saved">✓ 进度已保存</span>}{agenda.waitingReviewWordIds.length>0&&<span className="hub-review-state">待核验 {agenda.waitingReviewWordIds.length} 词</span>}</div>
      <div className="hub-current-main"><div className="hub-current-copy"><h2>{goals.length||continuing?title:emptyTitle}</h2>
        {blocked&&<><p role="status">词义或素材已更新。</p><button className="hub-text-button" onClick={onHome}>回首页找家长</button></>}
        {!review&&!continuing&&first?.kind==='introduce'&&agenda.reviewWordCount>0&&<p>一起复习 {agenda.reviewWordCount} 个旧词</p>}
        {progress&&<div className="hub-current-progress"><div className="hub-progress-label"><span>本次 {new Set(resume!.wordIds).size} 词 · 总进度</span><strong>{progress.completed}<span> / {progress.total} 步</span></strong></div><div className="hub-progress-track" role="progressbar" aria-label="整份任务进度" aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.total}><span style={{width:`${progress.total?progress.completed/progress.total*100:0}%`}}/></div></div>}
      </div>{!hasRoundAction&&words.length>0&&<div className="hub-word-preview" aria-label="这次学习的词图">{words.map(word=><span key={word.id}><img src={word.imageUrl} alt={word.meaning}/><small className={familiar(word)?'is-familiar':'is-new'}>{familiar(word)?'已学过':'未学习'}</small></span>)}</div>}</div>
      {!blocked&&<div className="hub-current-action">{continuing||goals.length?<button className={groupButton} disabled={busy} onClick={start}>{busy?'准备中…':continuing?(resume.entrySource?.entry==='review'?'继续复习':'继续学习'):mode==='usage'?'学短句':mode==='check'?'开始测试':review?'开始复习':'开始学习'}<span aria-hidden="true">→</span></button>:<button className={groupButton} disabled={busy} onClick={emptyAction}>{emptyActionLabel}<span aria-hidden="true">→</span></button>}</div>}
    </section>}
    {!hasRoundAction&&roundCard}
    {!review&&!group&&resume&&<section className="hub-new-choice"><div><h3>{fresh?'当前任务':'开始新的学习'}</h3></div><button disabled={busy} onClick={()=>setFresh(value=>!value)}>{fresh?'回到当前任务':'查看新词'} →</button></section>}
    {challenge&&<section className="hub-new-choice"><div><h3>未完成的检查</h3><p>已回答 {challenge.items.filter(item=>item.response).length} / {challenge.items.length} 项</p></div><button disabled={busy} onClick={()=>onStudyStart({purpose:'review',action:'resume-assessment',assessmentId:challenge.id})}>继续检查 →</button></section>}

    <section className="hub-options" aria-label="其他入口"><h2>其他方式</h2><div className="hub-option-grid">{options.map(option=>option&&<button key={option.label} className="hub-option" disabled={busy} onClick={option.action}>{option.label}<span aria-hidden="true">→</span></button>)}</div></section>
    {!review&&onLessonSettings&&<div className="hub-adjustment-actions"><button disabled={busy} onClick={onLessonSettings}>家长课堂安排</button></div>}
  </main>;
}
