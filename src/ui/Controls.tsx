import type { InputHTMLAttributes, ReactNode } from 'react';

export function Checkbox({ label, ...rest }: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  onText?: string;
  offText?: string;
  disabled?: boolean;
}

/** On/off control that always says its state in words ("Active" / "En pause"). */
export function Switch({ label, checked, onChange, onText = 'Active', offText = 'En pause', disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__text">{checked ? onText : offText}</span>
    </button>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange(value: T): void;
}

/** Choice between a few views, each with its count. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className="segmented__item"
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count != null && <span className="segmented__count num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ rows = 3, label = 'Chargement' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton__row" />
      ))}
    </div>
  );
}
