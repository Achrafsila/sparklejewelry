import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { asAdmin, expect, isPhone, login, resetDb, seedOffer, seedStock, sql, test } from './fixtures';

test.describe.configure({ mode: 'serial' });

let o1: { order_id: string; number: string };

async function order(offer: string, qty: number, phone: string) {
  const d = await asAdmin<{ order_id: string; number: string }>('save_order_draft', {
    p_request_id: randomUUID(),
    p_order: { customer: { name: 'Cliente ' + phone.slice(-2), phone, city: 'Rabat', address: '1 rue A' }, shipping_fee_cents: 3500, lines: [{ offer_id: offer, qty }] },
  });
  await asAdmin('confirm_order', { p_request_id: randomUUID(), p_order_id: d.order_id });
  return d;
}

async function ship(id: string, transport: number) {
  for (const i of await sql(`select id from order_items where order_id = $1`, [id])) await asAdmin('set_item_picked', { p_item_id: i.id, p_picked: true });
  await asAdmin('mark_prepared', { p_request_id: randomUUID(), p_order_id: id });
  await asAdmin('ship_order', { p_request_id: randomUUID(), p_order_id: id, p_carrier: 'Amana', p_tracking: 'T' + id.slice(0, 4), p_transport_cost_cents: transport });
}

test.beforeAll(async () => {
  await resetDb();
  const v = await seedStock([
    { sku: 'JONC-BRONZE', product: 'Jonc', label: 'Bronze', qty: 20, cost: 1000 },
    { sku: 'PERLE', product: 'Perle', qty: 2, cost: 800 },
  ]);
  const bronze = await seedOffer({ name: 'Bronze', kind: 'unit', price_cents: 9500, items: [{ variant_id: v['JONC-BRONZE']! }] });
  o1 = await order(bronze, 2, '0611000001');
  const o2 = await order(bronze, 1, '0611000002');
  const o3 = await order(bronze, 2, '0611000003');
  await ship(o1.order_id, 3500);
  await ship(o2.order_id, 3000);
  await ship(o3.order_id, 3500);
  await asAdmin('mark_delivered', { p_request_id: randomUUID(), p_order_id: o1.order_id });
  await asAdmin('mark_delivered', { p_request_id: randomUUID(), p_order_id: o2.order_id });
  await asAdmin('report_return', { p_request_id: randomUUID(), p_order_id: o3.order_id });
  const items = await sql(`select id from order_items where order_id = $1`, [o3.order_id]);
  await asAdmin('receive_return', { p_request_id: randomUUID(), p_order_id: o3.order_id, p_items: [{ item_id: items[0].id, damaged_qty: 1 }], p_return_fee_cents: 1500 });
  const [{ today }] = await sql(`select to_char(now() at time zone 'Africa/Casablanca', 'YYYY-MM-DD') as today`);
  await asAdmin('record_payout', {
    p_request_id: randomUUID(),
    p_carrier: 'Amana',
    p_received_on: today,
    p_reference: 'VIR-1',
    p_amount_cents: 18000,
    p_orders: [{ order_id: o1.order_id, received_cents: 18000 }],
  });
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

const indicator = (page: Page, label: string) => page.getByRole('row', { name: new RegExp(`^${label}`) });

test('the dashboard lists missing costs before the estimated margin', async ({ page }) => {
  await page.goto('/pilotage');
  await expect(page.getByRole('heading', { level: 1, name: 'Pilotage' })).toBeVisible();
  await expect(indicator(page, 'Commandes livrées')).toContainText('2');
  await expect(indicator(page, 'Montants encaissés')).toContainText('180,00 MAD');
  await expect(indicator(page, 'Panier moyen')).toContainText('142,50 MAD');
  await expect(indicator(page, 'Retours')).toContainText('1');
  await expect(page.getByText('Références en stock bas')).toBeVisible();
  await expect(page.getByRole('link', { name: /Perle/ })).toBeVisible();

  const missing = page.getByText('Coûts manquants');
  const margin = page.getByRole('heading', { name: 'Marge estimée' });
  await expect(missing).toBeVisible();
  await expect(page.getByText('Coût d’emballage par colis non réglé')).toBeVisible();
  await expect(page.getByText(/Budget publicitaire non saisi/)).toBeVisible();
  const [a, b] = [await missing.boundingBox(), await margin.boundingBox()];
  expect(a!.y).toBeLessThan(b!.y);
});

test('a channel filter keeps the period budget out of the channel margin', async ({ page }) => {
  await page.goto('/pilotage');
  await page.getByLabel('Canal').selectOption('site');
  await expect(indicator(page, 'Commandes livrées')).toContainText('0');
  await expect(page.getByText('Budget publicitaire de la période : non réparti entre les canaux.')).toBeVisible();
});

test('setting packaging and the month budget removes the warnings', async ({ page }) => {
  await page.goto('/reglages');
  await page.getByLabel('Coût d’emballage par colis').fill('8');
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
  expect((await sql(`select packaging_cost_cents from settings`))[0].packaging_cost_cents).toBe(800);

  await page.goto('/pilotage');
  await expect(page.getByText('Coût d’emballage par colis non réglé')).toHaveCount(0);
  await page.getByLabel(/Budget publicitaire de/).fill('300');
  await page.getByRole('button', { name: 'Enregistrer le budget' }).click();
  await expect(page.getByText('Budget enregistré.')).toBeVisible();
  await expect(page.getByText('Coûts manquants')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Budget publicitaire/ })).toContainText('300,00 MAD');
});

test('the prototype export can be imported after a preview', async ({ page }) => {
  const file = {
    variants: [
      { sku: 'COLLIER-A', model: 'Collier A', variant: '', photo: '', physical: 4 },
      { sku: 'BAGUE-B-OR', model: 'Bague B', variant: 'Or', photo: 'data:image/jpeg;base64,AAAA', physical: 2 },
    ],
    receipts: [{ supplier: 'Fournisseur 1', received: '2026-11-10', lines: [{ sku: 'COLLIER-A', qty: 5, cost: 2500 }] }],
    offers: [{ id: 'a', type: 'unit', skus: ['COLLIER-A'], title: 'Collier A', price: 9900, site: false, instagram: true, repeat: false }],
    orders: [{ id: 'x' }],
  };
  await page.goto('/reglages');
  await page.getByLabel('Fichier exporté du prototype').setInputFiles({
    name: 'sparkle-prototype-2026-11-24.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByText('2 références, 1 arrivage, 1 offre. 1 photo et 1 commande ne seront pas importées.')).toBeVisible();
  await page.getByRole('button', { name: 'Importer' }).click();
  await expect(page.getByText('Import terminé : 2 références, 1 arrivage, 1 offre.')).toBeVisible();
  expect(await sql(`select sku, physical_qty from variants where sku in ('COLLIER-A', 'BAGUE-B-OR') order by sku`)).toEqual([
    { sku: 'BAGUE-B-OR', physical_qty: 2 },
    { sku: 'COLLIER-A', physical_qty: 4 },
  ]);
});

test('all data can be exported as a JSON backup', async ({ page }) => {
  await page.goto('/reglages');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter toutes les données' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sparkle-export-\d{4}-\d{2}-\d{2}\.json$/);
  const content = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(content.version).toBe(1);
  expect(content.orders.length).toBeGreaterThanOrEqual(3);
});

test('global search finds a payout reference and an order number', async ({ page }) => {
  await page.goto('/stock');
  await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();
  if (isPhone(page)) await page.getByRole('button', { name: 'Rechercher' }).click();
  else await page.keyboard.press('/');
  const dialog = page.getByRole('dialog', { name: 'Recherche' });
  await dialog.getByRole('searchbox', { name: 'Rechercher' }).fill('vir-1');
  await dialog.getByRole('link', { name: /VIR-1/ }).click();
  await expect(page.getByRole('dialog', { name: /Versement VIR-1/ })).toBeVisible();

  await page.goto('/stock');
  await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();
  if (isPhone(page)) await page.getByRole('button', { name: 'Rechercher' }).click();
  else await page.keyboard.press('/');
  await page.getByRole('dialog', { name: 'Recherche' }).getByRole('searchbox', { name: 'Rechercher' }).fill(o1.number);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: new RegExp(o1.number) })).toBeVisible();
});
