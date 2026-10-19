import type { ActivityAction, ActivityState, LearningActivity, LearningSession, LearningStep, LearningTask, MemoryLoopPolicy } from './contracts.ts';
import { pairedGame } from './game-boards.ts';

/** A small, familiar pool; the complete registry remains available to classic sessions. */
export const memoryLoopKinds = ['supply', 'flip', 'gate', 'portal', 'switch'] as const;
const newOrder: LearningStep[] = ['learn', 'listen', 'recognize', 'recall', 'sound', 'read', 'spell'];

export function memoryLoopTasks(tasks: LearningTask[]): LearningTask[] {
  return tasks.map(task => ({ ...task, steps: task.mode === 'new'
    ? [...task.steps].sort((a, b) => newOrder.indexOf(a) - newOrder.indexOf(b))
    : [...task.steps.filter(step => step === 'recall'), ...task.steps.filter(step => step !== 'recall')] }));
}

/** Reorder existing atomic goals; never drop a target or borrow unselected example words. */
export function arrangeMemoryLoop(tasks: LearningTask[], activities: LearningActivity[]): LearningActivity[] {
  const rows: LearningActivity[] = [];
  const byId = new Map(activities.map(a=>[a.id,a]));
  const target = (wordId:string,step:LearningStep) => {const a=byId.get(`${wordId}:${step}`);return a?[a]:[];};
  const review = tasks.filter(task => task.mode === 'review');
  // Recall across review words before their audio/word-form answers are presented.
  for (const task of review) rows.push(...target(task.wordId,'recall'));
  for (const task of review) for (const step of task.steps.filter(s => s !== 'recall')) rows.push(...target(task.wordId,step));
  const fresh = tasks.filter(task => task.mode === 'new');
  for (let start = 0; start < fresh.length; start += 2) {
    const group = fresh.slice(start, start + 2);
    for (const step of newOrder) {
      const members = group.flatMap(task => target(task.wordId,step));
      // Avoid an immediate same-word replay at the boundary between recognition and retrieval.
      if (step === 'recall' && members.length > 1 && rows.at(-1)?.wordId === members[0]?.wordId) members.push(members.shift()!);
      rows.push(...members);
    }
  }
  // Assessment-directed practice retains its original ordering if a future step is added.
  const scheduled = new Set(rows.map(a=>a.id));
  for (const activity of activities) if (!scheduled.has(activity.id)) rows.push(activity);
  return rows.map(a => a.step === 'recall' ? { id:a.id, wordId:a.wordId, step:a.step, kind:'portal', word:a.word, choices:[] } : a);
}

export function freezeMemoryLoop(activities: LearningActivity[]): MemoryLoopPolicy {
  const checkpoints: string[] = [];
  let count = 0;
  for (let index = 0; index < activities.length - 1; index++) {
    count++;
    const activity = activities[index], next = activities[index + 1];
    if (count >= 8 && !(pairedGame(activity.kind) && activity.kind === next.kind && activity.groupId === next.groupId)) {
      checkpoints.push(activity.id); count = 0;
    }
  }
  return { version:1, kind:'memory-loop', segmentSize:8, checkpoints };
}

export const memoryLoopSession = (session: LearningSession | null | undefined) => session?.learningPolicy?.kind === 'memory-loop';
export const recallFirstActivity = (session: LearningSession, activity: LearningActivity) => memoryLoopSession(session) && activity.step === 'recall' && activity.kind === 'portal';
export function pendingLearningCheckpoint(session: LearningSession) {
  const id=session.learningPolicy?.checkpoints[session.acknowledgedCheckpoints?.length??0];
  const a=id&&session.activities?.find(item=>item.id===id);
  return a&&session.completedSteps?.[a.wordId]?.includes(a.step)?id:undefined;
}
export function learningSegmentProgress(session: LearningSession) {
  if (!session.learningPolicy || !session.activities) return null;
  const boundary = pendingLearningCheckpoint(session);
  const acknowledged = session.acknowledgedCheckpoints ?? [];
  const startId = acknowledged.at(-1);
  const start = startId ? session.activities.findIndex(a => a.id === startId) + 1 : 0;
  const nextId = boundary ?? session.learningPolicy.checkpoints[acknowledged.length];
  const end = nextId ? session.activities.findIndex(a => a.id === nextId) + 1 : session.activities.length;
  const rows = session.activities.slice(start, end);
  return { number:acknowledged.length+1, total:rows.length, completed:rows.filter(a=>session.completedSteps?.[a.wordId]?.includes(a.step)).length, activities:rows, checkpointId:boundary };
}

/** Oral participation stays ungraded; the server separately checks private audio before finish. */
export function transitionMemoryRecall(previous: ActivityState, action: ActivityAction) {
  const state: ActivityState = {...previous};
  if (state.outcome === 'practice') {
    if (action === 'next') return {state, complete:true};
    return {state};
  }
  if (action === 'reveal') { state.revealed=true; state.hinted=true; delete state.audioUnavailable; }
  else if (action === 'audio-failed' && state.revealed) { state.audioUnavailable=true; state.hinted=true; }
  else if (action === 'finish' || action === 'skip') {
    state.outcome='practice';
    if (action === 'skip') state.hinted=true;
    return {state, attempt:{correct:false, hinted:!!state.hinted, practiceOnly:true, key:action==='finish'?'goal-recorded':'goal-skipped'}};
  } else throw new Error('先自己试一试，需要时可以听示范或跳过。');
  return {state};
}

export function validMemoryLoopPolicy(session: LearningSession): boolean {
  const p=session.learningPolicy;
  if (p===undefined) return session.acknowledgedCheckpoints===undefined;
  if (!p || p.version!==1 || p.kind!=='memory-loop' || p.segmentSize!==8 || !session.activities || Object.keys(p).some(k=>!['version','kind','segmentSize','checkpoints'].includes(k))) return false;
  if (!Array.isArray(p.checkpoints) || !session.tasks || session.activities.some(a=>a.step==='recall'&&(a.kind!=='portal'||a.choices.length!==0))) return false;
  if (JSON.stringify(session.tasks)!==JSON.stringify(memoryLoopTasks(session.tasks))) return false;
  if (session.activities.map(a=>a.id).join('|')!==arrangeMemoryLoop(session.tasks,session.activities).map(a=>a.id).join('|')) return false;
  if (JSON.stringify(p.checkpoints)!==JSON.stringify(freezeMemoryLoop(session.activities).checkpoints)) return false;
  const ack=session.acknowledgedCheckpoints??[];
  if (!Array.isArray(ack) || ack.some((id,i)=>id!==p.checkpoints[i])) return false;
  const completed=session.activities.filter(a=>session.completedSteps?.[a.wordId]?.includes(a.step));
  const current=completed.length;
  const completedIds=new Set(completed.map(a=>a.id));
  if (ack.some(id=>!completedIds.has(id))) return false;
  const firstPending=p.checkpoints[ack.length];
  return !firstPending || current<=session.activities.findIndex(a=>a.id===firstPending)+1;
}

export function learningDecisionReason(session:LearningSession, activity:LearningActivity):string {
  if (!memoryLoopSession(session)) return '按原轮次计划继续';
  if (activity.step==='learn') return '先认识含义和发音';
  if (activity.step==='recall') return session.tasks?.find(t=>t.wordId===activity.wordId)?.mode==='review'?'隔天再想一次，需要时再听示范':'穿插练习后，试着自己想起英文';
  if (activity.step==='read') return '把熟悉的声音和英文词形连起来';
  return activity.step==='recognize'?'看看英文，认出意思':'用熟悉的操作，再练一练';
}
