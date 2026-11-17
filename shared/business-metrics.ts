/** business-metrics-v1: projections only. Collection and authorization belong to their workflows. */
export const businessMetricVersion = 'business-metrics-v1';
const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
function unique<T extends { id: string }>(rows: readonly T[]): T[] {
  const byId = new Map<string,T>();
  for (const row of rows) {
    if (!row.id) throw new Error('观察缺少稳定ID');
    const prior = byId.get(row.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error(`同一观察版本冲突：${row.id}`);
    byId.set(row.id,row);
  }
  return [...byId.values()];
}

export interface OpportunityFact {
  id: string;
  eligibility: 'eligible' | 'ineligible' | 'unknown';
  voluntary: boolean | null;
  stepByStepHelp: boolean | null;
  completed: boolean | null;
  end: 'completed' | 'rest' | 'refused' | 'device' | 'unknown';
}
export function summarizeK1(facts: readonly OpportunityFact[]) {
  const rows=unique(facts), eligible=rows.filter(row=>row.eligibility==='eligible');
  const numerator=eligible.filter(row=>row.voluntary===true&&row.stepByStepHelp===false&&row.completed===true&&row.end==='completed').length;
  return { version:businessMetricVersion, numerator, denominator:eligible.length, rate:ratio(numerator,eligible.length),
    excluded:rows.filter(row=>row.eligibility==='ineligible').length, eligibilityUnknown:rows.filter(row=>row.eligibility==='unknown').length,
    missing:eligible.filter(row=>row.voluntary===null||row.stepByStepHelp===null||row.completed===null||row.end==='unknown').length,
    started:eligible.filter(row=>row.voluntary===true).length,
    rest:eligible.filter(row=>row.end==='rest').length, refused:eligible.filter(row=>row.end==='refused').length,
    deviceFailures:eligible.filter(row=>row.end==='device').length };
}

export type ProbeDirection = 'listen' | 'recognize' | 'read' | 'recall';
export interface ProbeFact {
  /** One frozen first probe, not one row per retry or per review. */
  id: string;
  wordId: string;
  learningVersion: number;
  direction: ProbeDirection;
  interval: 'next-day' | 'day-7';
  outcome: 'correct' | 'incorrect' | 'helped' | 'unconfirmed' | 'missing' | 'skipped' | 'unavailable';
  authority: 'objective' | 'parent' | 'practice';
  evidenceId?: string;
}
export function summarizeK2(facts: readonly ProbeFact[]) {
  const rows=unique(facts), groups=new Map<string,ProbeFact[]>(), targets=new Set<string>();
  for (const row of rows) {
    if (!row.wordId || !Number.isInteger(row.learningVersion) || row.learningVersion<0) throw new Error('探测缺少词义版本');
    const key=`${row.interval}:${row.direction}`;
    const target=JSON.stringify([key,row.wordId]);
    if (targets.has(target)) throw new Error('同一轮探测按冻结义项取首次；重试或换版本不能重复计入分母');
    targets.add(target);
    groups.set(key,[...(groups.get(key)??[]),row]);
  }
  return [...groups].map(([scope,probes])=>{
    const status=(row:ProbeFact)=>{
      if (!['correct','incorrect'].includes(row.outcome)) return row.outcome;
      const authorized=(row.direction==='read'||row.direction==='recall')?row.authority==='parent':row.authority!=='practice';
      return authorized&&row.evidenceId?row.outcome:'unconfirmed';
    };
    const counts={correct:0,incorrect:0,helped:0,unconfirmed:0,missing:0,skipped:0,unavailable:0};
    for (const probe of probes) counts[status(probe)]++;
    const denominator=counts.correct+counts.incorrect+counts.helped;
    return { version:businessMetricVersion, scope, numerator:counts.correct, denominator, planned:probes.length,
      rate:ratio(counts.correct,denominator), coverage:ratio(denominator,probes.length), ...counts };
  });
}

export interface ParentEffortFact {
  id: string;
  plannedWords: number;
  deliveredWords: number;
  completeCycle: boolean;
  activeMinutes: { preparation:number|null; repair:number|null; guidance:number|null; review:number|null };
  waitingMinutes: number | null;
}
/** Return one cohort at a time. Partial cohorts cannot be silently pooled with full cycles. */
export function summarizeK3(fact: ParentEffortFact) {
  if (!fact.id||!Number.isInteger(fact.plannedWords)||!Number.isInteger(fact.deliveredWords)
    ||fact.plannedWords<0||fact.deliveredWords<0||fact.deliveredWords>fact.plannedWords) throw new Error('投入范围无效');
  const values=Object.values(fact.activeMinutes);
  if ([...values,fact.waitingMinutes].some(value=>value!==null&&(!Number.isFinite(value)||value<0))) throw new Error('主动/等待分钟无效');
  const missing=values.filter(value=>value===null).length;
  const activeMinutes=missing?null:values.reduce<number>((sum,value)=>sum+value!,0);
  return { version:businessMetricVersion, cohort:fact.id, plannedWords:fact.plannedWords, deliveredWords:fact.deliveredWords,
    missingCategories:missing, completeCycle:fact.completeCycle, activeMinutes, waitingMinutes:fact.waitingMinutes,
    minutesPerTen:activeMinutes===null||!fact.completeCycle||!fact.deliveredWords?null:activeMinutes/fact.deliveredWords*10 };
}
