import { prepareExtendedActivity } from './game-extension-plan.ts';
import { extendedKinds } from './game-materials.ts';
import type { GameKind, GameWord, LearningActivity, LearningSession, LearningTask, Word } from './contracts.ts';
import { eligibleGames, gameDefinition, gameRegistry, type GamePlanOptions } from './game-registry.ts';
import { letterBoard, neighbours, pairedGame } from './game-boards.ts';

export const gameWord = (word: Word): GameWord => ({ id: word.id, term: word.term, meaning: word.meaning, imageUrl: word.imageUrl, learningVersion: word.learningVersion ?? 0 });
export const activityDone = (session: LearningSession, activity: LearningActivity) => session.completedSteps?.[activity.wordId]?.includes(activity.step) ?? false;
export const currentActivity = (session: LearningSession) => session.activities?.find(activity => !activityDone(session, activity));
export const activityTitles: Record<LearningActivity['kind'], string> = Object.fromEntries([['standard',''], ...gameRegistry.map(game => [game.kind, game.title])]) as Record<LearningActivity['kind'], string>;

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
/** Every game action replaces an existing atomic learning step; no hidden extra round is appended. */
export function buildActivities(tasks: LearningTask[], words: Word[], random = Math.random, options: GamePlanOptions = {}): LearningActivity[] {
  const byId = new Map(words.map(word => [word.id, word]));
  const result: LearningActivity[] = [];
  const recent = options.recentKinds ?? [], familiar = new Set(['flip','supply','portal', ...recent]);
  const availableMembers = tasks.map(task => byId.get(task.wordId)!).filter(Boolean).slice(0, 3);
  const newKinds = gameRegistry.filter(game => !familiar.has(game.kind) && tasks.some(task => task.steps.some(step => eligibleGames(step, availableMembers, options).some(candidate => candidate.kind === game.kind))));
  const novel = options.forcedKind ?? (options.randomize && newKinds.length ? newKinds[Math.floor(random() * newKinds.length)].kind : undefined);
  const pick = (step: LearningActivity['step'], members: Word[], fallback: LearningActivity['kind'], objective = false): LearningActivity['kind'] => {
    let pool = eligibleGames(step, members, options).filter(game => (!objective || !game.practiceOnly) && (familiar.has(game.kind) || game.kind === novel));
    if (options.forcedKind) {
      const forced = pool.find(game => game.kind === options.forcedKind);
      return forced?.kind ?? (pool.some(game => game.kind === fallback) ? fallback : 'standard');
    }
    if (!options.randomize) return fallback;
    if (pool.some(game => game.kind === novel)) return novel!;
    const weights = pool.map(game => 1 / (1 + recent.filter(kind => kind === game.kind).length));
    let ticket = random() * weights.reduce((sum, value) => sum + value, 0);
    for (const [index, game] of pool.entries()) { ticket -= weights[index]; if (ticket <= 0) return game.kind; }
    return 'standard';
  };
  const add = (task: LearningTask, step: LearningActivity['step'], kind: LearningActivity['kind'] = 'standard', choices: GameWord[] = [], groupId?: string) => {
    const word = byId.get(task.wordId)!;
    result.push({ id: `${task.wordId}:${step}`, wordId: word.id, step, kind, word: gameWord(word), choices, ...(groupId ? { groupId } : {}) });
  };
  // Preserve review-first scheduling and each word's due-skill order. Distractors are already learned reviews.
  const reviews = tasks.filter(task => task.mode === 'review');
  for (let start = 0; start < reviews.length; start += 3) {
    const batch = reviews.slice(start, start + 3), members = batch.map(task => byId.get(task.wordId)!);
    const gateMatches = shuffled(batch.map((_, index) => index % 2 === 0), random);
    const distinct = members.length >= 2 && new Set(members.map(word => word.term.toLowerCase())).size === members.length && new Set(members.map(word => word.meaning.trim())).size === members.length && new Set(members.map(word => word.imageUrl)).size === members.length && members.every(word => word.imageUrl !== '/assets/placeholder.svg');
    const choices = distinct ? shuffled(members.map(gameWord), random) : [];
    for (const task of batch) for (const step of task.steps) {
      // A due sound assessment must remain objective; flip participation cannot advance that schedule.
      const fallback = distinct && step === 'listen' && byId.get(task.wordId)!.partOfSpeech === 'noun' ? 'supply' : 'standard';
      const goal=step==='recognize'||step==='read';
      const kind = goal&&distinct ? pick(step,members,step==='read'?'portal':members.every(w=>w.partOfSpeech==='noun')?'supply':'gate') : distinct && options.randomize && ['listen','sound'].includes(step) ? pick(step, members, fallback, true) : fallback;
      add(task, step, kind, kind === 'standard'||kind==='portal' ? [] : choices);
      if (kind === 'gate') result.at(-1)!.cueWord = choices[(choices.findIndex(choice => choice.id === task.wordId) + (gateMatches[batch.indexOf(task)] ? 0 : 1)) % choices.length];
    }
  }
  const fresh = tasks.filter(task => task.mode === 'new');
  // Batch at most three words so the child never has to hold an entire large pack in working memory.
  for (let start = 0; start < fresh.length; start += 3) {
    const batch = fresh.slice(start, start + 3);
    // New assessment steps retain their original order until a matching game is registered.
    if (batch.some(task => task.steps.some(step => !['learn','recognize','listen','sound','read','recall','spell'].includes(step)))) {
      for (const task of batch) for (const step of task.steps) add(task, step);
      continue;
    }
    const unique: Word[] = [];
    for (const task of batch) {
      const word = byId.get(task.wordId)!;
      if (word.imageUrl === '/assets/placeholder.svg' || unique.some(other => other.term.toLowerCase() === word.term.toLowerCase() || other.meaning.trim() === word.meaning.trim() || other.imageUrl === word.imageUrl)) continue;
      unique.push(word);
    }
    // Single/ambiguous-word batches retain the proven basic flow rather than padding with examples.
    if (unique.length !== batch.length || batch.length < 2) { for (const task of batch) for (const step of task.steps) add(task, step); continue; }
    for (const task of batch) if (task.steps.includes('learn')) add(task, 'learn');
    const recognizeKind=pick('recognize',unique,unique.every(w=>w.partOfSpeech==='noun')?'supply':'gate');
    for(const [index,task] of batch.entries())if(task.steps.includes('recognize')){
      add(task,'recognize',recognizeKind,shuffled(unique.map(gameWord),random));
      if(recognizeKind==='gate')result.at(-1)!.cueWord=gameWord(unique[(index+(random()<.5?0:1))%unique.length]);
    }
    const listenKind = pick('listen', unique, unique.every(word => word.partOfSpeech === 'noun') ? 'supply' : 'standard');
    const soundKind = pick('sound', unique, 'flip', gameDefinition(listenKind)?.practiceOnly === true);
    let recallKind = soundKind === 'associate' ? 'associate' : pick('recall', unique, 'portal');
    let spellKind = batch.some(task => task.steps.includes('spell')) ? pick('spell', unique, 'standard') : 'standard';
    if (new Set([listenKind,soundKind,recallKind,spellKind].filter(kind => kind !== 'standard')).size > 3) {
      // Keep the selected novel mechanism; rotate which other skill uses the familiar basic screen.
      if(recallKind===novel||spellKind!==novel&&random()<.5)spellKind='standard';else recallKind='standard';
    }
    const gateMatches = shuffled(batch.map((_, index) => index % 2 === 0), random);
    const pairChoices = shuffled(unique.map(gameWord), random), routeVisited = [12];
    for (const [index, task] of batch.entries()) if (task.steps.includes('listen')) {
      const target = byId.get(task.wordId)!;
      let choices = pairedGame(listenKind) ? pairChoices : shuffled(unique.map(gameWord), random);
      let kind = options.randomize || options.forcedKind ? listenKind : target.partOfSpeech === 'noun' ? 'supply' : 'standard';
      if (pairedGame(kind) && index >= 2) kind = 'standard';
      const groupId = ['bingo','queue','collect','route','story','program','combine','quantity'].includes(kind) ? `${kind}-${start}` : undefined;
      if(kind === 'route') {
        const cells = shuffled(neighbours(routeVisited.at(-1)!).filter(cell=>!routeVisited.includes(cell)),random);
        choices = [gameWord(target), ...choices.filter(choice=>choice.id!==target.id)].slice(0,Math.min(choices.length,cells.length));
        if(choices.length < 2)kind = 'standard';
        else {
          choices = shuffled(choices,random);
          add(task,'listen',kind,choices,groupId);const item=result.at(-1)!;
          item.routeStart=routeVisited.at(-1);item.routeCells=cells.slice(0,choices.length);
          routeVisited.push(item.routeCells[choices.findIndex(choice=>choice.id===target.id)]);continue;
        }
      }
      add(task, 'listen', kind, choices, kind === 'standard' ? undefined : groupId);
      if (kind === 'gate') result.at(-1)!.cueWord = choices[(choices.findIndex(choice => choice.id === task.wordId) + (gateMatches[index] ? 0 : 1)) % choices.length];
      if (pairedGame(kind)) result.at(-1)!.targets = batch.slice(0,2).map(task=>gameWord(byId.get(task.wordId)!));
    }
    const groupId = `flip-${start}`;
    const choices = shuffled(unique.map(gameWord), random);
    const soundOrder=shuffled(batch, random);
    for (const [index,task] of soundOrder.entries()) if (task.steps.includes('sound')) {
      add(task, 'sound', soundKind, choices, ['flip','repair'].includes(soundKind) ? groupId : undefined);
      if(soundKind === 'switch')result.at(-1)!.direction = index % 2 ? 'picture-hear' : 'hear-picture';
    }
    const readKind=pick('read',unique,'portal');
    for(const task of batch)if(task.steps.includes('read'))add(task,'read',readKind,readKind==='portal'?[]:choices);
    for (const task of soundKind==='associate'?soundOrder:batch) if (task.steps.includes('recall')) add(task, 'recall', recallKind, (['missing','associate','quiz','mimic'].includes(recallKind)||extendedKinds.has(recallKind)) ? choices : []);
    for (const [index,task] of batch.entries()) if (task.steps.includes('spell')) {
      const kind=spellKind==='letter-sort'&&index>=2?'standard':spellKind;
      add(task,'spell',kind,kind==='standard'?[]:choices,kind==='letter-sort'?`letter-sort-${start}`:undefined);
      if(kind==='letter-path')result.at(-1)!.letterGrid=letterBoard(byId.get(task.wordId)!.term,random);
      if(kind==='letter-sort')result.at(-1)!.targets=batch.slice(0,2).map(task=>gameWord(byId.get(task.wordId)!));
    }
  }
  // Goal coverage is fixed. A familiar basic screen can replace excess skins, never a goal.
  const kinds=[...new Set(result.filter(a=>a.kind!=='standard').map(a=>a.kind))];
  const keep=new Set(kinds.sort((a,b)=>Number(b===novel)-Number(a===novel)).slice(0,3));
  for(const a of result)if(a.kind!=='standard'&&!keep.has(a.kind)){
    a.kind='standard';if(a.step!=='recognize'&&a.step!=='read')a.choices=[];
    delete a.groupId;delete a.cueWord;delete a.targets;delete a.direction;delete a.routeStart;delete a.routeCells;delete a.letterGrid;
  }
  const prepared=new Set<string>();
  for(const a of result){
    if(prepared.has(a.id))continue;
    const peers=pairedGame(a.kind)?result.filter(other=>other.groupId===a.groupId&&other.kind===a.kind):[a];
    prepareExtendedActivity(a,a.choices.map(w=>byId.get(w.id)!).filter(Boolean),random,options.readyMaterialKeys);
    for(const member of peers){
      if(a.kind==='standard'&&peers.length>1){member.kind='standard';member.choices=[];delete member.groupId;delete member.targets;delete member.material;delete member.spellingBoard;}
      else {if(a.material)member.material=structuredClone(a.material);if(a.spellingBoard)member.spellingBoard=[...a.spellingBoard];}
      prepared.add(member.id);
    }
  }
  return result;
}
