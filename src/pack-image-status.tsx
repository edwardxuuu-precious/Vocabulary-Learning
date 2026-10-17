import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackImageStatus, Word, WordPack } from '../shared/contracts';
import { api, errorMessage } from './api';

export function usePackImages(packs: WordPack[], enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<string, PackImageStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const packsRef = useRef(packs), mounted = useRef(true), generation = useRef(0), polling = useRef(false);
  const serials = useRef(new Map<string, number>()); packsRef.current = packs;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const refresh = useCallback(async (packId?: string) => {
    const request = generation.current;
    await Promise.all((packId ? [packId] : packsRef.current.map(pack => pack.id)).map(async id => {
      const serial = (serials.current.get(id) ?? 0) + 1; serials.current.set(id, serial);
      const current = () => mounted.current && request === generation.current && serials.current.get(id) === serial;
      try {
        const status = await api<PackImageStatus>(`/api/packs/${encodeURIComponent(id)}/images`, { signal: AbortSignal.timeout(10000) });
        if (current()) { setStatuses(previous => ({ ...previous, [id]: status })); setErrors(previous => { const next = { ...previous }; delete next[id]; return next; }); }
      } catch (failure) {
        if (current()) { setErrors(previous => ({ ...previous, [id]: errorMessage(failure) })); setStatuses(previous => { const next = { ...previous }; delete next[id]; return next; }); }
      }
    }));
  }, []);
  const identity = packs.map(pack => pack.id).join('|');
  useEffect(() => {
    if (!enabled) return;
    const poll = async () => { if (polling.current) return; polling.current = true; try { await refresh(); } finally { polling.current = false; } };
    void poll(); const timer = setInterval(() => void poll(), 2000);
    return () => { generation.current++; clearInterval(timer); };
  }, [enabled, identity, refresh]);
  return { statuses, errors, refresh };
}

export const imageStatusLabels: Record<PackImageStatus['status'], string> = {
  idle: '等待准备', queued: '已加入队列', running: '正在画图', review: '等待家长审核', ready: '图片已全部确认', stopped: '已停止，可继续补缺', error: '图片准备未完成',
};
export function PackImageProgress({ status, error, words }: { status?: PackImageStatus; error?: string; words: Word[] }) {
  return <div className="pack-image-status" role="status">
    <div className="image-status-heading"><strong>{status ? imageStatusLabels[status.status] : error ? '图片状态读取失败' : '正在读取图片进度'}</strong>{status && <span>已确认 {status.approved} · 待审核 {status.reviewing} / {status.total}</span>}</div>
    {status && <progress value={status.approved + status.reviewing} max={Math.max(1, status.total)} aria-label="已有真实图片的进度，含待审核" />}
    {status && <p>{status.currentWordId ? `当前：${words.find(word => word.id === status.currentWordId)?.term || '一个单词'}。` : ''}还有 {status.pending} 张待准备{status.failed ? `，${status.failed} 张需要重试` : ''}。待审核图片尚不会进入学习。</p>}
    {(status?.error || error) && <p className="pack-error">{status?.error || error} 词表与已准备素材已保留。</p>}
  </div>;
}
