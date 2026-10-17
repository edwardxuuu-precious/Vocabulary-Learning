import type { ActivityAction, ActivityState, LearningActivity } from './contracts.ts';
import { adjacentCell, pairedGame, soundChoiceGame } from './game-boards.ts';
import type { GameTransition } from './game-rules.ts';

const hasDrawing = (state: ActivityState) => !!state.drawing && /[1-4]/.test(state.drawing);
const hasChoice = (a: LearningActivity, id: string | undefined) => typeof id === 'string' && a.choices.some(choice=>choice.id===id);
const pairReady = (a: LearningActivity, state: ActivityState) => state.selectedIds?.length === 2 && state.selectedIds[0]===a.wordId && state.selectedIds[1]!==a.wordId;
export function batchAnswerCorrect(a: LearningActivity, state: ActivityState) {
  if(pairedGame(a.kind)) return state.selectedIds?.length===2 && (a.kind==='queue' ? a.targets!.every((word,index)=>state.selectedIds![index]===word.id) : a.targets!.every(word=>state.selectedIds!.includes(word.id)));
  if(a.kind==='letter-path')return (state.letterPath??[]).map(cell=>a.letterGrid![cell]).join('')===a.word.term.toLowerCase();
  return state.selectedId===a.wordId;
}
export function transitionBatchTwo(a: LearningActivity, state: ActivityState, action: ActivityAction, id?: string): GameTransition {
  const result: GameTransition={state},fail=(text: string): never=>{throw Error(text);};
  const grade = (correct: boolean, key: string) => {
    const hinted=Boolean(state.hinted || state.outcome==='try'); state.outcome=correct?'correct':'try';state.hinted=hinted||!correct;
    result.attempt={correct,hinted,practiceOnly:true,key};
  };
  if(action==='listen') {
    if(!['queue','collect','draw','mimic','route','letter-path'].includes(a.kind) && !(a.kind==='switch'&&a.direction==='hear-picture')) fail('请先完成当前游戏的准备步骤。');
    state.heard=true;return result;
  }
  if(action==='listen-option') {
    if(!soundChoiceGame(a) || !hasChoice(a,id) || a.kind==='peek'&&!state.uncoveredTiles?.length)fail('先揭开一块图片，再听声音。');
    state.heardOptionIds=[...new Set([...(state.heardOptionIds??[]),id!])];return result;
  }
  if(action==='pick'&&pairedGame(a.kind)) {
    if(!state.heard||!hasChoice(a,id))fail('先听两个单词，再选择图片。');
    const selected=[...(state.selectedIds??[])],at=selected.indexOf(id!);
    if(a.kind==='collect'&&at>=0)selected.splice(at,1);
    else { if(at>=0||selected.length>=2)fail('两格已经放好，可以撤回再选。');selected.push(id!); }
    state.selectedIds=selected;delete state.outcome;return result;
  }
  if(action==='undo'&&(pairedGame(a.kind)||a.kind==='letter-path')) {
    if(a.kind==='letter-path')state.letterPath=(state.letterPath??[]).slice(0,-1);else state.selectedIds=(state.selectedIds??[]).slice(0,-1);
    delete state.outcome;return result;
  }
  if(action==='submit'&&(pairedGame(a.kind)||a.kind==='letter-path')) {
    if(!state.heard || (a.kind==='letter-path' ? state.letterPath?.length!==a.word.term.length : state.selectedIds?.length!==2))fail('请先听声音，并放好所有目标。');
    grade(batchAnswerCorrect(a,state),a.kind==='letter-path'?`letters-${state.letterPath!.join('-')}`:`pair-${state.selectedIds!.map(id=>a.choices.findIndex(choice=>choice.id===id)).join('-')}`);return result;
  }
  if(action==='letter'&&a.kind==='letter-path') {
    const cell=Number(id),path=[...(state.letterPath??[])];
    if(!state.heard||!/^\d{1,2}$/.test(id??'')||!Number.isInteger(cell)||cell<0||cell>=25||path.includes(cell)||path.length>=a.word.term.length||path.length>0&&!adjacentCell(path.at(-1)!,cell))fail('先听单词，再选择相邻的字母格。');
    state.letterPath=[...path,cell];delete state.outcome;return result;
  }
  if(action==='uncover'&&a.kind==='peek') {
    if(!/^[0-3]$/.test(id??''))fail('请选择图片上的一块。');
    state.uncoveredTiles=[...new Set([...(state.uncoveredTiles??[]),Number(id)])];state.hinted=true;return result;
  }
  if(action==='choose'&&['switch','peek','route'].includes(a.kind)) {
    if(!hasChoice(a,id))fail('请选择当前游戏中的答案。');
    if(soundChoiceGame(a) ? !state.heardOptionIds?.includes(id!) : !state.heard)fail('先听声音，再选择。');
    if(a.kind==='peek'&&!state.uncoveredTiles?.length)fail('先揭开一块图片。');
    state.selectedId=id;grade(id===a.wordId,id!);return result;
  }
  if(action==='draw'&&['draw','quiz'].includes(a.kind)) {
    if(!/^[0-4]{96}$/.test(id??'')||a.kind==='draw'&&!state.heard||state.revealed||state.handedOver)fail('先听单词，再在画板上试一试。');
    state.drawing=id;return result;
  }
  if(action==='compare'&&a.kind==='draw') {
    if(!state.heard||!hasDrawing(state))fail('先画一画，再打开图片核对。');
    state.revealed=true;state.hinted=true;return result;
  }
  if(action==='pick'&&a.kind==='associate'&&a.step==='sound') {
    if(!hasChoice(a,id)||id===a.wordId||state.composed)fail('请选择另一个伙伴，一起搭场景。');
    state.selectedIds=[a.wordId,id!];return result;
  }
  if(action==='compose'&&a.kind==='associate'&&a.step==='sound') {
    if(!pairReady(a,state))fail('先为它选一个伙伴。');
    state.composed=true;return result;
  }
  if(action==='hand-over'&&a.kind==='quiz') {
    if(!hasDrawing(state)&&id!=='gesture')fail('可以画线索，也可以用手势出题。');
    state.gesture=!hasDrawing(state);state.handedOver=true;return result;
  }
  if(action==='guess'&&a.kind==='quiz') {
    if(!state.handedOver||state.revealed||!hasChoice(a,id))fail('请先把谜题交给家长。');
    state.guessId=id;return result;
  }
  if(action==='reveal'&&['mimic','associate','quiz'].includes(a.kind)) {
    if(a.kind==='mimic'&&!state.heard||a.kind==='associate'&&(a.step!=='recall'||!state.composed||!pairReady(a,state))||a.kind==='quiz'&&!state.handedOver)fail('先完成前面的练习，再揭晓。');
    state.revealed=true;state.hinted=true;return result;
  }
  if(action==='finish'&&['draw','mimic','associate','quiz'].includes(a.kind)) {
    if(a.kind==='associate'&&a.step==='sound' ? !state.composed : !state.revealed)fail('请先完成练习，或选择跳过。');
    state.outcome='practice';state.hinted=true;result.attempt={correct:false,hinted:true,practiceOnly:true,key:'practice'};return result;
  }
  return fail('这个操作不适用于当前游戏。');
}

export function validBatchState(a: LearningActivity, state: ActivityState) {
  if(state.selectedIds!==undefined&&(!Array.isArray(state.selectedIds)||state.selectedIds.length>2||new Set(state.selectedIds).size!==state.selectedIds.length||state.selectedIds.some(id=>!hasChoice(a,id))||!['queue','collect','associate'].includes(a.kind)))return false;
  if(state.uncoveredTiles!==undefined&&(!Array.isArray(state.uncoveredTiles)||a.kind!=='peek'||state.uncoveredTiles.length>4||new Set(state.uncoveredTiles).size!==state.uncoveredTiles.length||state.uncoveredTiles.some(cell=>!Number.isInteger(cell)||cell<0||cell>3)))return false;
  if(state.drawing!==undefined&&(!['draw','quiz'].includes(a.kind)||typeof state.drawing!=='string'||!/^[0-4]{96}$/.test(state.drawing)))return false;
  if(state.letterPath!==undefined&&(!Array.isArray(state.letterPath)||a.kind!=='letter-path'||state.letterPath.length>a.word.term.length||new Set(state.letterPath).size!==state.letterPath.length||state.letterPath.some((cell,index)=>!Number.isInteger(cell)||cell<0||cell>=25||index>0&&!adjacentCell(state.letterPath![index-1],cell))))return false;
  if(state.composed&& (a.kind!=='associate'||!pairReady(a,state)))return false;
  if((state.handedOver||state.gesture||state.guessId!==undefined)&&a.kind!=='quiz'||state.guessId!==undefined&&(!state.handedOver||!hasChoice(a,state.guessId)))return false;
  if(state.revealed&&(a.kind==='draw'&&(!state.heard||!hasDrawing(state))||a.kind==='mimic'&&!state.heard||a.kind==='associate'&&(a.step!=='recall'||!state.composed)||a.kind==='quiz'&&!state.handedOver))return false;
  if(state.outcome==='correct'||state.outcome==='try') {
    if(!['queue','collect','switch','peek','route','letter-path'].includes(a.kind)||(state.outcome==='correct')!==batchAnswerCorrect(a,state))return false;
    if(pairedGame(a.kind)&&(!state.heard||state.selectedIds?.length!==2)||a.kind==='letter-path'&&(!state.heard||state.letterPath?.length!==a.word.term.length))return false;
    if(['switch','peek','route'].includes(a.kind)&&(!hasChoice(a,state.selectedId)||(soundChoiceGame(a)?!state.heardOptionIds?.includes(state.selectedId!):!state.heard)))return false;
    if(a.kind==='peek'&&!state.uncoveredTiles?.length||state.outcome==='try'&&!state.hinted)return false;
  }
  return true;
}
