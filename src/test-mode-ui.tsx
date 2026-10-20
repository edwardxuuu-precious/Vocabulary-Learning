import { AudioCheck } from './audio-check';
import { useState } from 'react';
import type { AppState, AssessmentGrant } from '../shared/contracts';
import { api, errorMessage } from './api';
import { enterTestMode, exitTestMode } from './test-mode-context';
import { ParentRecordSections } from './parent-space-ui';
import { AssessmentReport } from './assessments';
import { PracticeRecordingHistory } from './practice-recording-history';
import { LearningOverview } from './learning-overview';
import './test-mode.css';

export function TestModeBanner() {
  return <aside className="test-mode-banner" aria-label="当前为家长测试模式"><span><strong>家长测试</strong><span>不计入孩子的学习、测评和奖励</span></span><button onClick={() => void exitTestMode()}>退出测试，回孩子首页</button></aside>;
}

export function TestModeEntry({ grant }: { grant?: AssessmentGrant }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const enter = async () => {
    setBusy(true); setError('');
    try { const result = await api<{ token: string }>('/api/test-mode', { method: 'POST', headers: { Authorization: `Bearer ${grant?.token ?? ''}` } }); enterTestMode(result.token); }
    catch (error) { setError(errorMessage(error)); setBusy(false); }
  };
  return <section className="test-mode-entry"><div><span className="test-mode-eyebrow">家长专用</span><h2>放心试一试</h2><p>共用词表、图片和发音，测试记录单独保存，下次还能接着试。</p><small>云服务仍共用实际额度与预算保护。</small>{error && <p role="alert">{error}</p>}</div><button className="button secondary" disabled={busy || !grant} onClick={() => void enter()}>{busy ? '正在进入…' : '进入测试模式'}</button></section>;
}

export function TestParentSpace({ state, grant, onGrant, onTest, onExit }: { state: AppState; grant?: AssessmentGrant; onGrant: (grant?: AssessmentGrant) => void; onTest: () => void; onExit: () => void }) {
  return <main className="parent-page parent-studio page-enter"><nav className="parent-home-nav"><button onClick={onExit}>← 回测试首页</button></nav><header className="parent-space-heading"><h1>测试记录</h1></header><p>这里只显示家长试用记录。共用词表、素材与设置请退出测试后管理。</p><AudioCheck words={state.words}/><ParentRecordSections challenges={<section className="parent-panel"><h2>测试测评与核验</h2><button className="button primary" onClick={onTest}>核验与现场测试</button><AssessmentReport state={state} /></section>} recordings={<PracticeRecordingHistory grant={grant} onGrant={onGrant} />} overview={<LearningOverview state={state} />} /></main>;
}
