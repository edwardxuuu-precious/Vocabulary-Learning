import type { AppState } from '../shared/contracts';
import { pendingLearningCheckpoint } from '../shared/learning-policy';

type CheckpointRequest = { sessionId: string; checkpointId: string; planVersion: number };

/** Acknowledge completed boundaries without changing the frozen teaching plan or learning evidence. */
export async function continueLearningTask(
  snapshot: AppState,
  acknowledge: (request: CheckpointRequest) => Promise<AppState>,
  canContinue: () => boolean = () => true,
): Promise<AppState> {
  const sessionId = snapshot.activeSession?.id;
  const acknowledged = new Set<string>();
  let next = snapshot;
  while (canContinue()) {
    const session = next.activeSession;
    if (!session || session.id !== sessionId || session.completedAt || session.suspendedAt) break;
    const checkpointId = pendingLearningCheckpoint(session);
    if (!checkpointId) break;
    if (acknowledged.has(checkpointId)) throw new Error('下一步还没接上，请重试。');
    acknowledged.add(checkpointId);
    next = await acknowledge({ sessionId: session.id, checkpointId, planVersion: session.learningPolicy!.version });
  }
  return next;
}
