import type { ActivityAction, ActivityState, LearningActivity } from './contracts.ts';
import { automaticSpelling, spokenKinds } from './game-materials.ts';
import type { GameTransition } from './game-rules.ts';

const setEqual=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(v=>b.includes(v));
const ordered=new Set(['story','program','chunks']);
const placed=new Set(['assemble','sort','parts','position','combine','assign']);
export const pushStart=(a:LearningActivity)=>a.spellingBoard!.map((_,i)=>18+i);
export function replayPush(a:LearningActivity,moves:string[]) {
  const positions=pushStart(a);
  for(const move of moves){const match=/^(\d)@(\d{1,2})$/.exec(move);if(!match)return;const index=Number(match![1]),to=Number(match![2]),from=positions[index];if(index>=positions.length||to>=36||positions.includes(to)||Math.abs(Math.floor(from/6)-Math.floor(to/6))+Math.abs(from%6-to%6)!==1)return;positions[index]=to;}
  return positions;
}
export function extendedCorrect(a:LearningActivity,s:ActivityState) {
  const m=a.material,moves=s.gameMoves??[],placements=s.gamePlaced??{},text=s.gameText??'';
  if(a.kind==='detective')return moves[0]===m!.answer[0]&&s.gameFocus===m!.placements?.[m!.answer[0]];
  if(['assign','sort','parts','position'].includes(a.kind)&&m?.acceptedSlots)return Object.keys(placements).length===1&&!!placements[m!.answer[0]]&&(m!.acceptedSlots??[m!.placements![m!.answer[0]]]).includes(placements[m!.answer[0]]);
  if(placed.has(a.kind))return setEqual(Object.keys(placements),m!.answer)&&m!.answer.every(id=>placements[id]===m!.placements![id]);
  if(a.kind==='sentence-repair')return s.gameStage===m!.blank!+1&&moves[0]===m!.answer[0];
  if(ordered.has(a.kind))return moves.join('|')===(a.kind==='chunks'?a.material!.chunks!.map((_,i)=>String(i)):m!.answer).join('|');
  if(a.kind==='intersection')return setEqual(moves,m!.answer)&&s.gameStage===2;
  if(a.kind==='paint')return s.gameFocus===m!.answer[0]&&s.gameStage===1;
  if(a.kind==='quantity')return moves.length===m!.count&&moves.every(id=>id===m!.answer[0]);
  if(a.kind==='information')return moves[0]===m!.answer[0]&&(s.gameStage??0)>0;
  if(a.kind==='letter-gap')return text===a.word.term.toLowerCase()[Number(a.spellingBoard![0])];
  if(a.kind==='letter-extra')return moves.length===1&&[...a.spellingBoard![0]].filter((_,i)=>String(i)!==moves[0]).join('')===a.word.term.toLowerCase();
  if(['letter-swap','dictation','cover-spell','word-morph'].includes(a.kind))return text===a.word.term.toLowerCase();
  if(a.kind==='letter-sort')return a.targets!.every(w=>moves.filter(v=>v.split('@')[1]===w.id).map(v=>a.spellingBoard![Number(v.split('@')[0])]).join('')===w.term.toLowerCase());
  if(a.kind==='letter-push')return [...a.word.term.toLowerCase()].every((c,i)=>s.gamePositions?.some((cell,j)=>cell===i&&a.spellingBoard![j]===c));
  return setEqual(moves,m!.answer);
}

export function transitionExtended(a:LearningActivity,previous:ActivityState,action:ActivityAction,id?:string):GameTransition {
  const s:ActivityState=structuredClone(previous),result:GameTransition={state:s},m=a.material,k=a.kind,moves=[...(s.gameMoves??[])];
  const fail=(message='先完成当前这一步，再继续。'):never=>{throw Error(message);};
  const tile=()=>m?.tiles.find(t=>t.id===id),slot=()=>m?.slots?.find(t=>t.id===id);
  const grade=()=>{const correct=extendedCorrect(a,s),hinted=!!(s.hinted||s.outcome==='try');s.outcome=correct?'correct':'try';s.hinted=hinted||!correct;result.attempt={correct,hinted,practiceOnly:true,key:correct?'extended-ok':'extended-try'};};
  if(action==='guide')return result;
  if(action==='listen') {if(spokenKinds.has(k)&&k!=='clue'&&k!=='cloze')fail('先看线索，试着说一说。');s.heard=true;return result;}
  if(action==='clue'&&k==='intersection') {const stage=s.gameStage??0;if(stage>=2)return result;s.gameStage=stage+1;s.heard=true;return result;}
  if(action==='listen-option') {if(!tile()||!tile()!.wordId||!s.heard&&!['information','odd'].includes(k))fail();s.heardOptionIds=[...new Set([...(s.heardOptionIds??[]),id!])];return result;}
  if(action==='reveal'&&spokenKinds.has(k)) {if(['clue','cloze'].includes(k)&&!s.heard||k==='pantomime'&&!s.gameStage||k==='information'&&!s.gameStage)fail();s.revealed=true;s.hinted=true;return result;}
  if(action==='finish'&&spokenKinds.has(k)) {if(!s.revealed)fail();s.outcome='practice';s.hinted=true;result.attempt={correct:false,hinted:true,practiceOnly:true,key:'practice'};return result;}
  if(action==='conceal'&&k==='cover-spell') {s.concealed=true;s.hinted=true;return result;}
  if(action==='reveal'&&k==='cover-spell') {s.revealed=true;s.hinted=true;return result;}
  if(action==='run'&&['pantomime','program','story'].includes(k)) {if(k!=='pantomime'&&(!s.heard||moves.length!==m!.answer.length))fail('先排好动作，再点运行。');s.gameStage=(s.gameStage??0)+1;return result;}
  if(action==='pick'&&k==='information'){if(!s.handedOver||!tile()||!s.heardOptionIds?.includes(id!))fail('先听一个问题，再问家长。');s.gameFocus=id;return result;}
  if(action==='guess'&&k==='information'){const match=/^([a-zA-Z0-9_-]+)@(yes|no)$/.exec(id??'');if(!match||s.gameFocus!==match![1])fail();s.gamePlaced={...s.gamePlaced,[match![1]]:match![2]};s.gameStage=(s.gameStage??0)+1;return result;}
  if(action==='pick'&&k==='sentence-repair'){if(!s.heard||!/^\d$/.test(id??'')||Number(id)>=m!.sentence!.length)fail();s.gameStage=Number(id)+1;return result;}
  if(action==='hand-over'&&k==='information') {s.handedOver=true;s.gameStage=1;return result;}
  if(action==='undo') {if(k==='detective'){if(s.gameFocus)delete s.gameFocus;else{s.gameMoves=[];s.gameStage=0;}}else if(k==='letter-swap'){s.gameMoves=moves.slice(0,-1);const xs=[...a.spellingBoard![0]];for(const v of s.gameMoves){const [i,j]=v.split(':').map(Number);[xs[i],xs[j]]=[xs[j],xs[i]];}s.gameText=xs.join('');delete s.gameFocus;}else if(k==='letter-push'){s.gameMoves=moves.slice(0,-1);s.gamePositions=replayPush(a,s.gameMoves)!;}else if(['dictation','cover-spell'].includes(k))s.gameText=(s.gameText??'').slice(0,-1);else if(placed.has(k)){const entries=Object.entries(s.gamePlaced??{});entries.pop();s.gamePlaced=Object.fromEntries(entries);}else s.gameMoves=moves.slice(0,-1);delete s.outcome;return result;}
  if(action==='reset') {for(const key of ['gameMoves','gamePlaced','gameFocus','gameText','gamePositions','outcome'] as const)delete s[key];if(['program','story','detective','sentence-repair','paint'].includes(k))s.gameStage=0;return result;}
  if(action==='submit') {if(!s.heard&& !['detective','information'].includes(k))fail('先听一听，再检查。');if(['story','program'].includes(k)&&!s.gameStage)fail('先运行一次，看看自己的安排。');if(k==='cover-spell'&&!s.concealed)fail('合上单词后再拼。');grade();return result;}
  if(action==='pick'&&placed.has(k)) {if(!s.heard||!tile())fail('先听声音，再拿起一个部件。');s.gameFocus=id;return result;}
  if(action==='place'&&placed.has(k)) {if(!s.gameFocus||!slot()||!m!.tiles.some(t=>t.id===s.gameFocus))fail('先点一个物品，再点要放的位置。');s.gamePlaced={...s.gamePlaced,[s.gameFocus!]:id!};delete s.outcome;return result;}
  if(action==='tap'&&k==='detective') {if(!s.heard)fail('先听目标词。');if(!s.gameStage){if(!tile())fail();s.gameMoves=[id!];if(id===m!.answer[0])s.gameStage=1;else{s.outcome='try';s.hinted=true;}return result;}if(!slot())fail();s.gameFocus=id;delete s.outcome;return result;}
  if(action==='tap'&&k==='paint') {if(!s.heard||!tile()?.color)fail();s.gameFocus=id;s.gameStage=0;delete s.outcome;return result;}
  if(action==='place'&&k==='paint') {if(!s.gameFocus||id!=='canvas')fail();s.gameStage=1;return result;}
  if(action==='tap'&&k==='intersection') {if(!tile()||!s.gameStage)fail('先听第一条线索。');const initial=m!.tiles.map(t=>t.id),remaining=s.gameMoves??initial;s.gameMoves=remaining.includes(id!)?remaining.filter(v=>v!==id):[...remaining,id!];delete s.outcome;return result;}
  if(action==='tap'&&k==='quantity') {if(!s.heard||!tile()||moves.length>=5)fail();s.gameMoves=[...moves,id!];delete s.outcome;return result;}
  if(action==='tap'&&['letter-gap','chunks','letter-extra','letter-sort','letter-push','letter-swap'].includes(k)) {
    if(!s.heard)fail('先听目标单词。');
    if(k==='letter-gap'){if(!a.spellingBoard!.slice(1).includes(id??''))fail();s.gameText=id;}
    if(k==='chunks'){if(!a.spellingBoard!.includes(id??'')||moves.includes(id!))fail();s.gameMoves=[...moves,id!];}
    if(k==='letter-extra'){if(!/^\d$/.test(id??'')||Number(id)>=a.spellingBoard![0].length)fail();s.gameMoves=[id!];}
    if(k==='letter-sort'){if(!/^\d{1,2}$/.test(id??'')||Number(id)>=a.spellingBoard!.length||moves.some(v=>v.split('@')[0]===id))fail();s.gameFocus=id;}
    if(k==='letter-push'){if(!/^\d$/.test(id??'')||Number(id)>=a.spellingBoard!.length)fail();s.gameFocus=id;}
    if(k==='letter-swap'){const text=s.gameText??a.spellingBoard![0];if(!/^\d$/.test(id??'')||Number(id)>=text.length)fail();if(s.gameFocus===undefined)s.gameFocus=id;else{const xs=[...text],i=Number(s.gameFocus),j=Number(id);[xs[i],xs[j]]=[xs[j],xs[i]];s.gameText=xs.join('');s.gameMoves=[...moves,`${i}:${j}`];delete s.gameFocus;}}
    delete s.outcome;return result;
  }
  if(action==='place'&&k==='letter-sort') {if(s.gameFocus===undefined||!a.targets!.some(w=>w.id===id)||moves.some(v=>v.split('@')[0]===s.gameFocus))fail();s.gameMoves=[...moves,`${s.gameFocus}@${id}`];delete s.gameFocus;delete s.outcome;return result;}
  if(action==='place'&&k==='letter-push') {if(s.gameFocus===undefined||moves.length>=200)fail();const next=[...moves,`${s.gameFocus}@${id}`],positions=replayPush(a,next);if(!positions)fail('字母箱只能移动到旁边的空格。');s.gameMoves=next;s.gamePositions=positions;delete s.outcome;return result;}
  if(action==='letter'&&['dictation','cover-spell','word-morph'].includes(k)) {
    if(!s.heard||k==='cover-spell'&&!s.concealed)fail('先听一听，准备好后再拼。');
    if(k==='word-morph') {const current=s.gameText??m!.source!.toLowerCase(),at=Number(s.gameFocus??current.length);if(id==='delete'){s.gameText=current.slice(0,at)+current.slice(at+1);}else{const match=/^([ir]):([a-z])$/.exec(id??'');if(!match||current.length>=10&&match![1]==='i')fail();s.gameText=current.slice(0,at)+match![2]+current.slice(at+(match![1]==='r'?1:0));}delete s.outcome;return result;}
    if(!/^[a-z]$/.test(id??'')||(s.gameText??'').length>=12)fail();s.gameText=(s.gameText??'')+id;delete s.outcome;return result;
  }
  if(action==='tap'&&k==='word-morph') {const text=s.gameText??m!.source!;if(!/^\d{1,2}$/.test(id??'')||Number(id)>text.length)fail();s.gameFocus=id;return result;}
  if(action==='tap'&&['variants','opposites','odd','story','program','sentence-repair','negative','information'].includes(k)) {
    if(!tile()||(k==='information'?!s.handedOver:!s.heard))fail('先听声音，再试一试。');
    if(['variants','negative'].includes(k))s.gameMoves=moves.includes(id!)?moves.filter(v=>v!==id):[...moves,id!];
    else if(['story','program'].includes(k)){if(moves.length>=m!.answer.length||k==='story'&&moves.includes(id!))fail('位置放满了，可以撤回。');s.gameMoves=[...moves,id!];s.gameStage=0;}
    else s.gameMoves=[id!];delete s.outcome;return result;
  }
  return fail('这个操作不适用于当前玩法。');
}

export const extendedStateKeys=['gameMoves','gamePlaced','gameFocus','gameStage','gameText','gamePositions'];
export function validExtendedState(a:LearningActivity,s:ActivityState) {
  const k=a.kind,m=a.material,moves=s.gameMoves??[],ids=m?.tiles.map(t=>t.id)??[];
  if(['selectedId','selectedIds','uncoveredTiles','drawing','composed','gesture','guessId','letterPath','optionsVisible'].some(key=>(s as any)[key]!==undefined))return false;
  if(s.handedOver!==undefined&&k!=='information'||s.concealed!==undefined&&k!=='cover-spell'||s.revealed!==undefined&&!spokenKinds.has(k)&&k!=='cover-spell')return false;
  if(s.gameText!==undefined&&!['letter-gap','letter-swap','dictation','cover-spell','word-morph'].includes(k))return false;
  if(s.gameStage!==undefined&&!['detective','paint','pantomime','story','program','sentence-repair','intersection','information'].includes(k))return false;
  if(s.gameFocus!==undefined){
    if(['assemble','sort','parts','position','combine','assign','paint','information'].includes(k)){if(!ids.includes(s.gameFocus))return false;}
    else if(k==='detective'){if(!m!.slots!.some(slot=>slot.id===s.gameFocus))return false;}
    else if(['letter-sort','letter-swap','letter-push','word-morph'].includes(k)){if(!/^\d{1,2}$/.test(s.gameFocus)||Number(s.gameFocus)>=(k==='word-morph'?(s.gameText??m!.source!).length+1:k==='letter-swap'?a.word.term.length:a.spellingBoard!.length))return false;}
    else return false;
  }
  if(['variants','negative','opposites','odd','detective','sentence-repair','intersection','information'].includes(k)&&new Set(moves).size!==moves.length)return false;
  if(['opposites','odd','detective','sentence-repair','information'].includes(k)&&moves.length>1||['story','program'].includes(k)&&moves.length>m!.answer.length||k==='quantity'&&moves.length>5)return false;
  if(s.gameMoves!==undefined&&['assemble','sort','parts','position','combine','assign','paint','pantomime','clue','cloze','letter-gap','dictation','cover-spell','word-morph'].includes(k))return false;
  if(k==='letter-gap'&&s.gameText!==undefined&&!a.spellingBoard!.slice(1).includes(s.gameText))return false;

  if(s.gameStage!==undefined&&(!Number.isInteger(s.gameStage)||s.gameStage<0||s.gameStage>10000))return false;
  if(s.gameFocus!==undefined&&(typeof s.gameFocus!=='string'||s.gameFocus.length>100)||s.gameText!==undefined&&(typeof s.gameText!=='string'||!/^[a-z]{0,12}$/.test(s.gameText)))return false;
  if(s.gamePlaced!==undefined&&((!placed.has(k)&&k!=='information')||typeof s.gamePlaced!=='object'||Array.isArray(s.gamePlaced)||Object.entries(s.gamePlaced).some(([key,v])=>!ids.includes(key)||(k==='information'?!['yes','no'].includes(v):!m!.slots?.some(slot=>slot.id===v)))))return false;
  if(!Array.isArray(moves)||moves.length>(k==='letter-push'?200:20)||moves.some(v=>typeof v!=='string'||v.length>100))return false;
  if(k==='letter-swap'){if(moves.some(v=>!/^\d:\d$/.test(v)||v.split(':').some(i=>Number(i)>=a.word.term.length)))return false;const xs=[...a.spellingBoard![0]];for(const v of moves){const [i,j]=v.split(':').map(Number);[xs[i],xs[j]]=[xs[j],xs[i]];}if(s.gameText!==undefined&&s.gameText!==xs.join(''))return false;}
  if(k==='letter-push'){const replay=replayPush(a,moves);if(!replay||s.gamePositions!==undefined&&JSON.stringify(s.gamePositions)!==JSON.stringify(replay))return false;}
  else if(s.gamePositions!==undefined)return false;
  if(k==='letter-sort'){if(moves.some(v=>!/^\d{1,2}@[a-zA-Z0-9_-]{1,80}$/.test(v)||Number(v.split('@')[0])>=a.spellingBoard!.length||!a.targets?.some(w=>w.id===v.split('@')[1]))||new Set(moves.map(v=>v.split('@')[0])).size!==moves.length)return false;}
  else if(k==='chunks'){if(moves.some(v=>!a.spellingBoard!.includes(v))||new Set(moves).size!==moves.length)return false;}
  else if(k==='letter-extra'){if(moves.length>1||moves.some(v=>!/^\d$/.test(v)||Number(v)>=a.spellingBoard![0].length))return false;}
  else if(!automaticSpelling.has(k)&&moves.some(v=>!ids.includes(v)))return false;
  if(s.heardOptionIds!==undefined&&(!Array.isArray(s.heardOptionIds)||s.heardOptionIds.length>12||new Set(s.heardOptionIds).size!==s.heardOptionIds.length||s.heardOptionIds.some(id=>!ids.includes(id))))return false;
  if(s.outcome==='correct'||s.outcome==='try'){if(!s.heard&&!['information'].includes(k)|| (s.outcome==='correct')!==extendedCorrect(a,s)||spokenKinds.has(k)&&k!=='information'||s.outcome==='try'&&!s.hinted)return false;}
  if(s.revealed&&spokenKinds.has(k)&&(['clue','cloze'].includes(k)?!s.heard:!s.gameStage))return false;
  return true;
}
