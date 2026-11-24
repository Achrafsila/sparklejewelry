import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type pg from 'pg';
import { assertLedger, freshDb, rpc, type TestDb } from './helpers';
import { draft, offer, quantities, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let id: string;
let unit: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  const v = await stock(admin, [{ sku: 'CREOLE', qty: 5 }]);
  id = v.CREOLE!;
  unit = await offer(admin, { name: 'Créole', kind: 'unit', price_cents: 6000, items: [{ variant_id: id }] });
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

test('the same confirmation sent twice at once (double tap, two tabs) runs once', async () => {
  const d = await draft(admin, [{ offer_id: unit, qty: 2 }]);
  const request = randomUUID();
  const a = await db.asAdmin();
  const b = await db.asAdmin();
  const { rows } = await b.query('select pg_backend_pid() as pid');

  await a.query('begin');
  const first = await rpc(a, 'confirm_order', { p_request_id: request, p_order_id: d.order_id });
  const second = rpc(b, 'confirm_order', { p_request_id: request, p_order_id: d.order_id });
  for (let i = 0; i < 50; i++) {
    const w = await db.pool.query(`select wait_event_type from pg_stat_activity where pid = $1`, [rows[0].pid]);
    if (w.rows[0]?.wait_event_type === 'Lock') break;
    await sleep(20);
  }
  await a.query('commit');

  expect(await second).toEqual(first);
  expect(await quantities(db.pool, id)).toEqual({ physical_qty: 5, reserved_qty: 2, available_qty: 3 });
  await assertLedger(db.pool);
  a.release();
  b.release();
});
