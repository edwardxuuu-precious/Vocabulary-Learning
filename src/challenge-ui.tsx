import type { AssessmentDimension, AssessmentSession } from '../shared/contracts';
import { assessmentDimensions } from '../shared/assessment';

export type ChallengeIconName = 'flag' | 'mic' | 'stop' | 'arrow' | 'back' | 'pause' | 'refresh' | 'check' | 'book' | 'picture' | 'translate' | 'star' | 'play' | 'down';
export function ChallengeIcon({ name }: { name: ChallengeIconName }) {
  const shapes = {
    flag: <><path d="M5 21V3m0 1c4-4 10 4 14 0v10c-4 4-10-4-14 0" /></>,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8" /></>,
    stop: <rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" stroke="none" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    pause: <path d="M8 5v14m8-14v14" strokeWidth="3.5" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 8a7 7 0 0 1 12-3L20 8M4 16l2.5 3a7 7 0 0 0 12-3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    book: <><path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z" /><path d="M6 9h3m-3 4h3m6-4h3m-3 4h3" /></>,
    picture: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8" r="1.5" /><path d="m3 17 5-5 5 5 4-4 4 4" /></>,
    translate: <><path d="M3 5h11M8 3v2m-4 4 7 7M12 5c0 6-4 9-9 11m11 4 4-11 4 11m-6-4h4" /></>,
    star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" />,
    play: <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
    down: <path d="m6 9 6 6 6-6" />,
  };
  return <svg className="quest-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}
export const challengeStages: Record<AssessmentDimension, { name: string; title: string; instruction: string; icon: ChallengeIconName; color: string }> = {
  'zh-en': { name: '中文 → 英文', title: '看中文，说英文', instruction: '这个意思，用英语怎么说？', icon: 'translate', color: 'amber' },
  read: { name: '独立朗读', title: '试着自己读出来', instruction: '看一看这个词，再用声音回答。', icon: 'book', color: 'blue' },
  'en-zh': { name: '英文 → 中文', title: '用中文说说它的意思', instruction: '这个英文词，是什么意思呢？', icon: 'translate', color: 'purple' },
  look: { name: '看词选图', title: '找到它的图片', instruction: '看清英文，选出对应的图片。', icon: 'picture', color: 'green' },
};
export function ChallengeRoute({ session, dimensions: planned }: { session?: AssessmentSession; dimensions?: AssessmentDimension[] }) {
  const dimensions = assessmentDimensions.filter(dimension => session ? session.items.some(item => item.dimension === dimension) : !planned || planned.includes(dimension));
  const active = session?.items.find(item => !item.response)?.dimension;
  return <ol className="quest-route" aria-label="挑战关卡">{dimensions.map((dimension, index) => {
    const stage = challengeStages[dimension], complete = Boolean(session && session.items.filter(item => item.dimension === dimension).every(item => item.response));
    return <li key={dimension} className={`quest-stage quest-${stage.color} ${complete ? 'is-done' : active === dimension ? 'is-current' : ''}`} aria-current={active === dimension ? 'step' : undefined}>
      <span className="quest-stage-icon"><ChallengeIcon name={complete ? 'check' : stage.icon} /></span><span><small>{complete ? '已作答' : `第 ${index + 1} 关`}</small><strong>{stage.name}</strong></span>
    </li>;
  })}</ol>;
}
