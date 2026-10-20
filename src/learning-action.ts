import type { ActivityAction, AppState } from '../shared/contracts';
import { currentActivity } from '../shared/game-plan';

type Request = { planVersion?:1|2|3; sessionId: string; activityId: string; action: ActivityAction; selectedId?: string };

/** Continue only after the server has saved this activity's actual result. */
export async function submitLearningAction(request: Request, {
  submit, update, advance = false, isActive = () => true,
}: {
  submit: (request: Request) => Promise<AppState>;
  update: (state: AppState) => void;
  advance?: boolean;
  isActive?: () => boolean;
}) {
  let state = await submit(request);
  update(state);
  let advanced = request.action === 'next';
  const session = state.activeSession;
  const outcome = session?.activityStates?.[request.activityId]?.outcome;
  if ((advance || request.action === 'skip') && isActive() && session?.id === request.sessionId
    && currentActivity(session)?.id === request.activityId && (outcome === 'correct' || outcome === 'practice')) {
    state = await submit({ sessionId: request.sessionId, activityId: request.activityId, action: 'next', ...(request.planVersion===undefined?{}:{planVersion:request.planVersion}) });
    update(state);
    advanced = true;
  }
  return { state, advanced };
}
