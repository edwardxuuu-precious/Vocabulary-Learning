import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, AssessmentGrant } from '../shared/contracts';
import { AssessmentCenter } from './assessments';
import { api, post } from './api';
import './style.css';
import './parent.css';
function ChallengeQA() {
  const [state, setState] = useState<AppState>(), [grant, setGrant] = useState<AssessmentGrant>(), [parent, setParent] = useState(false), [active, setActive] = useState(true);
  const reload = useCallback(async () => { const state = await api<AppState>('/api/state'); setState(state); return state; }, []);
  useEffect(() => { void reload(); }, []);
  return <><aside style={{ padding: 12, background: '#fff1ba', display: 'flex', gap: 12, flexWrap: 'wrap' }}><strong>隔离示例 · 合成声音 · 转写/Codex为测试替身</strong><button onClick={() => { setParent(false); setActive(true); }}>儿童挑战</button><button onClick={() => { setParent(true); setActive(true); }}>家长核验</button><button onClick={() => void post('/__qa/next-day').then(() => location.reload())}>模拟下一天</button></aside>{state && active ? <AssessmentCenter state={state} grant={grant} onGrant={setGrant} parentMode={parent} reload={reload} initialWordIds={state.words.slice(0, 5).map(word => word.id)} onExit={() => { setActive(false); void reload(); }} /> : <p>已离开挑战，回答保存在隔离档案中。</p>}</>;
}
createRoot(document.getElementById('root')!).render(<ChallengeQA />);
