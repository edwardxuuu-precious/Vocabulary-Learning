import type { PracticeRecordingTarget } from '../shared/contracts';
import { OralPractice } from './oral-practice';

export function RecallPractice({ target, demonstrate, stopAudio, active, completed, busy, onComplete, onBusy }: {
  target:PracticeRecordingTarget; demonstrate: () => Promise<boolean>; stopAudio: () => void; active: boolean; completed: boolean; busy: boolean;
  onComplete: (source: 'click' | 'speech') => void;onBusy?:(busy:boolean)=>void;
}) {
  return <OralPractice target={target} active={active} busy={busy} rounds={3} demonstrate={demonstrate} stopAudio={stopAudio} onBusy={onBusy} complete={completed?undefined:()=>onComplete('speech')} onSkip={completed?undefined:()=>onComplete('click')}/>;
}
