export type OrderStatus =
  | 'brouillon'
  | 'confirmee'
  | 'preparee'
  | 'en_livraison'
  | 'livree'
  | 'payee'
  | 'retour_attendu'
  | 'retour_recu'
  | 'annulee';

type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neutral' | 'champagne';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  brouillon: 'Brouillon',
  confirmee: 'Confirmée',
  preparee: 'Préparée',
  en_livraison: 'Livraison en cours',
  livree: 'Livrée',
  payee: 'Payée',
  retour_attendu: 'Retour attendu',
  retour_recu: 'Retour reçu',
  annulee: 'Annulée',
};

const STATUS_TONES: Record<OrderStatus, Tone> = {
  brouillon: 'neutral',
  confirmee: 'champagne',
  preparee: 'champagne',
  en_livraison: 'info',
  livree: 'warn',
  payee: 'ok',
  retour_attendu: 'err',
  retour_recu: 'err',
  annulee: 'neutral',
};

const STOCK: Record<'low' | 'out' | 'ok', { label: string; tone: Tone }> = {
  low: { label: 'Stock bas', tone: 'warn' },
  out: { label: 'Rupture', tone: 'err' },
  ok: { label: 'En stock', tone: 'ok' },
};

/** Colored badge that always carries its meaning in words. */
export function Badge({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: OrderStatus | 'low' | 'out' | 'ok' }) {
  if (status === 'low' || status === 'out' || status === 'ok') {
    return <Badge tone={STOCK[status].tone}>{STOCK[status].label}</Badge>;
  }
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function ChannelBadge({ channel }: { channel: 'instagram' | 'site' }) {
  return <Badge tone="neutral">{channel === 'instagram' ? 'Instagram' : 'Site'}</Badge>;
}
