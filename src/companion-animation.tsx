import {ScreenRestContext} from './screen-time';
import { useContext, useEffect, useRef, useState } from 'react';
import type { CompanionVideo } from '../shared/companion-video-source';

/** Mount only after an explicit click; unmounting stops the third-party player. */
export function CompanionAnimation({ name, video, unlocked, remaining }: { name: string; video: CompanionVideo; unlocked: boolean; remaining?: number }) {
  const forcedRest=useContext(ScreenRestContext);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fullscreenUnavailable, setFullscreenUnavailable] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => { if (open && unlocked) frame.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [open, unlocked]);
  useEffect(() => { if (!unlocked||forcedRest) setOpen(false); }, [unlocked,forcedRest]);
  useEffect(() => { setFullscreenUnavailable(false); }, [open, attempt]);
  async function watchFullscreen() {
    try {
      if (!frame.current?.requestFullscreen) throw new Error('fullscreen unavailable');
      await frame.current.requestFullscreen();
    } catch { setFullscreenUnavailable(true); }
  }
  if (!unlocked) return <section className="companion-animation companion-animation-locked" aria-label={name + '的动画待解锁'}>
    <h3>{name}的动画待解锁</h3><p>{remaining ? `再新学会${remaining}个不同单词，就能看它的动画。` : '继续新学会单词，就能解锁它的动画。'}</p>
    <small>人物图片和故事已经可以看啦。</small>
  </section>;
  return <section className="companion-animation" aria-label={name + '的中文动画'}>
    <div className="companion-animation-heading"><h3>{name}的中文动画</h3><button className="companion-animation-link" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={open ? 'M6 6h12v12H6Z' : 'M8 4.5v15l12-7.5Z'}/></svg>{open ? '收起动画' : '看中文动画'}
    </button></div>
    <p>{video.title}</p>{video.note && <p>{video.note}</p>}
    {open && <><div className="companion-animation-player"><iframe key={attempt} ref={frame} src={video.embedUrl} title={name + '的普通话动画播放器'} allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div>
      <p className="companion-animation-help">点播放器中的 ▶ 开始播放，可全屏观看。</p>
      <div className="companion-animation-options"><button onClick={() => { void watchFullscreen(); }}>全屏观看</button><button onClick={() => setAttempt(current => current + 1)}>重新加载</button><a href={video.url} target="_blank" rel="noopener noreferrer" aria-label={'在哔哩哔哩打开' + name + '的中文动画，新标签页'}>在B站打开 ↗</a></div>
      {fullscreenUnavailable && <small role="status">当前设备暂未能打开全屏，可以继续在这里观看，或在B站打开。</small>}
      <small>如遇加载失败或平台登录提示，可重新加载或在B站打开。</small></>}
    <small>{video.platform} · {video.language} · 上传者：{video.publisher}</small>
  </section>;
}
