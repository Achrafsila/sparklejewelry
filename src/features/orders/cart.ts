import { useEffect, useState } from 'react';
import { clearDraft, loadDraft, saveDraft } from '../../lib/drafts';
import type { OfferRow } from '../offers/useOffers';

export interface CartLine {
  key: string;
  offerId: string;
  qty: number;
  /** Unit offer with several variants: the chosen one. */
  variantId?: string;
  /** Pick-your-trio: the three pieces agreed in DM. */
  picks?: string[];
}

export interface CustomerInput {
  phone: string;
  name: string;
  instagram: string;
  city: string;
  address: string;
}

export interface Cart {
  /** Set once the order exists on the server (saved draft). */
  orderId?: string;
  lines: CartLine[];
  customer: CustomerInput;
  shippingFee: string;
  step: 0 | 1 | 2;
}

const KEY = 'cart';
const VERSION = 1;

export const emptyCart = (): Cart => ({
  lines: [],
  customer: { phone: '', name: '', instagram: '', city: '', address: '' },
  shippingFee: '',
  step: 0,
});

/** The order being entered, kept on this device so an interruption loses nothing. */
export function useCart() {
  const [cart, setCart] = useState<Cart>(() => loadDraft<Cart>(KEY, VERSION) ?? emptyCart());
  useEffect(() => saveDraft(KEY, VERSION, cart), [cart]);
  return [cart, setCart, () => clearDraft(KEY)] as const;
}

export interface Piece {
  variantId: string;
  qty: number;
}

/** Pieces a cart line takes from stock. */
export function piecesOf(line: CartLine, offer: OfferRow | undefined): Piece[] {
  if (!offer) return [];
  if (offer.kind === 'unit') {
    const variantId = line.variantId ?? (offer.items.length === 1 ? offer.items[0]!.variant_id : undefined);
    return variantId ? [{ variantId, qty: line.qty }] : [];
  }
  if (offer.kind === 'fixed_trio') return offer.items.map((i) => ({ variantId: i.variant_id, qty: i.qty * line.qty }));
  return (line.picks ?? []).map((id) => ({ variantId: id, qty: 1 }));
}

/** Needs of the whole cart, added up by reference (a trio's bronze plus a single bronze = 2). */
export function needsOf(lines: CartLine[], offers: Map<string, OfferRow>): Map<string, number> {
  const needs = new Map<string, number>();
  for (const line of lines) {
    for (const p of piecesOf(line, offers.get(line.offerId))) needs.set(p.variantId, (needs.get(p.variantId) ?? 0) + p.qty);
  }
  return needs;
}

export function unitPriceOf(line: CartLine, offer: OfferRow | undefined): number {
  if (!offer) return 0;
  if (offer.kind === 'unit') {
    const item = offer.items.find((i) => i.variant_id === line.variantId) ?? (offer.items.length === 1 ? offer.items[0] : undefined);
    return item?.price_cents ?? offer.price_cents;
  }
  return offer.price_cents;
}

export const lineTotalOf = (line: CartLine, offer: OfferRow | undefined) =>
  unitPriceOf(line, offer) * (offer?.kind === 'custom_trio' ? 1 : line.qty);
