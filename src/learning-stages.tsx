import './learning-stages.css';

export function LearningStages({stage}:{stage:'words'|'usage'|'complete'}){
  const current=['words','usage','complete'].indexOf(stage);
  return <ol className="learning-stages" aria-label="学习环节">{['单词练习','短句用法','学习完成'].map((label,index)=><li key={label} className={index<current?'is-done':index===current?'is-current':''} aria-current={index===current?'step':undefined}><span aria-hidden="true">{index<current?'✓':index+1}</span><strong>{label}</strong></li>)}</ol>;
}
