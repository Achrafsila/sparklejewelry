import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { assertLedger, expectError, freshDb, rpc, type TestDb } from './helpers';
import { confirm, draft, offer, quantities, ship, shippedOrder, step, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let v: Record<string, string>;
let bronze: string;
let argent: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  v = await stock(admin, [
    { sku: 'BRONZE', qty: 10, cost: 1000 },
    { sku: 'ARGENT', qty: 10, cost: 1200 },
  ]);
  bronze = await offer(admin, { name: 'Bronze', kind: 'unit', price_cents: 9500, items: [{ variant_id: v.BRONZE! }] });
  argent = await offer(admin, { name: 'Argent', kind: 'unit', price_cents: 8000, items: [{ variant_id: v.ARGENT! }] });
  await db.pool.query(`update settings set packaging_cost_cents = 800`);
});
afterEach(async () => {
  await assertLedger(db.pool);
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

async function order(id: string) {
  const { rows } = await db.pool.query(`select * from orders where id = $1`, [id]);
  return rows[0];
}

describe('preparation and shipping', () => {
  test('stock is right at every step from confirmation to delivery', async () => {
    const d = await draft(admin, [
      { offer_id: bronze, qty: 2 },
      { offer_id: argent, qty: 1 },
    ]);
    await confirm(admin, d.order_id);
    expect(await quantities(db.pool, v.BRONZE!)).toEqual({ physical_qty: 10, reserved_qty: 2, available_qty: 8 });

    const notPicked = await expectError(step(admin, 'mark_prepared', d.order_id), 'VALEUR_INVALIDE');
    expect(notPicked.detail).toEqual({ field: 'picked' });

    await ship(admin, d.order_id, 'Amana', 3500);
    expect(await quantities(db.pool, v.BRONZE!)).toEqual({ physical_qty: 8, reserved_qty: 0, available_qty: 8 });
    const o = await order(d.order_id);
    expect(o).toMatchObject({ status: 'en_livraison', carrier: 'Amana', transport_cost_cents: 3500, packaging_cost_cents: 800 });
    const { rows: items } = await db.pool.query(`select sku, unit_cost from order_items where order_id = $1 order by sku`, [
      d.order_id,
    ]);
    expect(items.map((i) => [i.sku, Number(i.unit_cost)])).toEqual([
      ['ARGENT', 1200],
      ['BRONZE', 1000],
    ]);
    const { rows: s } = await db.pool.query(`select carriers from settings`);
    expect(s[0].carriers).toContain('Amana');

    await step(admin, 'mark_delivered', d.order_id);
    expect((await order(d.order_id)).status).toBe('livree');
    expect(await quantities(db.pool, v.BRONZE!)).toEqual({ physical_qty: 8, reserved_qty: 0, available_qty: 8 });
  });

  test('picks are saved on the order and can be unticked', async () => {
    const d = await draft(admin, [{ offer_id: argent, qty: 1 }]);
    await confirm(admin, d.order_id);
    const { rows } = await db.pool.query(`select id from order_items where order_id = $1`, [d.order_id]);
    await rpc(admin, 'set_item_picked', { p_item_id: rows[0].id, p_picked: true });
    await rpc(admin, 'set_item_picked', { p_item_id: rows[0].id, p_picked: false });
    const r = await db.pool.query(`select picked from order_items where id = $1`, [rows[0].id]);
    expect(r.rows[0].picked).toBe(false);
  });

  test('shipping needs the carrier and the real transport cost', async () => {
    const d = await draft(admin, [{ offer_id: argent, qty: 1 }]);
    await confirm(admin, d.order_id);
    const { rows } = await db.pool.query(`select id from order_items where order_id = $1`, [d.order_id]);
    await rpc(admin, 'set_item_picked', { p_item_id: rows[0].id, p_picked: true });
    await step(admin, 'mark_prepared', d.order_id);
    const noCost = await expectError(
      step(admin, 'ship_order', d.order_id, { p_carrier: 'Amana', p_tracking: null, p_transport_cost_cents: null }),
      'VALEUR_INVALIDE',
    );
    expect(noCost.detail).toEqual({ field: 'transport_cost_cents' });
    const noCarrier = await expectError(
      step(admin, 'ship_order', d.order_id, { p_carrier: ' ', p_tracking: null, p_transport_cost_cents: 3000 }),
      'VALEUR_INVALIDE',
    );
    expect(noCarrier.detail).toEqual({ field: 'carrier' });
  });

  test('replaying a shipment does not lower the stock twice', async () => {
    const d = await draft(admin, [{ offer_id: argent, qty: 1 }]);
    await confirm(admin, d.order_id);
    const { rows } = await db.pool.query(`select id from order_items where order_id = $1`, [d.order_id]);
    await rpc(admin, 'set_item_picked', { p_item_id: rows[0].id, p_picked: true });
    await step(admin, 'mark_prepared', d.order_id);
    const before = await quantities(db.pool, v.ARGENT!);
    const request = randomUUID();
    const args = { p_request_id: request, p_order_id: d.order_id, p_carrier: 'Amana', p_tracking: '', p_transport_cost_cents: 3000 };
    const first = await rpc(admin, 'ship_order', args);
    expect(await rpc(admin, 'ship_order', args)).toEqual(first);
    expect((await quantities(db.pool, v.ARGENT!)).physical_qty).toBe(before.physical_qty - 1);
  });
});

describe('cancellation', () => {
  test('cancelling before shipment releases the reservation', async () => {
    const before = await quantities(db.pool, v.BRONZE!);
    const d = await draft(admin, [{ offer_id: bronze, qty: 3 }]);
    await confirm(admin, d.order_id);
    expect((await quantities(db.pool, v.BRONZE!)).reserved_qty).toBe(before.reserved_qty + 3);
    await step(admin, 'cancel_order', d.order_id);
    expect(await quantities(db.pool, v.BRONZE!)).toEqual(before);
    expect((await order(d.order_id)).status).toBe('annulee');
  });

  test('a shipped order cannot be cancelled', async () => {
    const id = await shippedOrder(admin, [{ offer_id: argent, qty: 1 }]);
    const err = await expectError(step(admin, 'cancel_order', id), 'ETAT_INVALIDE');
    expect(err.detail).toEqual({ status: 'en_livraison' });
  });
});

describe('returns', () => {
  test('a partial return puts back only the resalable piece, once', async () => {
    const id = await shippedOrder(admin, [{ offer_id: bronze, qty: 2 }]);
    const before = await quantities(db.pool, v.BRONZE!);
    await step(admin, 'report_return', id);
    expect((await order(id)).status).toBe('retour_attendu');

    const { rows } = await db.pool.query(`select id from order_items where order_id = $1`, [id]);
    const args = {
      p_request_id: randomUUID(),
      p_order_id: id,
      p_items: [{ item_id: rows[0].id, damaged_qty: 1 }],
      p_return_fee_cents: 1500,
    };
    await rpc(admin, 'receive_return', args);
    expect((await quantities(db.pool, v.BRONZE!)).physical_qty).toBe(before.physical_qty + 1);
    const item = await db.pool.query(`select returned_resalable, returned_damaged from order_items where id = $1`, [rows[0].id]);
    expect(item.rows[0]).toEqual({ returned_resalable: 1, returned_damaged: 1 });
    const loss = await db.pool.query(
      `select count(*)::int as n from stock_movements where order_id = $1 and kind = 'retour_perte'`,
      [id],
    );
    expect(loss.rows[0].n).toBe(1);
    expect(await order(id)).toMatchObject({ status: 'retour_recu', return_fee_cents: 1500 });
    expect(await rpc(admin, 'order_expected_cents', { p_order_id: id })).toBe(-5000);

    await expectError(rpc(admin, 'receive_return', { ...args, p_request_id: randomUUID() }), 'ETAT_INVALIDE');
    expect((await quantities(db.pool, v.BRONZE!)).physical_qty).toBe(before.physical_qty + 1);
  });

  test('a damaged quantity above what was shipped is refused', async () => {
    const id = await shippedOrder(admin, [{ offer_id: argent, qty: 1 }]);
    await step(admin, 'report_return', id, { p_return_fee_cents: 1000 });
    const { rows } = await db.pool.query(`select id from order_items where order_id = $1`, [id]);
    const err = await expectError(
      rpc(admin, 'receive_return', {
        p_request_id: randomUUID(),
        p_order_id: id,
        p_items: [{ item_id: rows[0].id, damaged_qty: 2 }],
        p_return_fee_cents: 1000,
      }),
      'RETOUR_INCOHERENT',
    );
    expect(err.detail).toEqual({ item_id: rows[0].id });
  });

  test('the cost frozen at shipment does not move with later arrivals', async () => {
    const id = await shippedOrder(admin, [{ offer_id: argent, qty: 1 }]);
    await rpc(admin, 'validate_receipt', {
      p_request_id: randomUUID(),
      p_supplier: 'Grossiste',
      p_received_on: '2026-11-22',
      p_lines: [{ variant_id: v.ARGENT, qty: 10, unit_cost_cents: 4000 }],
    });
    const { rows } = await db.pool.query(`select unit_cost from order_items where order_id = $1`, [id]);
    expect(Number(rows[0].unit_cost)).toBe(1200);
  });

  test('a return can only be reported while the parcel is with the carrier', async () => {
    const d = await draft(admin, [{ offer_id: argent, qty: 1 }]);
    await confirm(admin, d.order_id);
    await expectError(step(admin, 'report_return', d.order_id), 'ETAT_INVALIDE');
  });
});
