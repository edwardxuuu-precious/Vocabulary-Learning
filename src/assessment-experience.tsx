import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, AssessmentGrant, ParentGateStatus } from '../shared/contracts';
import { AssessmentCenter } from './assessments';
import { api, post, errorMessage } from './api';
import './style.css';
import './parent.css';
import './assessment-experience.css';

// This entry is bundled separately and served only by the explicit isolated experience harness.
function AssessmentExperience() {
  const [state, setState] = useState<AppState>();
  const [grant, setGrant] = useState<AssessmentGrant>();
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [day, setDay] = useState(0);
  const reload = useCallback(async () => { const next = await api<AppState>('/api/state'); setState(next); return next; }, []);
  const unlock = useCallback(async () => {
    const result = await post<ParentGateStatus>('/api/parent-gate/unlock', { pin: '735924' });
    if (!result.assessmentGrant) throw Error('体验授权未准备好，请重新打开体验页。');
    setGrant(result.assessmentGrant);
  }, []);
  useEffect(() => { void Promise.all([reload(), unlock(), api<{ dayOffset: number }>('/__qa/info').then(info => setDay(info.dayOffset))]).catch(error => setError(errorMessage(error))); }, [reload, unlock]);
  const restart = async (nextDay = false) => {
    setBusy(true); setError('');
    try { await post(nextDay ? '/__qa/next-day' : '/__qa/reset'); window.location.reload(); }
    catch (error) { setError(errorMessage(error)); setBusy(false); }
  };
  const enter = async () => {
    setBusy(true); setError('');
    try { await unlock(); await reload(); setActive(true); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const completed = state?.assessments?.filter(item => item.completedAt).length ?? 0;
  return <div className="assessment-experience">
    <header className="experience-header"><div><strong>独立测评体验</strong><p>示例档案 · 不写入孩子正式记录 · 仅用已有音频缓存</p></div><div className="experience-tools"><span>{day ? `已模拟 ${day} 天后` : '体验当天'}</span><button disabled={busy || !completed} onClick={() => void restart(true)}>模拟下一天复测</button><button disabled={busy || !state} onClick={() => void restart()}>清空体验，重新开始</button></div></header>
    {error && <p className="experience-error" role="alert">{error}</p>}
    {active && state && grant ? <AssessmentCenter parentMode state={state} grant={grant} onGrant={setGrant} reload={reload} onExit={() => { setActive(false); void reload(); }} /> : <main className="experience-welcome"><span className="experience-label">放心试一遍</span><h1>看、读、翻译，完整体验</h1><p>选 1–5 个示例词，依次体验四类题。选 5 个词就是完整的 20 项测试。</p><ol><li><strong>中译英</strong><span>家长读中文，孩子说英文。</span></li><li><strong>独立朗读</strong><span>看英文，试着自己读出来。</span></li><li><strong>英译中</strong><span>看英文，说出中文意思。</span></li><li><strong>看词选图</strong><span>看英文，点对应图片，由系统判题。</span></li></ol><p className="experience-tip">前三类请你扮演家长，选择“独立答对 / 需要练习 / 有提示 / 未确认”。整轮结束后一起核对答案，也可以暂停后刷新继续。</p><button className="assessment-primary" disabled={busy || !state} onClick={() => void enter()}>{busy || !state ? '正在准备…' : completed ? '查看结果或再测一轮' : '开始完整体验 →'}</button><p className="experience-foot">{completed ? `已完成 ${completed} 轮体验。可在顶部模拟下一天，再进入“到期复测”。` : '这里预设了已学示例词，体验结果只存在这份独立档案中。'}</p></main>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<AssessmentExperience />);
