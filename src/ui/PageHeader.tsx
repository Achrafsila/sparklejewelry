import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  count?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
}

/** Same header on every screen: title, count, then the screen's main action and filters. */
export function PageHeader({ title, count, actions, filters }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__title">
        <h1>{title}</h1>
        {count != null && <span className="page-header__count num">{count}</span>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
      {filters && <div className="page-header__filters">{filters}</div>}
    </header>
  );
}
