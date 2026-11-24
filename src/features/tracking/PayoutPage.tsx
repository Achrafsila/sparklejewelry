import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useSWRConfig } from 'swr';
import { todayIso } from '../../lib/dates';
import { messageFor } from '../../lib/errors';
import { centsToInput, formatMoney, parseMoney } from '../../lib/money';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Controls';
import { EmptyState } from '../../ui/EmptyState';
import { InlineStatus, Notice } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { IconBack } from '../../ui/icons';
import { MoneyField } from '../../ui/MoneyField';
import { PageHeader } from '../../ui/PageHeader';
import { StatusBadge } from '../../ui/StatusBadge';
import { ORDERS_KEY, useOrders } from '../orders/useOrders';
import { PAYOUTS_KEY } from './usePayouts';
import '../offers/pickers.css';
import './tracking.css';

const key = (s: string | null) => (s ?? '').trim().toLowerCase();

/** One carrier transfer matched against the orders it pays (or the returns it charges). */
export function PayoutPage() {
  const orders = useOrders();
  const { mutate } = useSWRConfig();
  const [carrier, setCarrier] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [perOrder, setPerOrder] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<{ carrier?: string; amount?: string; orders?: string }>({});
  const [done, setDone] = useState<{ id: string; reference: string } | null>(null);
  const record = useRequest<
    { p_carrier: string; p_received_on: string; p_reference: string; p_amount_cents: number; p_orders: object[] },
    { payout_id: string; gap_cents: number }
  >('record_payout');

  const eligible = useMemo(
    () => (orders.data ?? []).filter((o) => ['livree', 'retour_attendu', 'retour_recu'].includes(o.status) && !o.payout_id),
    [orders.data],
  );
  const carriers = [...new Set(eligible.map((o) => o.carrier ?? '').filter(Boolean))].sort();
  const forCarrier = eligible.filter((o) => key(o.carrier) === key(carrier));
  const selected = forCarrier.filter((o) => checked[o.id]);
  const expected = selected.reduce((s, o) => s + (o.expected_cents ?? 0), 0);
  const perOrderSum = selected.reduce((s, o) => s + (parseMoney(perOrder[o.id] ?? centsToInput(o.expected_cents)) ?? 0), 0);
  const received = parseMoney(amount);
  const gap = received != null ? received - expected : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!carrier) errs.carrier = 'Choisissez le transporteur du versement.';
    if (received === null) errs.amount = 'Indiquez le montant reçu, par exemple 1 250,00.';
    if (selected.length === 0) errs.orders = 'Cochez les commandes couvertes par ce versement.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await record.run({
      p_carrier: carrier,
      p_received_on: receivedOn,
      p_reference: reference.trim(),
      p_amount_cents: received!,
      p_orders: selected.map((o) => ({
        order_id: o.id,
        received_cents: parseMoney(perOrder[o.id] ?? centsToInput(o.expected_cents)) ?? o.expected_cents,
      })),
    });
    if (!r) return;
    setDone({ id: r.payout_id, reference: reference.trim() });
    setChecked({});
    setPerOrder({});
    await Promise.all([mutate(ORDERS_KEY), mutate(PAYOUTS_KEY)]);
  }

  return (
    <>
      <Link to="/suivi" className="back-link">
        <IconBack size={18} aria-hidden="true" />
        Suivi
      </Link>
      <PageHeader title="Nouveau versement" />
      {done && (
        <Notice tone="ok" title={`Versement ${done.reference || 'sans référence'} enregistré.`}>
          <p>
            <Link to={`/suivi/versements/${done.id}`}>Voir le versement</Link>
          </p>
        </Notice>
      )}
      {!orders.data ? (
        <Skeleton rows={3} />
      ) : (
        <form className="payout" onSubmit={onSubmit} noValidate>
          <section className="panel form-grid form-grid--2">
            <Field label="Transporteur" error={errors.carrier}>
              {(p) => (
                <select
                  {...p}
                  className="select"
                  value={carrier}
                  onChange={(e) => {
                    setCarrier(e.target.value);
                    setChecked({});
                  }}
                >
                  <option value="">Choisir</option>
                  {carriers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Date de réception">
              {(p) => <input {...p} className="input" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />}
            </Field>
            <Field label="Référence du versement" optional hint="Celle du relevé ou du virement.">
              {(p) => <input {...p} className="input" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />}
            </Field>
            <MoneyField label="Montant reçu" value={amount} onChange={setAmount} error={errors.amount} />
          </section>

          <section className="panel" aria-labelledby="payout-orders">
            <h2 id="payout-orders" className="panel__title">
              Commandes du relevé
            </h2>
            {!carrier ? (
              <p className="muted">Choisissez le transporteur pour voir ses commandes livrées et ses retours non rapprochés.</p>
            ) : forCarrier.length === 0 ? (
              <EmptyState title="Aucune commande à rapprocher pour ce transporteur." />
            ) : (
              <ul className="payout-orders">
                {forCarrier.map((o) => (
                  <li key={o.id} className={checked[o.id] ? 'payout-order is-chosen' : 'payout-order'}>
                    <label className="payout-order__check">
                      <input
                        type="checkbox"
                        className="ref-picker__check"
                        checked={!!checked[o.id]}
                        onChange={(e) => setChecked((c) => ({ ...c, [o.id]: e.target.checked }))}
                      />
                      <span className="item-line__text">
                        <span className="item-line__name">
                          {o.number}, {o.customer_name}
                        </span>
                        <span className="item-line__meta">
                          Attendu {formatMoney(o.expected_cents ?? 0)}
                          {o.status !== 'livree' && ' (retour : frais du transporteur)'}
                        </span>
                      </span>
                    </label>
                    <StatusBadge status={o.status} />
                    {checked[o.id] && (
                      <label className="payout-order__received">
                        <span className="arrival-line__caption">Reçu</span>
                        <input
                          className="input num"
                          inputMode="decimal"
                          aria-label={`Reçu pour ${o.number}`}
                          value={perOrder[o.id] ?? centsToInput(o.expected_cents)}
                          onChange={(e) => setPerOrder((p) => ({ ...p, [o.id]: e.target.value }))}
                        />
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {errors.orders && (
              <p className="field__error" role="alert">
                {errors.orders}
              </p>
            )}
          </section>

          <section className="panel payout-totals" aria-label="Rapprochement">
            <p className="num">Attendu : {formatMoney(expected)}</p>
            <p className="num">Reçu : {received != null ? formatMoney(received) : '—'}</p>
            <p className={gap ? 'num payout-gap is-gap' : 'num payout-gap'}>Écart : {gap != null ? formatMoney(gap) : '—'}</p>
            {selected.length > 0 && received != null && perOrderSum !== received && (
              <p className="field__hint">
                La somme des montants par commande ({formatMoney(perOrderSum)}) diffère du montant reçu : ajustez les lignes selon le relevé.
              </p>
            )}
            <div>
              <Button type="submit" variant="primary" pending={record.pending}>
                Enregistrer le versement
              </Button>
              <InlineStatus state={record.error ? 'error' : 'idle'}>{record.error && messageFor(record.error)}</InlineStatus>
            </div>
          </section>
        </form>
      )}
    </>
  );
}
