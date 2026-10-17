import { useState } from 'react';
import { visualTheme, type CompanionCharacter } from '../shared/visual-theme';
import { companionFor } from '../shared/companions';

export function Mascot({ small = false, character }: { small?: boolean; character?: CompanionCharacter }) {
  const [dailyCharacter] = useState(() => companionFor(`welcome:${new Date().toLocaleDateString('sv-SE')}`));
  const [failedSource, setFailedSource] = useState('');
  const source = visualTheme.characters[character ?? dailyCharacter].image;
  const className = small ? 'mascot small' : 'mascot';
  if (failedSource !== source) return <img className={className} src={source} alt="" aria-hidden="true" draggable={false} decoding="async" onError={() => setFailedSource(source)} />;
  // A local image failure keeps a simple mechanical silhouette, never an old animal avatar.
  return <svg className={className} viewBox="0 0 240 280" aria-hidden="true"><g stroke="#243c70" strokeWidth="5" strokeLinejoin="round"><path d="M65 168 49 221v35h48l14-65m18 0 14 65h48v-35l-16-53" fill="#355bd0" /><path d="M52 129h136l-13 66H67Z" fill="#e24b4f" /><path d="m57 132-28 3-8 54 27 9 22-52m111-14 28 3 8 54-27 9-22-52" fill="#e24b4f" /><path d="M64 27v-14h16v14m80 0V13h16v14M54 44l14-17h104l14 17v77l-29 19H83l-29-19Z" fill="#355bd0" /><path d="M72 62h96v32H72Z" fill="#173057" /><path d="m78 70 31 4v12H78Zm84 0-31 4v12h31Z" fill="#67ecff" stroke="none" /><path d="m82 96 38-7 38 7-7 31-31 10-31-10Z" fill="#d7e0ee" /><path d="M75 145h36v26H75Zm54 0h36v26h-36Z" fill="#8cd8f4" /></g></svg>;
}
