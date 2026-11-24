import { useId, useState } from 'react';
import { Link, useMatch, useNavigate, useSearchParams } from 'react-router';
import { useSWRConfig } from 'swr';
import { ActionBar } from '../../app/ActionBar';
import { formatDate } from '../../lib/dates';
import { messageFor } from '../../lib/errors';
import { formatMoney, parseMoney } from '../../lib/money';
import { useRequest } from '../../lib/useRequest';
import { Button } from '../../ui/Button';
import { Segmented, Skeleton } from '../../ui/Controls';
import { DataList, type Column } from '../../ui/DataList';
import { EmptyState } from '../../ui/EmptyState';
import { InlineStatus, Notice } from '../../ui/Feedback';
import { IconPayout } from '../../ui/icons';
import { MoneyField } from '../../ui/MoneyField';
import { PageHeader } from '../../ui/PageHeader';
import { ConfirmDialog, Sheet } from '../../ui/Sheet';
import { Badge, StatusBadge } from '../../ui/StatusBadge';
import { ORDERS_KEY, useOrders, type OrderRow } from '../orders/useOrders';
import { STOCK_KEY } from '../stock/useStock';
import { ReturnForm } from './ReturnForm';
import { usePayouts, type PayoutRow } from './usePayouts';
import '../preparation/preparation.css';
import './tracking.css';

type View = 'shipping' | 'delivered' | 'paid' | 'returns' | 'payouts';

const VIEW_STATUSES: Record<Exclude<View, 'payouts'>, OrderRow['status'][]> = {
  shipping: ['en_livraison'],
  delivered: ['livree'],
  paid: ['payee'],
  returns: ['retour_attendu', 'retour_recu'],
};

function TrackCard({ order, onMessage, onReceive }: { order: OrderRow; onMessage(text: string): void; onReceive(order: OrderRow): void }) {
  const titleId = useId();
  const { mutate } = useSWRConfig();
  const [reporting, setReporting] = useState(false);
  const [fee, setFee] = useState('');
  const delivered = useRequest<{ p_order_id: string }, { status: string }>('mark_delivered');
  const report = useRequest<{ p_order_id: string; p_return_fee_cents: number | null }, { status: string }>('report_return');

  async function onDelivered() {
    if (await delivered.run({ p_order_id: order.id })) {
      onMessage(`Commande ${order.number} livrée.`);
      await mutate(ORDERS_KEY);
    }
  }

  async function onReport() {
    const r = await report.run({ p_order_id: order.id, p_return_fee_cents: fee.trim() ? parseMoney(fee) : null });
    setReporting(false);
    if (r) {
      onMessage(`Retour signalé pour ${order.number}.`);
      await mutate(ORDERS_KEY);
    }
  }

  const error = delivered.error ?? report.error;
  return (
    <article className="panel track-card" aria-labelledby={titleId}>
      <header className="prep-card__head">
        <div>
          <h2 id={titleId} className="prep-card__title">
            <Link to={`/commandes/${order.id}`} className="row-link">
              {order.number}
            </Link>
            , {order.customer_name}
          </h2>
          <p className="muted">
            {[order.carrier, order.tracking, order.customer_city].filter(Boolean).join(', ')}
            {order.shipped_at ? `, expédiée le ${formatDate(order.shipped_at)}` : ''}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </header>

      <dl className="kv">
        <dt>Encaissé par le livreur</dt>
        <dd>{order.payment_method === 'prepaid' ? 'Payé en ligne à l’avance' : formatMoney(order.total_cents)}</dd>
        {order.status === 'livree' && order.expected_cents != null && (
          <>
            <dt>
              <b>À recevoir du transporteur : {formatMoney(order.expected_cents)}</b>
            </dt>
            <dd className="muted">net de ses frais</dd>
          </>
        )}
        {order.status === 'payee' && (
          <>
            <dt>Versement</dt>
            <dd>{order.payout_reference || '—'}</dd>
            <dt>Reçu</dt>
            <dd>{formatMoney(order.received_cents ?? 0)}</dd>
          </>
        )}
        {(order.status === 'retour_attendu' || order.status === 'retour_recu') && (
          <>
            <dt>Frais du transporteur</dt>
            <dd>{formatMoney((order.transport_cost_cents ?? 0) + (order.return_fee_cents ?? 0))}</dd>
          </>
        )}
      </dl>
      {order.gap_cents != null && order.gap_cents !== 0 && (
        <Notice tone="warn" title={`Écart de versement : ${formatMoney(order.gap_cents)}`} />
      )}
      {order.status === 'retour_recu' && (
        <p className="muted">
          {order.items.reduce((s, i) => s + (i.returned_resalable ?? 0), 0)} remise(s) en stock,{' '}
          {order.items.reduce((s, i) => s + (i.returned_damaged ?? 0), 0)} abîmée(s).
        </p>
      )}

      <div className="prep-card__actions">
        {order.status === 'en_livraison' && (
          <>
            <Button variant="primary" pending={delivered.pending} onClick={onDelivered}>
              Marquer livrée
            </Button>
            <Button variant="secondary" onClick={() => setReporting(true)}>
              Signaler un retour
            </Button>
          </>
        )}
        {order.status === 'retour_attendu' && (
          <Button variant="primary" onClick={() => onReceive(order)}>
            Réceptionner le retour
          </Button>
        )}
      </div>
      <InlineStatus state={error ? 'error' : 'idle'}>{error && messageFor(error)}</InlineStatus>

      <ConfirmDialog
        open={reporting}
        title={`Signaler un retour pour ${order.number} ?`}
        confirmLabel="Signaler le retour"
        pending={report.pending}
        onConfirm={onReport}
        onCancel={() => setReporting(false)}
      >
        <p>Le colis a été refusé ou renvoyé. Les pièces reviendront en stock après contrôle, à la réception.</p>
        <MoneyField label="Frais de retour, si déjà connus" value={fee} onChange={setFee} optional />
      </ConfirmDialog>
    </article>
  );
}

function PayoutDetails({ payout, orders }: { payout: PayoutRow; orders: OrderRow[] }) {
  return (
    <>
      <dl className="kv">
        <dt>Transporteur</dt>
        <dd>{payout.carrier}</dd>
        <dt>Reçu le</dt>
        <dd>{formatDate(payout.received_on)}</dd>
        <dt>Montant reçu</dt>
        <dd>{formatMoney(payout.amount_received_cents)}</dd>
        <dt>Attendu</dt>
        <dd>{formatMoney(payout.expected_cents)}</dd>
      </dl>
      {payout.gap_cents !== 0 ? (
        <Notice tone="warn" title={`Écart : ${formatMoney(payout.gap_cents)}`}>
          <p>À vérifier avec le relevé du transporteur.</p>
        </Notice>
      ) : (
        <Notice tone="ok" title="Écart : 0,00 MAD" />
      )}
      <section>
        <h3 className="section-title">Commandes rapprochées</h3>
        <ul className="plain-list">
          {orders.map((o) => (
            <li key={o.id} className="plain-list__row">
              <span>
                <Link to={`/commandes/${o.id}`}>{o.number}</Link> {o.customer_name}
                {o.gap_cents ? <span className="field__error"> écart {formatMoney(o.gap_cents)}</span> : null}
              </span>
              <span className="num">{formatMoney(o.received_cents ?? 0)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function TrackingPage() {
  const payoutId = useMatch('/suivi/versements/:payoutId')?.params.payoutId;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const orders = useOrders();
  const payouts = usePayouts();
  const { mutate } = useSWRConfig();
  const [message, setMessage] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<OrderRow | null>(null);
  const view = (params.get('vue') as View | null) ?? 'shipping';

  const list = (v: Exclude<View, 'payouts'>) => (orders.data ?? []).filter((o) => VIEW_STATUSES[v].includes(o.status));
  const selectedPayout = payouts.data?.find((p) => p.id === payoutId) ?? null;

  const payoutColumns: Column<PayoutRow>[] = [
    {
      key: 'ref',
      header: 'Référence',
      render: (p) => (
        <Link to={`/suivi/versements/${p.id}`} className="row-link">
          {p.reference || 'Sans référence'}
        </Link>
      ),
    },
    { key: 'carrier', header: 'Transporteur', render: (p) => p.carrier },
    { key: 'date', header: 'Reçu le', render: (p) => formatDate(p.received_on) },
    { key: 'count', header: 'Commandes', numeric: true, render: (p) => p.order_count },
    { key: 'amount', header: 'Reçu', numeric: true, render: (p) => formatMoney(p.amount_received_cents) },
    {
      key: 'gap',
      header: 'Écart',
      numeric: true,
      render: (p) => (p.gap_cents === 0 ? <span className="muted">0</span> : <Badge tone="warn">{formatMoney(p.gap_cents)}</Badge>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Suivi"
        actionsOnPhone={false}
        actions={
          <Link to="/suivi/versements/nouveau" className="btn btn--primary">
            <IconPayout size={18} aria-hidden="true" />
            Enregistrer un versement
          </Link>
        }
        filters={
          <div className="scroll-x">
            <Segmented<View>
              label="Étape du colis"
              value={view}
              onChange={(v) => setParams(v === 'shipping' ? {} : { vue: v }, { replace: true })}
              options={[
                { value: 'shipping', label: 'Livraison en cours', count: list('shipping').length },
                { value: 'delivered', label: 'Livrée', count: list('delivered').length },
                { value: 'paid', label: 'Payée', count: list('paid').length },
                { value: 'returns', label: 'Retour', count: list('returns').length },
                { value: 'payouts', label: 'Versements', count: payouts.data?.length ?? 0 },
              ]}
            />
          </div>
        }
      />
      <InlineStatus state={message ? 'success' : 'idle'}>{message}</InlineStatus>

      {view === 'payouts' ? (
        <DataList
          label="Versements"
          columns={payoutColumns}
          rows={payouts.data}
          rowKey={(p) => p.id}
          loading={payouts.isLoading}
          error={payouts.error}
          onRetry={() => payouts.mutate()}
          empty={<EmptyState title="Aucun versement enregistré." text="Enregistrez chaque virement du transporteur avec son relevé." />}
          renderCard={(p) => (
            <Link to={`/suivi/versements/${p.id}`} className="order-card">
              <span className="order-card__top">
                <b>{p.reference || 'Sans référence'}</b>
                {p.gap_cents !== 0 && <Badge tone="warn">{`Écart ${formatMoney(p.gap_cents)}`}</Badge>}
              </span>
              <span className="order-card__bottom muted">
                <span>
                  {p.carrier}, {formatDate(p.received_on)}
                </span>
                <span className="num">{formatMoney(p.amount_received_cents)}</span>
              </span>
            </Link>
          )}
        />
      ) : !orders.data ? (
        <Skeleton rows={3} />
      ) : list(view).length === 0 ? (
        <EmptyState
          title={
            {
              shipping: 'Aucun colis en cours de livraison.',
              delivered: 'Aucune commande livrée en attente de versement.',
              paid: 'Aucune commande payée pour l’instant.',
              returns: 'Aucun retour.',
            }[view]
          }
        />
      ) : (
        <div className="prep-list">
          {list(view).map((o) => (
            <TrackCard key={o.id} order={o} onMessage={setMessage} onReceive={setReceiving} />
          ))}
        </div>
      )}

      <ActionBar>
        <Link to="/suivi/versements/nouveau" className="btn btn--primary">
          <IconPayout size={18} aria-hidden="true" />
          Enregistrer un versement
        </Link>
      </ActionBar>

      <Sheet open={receiving != null} title={receiving ? `Réceptionner le retour ${receiving.number}` : ''} onClose={() => setReceiving(null)}>
        {receiving && (
          <ReturnForm
            order={receiving}
            onDone={(text) => {
              setMessage(text);
              setReceiving(null);
              void mutate(ORDERS_KEY);
              void mutate(STOCK_KEY);
            }}
          />
        )}
      </Sheet>
      <Sheet open={selectedPayout != null} title={selectedPayout ? `Versement ${selectedPayout.reference || 'sans référence'}` : ''} onClose={() => navigate('/suivi?vue=payouts')}>
        {selectedPayout && <PayoutDetails payout={selectedPayout} orders={(orders.data ?? []).filter((o) => o.payout_id === selectedPayout.id)} />}
      </Sheet>
    </>
  );
}
