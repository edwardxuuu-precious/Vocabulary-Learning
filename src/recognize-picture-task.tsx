import type { GameWord } from '../shared/contracts';
import { visualTheme } from '../shared/visual-theme';
import './recognize-picture-task.css';

export type PictureAnswer = { selectedId?: string; outcome: 'retry' | 'correct' | 'skipped' };

function Icon({ name }: { name: 'home' | 'pause' | 'help' | 'hint' | 'arrow' | 'check' | 'retry' }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {name === 'home' ? <><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></> : name === 'pause' ? <path d="M8 5v14M16 5v14"/> : name === 'help' ? <><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/></> : name === 'hint' ? <><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/></> : name === 'check' ? <path d="m5 12 4 4L20 5"/> : name === 'retry' ? <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></> : <path d="M4 12h16m-6-6 6 6-6 6"/>}
  </svg>;
}

export function PictureRecognitionTask({ word, choices, answer, hinted, completed, total, onChoose, onContinue, onHint, onSkip, onHome, onPause, onHelp }: {
  word: GameWord; choices: GameWord[]; answer?: PictureAnswer; hinted: boolean; completed: number; total: number;
  onChoose: (id: string) => void; onContinue: () => void; onHint: () => void; onSkip: () => void;
  onHome: () => void; onPause: () => void; onHelp: () => void;
}) {
  const finished = answer?.outcome === 'correct' || answer?.outcome === 'skipped';
  return <main className="picture-task">
    <nav className="picture-nav" aria-label="学习导航">
      <button className="picture-nav-home" onClick={onHome}><Icon name="home"/><span>回大厅</span></button>
      <div className="picture-progress" aria-label={`本小段已完成${completed}题，共${total}题`}>
        <div className="picture-progress-track" role="progressbar" aria-label="本小段进度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
          {Array.from({ length: total }, (_, index) => <span key={index} className={index < completed ? 'is-done' : index === completed ? 'is-current' : ''}/>)}
        </div>
        <span><strong>{completed}</strong> / {total}</span>
      </div>
      <div className="picture-nav-tools"><button onClick={onHelp} aria-label="操作帮助"><Icon name="help"/><span>帮助</span></button><button onClick={onPause}><Icon name="pause"/><span>休息</span></button></div>
    </nav>

    <section className="picture-question" aria-labelledby="picture-instruction picture-word">
      <header className="picture-question-heading">
        <div className="picture-word-area"><h1 id="picture-instruction">看英文，选图片</h1><p id="picture-word" lang="en">{word.term}</p></div>
        <img className="picture-companion" src={visualTheme.characters.optimus.image} alt="" aria-hidden="true" draggable={false}/>
      </header>
      <div className={`picture-options${finished ? ' is-finished' : ''}`}>
        {choices.map((choice, index) => {
          const selected = answer?.selectedId === choice.id;
          const state = selected ? answer?.outcome : undefined;
          return <button key={choice.id} className={`picture-option${state ? ` is-${state}` : ''}`} aria-label={`选择第${index + 1}张图片：${choice.meaning}`} disabled={finished} onClick={() => onChoose(choice.id)}>
            <img src={choice.imageUrl} alt="" draggable={false}/>
            {state && <span className="picture-option-result"><Icon name={state === 'correct' ? 'check' : 'retry'}/>{state === 'correct' ? '选对了' : '再试试'}</span>}
          </button>;
        })}
      </div>
      <div className={`picture-response${answer ? ` is-${answer.outcome}` : ''}`}>
        <div className="picture-response-message" role="status" aria-live="polite">
          {answer?.outcome === 'correct' ? <><span className="picture-response-icon"><Icon name="check"/></span><div><strong>{hinted ? '跟着提示找到了' : '选对了！'}</strong><p><span lang="en">{word.term}</span><span className="picture-meaning-divider">·</span>{word.meaning}</p></div></> : answer?.outcome === 'skipped' ? <strong>先跳过这个词</strong> : answer?.outcome === 'retry' ? <><Icon name="retry"/><div><strong>再看一看，换一张试试</strong>{hinted && <p>意思是：{word.meaning}</p>}</div></> : hinted ? <p>意思是：<strong>{word.meaning}</strong></p> : null}
        </div>
        {finished && <button className="picture-continue" onClick={onContinue}>继续<Icon name="arrow"/></button>}
      </div>
      {!finished && <div className="picture-support"><button className="picture-skip" onClick={onSkip}>先跳过<Icon name="arrow"/></button><button className="picture-hint" onClick={onHint} disabled={hinted}><Icon name="hint"/>{hinted ? '提示已打开' : '看提示'}</button></div>}
    </section>
  </main>;
}
