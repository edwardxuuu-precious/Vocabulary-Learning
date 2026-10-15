import { useMemo, useState } from 'react';
import type { AppState } from '../shared/contracts';
import { dailyLearningPlan, wordLearningOverview, type summarizeSkill } from '../shared/learning';
import { sessionTaskProgress } from './learning-session';

function SkillObservation({ result }: { result: ReturnType<typeof summarizeSkill> }) {
  if (!result.attempts) return <span className="observation-empty">尚未练习</span>;
  if (!result.independent) return <><strong>练习过</strong><small>暂无独立答对记录</small></>;
  return <><strong>{result.independentDays > 1 ? '跨天独立答对' : '独立答对'}</strong><small>{result.independent} 次 · {result.independentDays} 天</small></>;
}

const dueDate = (time: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(time);

export function LearningOverview({ state }: { state: AppState }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'due' | 'practiced'>('all');
  const rows = useMemo(() => wordLearningOverview(state), [state]);
  const plan = useMemo(() => dailyLearningPlan(state), [state]);
  const currentTasks = state.activeSession ? sessionTaskProgress(state.activeSession) : null;
  const shown = rows.filter(row => (filter === 'all' || (filter === 'due' ? row.due : row.total > 0)) && `${row.word.term} ${row.word.meaning}`.toLowerCase().includes(query.trim().toLowerCase()));
  const showSpelling = state.settings.spellingEnabled || state.attempts.some(attempt => attempt.skill === 'spell');
  return <section className="parent-panel learning-overview" aria-labelledby="learning-overview-title">
    <div className="panel-heading"><div><h2 id="learning-overview-title">每个单词，练到哪一步了</h2><p className="muted">听辨、看图回忆分别查看，练习完成不等于已经掌握。</p></div></div>
    <div className="learning-statistics">
      <div><span>练习过的词</span><strong>{rows.filter(row => row.total > 0).length}</strong></div>
      <div><span>有独立答对记录</span><strong>{rows.filter(row => row.listen.independent || row.recall.independent || row.spell.independent).length}</strong></div>
      <div><span>到期待复习</span><strong>{rows.filter(row => row.due).length}</strong></div>
    </div>
    <div className="review-plan-summary"><h3>每日任务量</h3>{currentTasks && <p>本轮固定 {currentTasks.total} 个小任务，已完成 {currentTasks.completed} 个；设置变化不改写本轮计划。</p>}<p>新一轮参考：复习 {plan.review.length} 个旧词、新学 {plan.fresh.length} 个词，共 {plan.taskCount} 个小任务，估计 {plan.estimatedMinutes} 分钟。按当前 {state.settings.sessionMinutes} 分钟设置，上限为 {plan.taskLimit} 个小任务。</p>{plan.reductionReason && <p>{plan.reductionReason === 'backlog' ? '待复习旧词较多，已自动减少新词，先巩固。' : '为控制本轮任务量，已减少新词。'}本次新词上限 {plan.newWordLimit} 个。{plan.deferredReviewCount > 0 && `还有 ${plan.deferredReviewCount} 个旧词留待后续安排。`}</p>}</div>
    <p className="panel-footnote">“独立答对”表示该次练习未使用提示，不代表长期掌握。“跨天独立答对”表示同一技能在不同日期有独立答对记录。跟读和跳过仅记练习；未启用的口头回忆不计入当前待复习数。纯跟练的词会在之后安排听辨检查。</p>
    <div className="learning-filters"><label htmlFor="learning-search">查找单词<input id="learning-search" type="search" placeholder="英文或中文" value={query} onChange={event => setQuery(event.target.value)} /></label><div role="group" aria-label="筛选学习记录">{([{ id: 'all', label: '全部单词' }, { id: 'practiced', label: '练习过' }, { id: 'due', label: '待复习' }] as const).map(item => <button key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div></div>
    <p className="learning-table-hint">左右滑动表格，查看完整学习记录。</p>
    <div className="learning-table-wrap" role="region" aria-label="逐词学习记录" tabIndex={0}><table className="learning-table"><thead><tr><th scope="col">单词</th><th scope="col">听音辨认</th><th scope="col">看图回忆</th>{showSpelling && <th scope="col">拼写</th>}<th scope="col">练习记录</th><th scope="col">复习安排</th></tr></thead><tbody>{shown.map(row => <tr key={row.word.id}>
      <th scope="row"><strong>{row.word.term}</strong><small>{row.word.meaning}</small>{row.historicalTotal > 0 && <small>旧义项历史 {row.historicalTotal} 次</small>}{!row.available && <small>未启用或图片待准备</small>}</th>
      <td><SkillObservation result={row.listen} /></td><td><SkillObservation result={row.recall} /></td>{showSpelling && <td><SkillObservation result={row.spell} /></td>}
      <td><strong>{row.total} 次尝试</strong><small>有提示答对 {row.hintedCorrect} 次</small><small>跟练 / 体验 {row.practiceOnly} 次</small></td>
      <td>{!row.available ? <span className="observation-empty">暂不进入学习</span> : row.nextDue === undefined ? '开始练习后安排' : <><strong className={row.due ? 'review-due' : ''}>{row.due ? '待复习' : '下次复习'}</strong><small>{dueDate(row.nextDue)}</small></>}</td>
    </tr>)}</tbody></table></div>
    {!shown.length && <p className="empty-text">{rows.length ? '没有符合条件的单词。' : '还没有词表，请先在词书工坊导入。'}</p>}
    <p className="panel-footnote">复习日期使用与今日调度相同的计算；旧词只练到期技能。每日最多复习 {state.settings.dailyReviewWords} 个词，并受小任务上限约束，到期较早的优先。未启用的词书与待审核图片不进入今日安排。原始历史会随备份保存。</p>
  </section>;
}
