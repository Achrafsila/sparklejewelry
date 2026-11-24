import useSWR from 'swr';
import type { AppError } from '../../lib/errors';
import { read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';

export interface PayoutRow {
  id: string;
  carrier: string;
  received_on: string;
  reference: string;
  amount_received_cents: number;
  created_at: string;
  expected_cents: number;
  gap_cents: number;
  order_count: number;
}

export const PAYOUTS_KEY = 'v_payouts';

export function usePayouts() {
  return useSWR<PayoutRow[], AppError>(PAYOUTS_KEY, () =>
    read<PayoutRow[]>(supabase.from('v_payouts').select('*').order('received_on', { ascending: false }).order('created_at', { ascending: false })),
  );
}
