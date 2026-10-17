import type { LearningSession } from '../shared/contracts';
import { sessionTaskProgress } from './learning-session';

export function LearningSymbol({ kind }: { kind: 'home' | 'pause' | 'arrow' | 'play' | 'check' | 'down' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'home' ? <path d="m3 10 9-7 9 7v10H3Zm6 10v-7h6v7" /> : kind === 'pause' ? <path d="M8 5v14M16 5v14" /> : kind === 'arrow' ? <path d="M5 12h14m-6-6 6 6-6 6" /> : kind === 'play' ? <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" /> : kind === 'check' ? <path d="m5 12 4 4L19 6" /> : <path d="m6 9 6 6 6-6" />}</svg>;
}

export function LearningTopbar({ session, onHome, onPause }: { session: LearningSession; onHome: () => void; onPause: () => void }) {
  const tasks = sessionTaskProgress(session);
  const total = tasks?.total ?? session.wordIds.length;
  const completed = Math.min(total, tasks?.completed ?? session.completedWordIds.length);
  const label = tasks ? '小任务' : '单词';
  return <nav className="lesson-nav flow-nav" aria-label="学习导航">
    <button className="lesson-nav-button" onClick={onHome} aria-label="回到单词游乐园首页" title="回首页"><LearningSymbol kind="home" /></button>
    <div className="lesson-progress-wrap"><div className="lesson-progress" role="progressbar" aria-label={'本轮' + label + '进度'} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}><span style={{ width: 100 * completed / Math.max(1, total) + '%' }} /></div><span className="flow-progress-count" aria-label={'已完成' + completed + '个' + label + '，共' + total + '个'}><strong>{completed}</strong><span> / {total}</span><small>{label}</small></span></div>
    <button className="lesson-nav-button" onClick={onPause} aria-label="休息一下" title="休息一下"><LearningSymbol kind="pause" /></button>
  </nav>;
}
