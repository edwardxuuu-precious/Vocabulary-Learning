import { useEffect, useState } from 'react';

/** Read-only diagnostics. This never captures audio or changes browser/OS permissions. */
export function MicrophoneHelp({ notify }: { notify: (message: string) => void }) {
  const [permission, setPermission] = useState('尚未读取');
  useEffect(() => {
    let active = true, status: PermissionStatus | undefined;
    const labels = { granted: '已允许', denied: '已拒绝', prompt: '等待浏览器询问' };
    if (!navigator.permissions?.query) { setPermission('浏览器未提供查询'); return; }
    void navigator.permissions.query({ name: 'microphone' as PermissionName })
      .then(result => { if (active) { status = result; result.onchange = () => { if (active) setPermission(labels[result.state]); }; setPermission(labels[result.state]); } })
      .catch(() => { if (active) setPermission('浏览器未提供查询'); });
    return () => { active = false; if (status) status.onchange = null; };
  }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText('http://127.0.0.1:8787/'); notify('本机地址已复制，可粘贴到 Chrome 或 Edge。'); }
    catch { notify('本机地址：http://127.0.0.1:8787/'); }
  };
  const microphoneAvailable = typeof navigator.mediaDevices?.getUserMedia === 'function';
  return <div role="note" aria-label="麦克风开启方法">
    <strong>麦克风权限与设备</strong>
    <p role="status">浏览器授权：{permission}；录音接口：{microphoneAvailable ? '可用' : '未提供'}。</p>
    <p>在浏览器的站点权限中，允许此网页使用麦克风。如果内置浏览器没有授权入口，可用 Chrome 或 Edge 打开 http://127.0.0.1:8787，再点麦克风并允许。</p>
    <p>仍不能打开时，请检查 Windows 设置中的麦克风隐私权限，以及当前录音设备。网页不能代替你修改浏览器或系统授权。</p>
    <button className="button secondary compact-button" type="button" onClick={() => void copy()}>复制本机网页地址</button>
  </div>;
}
