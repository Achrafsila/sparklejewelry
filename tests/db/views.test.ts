import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { freshDb, rpc, type TestDb } from './helpers';
import { offer, shippedOrder, step, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let v: Record<string, string>;
const o: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  v = await stock(admin, [
    { sku: 'BRONZE', qty: 5, product: 'Jonc', label: 'Bronze' },
    { sku: 'OR', qty: 4 },
    { sku: 'PERLE', qty: 3 },
  ]);
  o.bronze = await offer(admin, { name: 'Jonc bronze', kind: 'unit', price_cents: 9500, items: [{ variant_id: v.BRONZE! }] });
  o.or1 = await offer(admin, { name: 'Or', kind: 'unit', price_cents: 12000, items: [{ variant_id: v.OR! }] });
  o.or2 = await offer(admin, { name: 'Or promo', kind: 'unit', price_cents: 11000, on_site: true, items: [{ variant_id: v.OR! }] });
  o.trio = await offer(admin, {
    name: 'Trio jonc',
    kind: 'fixed_trio',
    price_cents: 26000,
    on_site: true,
    items: [{ variant_id: v.BRONZE!, qty: 2 }, { variant_id: v.OR!, qty: 1 }],
  });
  o.trioPerle = await offer(admin, {
    name: 'Trio perle',
    kind: 'fixed_trio',
    price_cents: 20000,
    items: [{ variant_id: v.PERLE!, qty: 2 }, { variant_id: v.OR!, qty: 1 }],
  });
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

describe('v_offers', () => {
  test('a fixed trio shows how many trios can be made', async () => {
    const { rows } = await admin.query(`select sellable from v_offers where id = $1`, [o.trio]);
    expect(rows[0].sellable).toBe(2);
  });

  test('a fixed trio compares its price with the cheapest unit prices of the same pieces', async () => {
    const { rows } = await admin.query(`select id, unit_sum_cents from v_offers where id = any($1)`, [[o.trio, o.trioPerle]]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.unit_sum_cents]));
    expect(byId[o.trio!]).toBe(2 * 9500 + 11000);
    expect(byId[o.trioPerle!]).toBeNull();
  });

  test('items carry their availability and display name', async () => {
    const { rows } = await admin.query(`select items from v_offers where id = $1`, [o.trio]);
    const bronze = rows[0].items.find((i: any) => i.sku === 'BRONZE');
    expect(bronze).toMatchObject({ name: 'Jonc Bronze', qty: 2, available_qty: 5 });
  });
});

describe('v_stock', () => {
  test('lists quantities, the low-stock flag and the offers using each reference', async () => {
    const { rows } = await admin.query(`select * from v_stock where sku = 'OR'`);
    expect(rows[0]).toMatchObject({ physical_qty: 4, reserved_qty: 0, available_qty: 4, is_low: true });
    expect(rows[0].offers.map((x: any) => x.name)).toEqual(['Or', 'Or promo', 'Trio jonc', 'Trio perle']);
  });
});

describe('v_orders, v_payouts and search', () => {
  test('an order shows its totals, expected payout and gap', async () => {
    const id = await shippedOrder(admin, [{ offer_id: o.bronze!, qty: 1 }], 'Amana', 3000);
    await step(admin, 'mark_delivered', id);
    await rpc(admin, 'record_payout', {
      p_request_id: randomUUID(),
      p_carrier: 'Amana',
      p_received_on: '2026-11-23',
      p_reference: 'VIR-777',
      p_amount_cents: 9000,
      p_orders: [{ order_id: id, received_cents: 9000 }],
    });
    const { rows } = await admin.query(`select * from v_orders where id = $1`, [id]);
    expect(rows[0]).toMatchObject({
      items_total_cents: 9500,
      total_cents: 13000,
      expected_cents: 10000,
      payout_reference: 'VIR-777',
      received_cents: 9000,
      gap_cents: -1000,
    });
    expect(rows[0].lines[0]).toMatchObject({ offer_name: 'Jonc bronze', qty: 1 });
    expect(rows[0].items[0]).toMatchObject({ sku: 'BRONZE', qty: 1 });
    const p = await admin.query(`select * from v_payouts where reference = 'VIR-777'`);
    expect(p.rows[0]).toMatchObject({ expected_cents: 10000, gap_cents: -1000, order_count: 1 });

    const found = await rpc(admin, 'search_all', { p_query: '06 12 34 56 78' });
    expect(found.orders.map((x: any) => x.id)).toContain(id);
    const byNumber = await rpc(admin, 'search_all', { p_query: rows[0].number.toLowerCase() });
    expect(byNumber.orders[0].id).toBe(id);
    const bySku = await rpc(admin, 'search_all', { p_query: 'bron' });
    expect(bySku.variants.map((x: any) => x.sku)).toEqual(['BRONZE']);
    const byPayout = await rpc(admin, 'search_all', { p_query: 'vir-777' });
    expect(byPayout.payouts[0].reference).toBe('VIR-777');
  });
});

describe('v_receipts', () => {
  test('lists arrivals with their lines and total', async () => {
    const { rows } = await admin.query(`select * from v_receipts order by created_at limit 1`);
    expect(rows[0].supplier).toBe('Fixture');
    expect(rows[0].lines).toHaveLength(3);
    expect(rows[0].total_cents).toBe(12 * 1000);
  });
});

describe('shop_catalog', () => {
  test('the shop server reads only site offers, with capped availability', async () => {
    const service = await db.connect('service');
    const { rows } = await service.query(`select name, sellable from shop_catalog order by name`);
    service.release();
    expect(rows.map((r) => r.name)).toEqual(['Or promo', 'Trio jonc']);
  });

  test('the signed-in admin does not use the shop catalog', async () => {
    await expect(admin.query(`select * from shop_catalog`)).rejects.toThrow(/permission denied/);
  });
});
