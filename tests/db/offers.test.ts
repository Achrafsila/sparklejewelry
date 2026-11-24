import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { expectError, freshDb, rpc, type TestDb } from './helpers';
import { stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let v: Record<string, string>;

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  v = await stock(admin, [
    { sku: 'LUNA-OR', qty: 5, product: 'Luna', label: 'Or' },
    { sku: 'LUNA-ARGENT', qty: 5, product: 'Luna', label: 'Argent' },
    { sku: 'BRONZE', qty: 9 },
    { sku: 'PERLE', qty: 2 },
  ]);
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

const save = (offer: Record<string, unknown>, request = randomUUID()) =>
  rpc(admin, 'save_offer', { p_request_id: request, p_offer: offer });

async function items(id: string) {
  const { rows } = await db.pool.query(
    `select v.sku, i.qty, i.price_cents from offer_items i join variants v on v.id = i.variant_id where offer_id = $1 order by v.sku`,
    [id],
  );
  return rows;
}

describe('save_offer', () => {
  test('creates a unit offer over two variants with their own prices', async () => {
    const r = await save({
      name: 'Luna à l’unité',
      kind: 'unit',
      price_cents: 8900,
      on_instagram: true,
      on_site: false,
      items: [
        { variant_id: v['LUNA-OR'], qty: 1, price_cents: 9900 },
        { variant_id: v['LUNA-ARGENT'], qty: 1, price_cents: null },
      ],
    });
    expect(await items(r.offer_id)).toEqual([
      { sku: 'LUNA-ARGENT', qty: 1, price_cents: null },
      { sku: 'LUNA-OR', qty: 1, price_cents: 9900 },
    ]);
  });

  test('a fixed trio needs exactly three pieces', async () => {
    const err = await expectError(
      save({ name: 'Trio', kind: 'fixed_trio', price_cents: 20000, items: [{ variant_id: v.BRONZE, qty: 2 }] }),
      'VALEUR_INVALIDE',
    );
    expect(err.detail).toEqual({ field: 'items' });
    const ok = await save({
      name: 'Trio bronze',
      kind: 'fixed_trio',
      price_cents: 20000,
      items: [
        { variant_id: v.BRONZE, qty: 2 },
        { variant_id: v.PERLE, qty: 1 },
      ],
    });
    expect(await items(ok.offer_id)).toHaveLength(2);
  });

  test('a pick-your-trio without repeats needs at least three eligible pieces', async () => {
    const err = await expectError(
      save({
        name: 'À composer',
        kind: 'custom_trio',
        price_cents: 21000,
        allow_repeat: false,
        items: [{ variant_id: v.BRONZE }, { variant_id: v.PERLE }],
      }),
      'VALEUR_INVALIDE',
    );
    expect(err.detail).toEqual({ field: 'items' });
    const ok = await save({
      name: 'À composer',
      kind: 'custom_trio',
      price_cents: 21000,
      allow_repeat: true,
      items: [{ variant_id: v.BRONZE }, { variant_id: v.PERLE }],
    });
    expect(await items(ok.offer_id)).toHaveLength(2);
  });

  test('updating replaces name, price and composition; the kind cannot change', async () => {
    const r = await save({ name: 'Bronze', kind: 'unit', price_cents: 9000, items: [{ variant_id: v.BRONZE }] });
    await save({ id: r.offer_id, name: 'Bronze poli', kind: 'unit', price_cents: 9500, items: [{ variant_id: v.PERLE }] });
    const { rows } = await db.pool.query(`select name, price_cents from offers where id = $1`, [r.offer_id]);
    expect(rows[0]).toEqual({ name: 'Bronze poli', price_cents: 9500 });
    expect((await items(r.offer_id)).map((i) => i.sku)).toEqual(['PERLE']);
    const err = await expectError(
      save({ id: r.offer_id, name: 'X', kind: 'fixed_trio', price_cents: 1, items: [{ variant_id: v.BRONZE, qty: 3 }] }),
      'VALEUR_INVALIDE',
    );
    expect(err.detail).toEqual({ field: 'kind' });
  });

  test('refuses a missing name or a negative price', async () => {
    expect((await expectError(save({ name: ' ', kind: 'unit', price_cents: 1, items: [{ variant_id: v.BRONZE }] }), 'VALEUR_INVALIDE')).detail).toEqual({
      field: 'name',
    });
    expect((await expectError(save({ name: 'A', kind: 'unit', price_cents: -1, items: [{ variant_id: v.BRONZE }] }), 'VALEUR_INVALIDE')).detail).toEqual({
      field: 'price_cents',
    });
  });

  test('the same request saves once', async () => {
    const request = randomUUID();
    const a = await save({ name: 'Unique', kind: 'unit', price_cents: 100, items: [{ variant_id: v.BRONZE }] }, request);
    const b = await save({ name: 'Unique', kind: 'unit', price_cents: 100, items: [{ variant_id: v.BRONZE }] }, request);
    expect(b).toEqual(a);
    const { rows } = await db.pool.query(`select count(*)::int as n from offers where name = 'Unique'`);
    expect(rows[0].n).toBe(1);
  });
});
