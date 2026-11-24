import { useState, type FormEvent } from 'react';
import { centsToInput, parseMoney } from '../../lib/money';
import { messageFor } from '../../lib/errors';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { InlineStatus } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { MoneyField } from '../../ui/MoneyField';
import { PhotoSlot } from '../../ui/PhotoSlot';
import type { OrderRow } from '../orders/useOrders';

interface Props {
  order: OrderRow;
  onDone(text: string): void;
}

/** After checking the parcel: every piece counts as resalable unless marked damaged. */
export function ReturnForm({ order, onDone }: Props) {
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [fee, setFee] = useState(order.return_fee_cents != null ? centsToInput(order.return_fee_cents) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const receive = useRequest<{ p_order_id: string; p_items: object[]; p_return_fee_cents: number }, { status: string }>('receive_return');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const items = order.items.map((i) => {
      const raw = (damaged[i.id] ?? '0').trim() || '0';
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || n > i.qty) errs[i.id] = `Entre 0 et ${i.qty}.`;
      return { item_id: i.id, damaged_qty: n };
    });
    const feeCents = parseMoney(fee);
    if (feeCents === null) errs.fee = 'Indiquez les frais de retour facturés par le transporteur (0 si aucun).';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await receive.run({ p_order_id: order.id, p_items: items, p_return_fee_cents: feeCents! });
    if (!r) return;
    const lost = items.reduce((s, i) => s + i.damaged_qty, 0);
    const total = order.items.reduce((s, i) => s + i.qty, 0);
    const back = total - lost;
    onDone(
      `Retour ${order.number} enregistré : ${back} pièce${back > 1 ? 's' : ''} remise${back > 1 ? 's' : ''} en stock, ${lost} pièce${lost > 1 ? 's' : ''} abîmée${lost > 1 ? 's' : ''}.`,
    );
  }

  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <p>Indiquez seulement les pièces abîmées. Les autres reviennent en vente automatiquement.</p>
      <ul className="pick-list">
        {order.items.map((i) => (
          <li key={i.id} className="return-row">
            <PhotoSlot size={56} path={i.photo_path} />
            <span className="item-line__text">
              <span className="item-line__name">
                {i.name} × {i.qty}
              </span>
              <span className="item-line__meta">{i.sku}</span>
            </span>
            <Field label={`Pièces abîmées : ${i.name}`} error={errors[i.id]} className="return-row__field">
              {(p) => (
                <input
                  {...p}
                  className="input num"
                  inputMode="numeric"
                  placeholder="0"
                  value={damaged[i.id] ?? ''}
                  onChange={(e) => setDamaged((d) => ({ ...d, [i.id]: e.target.value }))}
                />
              )}
            </Field>
          </li>
        ))}
      </ul>
      <MoneyField label="Frais de retour" value={fee} onChange={setFee} error={errors.fee} hint="Facturés par le transporteur pour ce retour." />
      <div>
        <Button type="submit" variant="primary" pending={receive.pending}>
          Valider le retour
        </Button>
        <InlineStatus state={receive.error ? 'error' : 'idle'}>{receive.error && messageFor(receive.error)}</InlineStatus>
      </div>
    </form>
  );
}
