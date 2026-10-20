import { useEffect, useRef, useState } from 'react';
import { LearningTopbar } from './learning-topbar';
import type { ActivityAction, GameWord, LearningActivity, LearningSession } from '../shared/contracts';
import { activityDone, activityTitles } from '../shared/game-plan';
import { adjacentCell, pairedGame } from '../shared/game-boards';
import { gameAccepted } from '../shared/game-rules';
import { companionFor } from '../shared/companions';
import { Mascot } from './mascot';
import { GameActionBar, GameSoundIcon } from './game-action-bar';
import { OralPractice } from './oral-practice';
import './batch-two-games.css';

interface Props { activity: LearningActivity; session: LearningSession; busy: boolean; playing: boolean; onAction: (action: ActivityAction, selectedId?: string) => void; onHome: () => void; onPause: () => void; stopAudio: () => void }
function PixelSketch({value,disabled,save}:{value?:string;disabled:boolean;save:(value:string)=>void}) {
  const blank='0'.repeat(96),[cells,setCells]=useState(value??blank),[color,setColor]=useState('1');
  const draft=useRef(cells),drawing=useRef(false);
  useEffect(()=>{draft.current=value??blank;setCells(draft.current);},[value]);
  const paint=(index:number)=>{if(index<0||index>=96)return;draft.current=draft.current.slice(0,index)+color+draft.current.slice(index+1);setCells(draft.current);};
  const point=(event:React.PointerEvent<HTMLDivElement>)=>{const box=event.currentTarget.getBoundingClientRect();paint(Math.min(7,Math.max(0,Math.floor((event.clientY-box.top)/box.height*8)))*12+Math.min(11,Math.max(0,Math.floor((event.clientX-box.left)/box.width*12))));};
  return <div className="batch-sketch"><div className="batch-palette" role="group" aria-label="选择画笔">{['1','2','3','4','0'].map((c,index)=><button key={c} className={`ink-${c} ${color===c?'is-current':''}`} disabled={disabled} aria-label={index===4?'橡皮擦':`画笔${index+1}`} aria-pressed={color===c} onClick={()=>setColor(c)}>{index===4?'◇':color===c?'✓':'●'}</button>)}</div>
    <div className="batch-pixels" role="group" aria-label="我的小画板" onPointerDown={event=>{if(disabled)return;event.preventDefault();drawing.current=true;event.currentTarget.setPointerCapture(event.pointerId);point(event);}} onPointerMove={event=>{if(drawing.current)point(event);}} onPointerUp={()=>{if(drawing.current){drawing.current=false;save(draft.current);}}} onPointerCancel={()=>{if(drawing.current){drawing.current=false;save(draft.current);}}}>{[...cells].map((c,index)=><button type="button" key={index} className={`ink-${c}`} disabled={disabled} aria-label={`画格${index+1}`} onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();paint(index);save(draft.current);}}} />)}</div>
    <button className="batch-small" disabled={disabled||cells===blank} onClick={()=>{draft.current=blank;setCells(blank);save(blank);}}>↶ 重新画</button>
  </div>;
}

export function BatchTwoLearningGame({activity:a,session,busy:appBusy,playing,onAction,onHome,onPause,stopAudio}:Props) {
  const [oralBusy,setOralBusy]=useState(false),[oralReady,setOralReady]=useState(false),[oralSkipped,setOralSkipped]=useState(false);
  const busy=appBusy||oralBusy;
  const saved=session.activityStates?.[a.id]??{},scene=session.activityStates?.[`${a.wordId}:sound`];
  const state=a.kind==='associate'&&a.step==='recall'&&!saved.selectedIds&&scene?.composed ? {...saved,selectedIds:scene.selectedIds,composed:true} : saved;
  const accepted=gameAccepted(state),locked=busy||accepted;
  const chosen=state.selectedIds??[],heard=!!state.heard,painted=!!state.drawing&&/[1-4]/.test(state.drawing);
  const audio=<button className={`game-audio ${playing?'is-playing':''}`} disabled={locked} onClick={()=>onAction('listen')} aria-label={`${activityTitles[a.kind]}：听英文`}><GameSoundIcon/><span>{playing?'正在播放':pairedGame(a.kind)?'听两个单词':heard?'再听一遍':'听一听'}</span></button>;
  const image=(word:GameWord,className='')=><img className={className} src={word.imageUrl} alt={word.meaning}/>;
  const pictures=(action:ActivityAction='choose',multiple=false)=><div className="game-picture-choices batch-choices" role="group" aria-label="选择图片">{a.choices.map(word=><button key={word.id} className={`game-picture ${chosen.includes(word.id)?'is-picked':''} ${state.selectedId===word.id?(state.outcome==='correct'?'is-correct':'is-retry'):''}`} disabled={locked||!heard||multiple&&chosen.length===2&&!chosen.includes(word.id)||a.kind==='queue'&&chosen.includes(word.id)} onClick={()=>onAction(action,word.id)} aria-label={`选择${word.meaning}`} aria-pressed={multiple?chosen.includes(word.id):undefined}>{image(word)}{multiple&&chosen.includes(word.id)&&<span className="game-picture-mark">✓</span>}</button>)}</div>;
  const sounds=<div className="extra-sound-options" role="group" aria-label="声音选项">{a.choices.map((word,index)=><div key={word.id} className={`extra-sound-row ${state.selectedId===word.id&&state.outcome==='correct'?'is-correct':''}`}><button disabled={locked||a.kind==='peek'&&!state.uncoveredTiles?.length} onClick={()=>onAction('listen-option',word.id)} aria-label={`听声音${index+1}`}><span aria-hidden="true">♫</span>声音 {index+1}</button><button disabled={locked||!state.heardOptionIds?.includes(word.id)} onClick={()=>onAction('choose',word.id)} aria-label={`选择声音${index+1}`}>选这个</button></div>)}</div>;
  const selfFinish=['draw','mimic','quiz'].includes(a.kind)&&state.revealed||a.kind==='associate'&&(a.step==='sound'?state.composed:state.revealed);
  const group=session.activities?.filter(item=>item.kind===a.kind&&item.groupId===a.groupId)??[];
  const trail=group.filter(item=>activityDone(session,item)).map(item=>item.routeCells?.[item.choices.findIndex(word=>word.id===item.wordId)]).filter(cell=>cell!==undefined);
  const pawn=state.outcome==='correct'&&a.kind==='route'?a.routeCells![a.choices.findIndex(word=>word.id===a.wordId)]:a.routeStart;
  const primary=accepted?{label:'继续冒险',action:()=>onAction('next')}:
    pairedGame(a.kind)&&chosen.length===2?{label:a.kind==='queue'?'检查顺序':'放入收集篮',action:()=>onAction('submit')}:
    a.kind==='letter-path'&&state.letterPath?.length===a.word.term.length?{label:'检查拼写',action:()=>onAction('submit')}:
    selfFinish?{label:'我练过啦',action:()=>onAction('finish')}:
    a.kind==='draw'&&painted&&!state.revealed?{label:'打开图片核对',action:()=>onAction('compare')}:
    a.kind==='mimic'&&heard&&!state.revealed?{label:'看看动作图',action:()=>onAction('reveal')}:
    a.kind==='associate'&&a.step==='sound'&&chosen.length===2&&!state.composed?{label:'记住这个场景',action:()=>onAction('compose')}:
    a.kind==='quiz'&&!state.handedOver?{label:painted?'交给家长猜':'用手势出题',action:()=>onAction('hand-over',painted?'drawing':'gesture')}:
    a.kind==='quiz'&&state.handedOver&&!state.revealed?{label:'一起揭晓',action:()=>onAction('reveal')}:undefined;
  return <main className={`lesson-page game-page batch-page batch-${a.kind}`}>
<LearningTopbar session={session} onHome={onHome} onPause={onPause} />
    <div className="lesson-guide"><Mascot small character={companionFor(session.id,Math.max(0,session.activities?.findIndex(item=>item.id===a.id)??0))}/><h1>{activityTitles[a.kind]}</h1></div>
    <section className="game-stage batch-stage" aria-label={activityTitles[a.kind]}>
      {pairedGame(a.kind)&&<><p className="game-prompt">{a.kind==='queue'?'按听到的顺序，选出两张图':'找出刚才听到的两个朋友'}</p>
        <div className="pair-workspace"><aside className={`pair-listen ${heard?'has-listened':''}`} aria-label="听音区"><span className="pair-eyebrow">先听一听</span>{audio}<span className="pair-sound-waves" aria-hidden="true"><i/><i/><i/><i/><i/></span><p>{heard?'没听清，可以再听一次':'不着急，听完再选'}</p></aside>
        <div className="pair-answer-area"><div className="pair-answer-heading"><span>{a.kind==='queue'?'排好它们的位置':'装进小小收集篮'}</span>{chosen.length>0&&!accepted&&<button className="pair-undo" disabled={busy} onClick={()=>onAction('undo')} aria-label="撤回一张">↶ <span>撤回</span></button>}</div>
        <div className={`batch-slots ${a.kind==='collect'?'batch-basket':''}`} aria-label={a.kind==='queue'?'第一、第二位置':'两个目标的收集篮'}>{[0,1].map(index=><div className={chosen[index]?'is-filled':heard&&chosen.length===index?'is-waiting':''} key={index}><span aria-hidden="true">{a.kind==='queue'?index+1:'✓'}</span>{chosen[index]?image(a.choices.find(word=>word.id===chosen[index])!):<b aria-hidden="true">{a.kind==='queue'?'＋':'◇'}</b>}</div>)}</div>
        {pictures('pick',true)}</div></div>
      </>}
      {a.kind==='switch'&&<><div className="batch-direction" aria-label={a.direction==='hear-picture'?'听声音选图片':'看图片选声音'}><span>{a.direction==='hear-picture'?'♫':'▧'}</span> → <span>{a.direction==='hear-picture'?'▧':'♫'}</span></div><p className="game-prompt">{a.direction==='hear-picture'?'这一回，听声音找图片':'换个方向，看图片找声音'}</p>{a.direction==='hear-picture'?<>{audio}{pictures()}</>:<><div className="batch-main-picture">{image(a.word)}</div>{sounds}</>}</>}
      {a.kind==='peek'&&<><p className="game-prompt">揭开一小块，想想它的英文</p><div className="batch-peek" aria-label="四块遮挡图片">{[0,1,2,3].map(index=><button key={index} disabled={locked||state.uncoveredTiles?.includes(index)} onClick={()=>onAction('uncover',String(index))} aria-label={`揭开第${index+1}块`}>{state.uncoveredTiles?.includes(index)?<img src={a.word.imageUrl} alt="已揭开的图片局部" style={{left:index%2?'-100%':'0',top:index>1?'-100%':'0'}}/>:<span aria-hidden="true">✦</span>}</button>)}</div>{sounds}</>}
      {a.kind==='draw'&&<><p className="game-prompt">{state.revealed?'把自己的小画，和词义图比一比':'听英文，用小画画出它的意思'}</p>{!state.revealed&&audio}<div className={`batch-draw-area ${state.revealed?'is-comparing':''}`}><PixelSketch key={a.id} value={state.drawing} disabled={locked||!heard||!!state.revealed} save={value=>onAction('draw',value)}/>{state.revealed&&<div className="batch-main-picture">{image(a.word)}</div>}</div></>}
      {a.kind==='mimic'&&<><p className="game-prompt">{state.revealed?'看看词义图，和刚才的动作比一比':'听英语，自己做做这个动作'}</p>{state.revealed?<div className="batch-main-picture">{image(a.word)}</div>:<div className="batch-motion" aria-hidden="true">♫ <span>✋</span> ✦</div>}{audio}<p className="batch-note">坐着用手势也可以</p></>}
      {a.kind==='associate'&&<><p className="game-prompt">{a.step==='sound'?'给这个词选个伙伴，搭一个小场景':state.revealed?'听听圈出的词，和自己说的比一比':'又见到这个场景，圈出的词怎么说？'}</p><div className={`batch-scene ${state.composed?'is-built':''}`}><span className="batch-scene-sun" aria-hidden="true">☀</span>{image(a.word,'batch-sticker first')}{chosen[1]&&image(a.choices.find(word=>word.id===chosen[1])!,'batch-sticker second')}<span className="batch-scene-ground" aria-hidden="true"/></div>
        {a.step==='sound'&&!state.composed&&<><div className="batch-companions" aria-label="选择场景伙伴">{a.choices.filter(word=>word.id!==a.wordId).map(word=><button className={`game-picture ${chosen[1]===word.id?'is-picked':''}`} disabled={locked} key={word.id} onClick={()=>onAction('pick',word.id)} aria-label={`搭配${word.meaning}`}>{image(word)}</button>)}</div></>}
        {a.step==='sound'&&state.composed&&<p className="batch-note">先把场景放在心里，过一会儿再来找它</p>}
        {a.step==='recall'&&state.composed&&<OralPractice target={{sessionId:session.id,planVersion:session.learningPolicy?.version??1,activityId:a.id}} active={!appBusy} busy={appBusy} stopAudio={stopAudio} onReady={setOralReady} onBusy={setOralBusy} onSkip={()=>setOralSkipped(true)} compact={!!state.revealed}/>}
        {a.step==='recall'&&state.composed&&<button className="game-audio" disabled={busy||!state.revealed&&(accepted||!oralReady&&!oralSkipped)} onClick={()=>onAction('reveal')}>♫ {state.revealed?'再听这个词':'我想过啦，听听这个词'}</button>}
      </>}
      {a.kind==='quiz'&&<><p className="game-prompt">{state.revealed?'一起揭开谜底，听听这个词':state.handedOver?'请家长看线索，猜猜是哪一个':'偷偷看这个词，画线索或用手势出题'}</p>{!state.handedOver&&<div className="batch-main-picture batch-secret">{image(a.word)}<span aria-hidden="true">✦</span></div>}
        {!state.handedOver?<><PixelSketch key={a.id} value={state.drawing} disabled={locked} save={value=>onAction('draw',value)}/></>:state.revealed?<div className="batch-main-picture">{image(a.word)}<span>{a.word.term}</span></div>:<>{painted?<PixelSketch value={state.drawing} disabled save={()=>{}}/>:<div className="batch-motion" aria-label="用动作给家长出题">✋ ··· ?</div>}<div className="game-picture-choices batch-choices" aria-label="家长猜一猜">{a.choices.map(word=><button key={word.id} className={`game-picture ${state.guessId===word.id?'is-picked':''}`} disabled={locked} onClick={()=>onAction('guess',word.id)} aria-label={`猜${word.meaning}`}>{image(word)}</button>)}</div></>}
      </>}
      {a.kind==='route'&&<><p className="game-prompt">听目标词，沿相邻图片继续走</p>{audio}<div className="batch-route" aria-label="词义路线棋盘">{Array.from({length:25},(_,cell)=>{const index=a.routeCells!.indexOf(cell),word=a.choices[index];return word?<button className={`batch-route-tile ${pawn===cell?'is-pawn':''}`} key={cell} disabled={locked||!heard} onClick={()=>onAction('choose',word.id)} aria-label={`走到${word.meaning}`}>{image(word)}{pawn===cell&&<b aria-hidden="true">★</b>}</button>:<div key={cell} className={`batch-route-tile is-stone ${pawn===cell?'is-pawn':''} ${trail.includes(cell)?'is-trail':''}`} aria-label={pawn===cell?'现在的位置':undefined}>{pawn===cell?'★':trail.includes(cell)?'·':''}</div>;})}</div></>}
      {a.kind==='letter-path'&&<><p className="game-prompt">听单词，连起相邻的字母</p>{audio}<div className="batch-spelling" aria-label="已经连出的字母">{(state.letterPath??[]).map(cell=>a.letterGrid![cell]).join('')||'···'}</div><div className="batch-letter-board" role="group" aria-label="字母路径棋盘">{[...a.letterGrid!].map((letter,cell)=><button key={cell} className={(state.letterPath??[]).includes(cell)?'is-picked':''} disabled={locked||!heard||(state.letterPath??[]).includes(cell)||!!state.letterPath?.length&&!adjacentCell(state.letterPath.at(-1)!,cell)} onClick={()=>onAction('letter',String(cell))} aria-label={`字母格${cell+1}，${letter}`}>{letter}</button>)}</div><div className="batch-actions"><button className="batch-small" disabled={locked||!state.letterPath?.length} onClick={()=>onAction('undo')}>↶ 撤回一步</button></div></>}
      <div className={`game-feedback ${state.outcome?'has-feedback':''}`} role="status" aria-live="polite">{state.outcome==='try'?'再听一遍，慢慢来':accepted?state.outcome==='practice'?'练习记好啦':'找对啦！':''}</div>
      <GameActionBar busy={busy} accepted={accepted} onSkip={()=>onAction('skip')} primary={primary}/>
    </section>
  </main>;
}
