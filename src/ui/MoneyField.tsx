import { useState, type ReactNode } from 'react';
import { parseMoney } from '../lib/money';
import { Field } from './Field';

interface MoneyFieldProps {
  label: ReactNode;
  value: string;
  onChange(value: string): void;
  /** Server or form error; shown instead of the format error. */
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  allowEmpty?: boolean;
  name?: string;
}

export const MONEY_FORMAT_ERROR = 'Montant invalide. Exemple : 15,50';

/** Amount in MAD: accepts "15,50" or "15.50"; checked when the field is left, never while typing. */
export function MoneyField({ label, value, onChange, error, hint, optional, name }: MoneyFieldProps) {
  const [touched, setTouched] = useState(false);
  const formatError = touched && value.trim() !== '' && parseMoney(value) === null ? MONEY_FORMAT_ERROR : null;
  return (
    <Field label={label} hint={hint} optional={optional} error={error ?? formatError}>
      {(p) => (
        <div className="input-affix">
          <input
            {...p}
            name={name}
            className="input num"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          <span className="input-affix__suffix" aria-hidden="true">
            MAD
          </span>
        </div>
      )}
    </Field>
  );
}
