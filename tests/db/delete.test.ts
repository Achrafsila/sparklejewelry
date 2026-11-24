import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { assertLedger, expectError, freshDb, rpc, type TestDb } from './helpers';
import { confirm, draft, offer, quantities, shippedOrder, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

const deleteOffer = (id: string, request = randomUUID(), client: pg.PoolClient = admin) =>
  rpc(client, 'delete_offer', { p_request_id: request, p_offer_id: id });
const deleteVariant = (id: string, request = randomUUID(), client: pg.PoolClient = admin) =>
  rpc(client, 'delete_variant', { p_request_id: request, p_variant_id: id });

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.pool.query(`select count(*)::int as n from ${sql}`, params);
  return rows[0].n as number;
}

describe('delete_offer', () => {
  test('erases the offer and its composition; past orders keep its name and price', async () => {
    const v = await stock(admin, [{ sku: 'DO-A', qty: 5 }]);
    const id = await offer(admin, { name: 'Offre à effacer', kind: 'unit', price_cents: 9000, items: [{ variant_id: v['DO-A']! }] });
    const order = await shippedOrder(admin, [{ offer_id: id, qty: 1 }]);

    expect(await deleteOffer(id)).toEqual({ deleted: true });

    expect(await count('offers where id = $1', [id])).toBe(0);
    expect(await count('offer_items where offer_id = $1', [id])).toBe(0);
    const { rows } = await db.pool.query(`select offer_id, offer_name, unit_price_cents from order_lines where order_id = $1`, [order]);
    expect(rows).toEqual([{ offer_id: null, offer_name: 'Offre à effacer', unit_price_cents: 9000 }]);
  });

  test('replaying the same request gives the same answer; a new one finds nothing', async () => {
    const v = await stock(admin, [{ sku: 'DO-B', qty: 1 }]);
    const id = await offer(admin, { name: 'Rejeu', kind: 'unit', price_cents: 5000, items: [{ variant_id: v['DO-B']! }] });
    const request = randomUUID();
    expect(await deleteOffer(id, request)).toEqual({ deleted: true });
    expect(await deleteOffer(id, request)).toEqual({ deleted: true });
    await expectError(deleteOffer(id), 'INTROUVABLE');
  });

  test('only the admin can delete', async () => {
    const v = await stock(admin, [{ sku: 'DO-C', qty: 1 }]);
    const id = await offer(admin, { name: 'Protégée', kind: 'unit', price_cents: 5000, items: [{ variant_id: v['DO-C']! }] });
    const user = await db.connect('user');
    try {
      await expectError(deleteOffer(id, randomUUID(), user), 'NON_AUTORISE');
    } finally {
      user.release();
    }
    expect(await count('offers where id = $1', [id])).toBe(1);
  });
});

describe('delete_variant', () => {
  test('a reference no order ever used is erased with its arrival line, movements and model', async () => {
    const v = await stock(admin, [{ sku: 'RIVIERE-OR', qty: 4, product: 'Rivière', label: 'Or' }]);
    const id = v['RIVIERE-OR']!;
    const { rows } = await db.pool.query(`select receipt_id from receipt_lines where variant_id = $1`, [id]);
    const receipt = rows[0].receipt_id as string;

    expect(await deleteVariant(id)).toEqual({ mode: 'deleted' });

    expect(await count('variants where id = $1', [id])).toBe(0);
    expect(await count('stock_movements where variant_id = $1', [id])).toBe(0);
    expect(await count('receipt_lines where variant_id = $1', [id])).toBe(0);
    expect(await count('receipts where id = $1', [receipt])).toBe(0);
    expect(await count(`products where name = 'Rivière'`, [])).toBe(0);
    await assertLedger(db.pool);

    // The reference and the model can be received again under the same names.
    const again = await stock(admin, [{ sku: 'RIVIERE-OR', qty: 2, product: 'Rivière', label: 'Or' }]);
    expect((await quantities(db.pool, again['RIVIERE-OR']!)).physical_qty).toBe(2);
  });

  test('the other lines of the same arrival and the other variants of the model stay', async () => {
    const v = await stock(admin, [
      { sku: 'COLLIER-X', qty: 2, product: 'Collier', label: 'X' },
      { sku: 'COLLIER-Y', qty: 3, product: 'Collier', label: 'Y' },
    ]);
    await deleteVariant(v['COLLIER-X']!);
    const { rows } = await db.pool.query(
      `select count(*)::int as n from receipt_lines l join receipt_lines k on k.receipt_id = l.receipt_id where l.variant_id = $1`,
      [v['COLLIER-Y']],
    );
    expect(rows[0].n).toBe(1);
    expect(await count(`products where name = 'Collier'`, [])).toBe(1);
    expect((await quantities(db.pool, v['COLLIER-Y']!)).physical_qty).toBe(3);
  });

  test('a reference in an active offer is refused, with the offers named', async () => {
    const v = await stock(admin, [{ sku: 'DV-OFFRE', qty: 3 }]);
    await offer(admin, { name: 'Trio rivières', kind: 'fixed_trio', price_cents: 30000, items: [{ variant_id: v['DV-OFFRE']!, qty: 3 }] });
    const err = await expectError(deleteVariant(v['DV-OFFRE']!), 'REFERENCE_DANS_OFFRES');
    expect(err.detail).toEqual({ offers: ['Trio rivières'] });
    expect(await count('variants where id = $1', [v['DV-OFFRE']])).toBe(1);
  });

  test('an archived offer does not block, and loses the piece', async () => {
    const v = await stock(admin, [{ sku: 'DV-ARCH', qty: 1 }]);
    const o = await offer(admin, { name: 'Ancienne', kind: 'unit', price_cents: 5000, items: [{ variant_id: v['DV-ARCH']! }] });
    await db.pool.query(`update offers set archived = true where id = $1`, [o]);
    expect(await deleteVariant(v['DV-ARCH']!)).toEqual({ mode: 'deleted' });
    expect(await count('offer_items where offer_id = $1', [o])).toBe(0);
  });

  test('a reference already ordered is withdrawn from stock and kept for its orders', async () => {
    const v = await stock(admin, [{ sku: 'DV-VENDUE', qty: 5 }]);
    const id = v['DV-VENDUE']!;
    const o = await offer(admin, { name: 'Vendue', kind: 'unit', price_cents: 9000, items: [{ variant_id: id }] });
    const order = await shippedOrder(admin, [{ offer_id: o, qty: 1 }]);
    await deleteOffer(o);

    expect(await deleteVariant(id)).toEqual({ mode: 'archived' });

    const { rows } = await db.pool.query(`select archived, physical_qty, reserved_qty from variants where id = $1`, [id]);
    expect(rows[0]).toEqual({ archived: true, physical_qty: 0, reserved_qty: 0 });
    const last = await db.pool.query(
      `select kind, physical_delta, note from stock_movements where variant_id = $1 order by id desc limit 1`,
      [id],
    );
    expect(last.rows[0]).toEqual({ kind: 'correction', physical_delta: -4, note: 'Référence supprimée' });
    expect(await count('order_items where order_id = $1 and variant_id = $2', [order, id])).toBe(1);
    await assertLedger(db.pool);
  });

  test('a new arrival of a withdrawn reference puts it back in stock', async () => {
    const v = await stock(admin, [{ sku: 'DV-RETOUR', qty: 2 }]);
    const id = v['DV-RETOUR']!;
    const o = await offer(admin, { name: 'Retour', kind: 'unit', price_cents: 9000, items: [{ variant_id: id }] });
    await shippedOrder(admin, [{ offer_id: o, qty: 1 }]);
    await deleteOffer(o);
    await deleteVariant(id);

    await rpc(admin, 'validate_receipt', {
      p_request_id: randomUUID(),
      p_supplier: 'Fixture',
      p_received_on: '2026-11-24',
      p_lines: [{ variant_id: id, qty: 3, unit_cost_cents: 1000 }],
    });
    const { rows } = await db.pool.query(`select archived, physical_qty from variants where id = $1`, [id]);
    expect(rows[0]).toEqual({ archived: false, physical_qty: 3 });
    await assertLedger(db.pool);
  });

  test('pieces reserved by an order in progress block the deletion', async () => {
    const v = await stock(admin, [{ sku: 'DV-RESERVEE', qty: 5 }]);
    const id = v['DV-RESERVEE']!;
    const o = await offer(admin, { name: 'Réservée', kind: 'unit', price_cents: 9000, items: [{ variant_id: id }] });
    const d = await draft(admin, [{ offer_id: o, qty: 2 }]);
    await confirm(admin, d.order_id);
    await deleteOffer(o);

    const err = await expectError(deleteVariant(id), 'REFERENCE_RESERVEE');
    expect(err.detail).toEqual({ reserved: 2 });
    expect((await quantities(db.pool, id)).physical_qty).toBe(5);
  });

  test('replaying the same request gives the same answer', async () => {
    const v = await stock(admin, [{ sku: 'DV-REJEU', qty: 1 }]);
    const request = randomUUID();
    expect(await deleteVariant(v['DV-REJEU']!, request)).toEqual({ mode: 'deleted' });
    expect(await deleteVariant(v['DV-REJEU']!, request)).toEqual({ mode: 'deleted' });
    await expectError(deleteVariant(v['DV-REJEU']!), 'INTROUVABLE');
  });

  test('only the admin can delete', async () => {
    const v = await stock(admin, [{ sku: 'DV-PROTEGEE', qty: 1 }]);
    const user = await db.connect('user');
    try {
      await expectError(deleteVariant(v['DV-PROTEGEE']!, randomUUID(), user), 'NON_AUTORISE');
    } finally {
      user.release();
    }
    expect(await count('variants where id = $1', [v['DV-PROTEGEE']])).toBe(1);
  });
});
