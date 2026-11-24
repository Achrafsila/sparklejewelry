import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { expectError, freshDb, rpc, type TestDb } from './helpers';
import { offer, shippedOrder, step, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let bronze: string;
let argent: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  const v = await stock(admin, [
    { sku: 'BRONZE', qty: 20 },
    { sku: 'ARGENT', qty: 20 },
  ]);
  bronze = await offer(admin, { name: 'Bronze', kind: 'unit', price_cents: 9500, items: [{ variant_id: v.BRONZE! }] });
  argent = await offer(admin, { name: 'Argent', kind: 'unit', price_cents: 8000, items: [{ variant_id: v.ARGENT! }] });
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

function payout(orders: { order_id: string; received_cents?: number }[], amount: number, carrier = 'Amana') {
  return rpc(admin, 'record_payout', {
    p_request_id: randomUUID(),
    p_carrier: carrier,
    p_received_on: '2026-11-23',
    p_reference: 'VIR-2311',
    p_amount_cents: amount,
    p_orders: orders,
  });
}

async function status(id: string) {
  const { rows } = await db.pool.query(`select status from orders where id = $1`, [id]);
  return rows[0].status;
}

describe('record_payout', () => {
  test('matches delivered orders, marks them paid and keeps the gap visible', async () => {
    const a = await shippedOrder(admin, [
      { offer_id: bronze, qty: 2 },
      { offer_id: argent, qty: 1 },
    ]);
    const b = await shippedOrder(admin, [{ offer_id: bronze, qty: 1 }], 'Amana', 3000);
    await step(admin, 'mark_delivered', a);
    await step(admin, 'mark_delivered', b);
    // a: 2×9500 + 8000 + 3500 fee − 3500 transport = 27000 ; b: 9500 + 3500 − 3000 = 10000
    expect(await rpc(admin, 'order_expected_cents', { p_order_id: a })).toBe(27000);
    const r = await payout([{ order_id: a }, { order_id: b, received_cents: 8000 }], 35000);
    expect(r).toMatchObject({ expected_cents: 37000, received_cents: 35000, gap_cents: -2000 });
    expect(await status(a)).toBe('payee');
    expect(await status(b)).toBe('payee');
    const { rows } = await db.pool.query(
      `select order_id, expected_cents, received_cents from payout_orders where payout_id = $1 order by expected_cents`,
      [r.payout_id],
    );
    expect(rows).toEqual([
      { order_id: b, expected_cents: 10000, received_cents: 8000 },
      { order_id: a, expected_cents: 27000, received_cents: 27000 },
    ]);

    const again = await expectError(payout([{ order_id: a }], 27000), 'COMMANDE_DEJA_RATTACHEE');
    expect(again.detail).toMatchObject({ order_id: a });
  });

  test('a returned parcel counts as a negative amount (carrier fees)', async () => {
    const id = await shippedOrder(admin, [{ offer_id: argent, qty: 1 }]);
    await step(admin, 'report_return', id, { p_return_fee_cents: 1500 });
    const r = await payout([{ order_id: id }], -5000);
    expect(r).toMatchObject({ expected_cents: -5000, gap_cents: 0 });
    expect(await status(id)).toBe('retour_attendu');
  });

  test('an order still with the carrier cannot be matched', async () => {
    const id = await shippedOrder(admin, [{ offer_id: argent, qty: 1 }]);
    const err = await expectError(payout([{ order_id: id }], 1000), 'ETAT_INVALIDE');
    expect(err.detail).toMatchObject({ order_id: id, status: 'en_livraison' });
  });

  test('an order shipped with another carrier cannot be matched', async () => {
    const id = await shippedOrder(admin, [{ offer_id: argent, qty: 1 }], 'Sendit');
    await step(admin, 'mark_delivered', id);
    const err = await expectError(payout([{ order_id: id }], 1000, 'Amana'), 'VALEUR_INVALIDE');
    expect(err.detail).toEqual({ order_id: id, field: 'carrier' });
  });

  test('a payout needs at least one order', async () => {
    const err = await expectError(payout([], 0), 'VALEUR_INVALIDE');
    expect(err.detail).toEqual({ field: 'orders' });
  });
});
