import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type pg from 'pg';
import { assertLedger, freshDb, rpc, type TestDb } from './helpers';
import { draft, offer, quantities, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let last: string;
let unit: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  const v = await stock(admin, [{ sku: 'DERNIERE', qty: 1 }]);
  last = v.DERNIERE!;
  unit = await offer(admin, { name: 'Dernière pièce', kind: 'unit', price_cents: 5000, items: [{ variant_id: last }] });
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

async function waitingOnLock(pid: number) {
  for (let i = 0; i < 50; i++) {
    const { rows } = await db.pool.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return true;
    await sleep(20);
  }
  return false;
}

test('two confirmations for the last piece: the first committed wins, no oversell', async () => {
  const first = await draft(admin, [{ offer_id: unit, qty: 1 }]);
  const second = await draft(admin, [{ offer_id: unit, qty: 1 }]);
  const a = await db.asAdmin();
  const b = await db.asAdmin();
  const { rows } = await b.query('select pg_backend_pid() as pid');

  await a.query('begin');
  await rpc(a, 'confirm_order', { p_request_id: randomUUID(), p_order_id: first.order_id });
  const pending = rpc(b, 'confirm_order', { p_request_id: randomUUID(), p_order_id: second.order_id }).then(
    () => 'ok',
    (e) => e.message as string,
  );
  expect(await waitingOnLock(rows[0].pid)).toBe(true);
  await a.query('commit');

  expect(await pending).toBe('STOCK_INSUFFISANT');
  expect(await quantities(db.pool, last)).toEqual({ physical_qty: 1, reserved_qty: 1, available_qty: 0 });
  await assertLedger(db.pool);
  a.release();
  b.release();
});
