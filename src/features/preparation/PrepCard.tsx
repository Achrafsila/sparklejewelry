import { useId, useState, type FormEvent } from 'react';
import { useSWRConfig } from 'swr';
import { formatDateTime } from '../../lib/dates';
import { messageFor, toAppError } from '../../lib/errors';
import { parseMoney } from '../../lib/money';
import { callRpc } from '../../lib/rpc';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { InlineStatus } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { MoneyField } from '../../ui/MoneyField';
import { PhotoSlot } from '../../ui/PhotoSlot';
import '../offers/pickers.css';
import { ConfirmDialog } from '../../ui/Sheet';
import { ChannelBadge, StatusBadge } from '../../ui/StatusBadge';
import { groupedPieces } from '../orders/OrderSheet';
import { ORDERS_KEY, type OrderRow } from '../orders/useOrders';
import { SETTINGS_KEY, STOCK_KEY } from '../stock/useStock';

const OTHER = '__autre__';

interface Props {
  order: OrderRow;
  carriers: string[];
  onShipped(text: string): void;
}

/** One order to prepare: what was sold, the pieces to take out, then the shipment. */
export function PrepCard({ order, carriers, onShipped }: Props) {
  const titleId = useId();
  const { mutate } = useSWRConfig();
  const [pickError, setPickError] = useState<string | null>(null);
  const [carrier, setCarrier] = useState(carriers.length === 1 ? carriers[0]! : '');
  const [otherCarrier, setOtherCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [transport, setTransport] = useState('');
  const [errors, setErrors] = useState<{ carrier?: string; transport?: string }>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const prepare = useRequest<{ p_order_id: string }, { status: string }>('mark_prepared');
  const ship = useRequest<{ p_order_id: string; p_carrier: string; p_tracking: string; p_transport_cost_cents: number }, { status: string }>('ship_order');
  const cancel = useRequest<{ p_order_id: string }, { status: string }>('cancel_order');

  const pieces = groupedPieces(order);
  const allPicked = pieces.every((p) => p.picked);

  async function togglePiece(ids: string[], picked: boolean) {
    setPickError(null);
    const optimistic = (rows: OrderRow[] | undefined) =>
      rows?.map((o) => (o.id === order.id ? { ...o, items: o.items.map((i) => (ids.includes(i.id) ? { ...i, picked } : i)) } : o)) ?? [];
    try {
      await mutate(
        ORDERS_KEY,
        async (rows: OrderRow[] | undefined) => {
          for (const id of ids) await callRpc('set_item_picked', { p_item_id: id, p_picked: picked });
          return optimistic(rows);
        },
        { optimisticData: optimistic, rollbackOnError: true, revalidate: false },
      );
    } catch (e) {
      setPickError(`Coche non enregistrée. ${messageFor(toAppError(e))}`);
    }
  }

  async function onPrepared() {
    if (await prepare.run({ p_order_id: order.id })) await mutate(ORDERS_KEY);
  }

  async function onShip(e: FormEvent) {
    e.preventDefault();
    const name = carrier === OTHER ? otherCarrier.trim() : carrier;
    const cents = parseMoney(transport);
    const errs: typeof errors = {};
    if (!name) errs.carrier = 'Choisissez le transporteur.';
    if (cents === null) errs.transport = 'Indiquez le coût réel du transport, par exemple 35.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await ship.run({ p_order_id: order.id, p_carrier: name, p_tracking: tracking.trim(), p_transport_cost_cents: cents! });
    if (!r) return;
    onShipped(`Commande ${order.number} expédiée avec ${name}.`);
    await Promise.all([mutate(ORDERS_KEY), mutate(STOCK_KEY), mutate(SETTINGS_KEY)]);
  }

  async function onCancel() {
    const r = await cancel.run({ p_order_id: order.id });
    setConfirmCancel(false);
    if (r) {
      onShipped(`Commande ${order.number} annulée. Les pièces sont de nouveau disponibles.`);
      await Promise.all([mutate(ORDERS_KEY), mutate(STOCK_KEY)]);
    }
  }

  const error = prepare.error ?? ship.error ?? cancel.error;
  return (
    <article className="panel prep-card" aria-labelledby={titleId}>
      <header className="prep-card__head">
        <div>
          <h2 id={titleId} className="prep-card__title">
            {order.number}, {order.customer_name}
          </h2>
          <p className="muted">
            {order.customer_city}
            {order.confirmed_at ? `, confirmée le ${formatDateTime(order.confirmed_at)}` : ''}
          </p>
        </div>
        <div className="prep-card__badges">
          <ChannelBadge channel={order.channel} />
          <StatusBadge status={order.status} />
        </div>
      </header>

      <div className="prep-card__body">
        <section>
          <h3 className="section-title">Vendu</h3>
          <ul className="plain-list">
            {order.lines.map((l) => (
              <li key={l.id} className="plain-list__row">
                <span>
                  {l.offer_name}
                  {l.offer_kind !== 'custom_trio' && ` × ${l.qty}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="section-title">Pièces à sortir</h3>
          <ul className="pick-list">
            {pieces.map((p) => (
              <li key={p.variant_id}>
                <label className={p.picked ? 'pick is-picked' : 'pick'}>
                  <input
                    type="checkbox"
                    className="ref-picker__check"
                    checked={p.picked}
                    disabled={order.status !== 'confirmee'}
                    onChange={(e) => togglePiece(p.ids, e.target.checked)}
                  />
                  <PhotoSlot size={56} path={p.photo_path} />
                  <span className="item-line__text">
                    <span className="item-line__name">
                      {p.name} × {p.qty}
                    </span>
                    <span className="item-line__meta">{p.sku}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {pickError && (
            <p className="field__error" role="alert">
              {pickError}
            </p>
          )}
        </section>
      </div>

      {order.status === 'confirmee' ? (
        <div className="prep-card__actions">
          <div>
            <Button variant="primary" disabled={!allPicked} pending={prepare.pending} onClick={onPrepared}>
              Marquer préparée
            </Button>
            {!allPicked && <p className="field__hint">Cochez toutes les pièces sorties pour continuer.</p>}
          </div>
          <Button variant="danger" onClick={() => setConfirmCancel(true)}>
            Annuler la commande
          </Button>
        </div>
      ) : (
        <form className="ship-form" onSubmit={onShip} noValidate aria-label={`Expédition de ${order.number}`}>
          <div className="form-grid form-grid--3">
            <Field label="Transporteur" error={errors.carrier}>
              {(p) => (
                <select {...p} className="select" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                  <option value="">Choisir</option>
                  {carriers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={OTHER}>Autre transporteur</option>
                </select>
              )}
            </Field>
            {carrier === OTHER && (
              <Field label="Nom du transporteur">
                {(p) => <input {...p} className="input" value={otherCarrier} onChange={(e) => setOtherCarrier(e.target.value)} />}
              </Field>
            )}
            <Field label="Numéro de suivi" optional>
              {(p) => <input {...p} className="input" autoComplete="off" value={tracking} onChange={(e) => setTracking(e.target.value)} />}
            </Field>
            <MoneyField label="Coût réel du transport" value={transport} onChange={setTransport} error={errors.transport} />
          </div>
          <div className="prep-card__actions">
            <Button type="submit" variant="primary" pending={ship.pending}>
              Expédier
            </Button>
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>
              Annuler la commande
            </Button>
          </div>
        </form>
      )}
      <InlineStatus state={error ? 'error' : 'idle'}>{error && messageFor(error)}</InlineStatus>

      <ConfirmDialog
        open={confirmCancel}
        title={`Annuler la commande ${order.number} ?`}
        confirmLabel="Annuler la commande"
        cancelLabel="Garder la commande"
        danger
        pending={cancel.pending}
        onConfirm={onCancel}
        onCancel={() => setConfirmCancel(false)}
      >
        <p>Les pièces réservées redeviennent disponibles. Cette annulation est définitive.</p>
      </ConfirmDialog>
    </article>
  );
}
