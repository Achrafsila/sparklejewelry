import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type pg from 'pg';
import { assertLedger, expectError, freshDb, rpc, type TestDb } from './helpers';
import { confirm, customer, draft, offer, quantities, stock } from './fixtures';

let db: TestDb;
let admin: pg.PoolClient;
let v: Record<string, string>;
const o: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDb();
  admin = await db.asAdmin();
  v = await stock(admin, [
    { sku: 'BRONZE', qty: 6 },
    { sku: 'ARGENT', qty: 10 },
    { sku: 'OR', qty: 10 },
    { sku: 'PERLE', qty: 0 + 1 },
    { sku: 'NACRE', qty: 5 },
    { sku: 'LUNA-OR', qty: 8, product: 'Luna', label: 'Or' },
    { sku: 'LUNA-ARGENT', qty: 8, product: 'Luna', label: 'Argent' },
  ]);
  o.trio = await offer(admin, {
    name: 'Trio Soleil',
    kind: 'fixed_trio',
    price_cents: 24000,
    items: [{ variant_id: v.BRONZE! }, { variant_id: v.ARGENT! }, { variant_id: v.OR! }],
  });
  o.bronze = await offer(admin, { name: 'Bronze à l’unité', kind: 'unit', price_cents: 9500, items: [{ variant_id: v.BRONZE! }] });
  o.luna = await offer(admin, {
    name: 'Luna à l’unité',
    kind: 'unit',
    price_cents: 8900,
    items: [{ variant_id: v['LUNA-OR']!, price_cents: 9900 }, { variant_id: v['LUNA-ARGENT']! }],
  });
  o.compose = await offer(admin, {
    name: 'Trio à composer',
    kind: 'custom_trio',
    price_cents: 21000,
    items: [{ variant_id: v.PERLE! }, { variant_id: v.NACRE! }, { variant_id: v.ARGENT! }],
  });
});
afterEach(async () => {
  await assertLedger(db.pool);
});
afterAll(async () => {
  admin.release();
  await db.drop();
});

describe('confirm_order', () => {
  test('a fixed trio plus a single piece reserve two bronzes and raise only an alert', async () => {
    const d = await draft(admin, [
      { offer_id: o.trio!, qty: 1 },
      { offer_id: o.bronze!, qty: 1 },
    ]);
    expect(d.number).toMatch(/^SPK-\d{4}$/);
    const r = await confirm(admin, d.order_id);
    expect(r.status).toBe('confirmee');
    expect(await quantities(db.pool, v.BRONZE!)).toEqual({ physical_qty: 6, reserved_qty: 2, available_qty: 4 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ sku: 'BRONZE', before: 6, after: 4 });
    expect(r.alerts[0].offers.map((x: any) => x.name).sort()).toEqual(['Bronze à l’unité', 'Trio Soleil']);
    const { rows } = await db.pool.query(`select on_instagram from offers where id = any($1)`, [[o.trio, o.bronze]]);
    expect(rows.every((x) => x.on_instagram)).toBe(true);
  });

  test('a draft reserves nothing', async () => {
    const before = await quantities(db.pool, v.ARGENT!);
    await draft(admin, [{ offer_id: o.trio!, qty: 2 }]);
    expect(await quantities(db.pool, v.ARGENT!)).toEqual(before);
  });

  test('a unit offer with several variants needs the variant and uses its own price', async () => {
    await expectError(draft(admin, [{ offer_id: o.luna!, qty: 1 }]), 'OFFRE_INVALIDE');
    const d = await draft(admin, [
      { offer_id: o.luna!, qty: 2, variant_id: v['LUNA-ARGENT']! },
      { offer_id: o.luna!, qty: 1, variant_id: v['LUNA-OR']! },
    ]);
    const { rows } = await db.pool.query(
      `select l.unit_price_cents, i.sku, i.qty from order_lines l join order_items i on i.line_id = l.id
       where l.order_id = $1 order by l.position`,
      [d.order_id],
    );
    expect(rows).toEqual([
      { unit_price_cents: 8900, sku: 'LUNA-ARGENT', qty: 2 },
      { unit_price_cents: 9900, sku: 'LUNA-OR', qty: 1 },
    ]);
  });

  test('prices come from the offer, never from the request', async () => {
    const d = await draft(admin, [{ offer_id: o.bronze!, qty: 1, unit_price_cents: 1 }]);
    const { rows } = await db.pool.query(`select unit_price_cents from order_lines where order_id = $1`, [d.order_id]);
    expect(rows[0].unit_price_cents).toBe(9500);
  });

  test('a pick-your-trio outside the eligible pieces is refused at draft time', async () => {
    const err = await expectError(
      draft(admin, [{ offer_id: o.compose!, qty: 1, picks: [v.NACRE!, v.ARGENT!, v.BRONZE!] }]),
      'TRIO_INVALIDE',
    );
    expect(err.detail).toMatchObject({ line: 0, reason: 'non_eligible' });
  });

  test('a pick-your-trio repeating a piece is refused unless the offer allows it', async () => {
    const err = await expectError(
      draft(admin, [{ offer_id: o.compose!, qty: 1, picks: [v.NACRE!, v.NACRE!, v.ARGENT!] }]),
      'TRIO_INVALIDE',
    );
    expect(err.detail).toMatchObject({ line: 0, reason: 'repeat' });
  });

  test('a pick-your-trio needs exactly three pieces', async () => {
    const err = await expectError(
      draft(admin, [{ offer_id: o.compose!, qty: 1, picks: [v.NACRE!, v.ARGENT!] }]),
      'TRIO_INVALIDE',
    );
    expect(err.detail).toMatchObject({ line: 0, reason: 'count' });
  });

  test('an unavailable pick-your-trio combination names the piece, the need and the availability', async () => {
    const other = await draft(admin, [{ offer_id: o.compose!, qty: 1, picks: [v.PERLE!, v.NACRE!, v.ARGENT!] }]);
    await confirm(admin, other.order_id); // takes the only PERLE
    const d = await draft(admin, [{ offer_id: o.compose!, qty: 3, picks: [v.PERLE!, v.NACRE!, v.ARGENT!] }]);
    const { rows } = await db.pool.query(`select qty from order_lines where order_id = $1`, [d.order_id]);
    expect(rows[0].qty).toBe(1);
    const err = await expectError(confirm(admin, d.order_id), 'STOCK_INSUFFISANT');
    expect(err.detail).toEqual([{ variant_id: v.PERLE, sku: 'PERLE', name: 'PERLE', need: 1, available: 0 }]);
    const { rows: st } = await db.pool.query(`select status from orders where id = $1`, [d.order_id]);
    expect(st[0].status).toBe('brouillon');
  });

  test('every missing reference is listed and nothing is reserved', async () => {
    const before = await quantities(db.pool, v.ARGENT!);
    const d = await draft(admin, [
      { offer_id: o.trio!, qty: 1 },
      { offer_id: o.bronze!, qty: 20 },
      { offer_id: o.compose!, qty: 1, picks: [v.PERLE!, v.NACRE!, v.ARGENT!] },
    ]);
    const err = await expectError(confirm(admin, d.order_id), 'STOCK_INSUFFISANT');
    expect(err.detail.map((x: any) => x.sku).sort()).toEqual(['BRONZE', 'PERLE']);
    expect(await quantities(db.pool, v.ARGENT!)).toEqual(before);
  });

  test('replaying the same confirmation reserves once; another request is refused', async () => {
    const d = await draft(admin, [{ offer_id: o.bronze!, qty: 1 }]);
    const request = randomUUID();
    const before = await quantities(db.pool, v.BRONZE!);
    const first = await confirm(admin, d.order_id, request);
    const again = await confirm(admin, d.order_id, request);
    expect(again).toEqual(first);
    expect((await quantities(db.pool, v.BRONZE!)).reserved_qty).toBe(before.reserved_qty + 1);
    const err = await expectError(confirm(admin, d.order_id), 'ETAT_INVALIDE');
    expect(err.detail).toEqual({ status: 'confirmee' });
  });

  test('confirmation requires the customer details', async () => {
    const d = await draft(admin, [{ offer_id: o.bronze!, qty: 1 }], { customer: { ...customer, address: '' } });
    const err = await expectError(confirm(admin, d.order_id), 'VALEUR_INVALIDE');
    expect(err.detail).toEqual({ field: 'customer_address' });
  });

  test('an empty cart cannot be confirmed', async () => {
    const d = await draft(admin, []);
    await expectError(confirm(admin, d.order_id), 'PANIER_VIDE');
  });

  test('a confirmed order keeps its name, price and composition when the offer changes', async () => {
    const d = await draft(admin, [{ offer_id: o.trio!, qty: 1 }]);
    await confirm(admin, d.order_id);
    await admin.query(`update offers set name = 'Trio Soleil v2', price_cents = 99900 where id = $1`, [o.trio]);
    await admin.query(`delete from offer_items where offer_id = $1 and variant_id = $2`, [o.trio, v.OR]);
    const { rows } = await db.pool.query(
      `select l.offer_name, l.unit_price_cents, array_agg(i.sku order by i.sku) as skus
       from order_lines l join order_items i on i.line_id = l.id where l.order_id = $1 group by l.id`,
      [d.order_id],
    );
    expect(rows[0]).toEqual({ offer_name: 'Trio Soleil', unit_price_cents: 24000, skus: ['ARGENT', 'BRONZE', 'OR'] });
  });

  test('re-saving a draft replaces its lines; a confirmed order cannot be re-saved', async () => {
    const d = await draft(admin, [{ offer_id: o.luna!, qty: 1, variant_id: v['LUNA-OR']! }]);
    await draft(admin, [{ offer_id: o.luna!, qty: 3, variant_id: v['LUNA-OR']! }], { id: d.order_id });
    const { rows } = await db.pool.query(`select qty from order_lines where order_id = $1`, [d.order_id]);
    expect(rows).toEqual([{ qty: 3 }]);
    await confirm(admin, d.order_id);
    await expectError(draft(admin, [], { id: d.order_id }), 'ETAT_INVALIDE');
  });

  test('a draft can be deleted, a confirmed order cannot', async () => {
    const d = await draft(admin, [{ offer_id: o.bronze!, qty: 1 }]);
    await rpc(admin, 'delete_draft', { p_order_id: d.order_id });
    const { rows } = await db.pool.query(`select count(*)::int as n from orders where id = $1`, [d.order_id]);
    expect(rows[0].n).toBe(0);
  });
});

describe('place_site_order', () => {
  test('creates and confirms a site order in one call with server prices', async () => {
    const siteOffer = await offer(admin, {
      name: 'Nacre en ligne',
      kind: 'unit',
      price_cents: 7000,
      on_site: true,
      items: [{ variant_id: v.NACRE! }],
    });
    const service = await db.connect('service');
    const request = randomUUID();
    const payload = { customer, shipping_fee_cents: 3000, lines: [{ offer_id: siteOffer, qty: 1, unit_price_cents: 5 }] };
    const r = await rpc(service, 'place_site_order', { p_request_id: request, p_order: payload });
    const again = await rpc(service, 'place_site_order', { p_request_id: request, p_order: payload });
    service.release();
    expect(again).toEqual(r);
    const { rows } = await db.pool.query(
      `select o.channel, o.status, l.unit_price_cents from orders o join order_lines l on l.order_id = o.id where o.id = $1`,
      [r.order_id],
    );
    expect(rows).toEqual([{ channel: 'site', status: 'confirmee', unit_price_cents: 7000 }]);
  });

  test('refuses an offer that is not active on the site', async () => {
    const service = await db.connect('service');
    await expectError(
      rpc(service, 'place_site_order', {
        p_request_id: randomUUID(),
        p_order: { customer, shipping_fee_cents: 0, lines: [{ offer_id: o.bronze, qty: 1 }] },
      }),
      'OFFRE_INVALIDE',
    );
    service.release();
  });

  test('cannot be called by the signed-in admin', async () => {
    await expect(
      rpc(admin, 'place_site_order', { p_request_id: randomUUID(), p_order: { customer, lines: [] } }),
    ).rejects.toThrow(/permission denied/);
  });
});
