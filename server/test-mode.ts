import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { AppError, Store } from './store.ts';
import { AssessmentGrants } from './assessment-grants.ts';
import { createPracticeRecordings } from './practice-recordings.ts';
import { createChallengeManager, type ChallengeServices } from './challenges.ts';

/** Learning facts and private audio live separately; materials and the real API budget are shared. */
class TestStore extends Store {
  constructor(private source: Store) { super(path.join(source.dataDir, 'test-mode'), source.clock); }
  override reserve(...args: Parameters<Store['reserve']>) { return this.source.reserve(...args); }
  override settle(...args: Parameters<Store['settle']>) { return this.source.settle(...args); }
  syncCatalogue() {
    const source = this.source.read();
    this.mutate(data => {
      for (const session of data.sessions) if (!session.completedAt && !session.suspendedAt && session.wordIds.some(id => {
        const old = data.words.find(word => word.id === id), current = source.words.find(word => word.id === id && !word.deletedAt);
        return !old || !current || current.assetStatus !== 'approved' || !source.packs.some(pack => pack.id === current.packId && pack.enabled && !pack.deletedAt)
          || old.term !== current.term || old.meaning !== current.meaning || old.imageUrl !== current.imageUrl || (old.learningVersion ?? 0) !== (current.learningVersion ?? 0);
      })) session.suspendedAt = this.clock().toISOString();
      for (const key of ['profile', 'settings', 'packs', 'words', 'jobs', 'charges'] as const) Object.assign(data, { [key]: structuredClone(source[key]) });
      if (!source.lessonPlan) delete data.lessonPlan;
      else {
        const completedWordIds = data.lessonPlan?.id === source.lessonPlan.id && data.lessonPlan.revision === source.lessonPlan.revision ? data.lessonPlan.completedWordIds : [];
        data.lessonPlan = { ...structuredClone(source.lessonPlan), completedWordIds };
      }
    });
  }
}

export function createTestMode(source: Store, imageAvailable: (url: string) => boolean, services?: ChallengeServices) {
  const now = () => source.clock().getTime(), leases = new Map<string, number>();
  let context: ReturnType<typeof open> | undefined;
  function open() {
    const store = new TestStore(source);
    // Sync before managers inspect or clean up test-only recordings.
    store.syncCatalogue();
    return { store, grants: new AssessmentGrants(now), recordings: createPracticeRecordings(store),
      challenges: createChallengeManager({ store, dataDir: store.dataDir, imageAvailable, services }) };
  }
  return {
    enter() {
      context ??= open();
      for (const [token, expiry] of leases) if (expiry <= now()) leases.delete(token);
      while (leases.size >= 32) leases.delete(leases.keys().next().value!);
      const token = randomBytes(32).toString('hex');
      leases.set(token, now() + 12 * 60 * 60_000);
      return { token };
    },
    require(token: string | undefined) {
      if (!token || (leases.get(token) ?? 0) <= now() || !context) throw new AppError('测试入口已过期，请退出测试，再从家长空间进入。', 'TEST_MODE_AUTH_REQUIRED', 403);
      context.store.syncCatalogue();
      return context;
    },
    exit(token: string) { leases.delete(token); },
    async close() { leases.clear(); if (context) { await context.challenges.close(); context.store.close(); } },
  };
}

// Deny shared authoring/restore routes even if a client accidentally requests them in test mode.
export function allowedTestRoute(route: string, method: string) {
  if (route === '/api/state' || route === '/api/pack-games' || route === '/api/parent-gate') return method === 'GET';
  if (['/api/parent-gate/unlock', '/api/parent-gate/assessment/revoke', '/api/speech/tts', '/api/speech/tts/stream', '/api/speech/stt', '/api/attempts', '/api/session/start', '/api/session/end', '/api/session/activity', '/api/session/assessment-practice'].includes(route)) return method === 'POST';
  if (route === '/api/session') return method === 'PATCH';
  if (route === '/api/assessments' || /^\/api\/assessments\/[^/]+(?:\/(actions|responses|recordings|submit|review|retry|audio))?$/.test(route)) return ['GET', 'POST'].includes(method);
  return (route === '/api/practice-recordings' || /^\/api\/practice-recordings\/[^/]+\/audio$/.test(route)) && ['GET', 'POST'].includes(method);
}
