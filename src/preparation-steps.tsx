import type { PackAudioStatus, Word, WordPack } from '../shared/contracts';
import { isPreparedImage } from './pack-image-review';
import { packPreparation } from './pack-workflow';

export function PreparationSteps({ active, pack, words, audio }: { active: 1 | 2 | 3; pack?: WordPack; words: Word[]; audio?: PackAudioStatus }) {
  const members = words.filter(word => word.packId === pack?.id);
  const ready = pack ? packPreparation(pack, words, audio) : null;
  const done = [Boolean(pack), Boolean(ready?.total && ready.cached === ready.total && members.every(word => ['review', 'approved'].includes(word.assetStatus) && isPreparedImage(word.imageUrl))), Boolean(pack?.enabled)];
  return <ol className="preparation-steps" aria-label="备课流程">
    {['确认词义', '准备声音和图片', '审核并交给孩子'].map((label, index) => <li key={label} className={done[index] ? 'is-done' : active === index + 1 ? 'is-current' : ''} aria-current={active === index + 1 ? 'step' : undefined}><span aria-hidden="true">{done[index] ? '✓' : index + 1}</span><strong>{label}</strong></li>)}
  </ol>;
}
