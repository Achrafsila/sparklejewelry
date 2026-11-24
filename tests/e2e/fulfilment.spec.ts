import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { asAdmin, expect, isPhone, login, resetDb, seedOffer, seedStock, sql, test } from './fixtures';

const o: Record<string, { id: string; number: string }> = {};

test.describe.configure({ mode: 'serial' });

async function confirmed(name: string, phone: string, lines: { offer_id: string; qty: number }[]) {
  const d = await asAdmin<{ order_id: string; number: string }>('save_order_draft', {
    p_request_id: randomUUID(),
    p_order: { customer: { name, phone, city: 'Rabat', address: '1 rue des Orangers' }, shipping_fee_cents: 3500, lines },
  });
  await asAdmin('confirm_order', { p_request_id: randomUUID(), p_order_id: d.order_id });
  return { id: d.order_id, number: d.number };
}

test.beforeAll(async () => {
  await resetDb();
  const v = await seedStock([
    { sku: 'JONC-BRONZE', product: 'Jonc', label: 'Bronze', qty: 10, cost: 1000 },
    { sku: 'JONC-ARGENT', product: 'Jonc', label: 'Argent', qty: 10, cost: 1200 },
  ]);
  const bronze = await seedOffer({ name: 'Bronze', kind: 'unit', price_cents: 9500, items: [{ variant_id: v['JONC-BRONZE']! }] });
  const argent = await seedOffer({ name: 'Argent', kind: 'unit', price_cents: 8000, items: [{ variant_id: v['JONC-ARGENT']! }] });
  await sql(`update settings set packaging_cost_cents = 800, default_shipping_fee_cents = 3500, carriers = '{Amana}'`);
  o.salma = await confirmed('Salma B.', '0612345678', [
    { offer_id: bronze, qty: 2 },
    { offer_id: argent, qty: 1 },
  ]);
  o.imane = await confirmed('Imane K.', '0661223344', [{ offer_id: bronze, qty: 1 }]);
  o.nora = await confirmed('Nora T.', '0700112233', [{ offer_id: bronze, qty: 2 }]);
  o.rim = await confirmed('Rim A.', '0655443322', [{ offer_id: argent, qty: 1 }]);
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

const card = (page: Page, number: string) => page.getByRole('article', { name: new RegExp(number) });

async function stockOf(sku: string) {
  const [row] = await sql(`select physical_qty, reserved_qty, available_qty from variants where sku = $1`, [sku]);
  return row;
}

test('preparation: tick every piece (kept after reload), mark prepared, then ship', async ({ page }) => {
  await page.goto('/preparation');
  const c = card(page, o.salma!.number);
  const prepared = c.getByRole('button', { name: 'Marquer préparée' });
  await expect(prepared).toBeDisabled();
  await c.getByRole('checkbox', { name: /Jonc Bronze × 2/ }).check();
  await page.reload();
  await expect(card(page, o.salma!.number).getByRole('checkbox', { name: /Jonc Bronze × 2/ })).toBeChecked();
  await card(page, o.salma!.number).getByRole('checkbox', { name: /Jonc Argent × 1/ }).check();
  await card(page, o.salma!.number).getByRole('button', { name: 'Marquer préparée' }).click();

  const before = await stockOf('JONC-BRONZE');
  expect(before).toEqual({ physical_qty: 10, reserved_qty: 5, available_qty: 5 });
  const ship = card(page, o.salma!.number);
  await ship.getByLabel('Transporteur').selectOption('Amana');
  await ship.getByLabel('Numéro de suivi').fill('AM123456');
  await ship.getByLabel('Coût réel du transport').fill('35');
  await ship.getByRole('button', { name: 'Expédier' }).click();
  await expect(page.getByText(`Commande ${o.salma!.number} expédiée avec Amana.`)).toBeVisible();
  // Physical and reserved go down together: availability does not drop a second time.
  expect(await stockOf('JONC-BRONZE')).toEqual({ physical_qty: 8, reserved_qty: 3, available_qty: 5 });
});

test('a double tap on Expédier ships once', async ({ page }) => {
  await page.goto('/preparation');
  const c = card(page, o.imane!.number);
  await c.getByRole('checkbox', { name: /Jonc Bronze × 1/ }).check();
  await c.getByRole('button', { name: 'Marquer préparée' }).click();
  await c.getByLabel('Transporteur').selectOption('Amana');
  await c.getByLabel('Coût réel du transport').fill('30');
  await c.getByRole('button', { name: 'Expédier' }).dblclick();
  await expect(page.getByText(`Commande ${o.imane!.number} expédiée avec Amana.`)).toBeVisible();
  const moves = await sql(`select count(*)::int as n from stock_movements where order_id = $1 and kind = 'expedition'`, [o.imane!.id]);
  expect(moves[0].n).toBe(1);
  expect(await stockOf('JONC-BRONZE')).toEqual({ physical_qty: 7, reserved_qty: 2, available_qty: 5 });
});

test('cancelling before shipment frees the reservation', async ({ page }) => {
  const before = await stockOf('JONC-ARGENT');
  await page.goto('/preparation');
  await card(page, o.rim!.number).getByRole('button', { name: 'Annuler la commande' }).click();
  await page.getByRole('dialog', { name: /Annuler la commande/ }).getByRole('button', { name: 'Annuler la commande' }).click();
  await expect(card(page, o.rim!.number)).toHaveCount(0);
  expect((await stockOf('JONC-ARGENT')).reserved_qty).toBe(before.reserved_qty - 1);
});

test('tracking: deliveries show what the carrier owes, net of its fees', async ({ page }) => {
  await page.goto('/suivi');
  await expect(page.getByRole('tab', { name: /Livraison en cours/ })).toHaveAttribute('aria-selected', 'true');
  await card(page, o.salma!.number).getByRole('button', { name: 'Marquer livrée' }).click();
  await card(page, o.imane!.number).getByRole('button', { name: 'Marquer livrée' }).click();
  await page.getByRole('tab', { name: /Livrée/ }).click();
  await expect(card(page, o.salma!.number).getByText('À recevoir du transporteur : 270,00 MAD')).toBeVisible();
  await expect(card(page, o.imane!.number).getByText('À recevoir du transporteur : 100,00 MAD')).toBeVisible();
});

test('a grouped payout is matched, the gap stays visible on the payout and on the order', async ({ page }) => {
  await page.goto('/suivi');
  await page.getByRole('link', { name: 'Enregistrer un versement' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nouveau versement' })).toBeVisible();
  await page.getByLabel('Transporteur').selectOption('Amana');
  await page.getByLabel('Référence du versement').fill('VIR-2311');
  await page.getByLabel('Montant reçu').fill('350');
  await page.getByRole('checkbox', { name: new RegExp(o.salma!.number) }).check();
  await page.getByRole('checkbox', { name: new RegExp(o.imane!.number) }).check();
  await page.getByLabel(`Reçu pour ${o.imane!.number}`).fill('80');
  const totals = page.getByRole('region', { name: 'Rapprochement' });
  await expect(totals.getByText('Attendu : 370,00 MAD')).toBeVisible();
  await expect(totals.getByText('Écart : -20,00 MAD')).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer le versement' }).click();
  await expect(page.getByText('Versement VIR-2311 enregistré.')).toBeVisible();

  const statuses = await sql(`select status from orders where id = any($1) order by number`, [[o.salma!.id, o.imane!.id]]);
  expect(statuses).toEqual([{ status: 'payee' }, { status: 'payee' }]);

  await page.goto('/suivi');
  await page.getByRole('tab', { name: /Versements/ }).click();
  await page.getByRole('link', { name: /VIR-2311/ }).click();
  const sheet = page.getByRole('dialog', { name: /VIR-2311/ });
  await expect(sheet.getByText('Écart : -20,00 MAD')).toBeVisible();
  await expect(sheet.getByText(o.imane!.number)).toBeVisible();

  await page.goto(`/commandes/${o.imane!.id}`);
  await expect(page.getByRole('dialog').getByText('Écart de versement : -20,00 MAD')).toBeVisible();
});

test('a partial return puts back only the resalable piece and cannot be received twice', async ({ page }) => {
  const items = await sql(`select id from order_items where order_id = $1`, [o.nora!.id]);
  for (const i of items) await asAdmin('set_item_picked', { p_item_id: i.id, p_picked: true });
  await asAdmin('mark_prepared', { p_request_id: randomUUID(), p_order_id: o.nora!.id });
  await asAdmin('ship_order', {
    p_request_id: randomUUID(),
    p_order_id: o.nora!.id,
    p_carrier: 'Amana',
    p_tracking: 'AM999',
    p_transport_cost_cents: 3500,
  });
  const before = await stockOf('JONC-BRONZE');

  await page.goto('/suivi');
  await card(page, o.nora!.number).getByRole('button', { name: 'Signaler un retour' }).click();
  await page.getByRole('dialog', { name: /Signaler un retour/ }).getByRole('button', { name: 'Signaler le retour' }).click();
  await page.getByRole('tab', { name: /Retour/ }).click();
  const c = card(page, o.nora!.number);
  await expect(c.getByText('Retour attendu')).toBeVisible();
  await c.getByRole('button', { name: 'Réceptionner le retour' }).click();
  const form = page.getByRole('dialog', { name: /Réceptionner le retour/ });
  await form.getByLabel('Pièces abîmées : Jonc Bronze').fill('1');
  await form.getByLabel('Frais de retour').fill('15');
  await form.getByRole('button', { name: 'Valider le retour' }).click();
  await expect(page.getByText(`Retour ${o.nora!.number} enregistré : 1 pièce remise en stock, 1 pièce abîmée.`)).toBeVisible();
  await expect(card(page, o.nora!.number).getByText('Retour reçu')).toBeVisible();
  await expect(card(page, o.nora!.number).getByRole('button', { name: 'Réceptionner le retour' })).toHaveCount(0);
  expect((await stockOf('JONC-BRONZE')).physical_qty).toBe(before.physical_qty + 1);
  if (!isPhone(page)) await expect(page.getByRole('tab', { name: /Retour/ })).toContainText('1');
});
