import useSWR from 'swr';
import type { AppError } from '../../lib/errors';
import { read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import type { OfferKind } from '../offers/useOffers';
import type { OrderStatus } from '../../ui/StatusBadge';

export interface OrderLineView {
  id: string;
  position: number;
  offer_id: string | null;
  offer_name: string;
  offer_kind: OfferKind;
  unit_price_cents: number;
  qty: number;
}

export interface OrderItemView {
  id: string;
  line_id: string;
  variant_id: string;
  sku: string;
  name: string;
  qty: number;
  picked: boolean;
  photo_path: string | null;
  unit_cost: number | null;
  returned_resalable: number | null;
  returned_damaged: number | null;
}

export interface OrderRow {
  id: string;
  number: string;
  channel: 'instagram' | 'site';
  status: OrderStatus;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_instagram: string | null;
  customer_city: string;
  customer_address: string;
  payment_method: 'cod' | 'prepaid';
  shipping_fee_cents: number;
  carrier: string | null;
  tracking: string | null;
  transport_cost_cents: number | null;
  packaging_cost_cents: number | null;
  return_fee_cents: number | null;
  created_at: string;
  confirmed_at: string | null;
  prepared_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  paid_at: string | null;
  return_reported_at: string | null;
  return_received_at: string | null;
  cancelled_at: string | null;
  items_total_cents: number;
  total_cents: number;
  expected_cents: number | null;
  payout_id: string | null;
  payout_reference: string | null;
  payout_received_on: string | null;
  received_cents: number | null;
  gap_cents: number | null;
  lines: OrderLineView[];
  items: OrderItemView[];
}

export const ORDERS_KEY = 'v_orders';

export function useOrders() {
  return useSWR<OrderRow[], AppError>(ORDERS_KEY, () =>
    read<OrderRow[]>(supabase.from('v_orders').select('*').order('created_at', { ascending: false })),
  );
}

export interface OrderEvent {
  id: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  note: string | null;
  created_at: string;
}

export function useOrderEvents(orderId: string | undefined) {
  return useSWR<OrderEvent[], AppError>(orderId ? ['order_events', orderId] : null, () =>
    read<OrderEvent[]>(supabase.from('order_events').select('*').eq('order_id', orderId!).order('created_at')),
  );
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  instagram: string | null;
  city: string;
  address: string;
}

export interface KnownCustomer extends Customer {
  orders: number;
  returns: number;
}

/** A customer already known by this phone number, with her order and return counts. */
export function useKnownCustomer(phone: string | null) {
  return useSWR<KnownCustomer | null, AppError>(phone ? ['customer', phone] : null, async () => {
    const customer = await read<Customer | null>(supabase.from('customers').select('*').eq('phone', phone!).maybeSingle());
    if (!customer) return null;
    const orders = await read<{ status: OrderStatus }[]>(
      supabase.from('orders').select('status').eq('customer_id', customer.id).neq('status', 'brouillon'),
    );
    return {
      ...customer,
      orders: orders.filter((o) => o.status !== 'annulee').length,
      returns: orders.filter((o) => o.status === 'retour_attendu' || o.status === 'retour_recu').length,
    };
  });
}
