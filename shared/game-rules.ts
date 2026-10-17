import { extendedKinds,builtInGameInstructions } from './game-materials.ts';
import { transitionExtended,validExtendedState,extendedStateKeys } from './game-extended-rules.ts';
import type { ActivityAction, ActivityState, LearningActivity } from './contracts.ts';
import { gameDefinition, recallGame } from './game-registry.ts';
import { batchTwoKinds, pairedGame } from './game-boards.ts';
import { transitionBatchTwo, validBatchState } from './game-batch-two.ts';

export const gameActions: ActivityAction[] = ['listen','choose','reveal','skip','next','audio-failed','conceal','show-options','listen-option','pick','undo','submit','uncover','draw','compare','finish','compose','hand-over','guess','letter','tap','place','run','reset','swap','guide','clue'];
export const activityStateKeys = ['heard','revealed','hinted','audioUnavailable','selectedId','outcome','concealed','optionsVisible','heardOptionIds','selectedIds','uncoveredTiles','drawing','composed','handedOver','gesture','guessId','letterPath',...extendedStateKeys];
export const gameAccepted = (state: ActivityState) => state.outcome === 'correct' || state.outcome === 'practice';
export function gameAudioWord(activity: LearningActivity, action: ActivityAction, selectedId?: string) {
  if (action === 'listen-option') return activity.choices.find(choice => choice.id === selectedId);
  if (action === 'listen') return activity.cueWord ?? activity.word;
  if (action === 'reveal') return activity.word;
}
export function gameAudioWords(activity: LearningActivity, action: ActivityAction, selectedId?: string, state: ActivityState = {}) {
  if(extendedKinds.has(activity.kind)) {
    const m=activity.material;
    if(action==='submit'&&state.outcome==='correct'){
      if(['story','program'].includes(activity.kind))return m!.answer.flatMap(id=>activity.choices.find(w=>w.id===m!.tiles.find(t=>t.id===id)?.wordId)??[]);
      if(['quantity','combine'].includes(activity.kind)&&m!.prompt?.locale==='en-US')return [{...activity.word,term:m!.prompt.text,locale:'en-US' as const}];
      if(activity.kind==='opposites'){const opposite=activity.choices.find(w=>w.id===m!.tiles.find(t=>t.id===m!.answer[0])?.wordId);return opposite?[activity.word,opposite]:[activity.word];}
      if(activity.kind==='sentence-repair')return [{...activity.word,term:m!.sentence!.map((v,i)=>i===m!.blank?activity.word.term:v).join(' '),locale:'en-US' as const}];return pairedGame(activity.kind)?activity.targets!:[activity.word];}
    if(action==='guide'&&(m||builtInGameInstructions[activity.kind]))return [{...activity.word,term:m?.instruction??builtInGameInstructions[activity.kind],locale:'zh-CN' as const}];
    if(action==='clue'&&m?.clues){const c=m.clues[Math.max(0,(state.gameStage??1)-1)];return [{...activity.word,term:c.text,locale:c.locale}];}
    if(action==='listen-option'&&m){const tile=m.tiles.find(t=>t.id===selectedId),word=activity.choices.find(w=>w.id===tile?.wordId);return word?[word]:[];}
    if(action==='listen'&&m?.prompt)return [{...activity.word,term:m.prompt.text,locale:m.prompt.locale}];
    if(action==='listen'&&activity.kind==='odd')return m!.tiles.flatMap(t=>activity.choices.find(w=>w.id===t.wordId)??[]);
    if(action==='reveal'&&activity.kind==='cloze')return [{...activity.word,term:m!.sentence!.join(' '),locale:'en-US' as const}];
  }
  if(action==='listen'&&pairedGame(activity.kind))return activity.targets ?? [];
  const word=gameAudioWord(activity,action,selectedId);return word?[word]:[];
}
export function answerIsValid(activity: LearningActivity, id: string) { return activity.kind === 'gate' ? ['yes','no'].includes(id) : activity.choices.some(choice => choice.id === id); }
export function answerIsCorrect(activity: LearningActivity, id: string) { return activity.kind === 'gate' ? id === ((activity.cueWord?.id ?? activity.wordId) === activity.wordId ? 'yes' : 'no') : id === activity.wordId; }
export interface GameTransition { state: ActivityState; attempt?: { correct: boolean; hinted: boolean; practiceOnly: boolean; key: string }; complete?: boolean }

/** Pure transition rules; the server owns the prior checkpoint, frozen question and correctness. */
export function transitionGame(activity: LearningActivity, previous: ActivityState, action: ActivityAction, selectedId?: string): GameTransition {
  const state: ActivityState = { ...previous, ...(previous.heardOptionIds ? { heardOptionIds: [...previous.heardOptionIds] } : {}) };
  const result: GameTransition = { state };
  const fail = (message: string): never => { throw new Error(message); };
  if (!gameDefinition(activity.kind) || !gameActions.includes(action)) fail('游戏请求无效。');
  if (gameAccepted(state) && action !== 'next') return result;
  if(extendedKinds.has(activity.kind)&&!['skip','next','audio-failed'].includes(action))return transitionExtended(activity,state,action,selectedId);
  if (batchTwoKinds.has(activity.kind) && !['skip','next','audio-failed'].includes(action)) return transitionBatchTwo(activity,state,action,selectedId);
  if (action === 'listen') {
    if (recallGame(activity.kind) || activity.kind === 'think-choice') fail('先自己想一想，再打开声音。');
    if (activity.kind === 'treasure' && !state.concealed) fail('先看清图片，再合上藏宝格。');
    state.heard = true;
  } else if (action === 'listen-option') {
    if (activity.kind !== 'think-choice' || !state.optionsVisible || !selectedId || !answerIsValid(activity, selectedId)) fail('请先打开声音选项。');
    state.heardOptionIds = [...new Set([...(state.heardOptionIds ?? []), selectedId!])];
  } else if (action === 'conceal') {
    if (!['treasure','missing'].includes(activity.kind)) fail('这个游戏不需要合上图片。');
    state.concealed = true;
  } else if (action === 'show-options') {
    if (activity.kind !== 'think-choice' && activity.kind !== 'listen-first' || activity.kind === 'listen-first' && !state.heard) fail('先听单词，再打开图片。');
    state.optionsVisible = true;
  } else if (action === 'reveal') {
    if (!recallGame(activity.kind) || activity.kind === 'missing' && !state.concealed) fail('先把图片藏起来，自己想一想。');
    state.revealed = true; state.hinted = true;
  } else if (action === 'audio-failed') {
    if (!extendedKinds.has(activity.kind) && !state.heard && !state.revealed && !state.heardOptionIds?.length) fail('尚未开始播放声音。');
    state.audioUnavailable = true; state.hinted = true;
  } else if (action === 'choose') {
    if (recallGame(activity.kind) || !selectedId || !answerIsValid(activity, selectedId)) fail('请选择当前游戏中的答案。');
    if (activity.kind === 'think-choice' ? !state.optionsVisible || !state.heardOptionIds?.includes(selectedId!) : !state.heard) fail('先点声音卡听一听，再选择。');
    if (activity.kind === 'listen-first' && !state.optionsVisible || activity.kind === 'treasure' && !state.concealed) fail('请先完成当前游戏的准备步骤。');
    const correct = answerIsCorrect(activity, selectedId!), hinted = Boolean(state.hinted || state.outcome === 'try');
    state.selectedId = selectedId; state.outcome = correct ? 'correct' : 'try'; state.hinted = hinted || !correct;
    result.attempt = { correct, hinted, practiceOnly: gameDefinition(activity.kind)!.practiceOnly || state.audioUnavailable === true, key: selectedId! };
  } else if (action === 'skip') {
    state.outcome = 'practice'; state.hinted = true;
    result.attempt = { correct: false, hinted: true, practiceOnly: true, key: 'practice' };
  } else if (action === 'next') {
    if (!gameAccepted(state)) fail('先完成小任务，或点这次先跳过。');
    result.complete = true;
  }
  return result;
}

export function validActivityState(activity: LearningActivity, state: ActivityState) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).some(key => !activityStateKeys.includes(key))) return false;
  if (['heard','revealed','hinted','audioUnavailable','concealed','optionsVisible','composed','handedOver','gesture'].some(key => (state as any)[key] !== undefined && typeof (state as any)[key] !== 'boolean')) return false;
  if(extendedKinds.has(activity.kind))return validExtendedState(activity,state);
  if (state.heardOptionIds !== undefined && (!Array.isArray(state.heardOptionIds) || state.heardOptionIds.length > 3 || new Set(state.heardOptionIds).size !== state.heardOptionIds.length || state.heardOptionIds.some(id => !activity.choices.some(choice => choice.id === id)))) return false;
  if (state.outcome !== undefined && !['correct','try','practice'].includes(state.outcome)) return false;
  if (batchTwoKinds.has(activity.kind)) return validBatchState(activity,state);
  if (activityStateKeys.slice(9).some(key=>(state as any)[key]!==undefined))return false;
  if (state.selectedId !== undefined && !answerIsValid(activity, state.selectedId)) return false;
  if (state.outcome === 'correct' || state.outcome === 'try') {
    if (!state.selectedId || recallGame(activity.kind) || state.outcome === 'correct' !== answerIsCorrect(activity, state.selectedId)) return false;
    if (activity.kind === 'think-choice' ? !state.optionsVisible || !state.heardOptionIds?.includes(state.selectedId) : !state.heard) return false;
    if (state.outcome === 'try' && !state.hinted) return false;
    if (activity.kind === 'listen-first' && !state.optionsVisible || activity.kind === 'treasure' && !state.concealed) return false;
  }
  return true;
}
