import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { freshDb, rpc, type TestDb } from './helpers';
import { customer, draft, offer, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let unit: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  const v = await stock(admin, [{ sku: 'JONC', qty: 9 }]);
  unit = await offer(admin, { name: 'Jonc', kind: 'unit', price_cents: 4000, items: [{ variant_id: v.JONC! }] });
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

describe('normalize_phone', () => {
  test.each([
    ['06 12 34 56 78', '+212612345678'],
    ['0612345678', '+212612345678'],
    ['+212 6 12 34 56 78', '+212612345678'],
    ['00212712345678', '+212712345678'],
    ['05.22.33.44.55', '+212522334455'],
  ])('%s becomes %s', async (input, expected) => {
    expect(await rpc(admin, 'normalize_phone', { p: input })).toBe(expected);
  });

  test.each(['12', '0812345678', '', 'abc'])('%s is not a Moroccan number', async (input) => {
    expect(await rpc(admin, 'normalize_phone', { p: input })).toBeNull();
  });
});

describe('customer recognition', () => {
  test('three spellings of the same phone give one customer, updated with the latest details', async () => {
    await draft(admin, [{ offer_id: unit, qty: 1 }], { customer: { ...customer, phone: '06 12 34 56 78' } });
    await draft(admin, [{ offer_id: unit, qty: 1 }], { customer: { ...customer, phone: '0612345678' } });
    await draft(admin, [{ offer_id: unit, qty: 1 }], {
      customer: { ...customer, phone: '+212 6 12 34 56 78', address: '3 avenue Fal Ould Oumeir' },
    });
    const { rows } = await db.pool.query(`select phone, address from customers`);
    expect(rows).toEqual([{ phone: '+212612345678', address: '3 avenue Fal Ould Oumeir' }]);
    const orders = await db.pool.query(`select count(distinct customer_id)::int as n from orders`);
    expect(orders.rows[0].n).toBe(1);
  });

  test('a draft with an incomplete phone is kept without creating a customer', async () => {
    const d = await draft(admin, [{ offer_id: unit, qty: 1 }], { customer: { ...customer, phone: '0612' } });
    const { rows } = await db.pool.query(`select customer_id, customer_phone from orders where id = $1`, [d.order_id]);
    expect(rows[0]).toEqual({ customer_id: null, customer_phone: '0612' });
  });
});
