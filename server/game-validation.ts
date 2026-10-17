import { extendedKinds,automaticSpelling,validGameMaterial } from '../shared/game-materials.ts';
import type { LearningSession } from '../shared/contracts.ts';
import { activityDone } from '../shared/game-plan.ts';
import { gameDefinition, recallGame } from '../shared/game-registry.ts';
import { validActivityState } from '../shared/game-rules.ts';
import { adjacentCell, findLetterPath, pairedGame, sameWord } from '../shared/game-boards.ts';

/** Additional backup validation for the optional, versioned-by-shape activity plan. Legacy plans stay valid. */
export function validGameSession(session: LearningSession, wordIds: Set<string>, media: (url: unknown) => boolean): boolean {
  if (session.activities === undefined) return session.activityStates === undefined && session.gameSeed === undefined;
  if (session.gameSeed !== undefined && (typeof session.gameSeed !== 'string' || !session.gameSeed.length || session.gameSeed.length > 100)) return false;
  if (!session.tasks || !Array.isArray(session.activities) || !session.activityStates || typeof session.activityStates !== 'object' || Array.isArray(session.activityStates)) return false;
  const planned = session.tasks.flatMap(task => task.steps.map(step => `${task.wordId}:${step}`));
  if (session.activities.length !== planned.length || new Set(session.activities.map(item => item?.id)).size !== planned.length) return false;
  const snapshot = (value: any) => value && typeof value === 'object' && !Array.isArray(value) && wordIds.has(value.id) && typeof value.term === 'string' && /^[A-Za-z][A-Za-z '\-]*$/.test(value.term) && value.term.length <= 80 && typeof value.meaning === 'string' && value.meaning.length > 0 && value.meaning.length <= 160 && media(value.imageUrl) && Number.isInteger(value.learningVersion) && value.learningVersion >= 0;
  let unfinished = false;
  for (const item of session.activities) {
    if (!item || item.id !== `${item.wordId}:${item.step}` || !planned.includes(item.id) || !snapshot(item.word) || item.word.id !== item.wordId || item.kind !== 'standard' && !gameDefinition(item.kind) || !Array.isArray(item.choices) || item.choices.length > 3 || item.choices.some(choice => !snapshot(choice))) return false;
    if (item.groupId !== undefined && (!['flip','repair','bingo','queue','collect','route','letter-sort','story','program','combine','quantity'].includes(item.kind) || typeof item.groupId !== 'string' || item.groupId.length > 80)) return false;
    if (item.kind === 'portal' && (!['recall','read'].includes(item.step) || item.choices.length)) return false;
    const definition = gameDefinition(item.kind);
    if (definition && definition.step !== item.step && !definition.otherSteps?.includes(item.step) || ['flip','repair','bingo','queue','collect','route','letter-sort','story','program','combine','quantity'].includes(item.kind) && !item.groupId) return false;
    if (definition && item.kind !== 'portal') {
      const target = item.choices.find(choice => choice.id === item.wordId);
      if (item.choices.length < definition.minWords || !target || ['id','term','meaning','imageUrl','learningVersion'].some(key => (target as any)[key] !== (item.word as any)[key]) || new Set(item.choices.map(choice => choice.id)).size !== item.choices.length || new Set(item.choices.map(choice => choice.term.toLowerCase())).size !== item.choices.length || new Set(item.choices.map(choice => choice.meaning.trim())).size !== item.choices.length || new Set(item.choices.map(choice => choice.imageUrl)).size !== item.choices.length) return false;
    }
    if (item.kind === 'gate' ? !snapshot(item.cueWord) || !item.choices.some(choice => JSON.stringify(choice) === JSON.stringify(item.cueWord)) : item.cueWord !== undefined) return false;
    if(pairedGame(item.kind)) {
      if(!Array.isArray(item.targets)||item.targets.length!==2||new Set(item.targets.map(word=>word.id)).size!==2||item.targets.some(word=>!snapshot(word)||!item.choices.some(choice=>sameWord(word,choice))))return false;
      const members=session.activities.filter(other=>other.kind===item.kind&&other.groupId===item.groupId);
      if(members.length!==2||members.some((other,index)=>other.wordId!==item.targets![index].id||JSON.stringify(other.targets)!==JSON.stringify(item.targets)||JSON.stringify(other.choices)!==JSON.stringify(item.choices)||JSON.stringify(other.material)!==JSON.stringify(item.material)||JSON.stringify(other.spellingBoard)!==JSON.stringify(item.spellingBoard)||JSON.stringify(session.activityStates![other.id]??{})!==JSON.stringify(session.activityStates![item.id]??{})||activityDone(session,other)!==activityDone(session,item))||session.activities.indexOf(members[1])!==session.activities.indexOf(members[0])+1)return false;
    } else if(item.targets!==undefined)return false;
    if(item.kind==='switch' ? !['hear-picture','picture-hear'].includes(item.direction??'') : item.direction!==undefined)return false;
    if(item.kind==='route') {
      if(!Number.isInteger(item.routeStart)||item.routeStart!<0||item.routeStart!>=25||!Array.isArray(item.routeCells)||item.routeCells.length!==item.choices.length||new Set(item.routeCells).size!==item.routeCells.length||item.routeCells.some(cell=>!Number.isInteger(cell)||cell<0||cell>=25||!adjacentCell(item.routeStart!,cell)))return false;
    }else if(item.routeStart!==undefined||item.routeCells!==undefined)return false;
    if(item.kind==='letter-path' ? typeof item.letterGrid!=='string'||!/^[a-z]{25}$/.test(item.letterGrid)||!/^[a-z]{2,6}$/i.test(item.word.term)||!findLetterPath(item.letterGrid,item.word.term) : item.letterGrid!==undefined)return false;
    if(extendedKinds.has(item.kind)) {
      if(automaticSpelling.has(item.kind)?!/^[a-z]{2,6}$/i.test(item.word.term):!validGameMaterial(item.kind,item.material))return false;
      if(['story','program','combine'].includes(item.kind)&&item.targets!.some(w=>!item.material!.answer.some(id=>item.material!.tiles.find(t=>t.id===id)?.wordId===w.id)))return false;
      if(item.material&&item.material.wordVersion!==(item.targets?.[0]??item.word).learningVersion)return false;
      if(item.material&&item.material.wordIds.some(id=>!wordIds.has(id)))return false;
      if(item.material?.tiles.some(t=>t.imageUrl&&!media(t.imageUrl)))return false;
      const board=item.spellingBoard;
      if(['letter-gap','chunks','letter-extra','letter-swap','letter-sort','letter-push'].includes(item.kind)) {
        if(!Array.isArray(board)||!board.length||board.length>12||board.some(v=>typeof v!=='string'||v.length>12))return false;
        const term=item.word.term.toLowerCase();
        if(item.kind==='letter-gap'&&(!/^[0-5]$/.test(board[0])||Number(board[0])>=term.length||new Set(board.slice(1)).size!==board.length-1||!board.slice(1).includes(term[Number(board[0])])||board.slice(1).some(v=>!/^[a-z]$/.test(v))))return false;
        if(item.kind==='chunks'&&(item.material!.chunks!.join('').toLowerCase()!==term||board.length!==item.material!.chunks!.length||new Set(board).size!==board.length||board.some(v=>!/^\d$/.test(v)||Number(v)>=board.length)))return false;
        if(item.kind==='letter-extra'&&(board.length!==1||board[0].length!==term.length+1||![...board[0]].some((_,i)=>board[0].slice(0,i)+board[0].slice(i+1)===term)))return false;
        if(item.kind==='letter-swap'&&(board.length!==1||board[0]===term||board[0].length!==term.length||[...board[0]].sort().join('')!==[...term].sort().join('')||[...board[0]].filter((c,i)=>c!==term[i]).length!==2))return false;
        if(item.kind==='letter-push'&&board.slice().sort().join('')!==[...term].sort().join(''))return false;
        if(item.kind==='letter-sort'&&board.slice().sort().join('')!==item.targets!.flatMap(w=>[...w.term.toLowerCase()]).sort().join(''))return false;
      }else if(board!==undefined)return false;
    }else if(item.material!==undefined||item.spellingBoard!==undefined)return false;
    const done = activityDone(session, item);
    if (done && unfinished) return false;
    unfinished ||= !done;
    const state = session.activityStates[item.id];
    if (state === undefined) { if (done && item.kind !== 'standard') return false; continue; }
    if (!validActivityState(item, state)) return false;
    if (state.revealed && item.kind === 'missing' && !state.concealed || state.heard && item.kind === 'treasure' && !state.concealed || state.heardOptionIds?.length && item.kind==='think-choice' && !state.optionsVisible) return false;
    if (done && item.kind !== 'standard' && !['correct','practice'].includes(state.outcome ?? '')) return false;
  }
  return Object.keys(session.activityStates).every(id => session.activities!.some(item => item.id === id));
}
