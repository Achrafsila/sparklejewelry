import { useId, useRef, useState, type FormEvent } from 'react';
import { formatMoney, parseMoney } from '../../lib/money';
import { Button } from '../../ui/Button';
import { Combobox } from '../../ui/Combobox';
import { InlineStatus, type InlineState } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { MoneyField } from '../../ui/MoneyField';
import { PhotoSlot } from '../../ui/PhotoSlot';
import type { ReceiptRow, StockRow } from '../stock/useStock';
import type { ArrivalLine } from './arrivalDraft';

type Errors = Partial<Record<'variant' | 'qty' | 'cost', string>>;

interface Props {
  stock: StockRow[];
  receipts: ReceiptRow[];
  lines: ArrivalLine[];
  onAdd(line: ArrivalLine): void;
}

export function ItemLine({ row }: { row: Pick<StockRow, 'name' | 'sku' | 'photo_path' | 'available_qty'> }) {
  return (
    <span className="item-line">
      <PhotoSlot size={40} path={row.photo_path} />
      <span className="item-line__text">
        <span className="item-line__name">{row.name}</span>
        <span className="item-line__meta">
          {row.sku}, {row.available_qty} disponible{row.available_qty > 1 ? 's' : ''}
        </span>
      </span>
    </span>
  );
}

export function ExistingModelForm({ stock, receipts, lines, onAdd }: Props) {
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<{ state: InlineState; text: string }>({ state: 'idle', text: '' });

  const lastCost = selected
    ? receipts.flatMap((r) => r.lines).find((l) => l.variant_id === selected.variant_id)?.unit_cost_cents
    : undefined;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const e: Errors = {};
    if (!selected) e.variant = 'Choisissez le modèle et la variante reçus.';
    else if (lines.some((l) => l.variantId === selected.variant_id))
      e.variant = 'Cette référence est déjà dans l’arrivage. Modifiez sa ligne dans le récapitulatif.';
    if (!/^\d+$/.test(qty.trim()) || Number(qty) < 1) e.qty = 'Indiquez une quantité entière, au moins 1.';
    if (parseMoney(cost) === null) e.cost = 'Indiquez un coût valide, par exemple 30 ou 30,50.';
    setErrors(e);
    if (Object.keys(e).length || !selected) {
      setStatus({ state: 'error', text: 'Corrigez les champs signalés.' });
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const n = Number(qty);
    onAdd({
      key: crypto.randomUUID(),
      variantId: selected.variant_id,
      sku: selected.sku,
      productName: selected.product_name,
      label: selected.label,
      qty: String(n),
      unitCost: cost.trim(),
      photoPath: selected.photo_path,
    });
    setStatus({ state: 'success', text: `Ligne ajoutée à l’arrivage : ${selected.sku}, ${n} pièce${n > 1 ? 's' : ''}.` });
    setSelected(null);
    setQty('');
    setCost('');
  }

  return (
    <form ref={formRef} className="panel arrival-form" aria-labelledby={titleId} onSubmit={onSubmit} noValidate>
      <h2 id={titleId} className="panel__title">
        Modèle existant
      </h2>
      {stock.length === 0 ? (
        <p className="muted">Les modèles apparaissent ici après la validation de leur premier arrivage.</p>
      ) : (
        <div className="form-grid">
          {selected ? (
            <div className="field">
              <span className="field__label">Modèle et variante</span>
              <div className="selected-item">
                <ItemLine row={selected} />
                <Button variant="ghost" size="small" onClick={() => setSelected(null)}>
                  Changer
                </Button>
              </div>
            </div>
          ) : (
            <Combobox
              label="Modèle et variante"
              items={stock.filter((s) => !s.archived)}
              getKey={(s) => s.variant_id}
              getText={(s) => `${s.name} ${s.sku}`}
              renderItem={(s) => <ItemLine row={s} />}
              onSelect={(s) => {
                setSelected(s);
                setErrors((e) => ({ ...e, variant: undefined }));
              }}
              placeholder="Nom, variante ou référence"
              error={errors.variant}
            />
          )}
          <div className="form-grid form-grid--2">
            <Field label="Quantité reçue" error={errors.qty}>
              {(p) => (
                <input
                  {...p}
                  className="input num"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              )}
            </Field>
            <MoneyField
              label="Nouveau coût d’achat unitaire"
              value={cost}
              onChange={setCost}
              error={errors.cost}
              hint={lastCost != null ? `Dernier coût : ${formatMoney(lastCost)}` : undefined}
            />
          </div>
          <div>
            <Button type="submit" variant="primary">
              Ajouter à l’arrivage
            </Button>
            <InlineStatus state={status.state}>{status.text}</InlineStatus>
          </div>
        </div>
      )}
    </form>
  );
}
