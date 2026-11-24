import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { IconClose } from './icons';

// Safari does not focus a button when it is clicked, so remember the last control
// pressed: that is where focus goes back when a panel closes.
let lastPressed: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      lastPressed = (e.target as Element | null)?.closest<HTMLElement>('button, a[href], [tabindex]') ?? null;
    },
    true,
  );
}

function currentOpener(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body) return active;
  return lastPressed;
}

interface SheetProps {
  title: ReactNode;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/**
 * Side panel (full screen on phones) built on the native modal <dialog>:
 * focus moves inside, Tab stays inside, Escape closes, focus returns to the opener.
 */
export function Sheet({ title, open, onClose, children, footer, wide = false }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = currentOpener();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onDialogClose = () => {
      if (opener.current?.isConnected) opener.current.focus();
      if (open) onClose();
    };
    dialog.addEventListener('close', onDialogClose);
    return () => dialog.removeEventListener('close', onDialogClose);
  }, [open, onClose]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'sheet sheet--wide' : 'sheet'}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="sheet__frame">
          <header className="sheet__header">
            <h2 id={titleId} className="sheet__title">
              {title}
            </h2>
            <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
              <IconClose size={20} aria-hidden="true" />
            </button>
          </header>
          <div className="sheet__body">{children}</div>
          {footer && <footer className="sheet__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** Confirmation before a destructive or irreversible action. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Revenir',
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} pending={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Sheet>
  );
}
