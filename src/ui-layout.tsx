import type { ReactNode } from 'react';

export function BackButton({ children, onClick, label, disabled }: {
  children: ReactNode;
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return <button type="button" className="ui-back" onClick={onClick} aria-label={label} disabled={disabled}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
    <span>{children}</span>
  </button>;
}

export function PageHeading({ title, description, actions, className }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return <header className={`ui-page-heading${className ? ` ${className}` : ''}`}>
    <div className="ui-page-title">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="ui-page-actions">{actions}</div>}
  </header>;
}

export function ActionBar({ children, context, primary, className, label = '本页操作' }: {
  children?: ReactNode;
  context?: ReactNode;
  primary?: ReactNode;
  className?: string;
  label?: string;
}) {
  return <footer className={`ui-action-bar${className ? ` ${className}` : ''}`} aria-label={label}>
    {context != null && <div className="ui-action-context">{context}</div>}
    {(children || primary) && <div className="ui-action-controls">{children}{primary}</div>}
  </footer>;
}

export type ActivityProgress = {
  label: string;
  name: string;
  completed: number;
  total: number;
  unit?: string;
  description?: string;
};

export function ActivityNavigation({ label, back, progress, actions }: {
  label: string;
  back: ReactNode;
  progress?: ActivityProgress;
  actions?: ReactNode;
}) {
  return <nav className="ui-activity-nav" aria-label={label}>
    {back}
    {progress && progress.total > 0 && <div className="ui-progress">
      <div className="ui-progress-summary">
        <span>{progress.label}</span>
        <span><strong>{progress.completed}</strong> / {progress.total}{progress.unit && ` ${progress.unit}`}</span>
      </div>
      <div className="ui-progress-track" role="progressbar" aria-label={progress.name} aria-valuetext={progress.description} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}>
        <span style={{ width: `${100 * progress.completed / progress.total}%` }} />
      </div>
    </div>}
    {actions && <div className="ui-activity-actions">{actions}</div>}
  </nav>;
}

export function TaskHeading({ title, instruction, children }: {
  title: string;
  instruction?: string;
  children?: ReactNode;
}) {
  return <header className="ui-task-heading">
    <div>
      <h1>{title}</h1>
      {instruction && <p>{instruction}</p>}
    </div>
    {children}
  </header>;
}
