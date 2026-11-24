import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'normal';
  block?: boolean;
  /** Shows a spinner, sets aria-busy and blocks further clicks while a request runs. */
  pending?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'normal',
  block = false,
  pending = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, size === 'small' && 'btn--small', block && 'btn--block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
