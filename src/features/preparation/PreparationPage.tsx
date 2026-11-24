import { useState } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '../../ui/Controls';
import { EmptyState } from '../../ui/EmptyState';
import { InlineStatus } from '../../ui/Feedback';
import { PageHeader } from '../../ui/PageHeader';
import { useOrders } from '../orders/useOrders';
import { useSettings } from '../stock/useStock';
import { PrepCard } from './PrepCard';
import './preparation.css';

export function PreparationPage() {
  const orders = useOrders();
  const settings = useSettings();
  const [message, setMessage] = useState<string | null>(null);

  const toPrepare = (orders.data ?? [])
    .filter((o) => o.status === 'confirmee' || o.status === 'preparee')
    .sort((a, b) => (a.confirmed_at ?? a.created_at).localeCompare(b.confirmed_at ?? b.created_at));
  const confirmed = toPrepare.filter((o) => o.status === 'confirmee');
  const ready = toPrepare.filter((o) => o.status === 'preparee');
  const carriers = settings.data?.carriers ?? [];

  return (
    <>
      <PageHeader title="Préparation" count={orders.data ? `${confirmed.length} à préparer, ${ready.length} à expédier` : undefined} />
      <InlineStatus state={message ? 'success' : 'idle'}>{message}</InlineStatus>
      {!orders.data ? (
        <Skeleton rows={3} label="Chargement des commandes à préparer" />
      ) : toPrepare.length === 0 ? (
        <EmptyState
          title="Rien à préparer."
          text="Les commandes confirmées apparaissent ici, avec les pièces à sortir."
          action={
            <Link to="/commandes/nouvelle" className="btn btn--secondary">
              Nouvelle commande Instagram
            </Link>
          }
        />
      ) : (
        <div className="prep-list">
          {ready.length > 0 && <h2 className="prep-list__title">Prêtes à expédier</h2>}
          {ready.map((o) => (
            <PrepCard key={o.id} order={o} carriers={carriers} onShipped={setMessage} />
          ))}
          {confirmed.length > 0 && <h2 className="prep-list__title">À préparer</h2>}
          {confirmed.map((o) => (
            <PrepCard key={o.id} order={o} carriers={carriers} onShipped={setMessage} />
          ))}
        </div>
      )}
    </>
  );
}
