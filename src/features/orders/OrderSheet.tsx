import { useState } from 'react';
import { Link } from 'react-router';
import { useSWRConfig } from 'swr';
import { formatDateTime } from '../../lib/dates';
import { messageFor } from '../../lib/errors';
import { formatMoney } from '../../lib/money';
import { formatPhone } from '../../lib/phone';
import { callRpc } from '../../lib/rpc';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { InlineStatus, Notice } from '../../ui/Feedback';
import { PhotoSlot } from '../../ui/PhotoSlot';
import { ConfirmDialog } from '../../ui/Sheet';
import { ChannelBadge, STATUS_LABELS, StatusBadge } from '../../ui/StatusBadge';
import { STOCK_KEY } from '../stock/useStock';
import { ORDERS_KEY, useOrderEvents, type OrderRow } from './useOrders';

/** Pieces of an order grouped by reference (a trio's bronze and a single bronze make one line × 2). */
export function groupedPieces(order: OrderRow) {
  const groups = new Map<string, { variant_id: string; sku: string; name: string; photo_path: string | null; qty: number; ids: string[]; picked: boolean }>();
  for (const i of order.items) {
    const g = groups.get(i.variant_id);
    if (g) {
      g.qty += i.qty;
      g.ids.push(i.id);
      g.picked = g.picked && i.picked;
    } else {
      groups.set(i.variant_id, { variant_id: i.variant_id, sku: i.sku, name: i.name, photo_path: i.photo_path, qty: i.qty, ids: [i.id], picked: i.picked });
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function OrderDetails({ order, onClosed }: { order: OrderRow; onClosed(): void }) {
  const events = useOrderEvents(order.id);
  const { mutate } = useSWRConfig();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const cancel = useRequest<{ p_order_id: string }, { status: string }>('cancel_order');

  async function onCancel() {
    const r = await cancel.run({ p_order_id: order.id });
    setConfirmCancel(false);
    if (r) await Promise.all([mutate(ORDERS_KEY), mutate(STOCK_KEY)]);
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await callRpc('delete_draft', { p_order_id: order.id });
      setConfirmDelete(false);
      await mutate(ORDERS_KEY);
      onClosed();
    } catch (e) {
      setDeleteError(messageFor(e as never));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="order-head">
        <StatusBadge status={order.status} />
        <ChannelBadge channel={order.channel} />
        <span className="muted">{formatDateTime(order.created_at)}</span>
      </div>

      {order.status === 'brouillon' && (
        <Notice tone="info" title="Brouillon : aucune pièce réservée.">
          <p>
            <Link className="btn btn--primary btn--small" to={`/commandes/nouvelle?brouillon=${order.id}`}>
              Reprendre le brouillon
            </Link>
          </p>
        </Notice>
      )}

      <section>
        <h3 className="section-title">Cliente</h3>
        <p>{order.customer_name || <span className="muted">Nom non renseigné</span>}</p>
        <p className="muted">
          {[order.customer_phone && formatPhone(order.customer_phone), order.customer_instagram].filter(Boolean).join(', ')}
        </p>
        <p className="muted">{[order.customer_address, order.customer_city].filter(Boolean).join(', ')}</p>
      </section>

      <section>
        <h3 className="section-title">Composition vendue</h3>
        <ul className="plain-list">
          {order.lines.map((l) => (
            <li key={l.id} className="plain-list__row">
              <span>
                {l.offer_name}
                {l.offer_kind !== 'custom_trio' && ` × ${l.qty}`}
              </span>
              <span className="num">{formatMoney(l.unit_price_cents * l.qty)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="section-title">Pièces</h3>
        <ul className="pieces">
          {groupedPieces(order).map((p) => (
            <li key={p.variant_id} className="pieces__row">
              <PhotoSlot size={40} path={p.photo_path} />
              <span className="item-line__text">
                <span className="item-line__name">
                  {p.name} × {p.qty}
                </span>
                <span className="item-line__meta">{p.sku}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <dl className="kv">
        <dt>Bijoux</dt>
        <dd>{formatMoney(order.items_total_cents)}</dd>
        <dt>Livraison facturée</dt>
        <dd>{formatMoney(order.shipping_fee_cents)}</dd>
        <dt>Total</dt>
        <dd>
          <b>{formatMoney(order.total_cents)}</b>
        </dd>
        {order.carrier && (
          <>
            <dt>Transporteur</dt>
            <dd>
              {order.carrier}
              {order.tracking ? `, ${order.tracking}` : ''}
            </dd>
          </>
        )}
        {order.transport_cost_cents != null && (
          <>
            <dt>Transport réel</dt>
            <dd>{formatMoney(order.transport_cost_cents)}</dd>
          </>
        )}
        {order.expected_cents != null && (
          <>
            <dt>Attendu du transporteur</dt>
            <dd>{formatMoney(order.expected_cents)}</dd>
          </>
        )}
        {order.payout_id && (
          <>
            <dt>Versement</dt>
            <dd>
              <Link to={`/suivi/versements/${order.payout_id}`}>{order.payout_reference || 'Voir le versement'}</Link>
            </dd>
            <dt>Reçu</dt>
            <dd>{formatMoney(order.received_cents ?? 0)}</dd>
          </>
        )}
      </dl>
      {order.gap_cents != null && order.gap_cents !== 0 && (
        <Notice tone="warn" title={`Écart de versement : ${formatMoney(order.gap_cents)}`}>
          <p>Le montant reçu diffère du montant attendu pour cette commande.</p>
        </Notice>
      )}

      <section>
        <h3 className="section-title">Chronologie</h3>
        <ol className="timeline">
          {(events.data ?? []).map((e) => (
            <li key={e.id}>
              <span>{STATUS_LABELS[e.to_status]}</span>
              <span className="muted num">{formatDateTime(e.created_at)}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="order-sheet__actions">
        {(order.status === 'confirmee' || order.status === 'preparee') && (
          <>
            <Link className="btn btn--secondary" to="/preparation">
              Aller à la préparation
            </Link>
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>
              Annuler la commande
            </Button>
          </>
        )}
        {order.status === 'brouillon' && (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Supprimer le brouillon
          </Button>
        )}
        {['en_livraison', 'livree', 'payee', 'retour_attendu', 'retour_recu'].includes(order.status) && (
          <Link className="btn btn--secondary" to="/suivi">
            Voir le suivi
          </Link>
        )}
      </div>
      <InlineStatus state={cancel.error || deleteError ? 'error' : 'idle'}>{cancel.error ? messageFor(cancel.error) : deleteError}</InlineStatus>

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
      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer ce brouillon ?"
        confirmLabel="Supprimer"
        danger
        pending={deleting}
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>Aucune pièce n’était réservée. Le brouillon disparaît de la liste.</p>
      </ConfirmDialog>
    </>
  );
}
