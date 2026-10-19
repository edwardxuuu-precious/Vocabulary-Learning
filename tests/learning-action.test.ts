import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState } from '../shared/contracts.ts';
import { submitLearningAction } from '../src/learning-action.ts';

const request = { sessionId: 'round', activityId: 'recall', action: 'finish' as const };
function snapshot(outcome = 'practice', sessionId = 'round', currentId = 'recall') {
  return { activeSession: { id: sessionId, activities: [{ id: currentId, wordId: 'word', step: 'recall' }],
    completedSteps: {}, activityStates: { recall: { outcome } } } } as unknown as AppState;
}

test('saved oral participation continues once; ordinary answer keeps its feedback', async () => {
  for (const action of ['finish', 'skip', 'choose'] as const) {
    const actions: string[] = [], updates: AppState[] = [];
    const result = await submitLearningAction({ ...request, action }, {
      advance: action === 'finish', update: state => updates.push(state),
      submit: async event => { actions.push(event.action); return snapshot(); },
    });
    assert.deepEqual(actions, action === 'choose' ? ['choose'] : [action, 'next']);
    assert.equal(result.advanced, action !== 'choose');
    assert.equal(updates.length, actions.length);
  }
});

test('failed save cannot advance, and failed continuation retains the saved result for retry', async () => {
  for (const failedAction of ['finish', 'next']) {
    const actions: string[] = [], updates: AppState[] = [];
    await assert.rejects(submitLearningAction(request, {
      advance: true, update: state => updates.push(state),
      submit: async event => { actions.push(event.action); if (event.action === failedAction) throw new Error('offline'); return snapshot(); },
    }), /offline/);
    assert.deepEqual(actions, failedAction === 'finish' ? ['finish'] : ['finish', 'next']);
    assert.equal(updates.length, failedAction === 'finish' ? 0 : 1);
    if (updates.length) assert.equal(updates[0].activeSession?.activityStates?.recall.outcome, 'practice');
  }
});

test('unaccepted, replaced or already moved activity cannot trigger a continuation', async () => {
  for (const state of [snapshot('try'), snapshot(''), snapshot('practice', 'other'), snapshot('practice', 'round', 'other'), { activeSession: null } as AppState]) {
    const actions: string[] = [];
    const result = await submitLearningAction(request, {
      advance: true, update() {}, submit: async event => { actions.push(event.action); return state; },
    });
    assert.deepEqual(actions, ['finish']);
    assert.equal(result.advanced, false);
  }
});

test('pausing or leaving while saving keeps the saved result without continuing in the background', async () => {
  let active = true;
  const actions: string[] = [];
  const result = await submitLearningAction(request, {
    advance: true, isActive: () => active, update() {},
    submit: async event => { actions.push(event.action); active = false; return snapshot(); },
  });
  assert.equal(result.advanced, false);
  assert.deepEqual(actions, ['finish']);
});

test('an explicit next request is never repeated', async () => {
  let count = 0;
  const result = await submitLearningAction({ ...request, action: 'next' }, {
    update() {}, submit: async () => { count++; return snapshot(); },
  });
  assert.equal(result.advanced, true);
  assert.equal(count, 1);
});
