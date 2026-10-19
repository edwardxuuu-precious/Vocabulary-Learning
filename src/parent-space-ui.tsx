import { useState, type ReactNode } from 'react';
import { Mascot } from './mascot';

type ParentTab = 'packs' | 'learning' | 'assets' | 'settings';
type ParentSymbolKind = 'back' | 'book' | 'history' | 'settings' | 'down' | 'services' | 'shield';

export function ParentSymbol({ kind }: { kind: ParentSymbolKind }) {
  const paths: Record<ParentSymbolKind, string> = {
    back: 'M19 12H5m6-6-6 6 6 6',
    book: 'M12 5v15m0-15C8 2 4 3 3 4v14c4-2 7-1 9 2m0-15c4-3 8-2 9-1v14c-4-2-7-1-9 2',
    history: 'M4 11a8 8 0 1 1 2 6M4 4v7h7m1-4v6l4 2',
    settings: 'm9 3-1 3-3 1-2 4 2 2v3l4 3 3-1 3 1 4-3v-3l2-2-2-4-3-1-1-3Z M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    down: 'm6 9 6 6 6-6',
    services: 'M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-6 6v4m-6-14v4a6 6 0 0 0 6 6',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z m-4 9 3 3 5-6',
  };
  return <svg className="parent-symbol" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

export function ParentSpaceHeader({ tab, reviewing, settingsDirty = false, onExit, onNavigate }: { tab: ParentTab; reviewing: number; settingsDirty?: boolean; onExit: () => void; onNavigate: (tab: Exclude<ParentTab, 'assets'>) => void }) {
  return <>
    <nav className="parent-home-nav" aria-label="家长空间返回"><button onClick={onExit}><ParentSymbol kind="back" />孩子首页</button></nav>
    <header className="parent-space-heading"><h1>家长空间</h1><Mascot small /></header>
    <nav className="studio-tabs" aria-label="家长空间导航">{([{ id: 'packs', label: '备课', icon: 'book' }, { id: 'learning', label: '学习记录', icon: 'history' }, { id: 'settings', label: '设置', icon: 'settings' }] as const).map(item => <button key={item.id} aria-current={tab === item.id || item.id === 'packs' && tab === 'assets' ? 'page' : undefined} onClick={() => onNavigate(item.id)}><ParentSymbol kind={item.icon} />{item.label}{item.id==='settings'&&settingsDirty&&<b aria-label="设置有未保存更改">未保存</b>}{item.id === 'packs' && reviewing > 0 && <b aria-label={reviewing + '张图片待审核'}>{reviewing}</b>}</button>)}</nav>
  </>;
}

export function ParentDisclosure({ title, description, icon, children }: { title: string; description: string; icon: 'services' | 'shield' | 'book'; children: ReactNode }) {
  return <details className="parent-disclosure"><summary><span className="parent-disclosure-icon"><ParentSymbol kind={icon} /></span><span className="parent-disclosure-copy"><strong>{title}</strong><span>{description}</span></span><ParentSymbol kind="down" /></summary><div className="parent-disclosure-content">{children}</div></details>;
}

export function ParentRecordSections({ challenges, recordings, overview, materials }: { challenges: ReactNode; recordings: ReactNode; overview: ReactNode; materials?: ReactNode }) {
  const [section, setSection] = useState<'challenges' | 'recordings' | 'overview'>('challenges');
  const [showMaterials, setShowMaterials] = useState(false);
  return <div className="parent-records">
    <div className="parent-record-tabs" role="group" aria-label="学习记录分类">{([{ id: 'challenges', label: '挑战核验' }, { id: 'recordings', label: '练习录音' }, { id: 'overview', label: '学习概览' }] as const).map(item => <button key={item.id} aria-pressed={section === item.id} onClick={() => setSection(item.id)}>{item.label}</button>)}</div>
    <div className="parent-record-content">{section === 'challenges' ? challenges : section === 'recordings' ? recordings : overview}</div>
    {materials && <details className="parent-disclosure parent-game-materials" onToggle={event => setShowMaterials(event.currentTarget.open)}><summary><span className="parent-disclosure-icon"><ParentSymbol kind="book" /></span><span className="parent-disclosure-copy"><strong>游戏配套素材</strong><span>查看素材和审核状态</span></span><ParentSymbol kind="down" /></summary>{showMaterials && <div className="parent-disclosure-content">{materials}</div>}</details>}
  </div>;
}
