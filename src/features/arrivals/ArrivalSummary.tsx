import { useId } from 'react';
import { formatMoney, parseMoney } from '../../lib/money';
import { Badge } from '../../ui/StatusBadge';
import { Field } from '../../ui/Field';
import { IconTrash } from '../../ui/icons';
import { PhotoSlot } from '../../ui/PhotoSlot';
import type { ArrivalDraft, ArrivalLine } from './arrivalDraft';

interface Props {
  draft: ArrivalDraft;
  suppliers: string[];
  supplierError?: string | null;
  lineErrors: Record<string, string>;
  newKeys: Set<string>;
  onChange(draft: ArrivalDraft): void;
}

export const lineTotal = (l: ArrivalLine) => (Number(l.qty) || 0) * (parseMoney(l.unitCost) ?? 0);

export function ArrivalSummary({ draft, suppliers, supplierError, lineErrors, newKeys, onChange }: Props) {
  const titleId = useId();
  const listId = useId();
  const update = (key: string, patch: Partial<ArrivalLine>) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  return (
    <section className="panel" aria-labelledby={titleId}>
      <h2 id={titleId} className="panel__title">
        Récapitulatif de l’arrivage
      </h2>
      <div className="form-grid form-grid--2">
        <Field label="Fournisseur" error={supplierError}>
          {(p) => (
            <>
              <input
                {...p}
                className="input"
                list={listId}
                autoComplete="off"
                value={draft.supplier}
                onChange={(e) => onChange({ ...draft, supplier: e.target.value })}
              />
              <datalist id={listId}>
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Date de réception">
          {(p) => (
            <input
              {...p}
              className="input"
              type="date"
              value={draft.receivedOn}
              onChange={(e) => onChange({ ...draft, receivedOn: e.target.value })}
            />
          )}
        </Field>
      </div>

      {draft.lines.length === 0 ? (
        <p className="muted arrival-lines__empty">Les lignes ajoutées depuis « Nouveau modèle » ou « Modèle existant » apparaissent ici.</p>
      ) : (
        <ul className="arrival-lines">
          {draft.lines.map((l) => {
            const name = [l.productName, l.label].filter(Boolean).join(' ');
            const qtyInvalid = !/^\d+$/.test(l.qty) || Number(l.qty) < 1;
            const costInvalid = parseMoney(l.unitCost) === null;
            return (
              <li key={l.key} className={newKeys.has(l.key) ? 'arrival-line is-new' : 'arrival-line'}>
                <PhotoSlot size={56} path={l.photoPath} alt="" />
                <div className="arrival-line__main">
                  <p className="item-line__name">{name}</p>
                  <p className="item-line__meta">
                    {l.sku} <Badge tone={l.variantId ? 'neutral' : 'champagne'}>{l.variantId ? 'Réassort' : 'Nouveau'}</Badge>
                  </p>
                  {lineErrors[l.key] && (
                    <p className="field__error" role="alert">
                      {lineErrors[l.key]}
                    </p>
                  )}
                </div>
                <label className="arrival-line__field">
                  <span aria-hidden="true" className="arrival-line__caption">
                    Quantité
                  </span>
                  <input
                    aria-label={`Quantité pour ${l.sku}`}
                    className="input num"
                    inputMode="numeric"
                    aria-invalid={qtyInvalid || undefined}
                    value={l.qty}
                    onChange={(e) => update(l.key, { qty: e.target.value })}
                  />
                </label>
                <label className="arrival-line__field">
                  <span aria-hidden="true" className="arrival-line__caption">
                    Coût unitaire
                  </span>
                  <input
                    aria-label={`Coût unitaire pour ${l.sku}`}
                    className="input num"
                    inputMode="decimal"
                    aria-invalid={costInvalid || undefined}
                    value={l.unitCost}
                    onChange={(e) => update(l.key, { unitCost: e.target.value })}
                  />
                </label>
                <p className="arrival-line__total num">
                  <span className="visually-hidden">Total de la ligne : </span>
                  {costInvalid || qtyInvalid ? '—' : formatMoney(lineTotal(l))}
                </p>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Retirer ${l.sku}`}
                  onClick={() => onChange({ ...draft, lines: draft.lines.filter((x) => x.key !== l.key) })}
                >
                  <IconTrash size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
