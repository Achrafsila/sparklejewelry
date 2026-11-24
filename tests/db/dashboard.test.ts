import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { freshDb, rpc, type TestDb } from './helpers';
import { offer, shippedOrder, step, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let from: string;
let to: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  const { rows } = await db.pool.query(`
    select to_char(date_trunc('month', now() at time zone 'Africa/Casablanca'), 'YYYY-MM-DD') as f,
           to_char((date_trunc('month', now() at time zone 'Africa/Casablanca') + interval '1 month - 1 day'), 'YYYY-MM-DD') as t`);
  from = rows[0].f;
  to = rows[0].t;

  const v = await stock(admin, [{ sku: 'BRONZE', qty: 20, cost: 1000 }]);
  const bronze = await offer(admin, { name: 'Bronze', kind: 'unit', price_cents: 9500, items: [{ variant_id: v.BRONZE! }] });

  const o1 = await shippedOrder(admin, [{ offer_id: bronze, qty: 2 }], 'Amana', 3500);
  await step(admin, 'mark_delivered', o1);
  const o2 = await shippedOrder(admin, [{ offer_id: bronze, qty: 1 }], 'Amana', 3000);
  await step(admin, 'mark_delivered', o2);
  const o3 = await shippedOrder(admin, [{ offer_id: bronze, qty: 2 }], 'Amana', 3500);
  await step(admin, 'report_return', o3);
  const { rows: items } = await db.pool.query(`select id from order_items where order_id = $1`, [o3]);
  await rpc(admin, 'receive_return', {
    p_request_id: randomUUID(),
    p_order_id: o3,
    p_items: [{ item_id: items[0].id, damaged_qty: 1 }],
    p_return_fee_cents: 1500,
  });
  await rpc(admin, 'record_payout', {
    p_request_id: randomUUID(),
    p_carrier: 'Amana',
    p_received_on: from,
    p_reference: 'VIR-1',
    p_amount_cents: 18000,
    p_orders: [{ order_id: o1, received_cents: 18000 }],
  });
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

const dashboard = (channel: string | null = null) =>
  rpc(admin, 'dashboard', { p_from: from, p_to: to, p_channel: channel });

describe('dashboard', () => {
  test('sales, cash, expected payouts, returns and gaps for the period', async () => {
    const d = await dashboard();
    expect(d).toMatchObject({
      delivered_count: 2,
      items_revenue_cents: 28500,
      shipping_billed_cents: 7000,
      avg_basket_cents: 14250,
      cash_received_cents: 18000,
      expected_payouts_cents: 10000 - 5000,
      gaps_cents: -1000,
    });
    expect(d.returns).toMatchObject({ count: 1, fees_cents: 1500 });
    expect(Number(d.returns.rate)).toBeCloseTo(1 / 3, 3);
  });

  test('lists missing costs before the estimated margin', async () => {
    const d = await dashboard();
    expect(d.missing.map((m: any) => m.code).sort()).toEqual(['ad_spend_missing', 'packaging_unset']);
    expect(d.margin).toMatchObject({
      items_revenue_cents: 28500,
      shipping_billed_cents: 7000,
      cogs_cents: 3000,
      transport_cents: 6500,
      packaging_cents: 0,
      return_costs_cents: 5000,
      losses_cents: 1000,
      ad_spend_cents: 0,
      estimated_cents: 20000,
    });
  });

  test('once packaging and the month budget are set, the warnings go and the margin includes them', async () => {
    await db.pool.query(`update settings set packaging_cost_cents = 800`);
    await db.pool.query(`insert into ad_spend (month, amount_cents) values ($1, 30000)`, [from]);
    const d = await dashboard();
    expect(d.missing).toEqual([]);
    expect(d.margin).toMatchObject({
      packaging_cents: 1600,
      return_costs_cents: 5800,
      ad_spend_cents: 30000,
      estimated_cents: 28500 + 7000 - 3000 - 6500 - 1600 - 5800 - 1000 - 30000,
    });
  });

  test('a channel filter keeps the budget visible but out of the margin', async () => {
    const d = await dashboard('site');
    expect(d.delivered_count).toBe(0);
    expect(d.margin.ad_spend_cents).toBe(30000);
    expect(d.margin.estimated_cents).toBe(0);
  });

  test('low-stock references are listed', async () => {
    await db.pool.query(`update settings set low_stock_threshold = 50`);
    const d = await dashboard();
    expect(d.low_stock.map((x: any) => x.sku)).toEqual(['BRONZE']);
  });
});
