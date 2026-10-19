import { learningSegmentProgress } from '../shared/learning-policy';
import type { LearningSession } from '../shared/contracts';
import { useEffect, useRef } from 'react';
import { sessionTaskProgress } from './learning-session';

export function LearningSymbol({ kind }: { kind: 'home' | 'pause' | 'arrow' | 'play' | 'check' | 'down' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'home' ? <path d="m3 10 9-7 9 7v10H3Zm6 10v-7h6v7" /> : kind === 'pause' ? <path d="M8 5v14M16 5v14" /> : kind === 'arrow' ? <path d="M5 12h14m-6-6 6 6-6 6" /> : kind === 'play' ? <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" /> : kind === 'check' ? <path d="m5 12 4 4L19 6" /> : <path d="m6 9 6 6 6-6" />}</svg>;
}

export function LearningTopbar({ session, onHome, onPause }: { session: LearningSession; onHome: () => void; onPause: () => void }) {
  const segment = learningSegmentProgress(session);
  const tasks = segment ?? sessionTaskProgress(session);
  const total = tasks?.total ?? session.wordIds.length;
  const completed = Math.min(total, tasks?.completed ?? session.completedWordIds.length);
  const label = segment ? '本小段' : tasks ? '小任务' : '单词';
  return <nav className="lesson-nav flow-nav" aria-label="学习导航">
    <button className="lesson-nav-button flow-back" onClick={onHome} aria-label={session.packGame?'回游戏选择，保留进度':'回学习大厅，保留进度'} title={session.packGame?'回游戏选择':'回学习大厅'}><LearningSymbol kind="home" /><span>{session.packGame?'选玩法':'回大厅'}</span></button>
    <div className="lesson-progress-wrap"><div className="lesson-progress" role="progressbar" aria-label={(segment ? '' : '本轮') + label + '进度'} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}><span style={{ width: 100 * completed / Math.max(1, total) + '%' }} /></div><span className="flow-progress-count" aria-label={segment ? '本小段已完成'+completed+'个小任务，共'+total+'个' : '已完成' + completed + '个' + label + '，共' + total + '个'}><strong>{completed}</strong><span> / {total}</span><small>{label}</small></span></div>
    <button className="lesson-nav-button flow-pause" onClick={onPause} aria-label="休息一下" title="休息一下"><LearningSymbol kind="pause" /><span>休息</span></button>
  </nav>;
}

export function LearningPause({ onContinue, onRest, restLabel='先休息，回大厅' }: { onContinue: () => void; onRest: () => void; restLabel?:string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="flow-pause-dialog" aria-labelledby="pause-title" onCancel={event => { event.preventDefault(); onContinue(); }}>
    <span className="flow-pause-mark"><LearningSymbol kind="pause" /></span>
    <h2 id="pause-title">休息一下</h2><p>进度存好啦，下次接着玩。</p>
    <button className="lesson-next" onClick={onContinue}><LearningSymbol kind="play" />接着玩</button>
    <button className="flow-rest" onClick={onRest}>{restLabel}<LearningSymbol kind="arrow" /></button>
  </dialog>;
}
