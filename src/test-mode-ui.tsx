import { PageHeading } from './ui-layout';
import { BusinessObservationPanel } from './business-observations';
import { AudioCheck } from './audio-check';
import { useState } from 'react';
import type { AppState, AssessmentGrant } from '../shared/contracts';
import { api, errorMessage } from './api';
import { enterTestMode, exitTestMode } from './test-mode-context';
import { ParentRecordSections, ParentSymbol, ParentWorkspace } from './parent-space-ui';
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
  return <section className="test-mode-entry" aria-labelledby="parent-test-entry-title">
    <div className="parent-workspace-test-title"><ParentSymbol kind="shield" /><h2 id="parent-test-entry-title">家长测试</h2></div>
    <p>试用记录单独保存，素材和云额度共用。</p>
    <button className="button secondary" type="button" disabled={busy || !grant} onClick={() => void enter()}>{busy ? '正在进入…' : '进入测试模式'}</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function TestParentSpace({ state, grant, onGrant, onTest, onExit }: { state: AppState; grant?: AssessmentGrant; onGrant: (grant?: AssessmentGrant) => void; onTest: () => void; onExit: () => void }) {
  return <ParentWorkspace test onExit={onExit}>
    <PageHeading className="parent-workspace-heading" title="家长测试记录" description="退出测试模式后可管理词表、素材和设置。" actions={<AudioCheck words={state.words}/>}/>
    <ParentRecordSections observations={<BusinessObservationPanel state={state} grant={grant} onGrant={onGrant}/>} challenges={<section className="parent-panel"><h2>测试核验</h2><button className="button primary" onClick={onTest}>核验与现场测试</button><AssessmentReport state={state} /></section>} recordings={<PracticeRecordingHistory grant={grant} onGrant={onGrant} />} overview={<LearningOverview state={state} />} />
  </ParentWorkspace>;
}
