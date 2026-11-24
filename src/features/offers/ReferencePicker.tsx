import { useDeferredValue, useState } from 'react';
import { PhotoSlot } from '../../ui/PhotoSlot';
import './pickers.css';
import type { StockRow } from '../stock/useStock';

interface Props {
  legend: string;
  stock: StockRow[];
  selected: string[];
  onChange(selected: string[]): void;
  error?: string | null;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Checkbox list of references with photo and availability, filterable by name or reference. */
export function ReferencePicker({ legend, stock, selected, onChange, error }: Props) {
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);
  const words = fold(q).split(/\s+/).filter(Boolean);
  const visible = stock.filter((s) => !s.archived && words.every((w) => fold(`${s.name} ${s.sku}`).includes(w)));
  const set = new Set(selected);

  return (
    <fieldset className="ref-picker">
      <legend>
        {legend} <span className="field__optional num">({selected.length} choisie{selected.length > 1 ? 's' : ''})</span>
      </legend>
      {stock.length > 8 && (
        <input
          className="input"
          type="search"
          aria-label={`Filtrer : ${legend}`}
          placeholder="Nom ou référence…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <ul className="ref-picker__list">
        {visible.map((s) => (
          <li key={s.variant_id}>
            <label className={set.has(s.variant_id) ? 'ref-picker__row is-chosen' : 'ref-picker__row'}>
              <input
                type="checkbox"
                className="ref-picker__check"
                checked={set.has(s.variant_id)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, s.variant_id] : selected.filter((id) => id !== s.variant_id))
                }
              />
              <PhotoSlot size={40} path={s.photo_path} selected={set.has(s.variant_id)} />
              <span className="item-line__text">
                <span className="item-line__name">{s.name}</span>
                <span className="item-line__meta">
                  {s.sku}, {s.available_qty} disponible{s.available_qty > 1 ? 's' : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
