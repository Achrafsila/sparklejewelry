import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { assertLedger, expectError, freshDb, rpc, type TestDb } from './helpers';

let db: TestDb;
let admin: pg.PoolClient;

const prototype = {
  variants: [
    { sku: 'COLLIER-A', model: 'Collier A', variant: '', photo: 'data:image/jpeg;base64,AAAA', physical: 4 },
    { sku: 'BAGUE-B-OR', model: 'Bague B', variant: 'Or', photo: '', physical: 2 },
    { sku: 'BAGUE-B-ARGENT', model: 'Bague B', variant: 'Argent', photo: '', physical: 0 },
  ],
  receipts: [
    {
      supplier: 'Fournisseur 1',
      received: '2026-11-10',
      lines: [
        { sku: 'COLLIER-A', qty: 5, cost: 2500 },
        { sku: 'BAGUE-B-OR', qty: 2, cost: 4000 },
      ],
    },
  ],
  offers: [
    { id: 'a', type: 'unit', skus: ['COLLIER-A'], title: 'Collier A', price: 9900, site: true, instagram: true, repeat: false },
    { id: 'b', type: 'fixed', skus: ['BAGUE-B-OR', 'BAGUE-B-OR', 'COLLIER-A'], title: 'Trio B', price: 20000, site: false, instagram: true, repeat: false },
    { id: 'c', type: 'custom', skus: ['COLLIER-A', 'BAGUE-B-OR', 'BAGUE-B-ARGENT'], title: 'Compose', price: 18000, site: false, instagram: true, repeat: true },
  ],
  orders: [{ id: 'x', channel: 'Instagram', status: 'Brouillon', lines: [] }],
};

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

describe('import_prototype', () => {
  test('imports references, stock, arrivals and offers, and reports what it skipped', async () => {
    const r = await rpc(admin, 'import_prototype', { p_request_id: randomUUID(), p_data: prototype });
    expect(r).toEqual({ variants: 3, receipts: 1, offers: 3, photos_skipped: 1, orders_ignored: 1 });

    const { rows } = await db.pool.query(`select sku, label, physical_qty, avg_cost, cost_known from v_stock order by sku`);
    expect(rows.map((x) => [x.sku, x.label, x.physical_qty, Number(x.avg_cost), x.cost_known])).toEqual([
      ['BAGUE-B-ARGENT', 'Argent', 0, 0, false],
      ['BAGUE-B-OR', 'Or', 2, 4000, true],
      ['COLLIER-A', null, 4, 2500, true],
    ]);
    const trio = await db.pool.query(
      `select i.qty from offer_items i join offers o on o.id = i.offer_id join variants v on v.id = i.variant_id
       where o.name = 'Trio B' and v.sku = 'BAGUE-B-OR'`,
    );
    expect(trio.rows[0].qty).toBe(2);
    const compose = await db.pool.query(`select kind, allow_repeat, on_site from offers where name = 'Compose'`);
    expect(compose.rows[0]).toEqual({ kind: 'custom_trio', allow_repeat: true, on_site: false });
    await assertLedger(db.pool);
  });

  test('refuses to import references that already exist', async () => {
    const err = await expectError(
      rpc(admin, 'import_prototype', { p_request_id: randomUUID(), p_data: prototype }),
      'IMPORT_CONFLIT',
    );
    expect(err.detail.skus.sort()).toEqual(['BAGUE-B-ARGENT', 'BAGUE-B-OR', 'COLLIER-A']);
  });
});

describe('export_all', () => {
  test('exports every table for a backup', async () => {
    const e = await rpc(admin, 'export_all');
    expect(e.version).toBe(1);
    expect(e.variants).toHaveLength(3);
    expect(e.offers).toHaveLength(3);
    expect(Object.keys(e)).toEqual(
      expect.arrayContaining(['settings', 'orders', 'order_lines', 'stock_movements', 'payouts', 'customers', 'ad_spend']),
    );
  });
});
