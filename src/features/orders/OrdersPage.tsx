import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { ActionBar } from '../../app/ActionBar';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { normalizePhone } from '../../lib/phone';
import { Segmented } from '../../ui/Controls';
import { DataList, type Column } from '../../ui/DataList';
import { EmptyState } from '../../ui/EmptyState';
import { IconPlus, IconSearch } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { Sheet } from '../../ui/Sheet';
import { ChannelBadge, StatusBadge, type OrderStatus } from '../../ui/StatusBadge';
import { OrderDetails } from './OrderSheet';
import { useOrders, type OrderRow } from './useOrders';
import './orders.css';

type View = 'all' | 'drafts' | 'to_prepare' | 'shipping' | 'done' | 'returns' | 'cancelled';

const VIEWS: Record<View, { label: string; statuses: OrderStatus[] | null }> = {
  all: { label: 'Toutes', statuses: null },
  drafts: { label: 'Brouillons', statuses: ['brouillon'] },
  to_prepare: { label: 'À préparer', statuses: ['confirmee', 'preparee'] },
  shipping: { label: 'En livraison', statuses: ['en_livraison', 'livree'] },
  done: { label: 'Payées', statuses: ['payee'] },
  returns: { label: 'Retours', statuses: ['retour_attendu', 'retour_recu'] },
  cancelled: { label: 'Annulées', statuses: ['annulee'] },
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function OrdersPage() {
  const orderId = useMatch('/commandes/:orderId')?.params.orderId;
  const navigate = useNavigate();
  const orders = useOrders();
  const [view, setView] = useState<View>('all');
  const [channel, setChannel] = useState<'all' | 'instagram' | 'site'>('all');
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);

  const rows = useMemo(() => {
    if (!orders.data) return undefined;
    const statuses = VIEWS[view].statuses;
    const words = fold(q).split(/\s+/).filter(Boolean);
    const phone = normalizePhone(q);
    return orders.data.filter((o) => {
      if (statuses && !statuses.includes(o.status)) return false;
      if (channel !== 'all' && o.channel !== channel) return false;
      if (phone) return o.customer_phone === phone;
      const hay = fold(`${o.number} ${o.customer_name} ${o.customer_instagram ?? ''} ${o.customer_city} ${o.tracking ?? ''}`);
      return words.every((w) => hay.includes(w));
    });
  }, [orders.data, view, channel, q]);

  const count = (v: View) => (orders.data ?? []).filter((o) => !VIEWS[v].statuses || VIEWS[v].statuses!.includes(o.status)).length;
  const selected = orders.data?.find((o) => o.id === orderId) ?? null;

  const numberLink = (o: OrderRow) => (
    <Link to={`/commandes/${o.id}`} className="row-link" aria-label={`${o.number}, ${o.customer_name || 'sans nom'}`}>
      {o.number}
    </Link>
  );

  const columns: Column<OrderRow>[] = [
    { key: 'number', header: 'Commande', render: numberLink },
    {
      key: 'customer',
      header: 'Cliente',
      render: (o) => (
        <span className="item-line__text">
          <span>{o.customer_name || <span className="muted">Sans nom</span>}</span>
          <span className="item-line__meta">{[o.customer_instagram, o.customer_city].filter(Boolean).join(', ')}</span>
        </span>
      ),
    },
    { key: 'channel', header: 'Canal', render: (o) => <ChannelBadge channel={o.channel} /> },
    { key: 'status', header: 'Statut', render: (o) => <StatusBadge status={o.status} /> },
    { key: 'total', header: 'Total', numeric: true, render: (o) => formatMoney(o.total_cents) },
    { key: 'date', header: 'Date', numeric: true, render: (o) => formatDate(o.created_at) },
  ];

  return (
    <>
      <PageHeader
        title="Commandes"
        count={orders.data ? `${orders.data.length}` : undefined}
        actionsOnPhone={false}
        actions={
          <Link to="/commandes/nouvelle" className="btn btn--primary">
            <IconPlus size={18} aria-hidden="true" />
            Nouvelle commande Instagram
          </Link>
        }
        filters={
          <>
            <label className="search">
              <IconSearch size={18} aria-hidden="true" />
              <span className="visually-hidden">Rechercher une commande</span>
              <input
                className="input"
                type="search"
                placeholder="Numéro, nom, @pseudo, téléphone, suivi"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="visually-hidden" htmlFor="orders-channel">
              Canal
            </label>
            <select id="orders-channel" className="select select--compact" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="all">Tous les canaux</option>
              <option value="instagram">Instagram</option>
              <option value="site">Site</option>
            </select>
            <div className="scroll-x">
              <Segmented<View>
                label="Statut des commandes"
                value={view}
                onChange={setView}
                options={(Object.keys(VIEWS) as View[]).map((v) => ({ value: v, label: VIEWS[v].label, count: count(v) }))}
              />
            </div>
          </>
        }
      />
      <DataList
        label="Commandes"
        columns={columns}
        rows={rows}
        rowKey={(o) => o.id}
        loading={orders.isLoading}
        error={orders.error}
        onRetry={() => orders.mutate()}
        empty={
          orders.data?.length ? (
            <EmptyState title="Aucune commande ne correspond." text="Modifiez la recherche ou les filtres." />
          ) : (
            <EmptyState
              title="Aucune commande pour l’instant."
              text="Saisissez la première commande reçue en DM."
              action={
                <Link to="/commandes/nouvelle" className="btn btn--primary">
                  Nouvelle commande Instagram
                </Link>
              }
            />
          )
        }
        renderCard={(o) => (
          <Link to={`/commandes/${o.id}`} className="order-card">
            <span className="order-card__top">
              <b>{o.number}</b>
              <StatusBadge status={o.status} />
            </span>
            <span>{o.customer_name || 'Sans nom'}</span>
            <span className="order-card__bottom muted">
              <span>{formatDate(o.created_at)}</span>
              <span className="num">{formatMoney(o.total_cents)}</span>
            </span>
          </Link>
        )}
      />
      <ActionBar>
        <Link to="/commandes/nouvelle" className="btn btn--primary">
          <IconPlus size={18} aria-hidden="true" />
          Nouvelle commande Instagram
        </Link>
      </ActionBar>
      <Sheet open={selected != null} title={selected ? `${selected.number}, ${selected.customer_name || 'sans nom'}` : ''} onClose={() => navigate('/commandes')}>
        {selected && <OrderDetails key={selected.id} order={selected} onClosed={() => navigate('/commandes')} />}
      </Sheet>
    </>
  );
}
