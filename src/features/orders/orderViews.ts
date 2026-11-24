import type { OrderStatus } from '../../ui/StatusBadge';

export type OrderView = 'all' | 'drafts' | 'to_prepare' | 'shipping' | 'delivered' | 'done' | 'returns' | 'cancelled';

/** Order list filters: each status belongs to the filter that names it. */
export const ORDER_VIEWS: Record<OrderView, { label: string; statuses: OrderStatus[] | null }> = {
  all: { label: 'Toutes', statuses: null },
  drafts: { label: 'Brouillons', statuses: ['brouillon'] },
  to_prepare: { label: 'À préparer', statuses: ['confirmee', 'preparee'] },
  shipping: { label: 'En livraison', statuses: ['en_livraison'] },
  delivered: { label: 'Livrées', statuses: ['livree'] },
  done: { label: 'Payées', statuses: ['payee'] },
  returns: { label: 'Retours', statuses: ['retour_attendu', 'retour_recu'] },
  cancelled: { label: 'Annulées', statuses: ['annulee'] },
};
