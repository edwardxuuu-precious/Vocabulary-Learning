import { useEffect, useRef, useState } from 'react';
import type { AssessmentGrant, ParentGateStatus } from '../shared/contracts';
import { api, errorMessage, patch, post } from './api';
import './parent-gate.css';

const clean = (value: string) => value.replace(/\D/g, '').slice(0, 6);

function PinFields({ setup, busy, pin, setPin, confirmation, setConfirmation }: {
  setup: boolean; busy: boolean; pin: string; setPin: (pin: string) => void;
  confirmation: string; setConfirmation: (pin: string) => void;
}) {
  return <>
    <label className="pin-field"><span>{setup ? '设置 6 位数字 PIN' : '家长 PIN'}</span><input required type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete={setup ? 'new-password' : 'off'} disabled={busy} value={pin} onChange={event => setPin(clean(event.target.value))} /></label>
    {setup && <label className="pin-field"><span>再输入一次</span><input required type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" disabled={busy} value={confirmation} onChange={event => setConfirmation(clean(event.target.value))} /></label>}
  </>;
}

export function ParentGate({ onClose, onUnlock }: { onClose: () => void; onUnlock: (grant?: AssessmentGrant) => void }) {
  const [status, setStatus] = useState<ParentGateStatus>();
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void api<ParentGateStatus>('/api/parent-gate').then(value => { if (active.current) setStatus(value); }).catch(error => { if (active.current) setError(errorMessage(error)); });
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { active.current = false; onClose(); }
      if (event.key !== 'Tab') return;
      const controls = form.current?.closest('section')?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [onClose]);
  const setup = status?.configured === false;
  useEffect(() => { if (status && !busy) form.current?.querySelector('input')?.focus(); }, [status?.configured, busy]);
  const close = () => { active.current = false; onClose(); };
  const submit = async () => {
    if (!status || busy) return;
    if (setup && pin !== confirmation) { setError('两次 PIN 不一致，请重新输入。'); return; }
    setBusy(true); setError('');
    try {
      const unlocked = await post<ParentGateStatus>(setup ? '/api/parent-gate' : '/api/parent-gate/unlock', { pin });
      setPin(''); setConfirmation('');
      if (active.current) onUnlock(unlocked.assessmentGrant);
    } catch (error) {
      if (active.current) {
        setError(errorMessage(error)); setPin(''); setConfirmation('');
        void api<ParentGateStatus>('/api/parent-gate').then(value => { if (active.current) setStatus(value); }).catch(() => {});
      }
    } finally { if (active.current) setBusy(false); }
  };
  return <div className="modal-backdrop" role="presentation"><section className="modal parent-pin-modal" role="dialog" aria-modal="true" aria-labelledby="gate-title">
    <button className="modal-close icon-button" onClick={close} aria-label="关闭">×</button>
    <span className="modal-emoji" aria-hidden="true">🔒</span>
    <h2 id="gate-title">{setup ? '请家长设置 PIN' : '这里交给大人啦'}</h2>
    <p>{setup ? '第一次使用，请家长设置并记住 PIN。' : '请输入家长设置的 6 位 PIN。'}<br /><small>{setup ? '请避开孩子操作，不要告诉孩子。' : '不知道 PIN，请把设备交给家长。'}</small></p>
    <form ref={form} onSubmit={event => { event.preventDefault(); void submit(); }}>
      {status && <PinFields setup={setup} busy={busy} pin={pin} setPin={setPin} confirmation={confirmation} setConfirmation={setConfirmation} />}
      <p className="field-error" role="alert">{error}</p>
      <button className="button primary" disabled={!status || busy || pin.length !== 6 || (setup && confirmation.length !== 6)} type="submit">{busy ? '正在验证…' : !status ? '正在读取…' : setup ? '设置并进入' : '进入家长空间'}</button>
    </form>
  </section></div>;
}

export function ParentPinSettings() {
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async () => {
    if (busy) return;
    if (pin !== confirmation) { setMessage('两次新 PIN 不一致，请重新输入。'); return; }
    setBusy(true); setMessage('');
    try {
      await patch<ParentGateStatus>('/api/parent-gate/pin', { currentPin, pin });
      setMessage('PIN 已修改，下次进入时使用新 PIN。');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); setCurrentPin(''); setPin(''); setConfirmation(''); }
  };
  return <section className="parent-panel parent-pin-settings"><div className="panel-heading"><h2>家长 PIN</h2><span>保护家长入口</span></div><p className="muted">返回孩子首页后，再进来需要重新输入 PIN。</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="pin-field"><span>当前 PIN</span><input required type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="off" disabled={busy} value={currentPin} onChange={event => setCurrentPin(clean(event.target.value))} /></label>
      <PinFields setup busy={busy} pin={pin} setPin={setPin} confirmation={confirmation} setConfirmation={setConfirmation} />
      <p className="field-error" role="status">{message}</p><button className="button secondary compact-button" disabled={busy || currentPin.length !== 6 || pin.length !== 6 || confirmation.length !== 6}>修改 PIN</button>
    </form>
  </section>;
}
