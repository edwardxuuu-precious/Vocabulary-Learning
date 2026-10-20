import type { LearningActivity, Word } from './contracts.ts';
import { gameDefinition, seededRandom } from './game-registry.ts';

export const mainlineKinds = ['listen-first', 'treasure', 'gate', 'supply', 'flip', 'repair', 'switch', 'portal'] as const;

/** Change presentation, never atomic goals, IDs, order, or material provenance. */
export function mainlineActivities(activities: LearningActivity[], words: Word[], seed: string, startIndex = 0, checkpoints: string[] = []): LearningActivity[] {
  const random = seededRandom(seed + ':mainline-v2');
  const rows = structuredClone(activities), introduced = new Set(rows.filter(a => !rows.some(b => b.wordId === a.wordId && b.step === 'learn')).map(a => a.wordId));
  let segment = 0, stepGroup = 0, lastStep = '', position = 0, listenGroup = -1, soundGroup = -1, lastSoundGroup = -1;
  for (let index = 0; index < rows.length; index++) {
    const a = rows[index];
    if (index && checkpoints.includes(rows[index - 1].id)) segment++;
    if (lastStep !== a.step) { stepGroup++; position = 0; lastStep = a.step; if (a.step === 'listen') listenGroup++; }
    if (a.step === 'learn') introduced.add(a.wordId);
    const candidates = [a.word, ...rows.slice(Math.max(0, index - 8), index).map(item => item.word).reverse(), ...rows.map(item => item.word)].filter(w => introduced.has(w.id));
    const choices: LearningActivity['choices'] = [];
    for (const w of candidates) if (choices.length < 3 && w.imageUrl !== '/assets/placeholder.svg' && !choices.some(other => other.id === w.id || other.term.toLowerCase() === w.term.toLowerCase() || other.meaning.trim() === w.meaning.trim() || other.imageUrl === w.imageUrl)) choices.push(w);
    const noun = choices.every(w => words.find(word => word.id === w.id)?.partOfSpeech === 'noun');
    const ticket = Math.floor(random() * 10000);
    if (index < startIndex || ['learn', 'recall', 'spell'].includes(a.step) || a.step.startsWith('practice-')) { position++; continue; }
    // Review-only targets retain their learning goal even when there is no second clear image.
    const base: LearningActivity = { id: a.id, wordId: a.wordId, word: a.word, step: a.step, kind: 'standard', choices: [] };
    if (a.step === 'read') { base.kind = 'portal'; }
    else if (choices.length >= 2) {
      base.choices = ticket % 2 ? choices.slice().reverse() : choices;
      if (a.step === 'recognize') {
        base.kind = noun && segment % 2 ? 'supply' : rows.find(row => row.wordId === a.wordId && row.step === 'listen')?.kind === 'gate' ? 'repair' : 'gate';
        if (base.kind === 'repair') base.groupId = `meaning-repair-${segment}-${stepGroup}`;
        if (base.kind === 'gate') base.cueWord = choices[(position + segment) % 2 ? 1 : 0];
      } else if (a.step === 'listen') {
        const kinds = noun ? ['listen-first', 'gate', 'treasure', 'supply'] as const : ['listen-first', 'gate', 'treasure'] as const;
        base.kind = kinds[listenGroup % kinds.length];
        if (base.kind === 'gate') base.cueWord = choices[position % 2 ? 1 : 0];
      } else if (a.step === 'sound') {
        const listened = rows.find(row => row.wordId === a.wordId && row.step === 'listen');
        if (listened && gameDefinition(listened.kind)?.practiceOnly) base.kind = 'standard';
        else { if(lastSoundGroup!==stepGroup){lastSoundGroup=stepGroup;soundGroup++;}base.kind=(['flip', 'repair', 'switch'] as const)[soundGroup % 3]; }
        if (base.kind === 'flip' || base.kind === 'repair') base.groupId = `mainline-${segment}-${stepGroup}`;
        if (base.kind === 'switch') base.direction = position % 2 ? 'picture-hear' : 'hear-picture';
      }
    }
    rows[index] = base; position++;
  }
  return rows;
}
