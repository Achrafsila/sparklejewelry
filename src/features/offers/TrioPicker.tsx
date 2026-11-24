import { useId } from 'react';
import { PhotoSlot } from '../../ui/PhotoSlot';
import './pickers.css';

export interface TrioCandidate {
  variant_id: string;
  name: string;
  sku: string;
  photo_path: string | null;
  available_qty: number;
}

interface TrioPickerProps {
  /** "fixed": composing an offer (stock not required). "pick": a customer's choice (stock required). */
  mode: 'fixed' | 'pick';
  label: string;
  candidates: TrioCandidate[];
  value: string[];
  allowRepeat: boolean;
  onChange(value: string[]): void;
}

/** Three empty settings that fill with the chosen pieces: 0/3 to 3/3. */
export function TrioPicker({ mode, label, candidates, value, allowRepeat, onChange }: TrioPickerProps) {
  const titleId = useId();
  const byId = new Map(candidates.map((c) => [c.variant_id, c]));
  const full = value.length >= 3;
  const chosenCount = (id: string) => value.filter((v) => v === id).length;

  return (
    <div className="trio" role="group" aria-labelledby={titleId}>
      <div className="trio__head">
        <p id={titleId} className="field__label">
          {label}
        </p>
        <p className="trio__count num" aria-live="polite">
          {value.length}/3
        </p>
      </div>
      <ol className="trio__slots">
        {[0, 1, 2].map((slot) => {
          const item = value[slot] ? byId.get(value[slot]) : undefined;
          return (
            <li key={slot} className="trio__slot">
              {item ? (
                <button
                  type="button"
                  className="trio__filled"
                  aria-label={`Retirer ${item.name} de l’emplacement ${slot + 1}`}
                  onClick={() => onChange(value.filter((_, i) => i !== slot))}
                >
                  <PhotoSlot size={72} path={item.photo_path} selected />
                  <span className="trio__slot-name">{item.name}</span>
                </button>
              ) : (
                <span className="trio__empty">
                  <PhotoSlot size={72} />
                  <span className="trio__slot-name muted">Pièce {slot + 1}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {full && <p className="field__hint">Touchez une pièce choisie pour la retirer et en choisir une autre.</p>}
      <ul className="trio__grid">
        {candidates.map((c) => {
          const count = chosenCount(c.variant_id);
          const outOfStock = mode === 'pick' && c.available_qty - count <= 0;
          const repeatBlocked = !allowRepeat && count > 0;
          const disabled = full || outOfStock || repeatBlocked;
          return (
            <li key={c.variant_id}>
              <button
                type="button"
                className={count > 0 ? 'trio__candidate is-chosen' : 'trio__candidate'}
                aria-label={`Ajouter ${c.name}, ${c.available_qty} disponible${c.available_qty > 1 ? 's' : ''}`}
                disabled={disabled}
                onClick={() => onChange([...value, c.variant_id])}
              >
                <PhotoSlot size={56} path={c.photo_path} selected={count > 0} />
                <span className="trio__candidate-text">
                  <span className="item-line__name">{c.name}</span>
                  <span className="item-line__meta">
                    {c.available_qty > 0 ? `${c.available_qty} disponible${c.available_qty > 1 ? 's' : ''}` : 'Indisponible'}
                    {count > 0 && `, choisie ${count} fois`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
