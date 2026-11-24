import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const ActionBarSlot = createContext<HTMLElement | null>(null);

interface ActionBarProps {
  children: ReactNode;
  summary?: ReactNode;
  /** true: only on phones (desktop shows the action in the page header). false: always visible. */
  mobileOnly?: boolean;
  label?: string;
}

/** Persistent glass bar holding the screen's main action within thumb reach. */
export function ActionBar({ children, summary, mobileOnly = true, label = 'Action principale' }: ActionBarProps) {
  const slot = useContext(ActionBarSlot);
  if (!slot) return null;
  return createPortal(
    <div className={mobileOnly ? 'action-bar action-bar--mobile-only' : 'action-bar'} role="region" aria-label={label}>
      <div className="action-bar__inner glass">
        {summary && <div className="action-bar__summary num">{summary}</div>}
        {children}
      </div>
    </div>,
    slot,
  );
}
