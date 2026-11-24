import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { rpc } from './helpers';

export interface StockItem {
  sku: string;
  qty: number;
  cost?: number;
  product?: string;
  label?: string | null;
}

/** Receives new references through validate_receipt and returns their ids by sku. */
export async function stock(admin: pg.PoolClient, items: StockItem[]): Promise<Record<string, string>> {
  await rpc(admin, 'validate_receipt', {
    p_request_id: randomUUID(),
    p_supplier: 'Fixture',
    p_received_on: '2026-11-01',
    p_lines: items.map((i) => ({
      sku: i.sku,
      product_name: i.product ?? i.sku,
      label: i.label ?? null,
      qty: i.qty,
      unit_cost_cents: i.cost ?? 1000,
    })),
  });
  const { rows } = await admin.query(`select id, sku from variants where sku = any($1)`, [items.map((i) => i.sku)]);
  return Object.fromEntries(rows.map((r) => [r.sku, r.id]));
}

export interface OfferInput {
  name: string;
  kind: 'unit' | 'fixed_trio' | 'custom_trio';
  price_cents: number;
  items: { variant_id: string; qty?: number; price_cents?: number | null }[];
  on_instagram?: boolean;
  on_site?: boolean;
  allow_repeat?: boolean;
}

/** Creates an offer the way the admin UI does: direct inserts allowed by RLS. */
export async function offer(admin: pg.PoolClient, input: OfferInput): Promise<string> {
  const { rows } = await admin.query(
    `insert into offers (name, kind, price_cents, on_instagram, on_site, allow_repeat)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.name, input.kind, input.price_cents, input.on_instagram ?? true, input.on_site ?? false, input.allow_repeat ?? false],
  );
  const id = rows[0].id as string;
  for (const item of input.items) {
    await admin.query(`insert into offer_items (offer_id, variant_id, qty, price_cents) values ($1, $2, $3, $4)`, [
      id,
      item.variant_id,
      item.qty ?? 1,
      item.price_cents ?? null,
    ]);
  }
  return id;
}

export const customer = {
  name: 'Salma B.',
  phone: '06 12 34 56 78',
  instagram: '@salma.b',
  city: 'Rabat',
  address: '12 rue Oued Ziz, Agdal',
};

export interface LineInput {
  offer_id: string;
  qty: number;
  variant_id?: string;
  picks?: string[];
  unit_price_cents?: number;
}

export async function draft(
  admin: pg.PoolClient,
  lines: LineInput[],
  extra: Record<string, unknown> = {},
): Promise<{ order_id: string; number: string }> {
  return rpc(admin, 'save_order_draft', {
    p_request_id: randomUUID(),
    p_order: { customer, shipping_fee_cents: 3500, lines, ...extra },
  });
}

export function confirm(admin: pg.PoolClient, orderId: string, request = randomUUID()) {
  return rpc(admin, 'confirm_order', { p_request_id: request, p_order_id: orderId });
}

/** Ticks every piece, marks the order prepared and ships it. */
export async function ship(admin: pg.PoolClient, orderId: string, carrier = 'Amana', transport = 3500) {
  const { rows } = await admin.query(`select id from order_items where order_id = $1`, [orderId]);
  for (const r of rows) await rpc(admin, 'set_item_picked', { p_item_id: r.id, p_picked: true });
  await rpc(admin, 'mark_prepared', { p_request_id: randomUUID(), p_order_id: orderId });
  return rpc(admin, 'ship_order', {
    p_request_id: randomUUID(),
    p_order_id: orderId,
    p_carrier: carrier,
    p_tracking: 'TRK-' + orderId.slice(0, 6),
    p_transport_cost_cents: transport,
  });
}

/** Draft, confirm and ship in one go. */
export async function shippedOrder(admin: pg.PoolClient, lines: LineInput[], carrier = 'Amana', transport = 3500) {
  const d = await draft(admin, lines);
  await confirm(admin, d.order_id);
  await ship(admin, d.order_id, carrier, transport);
  return d.order_id;
}

export function step(admin: pg.PoolClient, fn: string, orderId: string, extra: Record<string, unknown> = {}) {
  return rpc(admin, fn, { p_request_id: randomUUID(), p_order_id: orderId, ...extra });
}

export async function quantities(pool: pg.Pool, id: string) {
  const { rows } = await pool.query(`select physical_qty, reserved_qty, available_qty from variants where id = $1`, [id]);
  return rows[0] as { physical_qty: number; reserved_qty: number; available_qty: number };
}
