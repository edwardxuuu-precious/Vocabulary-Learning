export function GameSoundIcon() {
  return <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 7 7 12H3v8h4l7 5V7Z"/><path d="M20 11a8 8 0 0 1 0 10m5-15a15 15 0 0 1 0 20"/></svg>;
}

interface Props { busy: boolean; accepted: boolean; onSkip: () => void; primary?: { label: string; action: () => void } }
export function GameActionBar({busy,accepted,onSkip,primary}:Props) {
  return <footer className="game-action-bar" aria-label="本题操作"><div className="game-action-inner">
    {!accepted&&<button className="game-skip" disabled={busy} onClick={onSkip}>这次先跳过</button>}
    {primary&&<button className="lesson-next game-next" disabled={busy} onClick={primary.action}>{accepted ? '继续' : primary.label}<span aria-hidden="true">→</span></button>}
  </div></footer>;
}
