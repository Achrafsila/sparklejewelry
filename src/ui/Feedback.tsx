import type { ReactNode } from 'react';
import { IconAlert, IconSuccess } from './icons';

export type InlineState = 'idle' | 'pending' | 'success' | 'error';

/** Result of an action, shown right under its button. Errors are announced immediately. */
export function InlineStatus({ state, children }: { state: InlineState; children?: ReactNode }) {
  return (
    <div aria-live="polite" className="inline-status-wrap">
      {state !== 'idle' && children && (
        <div className={`inline-status inline-status--${state}`} role={state === 'error' ? 'alert' : undefined}>
          {state === 'error' && <IconAlert size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 3 }} />}
          {state === 'success' && <IconSuccess size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 3 }} />}
          {state === 'pending' && <span className="spinner" aria-hidden="true" style={{ marginTop: 3 }} />}
          <div>{children}</div>
        </div>
      )}
    </div>
  );
}

export function Notice({ tone, title, children }: { tone: 'warn' | 'info' | 'ok' | 'err'; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'err' ? 'alert' : undefined}>
      {tone === 'ok' ? (
        <IconSuccess size={18} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
      ) : (
        <IconAlert size={18} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
      )}
      <div className="notice__body">
        {title && <p className="notice__title">{title}</p>}
        {children}
      </div>
    </div>
  );
}
