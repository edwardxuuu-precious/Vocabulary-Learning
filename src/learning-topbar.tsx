import type { LearningSession } from '../shared/contracts';
import { useEffect, useRef } from 'react';
import { sessionTaskProgress } from './learning-session';
import {learningReturn} from '../shared/learning-entry';
import { ActivityNavigation, BackButton } from './ui-layout';

const learningReturnLabels = {hub:'回学习',review:'回复习',books:'回词书','book-games':'回游戏目录'} as const;
export const learningBackLabel = (session?: LearningSession | null) => learningReturnLabels[learningReturn(session)];

export function LearningSymbol({ kind }: { kind: 'home' | 'pause' | 'arrow' | 'play' | 'check' | 'down' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'home' ? <path d="m3 10 9-7 9 7v10H3Zm6 10v-7h6v7" /> : kind === 'pause' ? <path d="M8 5v14M16 5v14" /> : kind === 'arrow' ? <path d="M5 12h14m-6-6 6 6-6 6" /> : kind === 'play' ? <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" /> : kind === 'check' ? <path d="m5 12 4 4L19 6" /> : <path d="m6 9 6 6 6-6" />}</svg>;
}

export function LearningTopbar({ session, onHome, onPause }: { session: LearningSession; onHome: () => void; onPause: () => void }) {
  const tasks = sessionTaskProgress(session);
  const total = tasks?.total ?? session.wordIds.length;
  const completed = Math.min(total, tasks?.completed ?? session.completedWordIds.length);
  const wordCount = new Set(session.wordIds).size;
  const label = tasks ? '步' : '词';
  const progressText = `本次${wordCount}个词，已完成${completed}${label}，共${total}${label}`;
  const backLabel=learningBackLabel(session);
  return <ActivityNavigation
    label="学习导航"
    back={<BackButton onClick={onHome} label={`${backLabel}，保留进度`}>{backLabel}</BackButton>}
    progress={{ label: `本次 ${wordCount} 词`, name: '整份任务进度', completed, total, unit: label, description: progressText }}
    actions={<>
      <div id="learning-help-slot" />
      <button className="ui-secondary" onClick={onPause} aria-label="保存休息"><LearningSymbol kind="pause" />休息</button>
    </>}
  />;
}

export function LearningPause({ onContinue, onRest, restLabel }: { onContinue: () => void; onRest: () => void; restLabel:string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="flow-pause-dialog" aria-labelledby="pause-title" onCancel={event => { event.preventDefault(); onContinue(); }}>
    <span className="flow-pause-mark"><LearningSymbol kind="pause" /></span>
    <h2 id="pause-title">休息一下</h2><p>进度存好啦，下次接着玩。</p>
    <button className="lesson-next" onClick={onContinue}><LearningSymbol kind="play" />接着玩</button>
    <button className="flow-rest" onClick={onRest}>{restLabel}<LearningSymbol kind="arrow" /></button>
  </dialog>;
}
