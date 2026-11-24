import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { assertLedger, expectError, freshDb, rpc, type TestDb } from './helpers';

let db: TestDb;
let admin: pg.PoolClient;
beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
});
afterEach(async () => {
  await assertLedger(db.pool);
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

type Line = {
  variant_id?: string;
  sku?: string;
  product_name?: string;
  label?: string | null;
  qty: number;
  unit_cost_cents: number;
  photo_path?: string;
};

function receive(lines: Line[], request = randomUUID(), supplier = 'Atelier Casa') {
  return rpc(admin, 'validate_receipt', {
    p_request_id: request,
    p_supplier: supplier,
    p_received_on: '2026-11-20',
    p_lines: lines,
  });
}

async function variant(sku: string) {
  const { rows } = await db.pool.query(
    `select v.*, p.name as product_name from variants v join products p on p.id = v.product_id where sku = $1`,
    [sku],
  );
  return rows[0];
}

describe('validate_receipt', () => {
  test('creates a model without a named variant', async () => {
    const r = await receive([{ sku: 'COLLIER-SOLEIL', product_name: 'Collier Soleil', qty: 10, unit_cost_cents: 3000 }]);
    expect(r.receipt_id).toBeTruthy();
    const v = await variant('COLLIER-SOLEIL');
    expect(v.label).toBeNull();
    expect(v.physical_qty).toBe(10);
    expect(Number(v.avg_cost)).toBe(3000);
  });

  test('creates one model with several variants in the same arrival', async () => {
    await receive([
      { sku: 'BAGUE-LUNA-OR', product_name: 'Bague Luna', label: 'Or', qty: 6, unit_cost_cents: 4000, photo_path: 'variants/luna-or.jpg' },
      { sku: 'BAGUE-LUNA-ARGENT', product_name: 'Bague Luna', label: 'Argent', qty: 4, unit_cost_cents: 3500 },
    ]);
    const or = await variant('BAGUE-LUNA-OR');
    const argent = await variant('BAGUE-LUNA-ARGENT');
    expect(or.product_id).toBe(argent.product_id);
    expect(or.photo_path).toBe('variants/luna-or.jpg');
    expect(argent.physical_qty).toBe(4);
  });

  test('adds a variant to an existing model name, ignoring case and accents', async () => {
    await receive([{ sku: 'BAGUE-LUNA-ROSE', product_name: 'bague  LUNA', label: 'Rosé', qty: 2, unit_cost_cents: 4200 }]);
    const rose = await variant('BAGUE-LUNA-ROSE');
    const or = await variant('BAGUE-LUNA-OR');
    expect(rose.product_id).toBe(or.product_id);
  });

  test('refuses an existing model + variant entered as a new model', async () => {
    const err = await expectError(
      receive([{ sku: 'AUTRE-REF', product_name: 'Bague Luna', label: 'or', qty: 1, unit_cost_cents: 1000 }]),
      'MODELE_VARIANTE_EXISTE',
    );
    expect(err.detail).toMatchObject({ line: 0 });
  });

  test('refuses a reference already used, whatever the case', async () => {
    const err = await expectError(
      receive([{ sku: 'bague-luna-or', product_name: 'Bague Nova', qty: 1, unit_cost_cents: 1000 }]),
      'SKU_EXISTE',
    );
    expect(err.detail).toMatchObject({ line: 0, sku: 'BAGUE-LUNA-OR' });
  });

  test('restocks an existing reference at a different cost with a weighted average', async () => {
    await receive([{ sku: 'BRACELET-ROND', product_name: 'Bracelet Rond', qty: 10, unit_cost_cents: 3000 }]);
    const id = (await variant('BRACELET-ROND')).id;
    await receive([{ variant_id: id, qty: 10, unit_cost_cents: 3500 }], randomUUID(), 'Grossiste Derb');
    const v = await variant('BRACELET-ROND');
    expect(v.physical_qty).toBe(20);
    expect(Number(v.avg_cost)).toBe(3250);
    const { rows } = await db.pool.query(
      `select l.unit_cost_cents, r.supplier from receipt_lines l join receipts r on r.id = l.receipt_id
       where l.variant_id = $1 order by l.unit_cost_cents`,
      [id],
    );
    expect(rows).toEqual([
      { unit_cost_cents: 3000, supplier: 'Atelier Casa' },
      { unit_cost_cents: 3500, supplier: 'Grossiste Derb' },
    ]);
  });

  test('stores a cost of 15,50 MAD as 1550 cents', async () => {
    const r = await receive([{ sku: 'PUCES-MINI', product_name: 'Puces Mini', qty: 3, unit_cost_cents: 1550 }]);
    const { rows } = await db.pool.query(`select unit_cost_cents from receipt_lines where receipt_id = $1`, [r.receipt_id]);
    expect(rows[0].unit_cost_cents).toBe(1550);
  });

  test('running the same request twice records one arrival', async () => {
    const request = randomUUID();
    const line = { sku: 'CHAINE-FINE', product_name: 'Chaîne Fine', qty: 5, unit_cost_cents: 2000 };
    const first = await receive([line], request);
    const second = await receive([line], request);
    expect(second).toEqual(first);
    expect((await variant('CHAINE-FINE')).physical_qty).toBe(5);
    const { rows } = await db.pool.query(`select count(*)::int as n from receipts where id = $1`, [first.receipt_id]);
    expect(rows[0].n).toBe(1);
  });

  test('refuses a quantity of zero and reports the line and field', async () => {
    const err = await expectError(
      receive([{ sku: 'X-1', product_name: 'X', qty: 0, unit_cost_cents: 100 }]),
      'VALEUR_INVALIDE',
    );
    expect(err.detail).toEqual({ line: 0, field: 'qty' });
  });

  test('refuses an arrival without supplier', async () => {
    const err = await expectError(
      receive([{ sku: 'X-2', product_name: 'X', qty: 1, unit_cost_cents: 100 }], randomUUID(), '  '),
      'VALEUR_INVALIDE',
    );
    expect(err.detail).toEqual({ field: 'supplier' });
  });

  test('a signed-in user who is not admin cannot validate an arrival', async () => {
    const user = await db.connect('user');
    await expectError(
      rpc(user, 'validate_receipt', {
        p_request_id: randomUUID(),
        p_supplier: 'S',
        p_received_on: '2026-11-20',
        p_lines: [{ sku: 'Y-1', product_name: 'Y', qty: 1, unit_cost_cents: 1 }],
      }),
      'NON_AUTORISE',
    );
    user.release();
  });
});

describe('suggest_sku', () => {
  test('builds the reference from model and variant', async () => {
    expect(await rpc(admin, 'suggest_sku', { p_model: 'Créole Étoile', p_label: 'Or rose' })).toBe('CREOLE-ETOILE-OR-ROSE');
  });

  test('adds a suffix when the reference is taken', async () => {
    expect(await rpc(admin, 'suggest_sku', { p_model: 'Bague Luna', p_label: 'Or' })).toBe('BAGUE-LUNA-OR-2');
  });

  test('uses the model alone when there is no variant', async () => {
    expect(await rpc(admin, 'suggest_sku', { p_model: 'Bague Nova', p_label: null })).toBe('BAGUE-NOVA');
  });
});

describe('adjust_stock', () => {
  test('lowers physical stock with a reason and reports a low-stock crossing', async () => {
    const id = (await variant('BAGUE-LUNA-OR')).id;
    const r = await rpc(admin, 'adjust_stock', {
      p_request_id: randomUUID(),
      p_variant_id: id,
      p_delta: -2,
      p_reason: 'Pièce cassée en vitrine',
    });
    expect(r.physical_qty).toBe(4);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ sku: 'BAGUE-LUNA-OR', before: 6, after: 4 });
  });

  test('refuses a correction that would go below zero', async () => {
    const id = (await variant('PUCES-MINI')).id;
    const err = await expectError(
      rpc(admin, 'adjust_stock', { p_request_id: randomUUID(), p_variant_id: id, p_delta: -4, p_reason: 'Inventaire' }),
      'VALEUR_INVALIDE',
    );
    expect(err.detail).toMatchObject({ field: 'delta' });
  });

  test('requires a reason', async () => {
    const id = (await variant('PUCES-MINI')).id;
    const err = await expectError(
      rpc(admin, 'adjust_stock', { p_request_id: randomUUID(), p_variant_id: id, p_delta: 1, p_reason: ' ' }),
      'VALEUR_INVALIDE',
    );
    expect(err.detail).toEqual({ field: 'reason' });
  });
});
