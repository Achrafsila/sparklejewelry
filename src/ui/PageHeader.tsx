import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  count?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  /** false when the same action already sits in the phone action bar. */
  actionsOnPhone?: boolean;
}

/** Same header on every screen: title, count, then the screen's main action and filters. */
export function PageHeader({ title, count, actions, filters, actionsOnPhone = true }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__title">
        <h1>{title}</h1>
        {count != null && <span className="page-header__count num">{count}</span>}
      </div>
      {actions && (
        <div className={actionsOnPhone ? 'page-header__actions' : 'page-header__actions page-header__actions--wide'}>{actions}</div>
      )}
      {filters && <div className="page-header__filters">{filters}</div>}
    </header>
  );
}
