import useSWR from 'swr';
import { read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import type { AppError } from '../../lib/errors';

export interface StockRow {
  variant_id: string;
  product_id: string;
  product_name: string;
  label: string | null;
  name: string;
  sku: string;
  photo_path: string | null;
  physical_qty: number;
  reserved_qty: number;
  available_qty: number;
  avg_cost: number;
  cost_known: boolean;
  is_low: boolean;
  archived: boolean;
  offers: { id: string; name: string }[];
}

export const STOCK_KEY = 'v_stock';

export function useStock() {
  return useSWR<StockRow[], AppError>(STOCK_KEY, () =>
    read<StockRow[]>(supabase.from('v_stock').select('*').order('product_name').order('label', { nullsFirst: true })),
  );
}

export interface ReceiptRow {
  id: string;
  supplier: string;
  received_on: string;
  created_at: string;
  lines: { variant_id: string; sku: string; name: string; qty: number; unit_cost_cents: number }[];
  total_cents: number;
}

export const RECEIPTS_KEY = 'v_receipts';

export function useReceipts() {
  return useSWR<ReceiptRow[], AppError>(RECEIPTS_KEY, () =>
    read<ReceiptRow[]>(supabase.from('v_receipts').select('*').order('received_on', { ascending: false }).order('created_at', { ascending: false })),
  );
}

export interface MovementRow {
  id: number;
  kind: string;
  physical_delta: number;
  reserved_delta: number;
  note: string | null;
  created_at: string;
  order_id: string | null;
}

export function useMovements(variantId: string | undefined) {
  return useSWR<MovementRow[], AppError>(variantId ? ['movements', variantId] : null, () =>
    read<MovementRow[]>(
      supabase
        .from('stock_movements')
        .select('id, kind, physical_delta, reserved_delta, note, created_at, order_id')
        .eq('variant_id', variantId!)
        .order('created_at', { ascending: false })
        .limit(30),
    ),
  );
}

export interface Settings {
  low_stock_threshold: number;
  packaging_cost_cents: number | null;
  default_shipping_fee_cents: number | null;
  carriers: string[];
}

export const SETTINGS_KEY = 'settings';

export function useSettings() {
  return useSWR<Settings, AppError>(SETTINGS_KEY, () =>
    read<Settings>(supabase.from('settings').select('low_stock_threshold, packaging_cost_cents, default_shipping_fee_cents, carriers').single()),
  );
}

export const MOVEMENT_LABELS: Record<string, string> = {
  arrivage: 'Arrivage',
  reservation: 'Réservation',
  liberation: 'Réservation levée',
  expedition: 'Expédition',
  retour_revendable: 'Retour remis en stock',
  retour_perte: 'Pièce abîmée au retour',
  correction: 'Correction',
  import: 'Import du prototype',
};
