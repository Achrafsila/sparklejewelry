import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ADMIN_ID, OTHER_USER_ID, freshDb, type TestDb } from './helpers';

let db: TestDb;
beforeAll(async () => {
  db = await freshDb();
  await db.pool.query(`insert into auth.users (id, email) values ($1, 'other@sparkle.test')`, [OTHER_USER_ID]);
  const { rows } = await db.pool.query(`insert into products (name) values ('Bague Luna') returning id`);
  await db.pool.query(`insert into variants (product_id, sku, label) values ($1, 'BAGUE-LUNA-OR', 'Or')`, [rows[0].id]);
});
afterAll(async () => {
  await db.drop();
});

describe('row level security', () => {
  test('anon cannot read variants', async () => {
    const c = await db.asAnon();
    await expect(c.query('select * from variants')).rejects.toThrow(/permission denied/);
    c.release();
  });

  test('a signed-in user who is not admin reads no variant', async () => {
    const c = await db.connect('user');
    const { rows } = await c.query('select * from variants');
    c.release();
    expect(rows).toHaveLength(0);
  });

  test('the admin reads variants and settings', async () => {
    const c = await db.asAdmin();
    const variants = await c.query('select sku from variants');
    const settings = await c.query('select low_stock_threshold from settings');
    const admin = await c.query('select is_admin() as ok');
    c.release();
    expect(variants.rows.map((r) => r.sku)).toEqual(['BAGUE-LUNA-OR']);
    expect(settings.rows[0].low_stock_threshold).toBe(5);
    expect(admin.rows[0].ok).toBe(true);
  });

  test('the admin cannot change stock quantities directly', async () => {
    const c = await db.asAdmin();
    await expect(c.query(`update variants set physical_qty = 9`)).rejects.toThrow(/permission denied/);
    c.release();
  });

  test('the admin can change a variant photo directly', async () => {
    const c = await db.asAdmin();
    const r = await c.query(`update variants set photo_path = 'variants/x.jpg' returning photo_path`);
    c.release();
    expect(r.rows[0].photo_path).toBe('variants/x.jpg');
  });

  test('is_admin() is false for another signed-in user', async () => {
    const c = await db.connect('user');
    const { rows } = await c.query('select is_admin() as ok');
    c.release();
    expect(rows[0].ok).toBe(false);
  });
});

describe('request idempotency', () => {
  test('begin_request returns null first, then the stored result', async () => {
    const id = randomUUID();
    const first = await db.pool.query(`select begin_request($1, 'test_fn') as r`, [id]);
    expect(first.rows[0].r).toBeNull();
    await db.pool.query(`select finish_request($1, '{"ok": 1}'::jsonb)`, [id]);
    const second = await db.pool.query(`select begin_request($1, 'test_fn') as r`, [id]);
    expect(second.rows[0].r).toEqual({ ok: 1 });
  });
});

describe('helpers', () => {
  test('norm_key lowercases, strips accents and squeezes spaces', async () => {
    const { rows } = await db.pool.query(`select norm_key('  Bagué   LUNA ') as k`);
    expect(rows[0].k).toBe('bague luna');
  });

  test('order numbers start at SPK-0001', async () => {
    const { rows } = await db.pool.query(`insert into orders default values returning number`);
    expect(rows[0].number).toBe('SPK-0001');
  });

  test('format_order_number keeps every digit past 9999', async () => {
    const { rows } = await db.pool.query(`select format_order_number(12345) as n`);
    expect(rows[0].n).toBe('SPK-12345');
  });

  test('the admin id seeded in the template is an admin', async () => {
    const { rows } = await db.pool.query(`select count(*)::int as n from admins where user_id = $1`, [ADMIN_ID]);
    expect(rows[0].n).toBe(1);
  });
});
