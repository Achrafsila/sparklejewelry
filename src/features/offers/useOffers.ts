import useSWR from 'swr';
import type { AppError } from '../../lib/errors';
import { read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';

export type OfferKind = 'unit' | 'fixed_trio' | 'custom_trio';

export interface OfferItemView {
  variant_id: string;
  sku: string;
  name: string;
  product_name: string;
  label: string | null;
  photo_path: string | null;
  qty: number;
  price_cents: number | null;
  available_qty: number;
}

export interface OfferRow {
  id: string;
  name: string;
  kind: OfferKind;
  price_cents: number;
  photo_path: string | null;
  on_instagram: boolean;
  on_site: boolean;
  allow_repeat: boolean;
  archived: boolean;
  items: OfferItemView[];
  sellable: number;
  unit_sum_cents: number | null;
}

export const OFFERS_KEY = 'v_offers';

export function useOffers() {
  return useSWR<OfferRow[], AppError>(OFFERS_KEY, () =>
    read<OfferRow[]>(supabase.from('v_offers').select('*').order('archived').order('name')),
  );
}

export const KIND_LABELS: Record<OfferKind, string> = {
  unit: 'À l’unité',
  fixed_trio: 'Trio fixe',
  custom_trio: 'Trio à composer',
};

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** What can be sold right now, in the words of each format. */
export function availabilityLabel(kind: OfferKind, sellable: number): string {
  if (kind === 'unit') return plural(sellable, 'disponible', 'disponibles');
  if (kind === 'fixed_trio') return plural(sellable, 'trio réalisable', 'trios réalisables');
  return plural(sellable, 'pièce éligible disponible', 'pièces éligibles disponibles');
}

/** Cheapest active unit price of each reference, from the unit offers. */
export function minUnitPrices(offers: OfferRow[]): Map<string, number> {
  const prices = new Map<string, number>();
  for (const o of offers) {
    if (o.kind !== 'unit' || o.archived) continue;
    for (const i of o.items) {
      const p = i.price_cents ?? o.price_cents;
      const current = prices.get(i.variant_id);
      if (current == null || p < current) prices.set(i.variant_id, p);
    }
  }
  return prices;
}

/** Counts of each reference in a trio composition given as a list of variant ids. */
export function composition(ids: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** How many complete trios the available stock allows. */
export function buildableTrios(ids: string[], available: (variantId: string) => number): number {
  if (ids.length === 0) return 0;
  let min = Infinity;
  for (const [id, qty] of composition(ids)) min = Math.min(min, Math.floor(Math.max(0, available(id)) / qty));
  return Number.isFinite(min) ? min : 0;
}
