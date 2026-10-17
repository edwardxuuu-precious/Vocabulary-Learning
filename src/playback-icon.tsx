/** Shared play symbol for recording playback in child and parent views. */
export function PlaybackIcon({ size = 25 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style={{ verticalAlign: 'middle' }}><path d="m9 5 11 7-11 7Z" /></svg>;
}
