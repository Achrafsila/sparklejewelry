import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { asAdmin, expect, expectNoHorizontalOverflow, isPhone, login, resetDb, seedOffer, seedStock, sql, test } from './fixtures';

let v: Record<string, string>;
let bronzeUnit: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await resetDb();
  v = await seedStock([
    { sku: 'JONC-BRONZE', product: 'Jonc', label: 'Bronze', qty: 6 },
    { sku: 'JONC-ARGENT', product: 'Jonc', label: 'Argent', qty: 10 },
    { sku: 'JONC-OR', product: 'Jonc', label: 'Or', qty: 10 },
    { sku: 'PERLE', product: 'Perle', qty: 1 },
    { sku: 'NACRE', product: 'Nacre', qty: 5 },
  ]);
  await seedOffer({
    name: 'Trio soleil',
    kind: 'fixed_trio',
    price_cents: 24000,
    items: [{ variant_id: v['JONC-BRONZE']! }, { variant_id: v['JONC-ARGENT']! }, { variant_id: v['JONC-OR']! }],
  });
  bronzeUnit = await seedOffer({ name: 'Bronze à l’unité', kind: 'unit', price_cents: 9500, items: [{ variant_id: v['JONC-BRONZE']! }] });
  await seedOffer({
    name: 'Trio à composer',
    kind: 'custom_trio',
    price_cents: 21000,
    items: [{ variant_id: v.PERLE! }, { variant_id: v.NACRE! }, { variant_id: v['JONC-ARGENT']! }],
  });
  await sql(`update settings set default_shipping_fee_cents = 3500`);
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

async function startOrder(page: Page) {
  await page.goto('/commandes/nouvelle');
  await expect(page.getByRole('heading', { level: 1, name: 'Nouvelle commande' })).toBeVisible();
}

async function addOffer(page: Page, query: string, option: RegExp) {
  await page.getByRole('combobox', { name: 'Ajouter une offre' }).fill(query);
  await page.getByRole('option', { name: option }).click();
}

/** On phones the order is entered in three steps; on wider screens everything is on one page. */
async function next(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Continuer' }).click();
}

async function fillCustomer(page: Page, c: { phone: string; name: string; city?: string; address?: string }) {
  await page.getByLabel('Téléphone').fill(c.phone);
  await page.getByLabel('Nom de la cliente').fill(c.name);
  await page.getByLabel('Ville').fill(c.city ?? 'Rabat');
  await page.getByLabel('Adresse').fill(c.address ?? '12 rue Oued Ziz, Agdal');
}

test('a fixed trio plus a single piece reserve two bronzes; the 6→4 drop only raises an alert', async ({ page }) => {
  await startOrder(page);
  await addOffer(page, 'soleil', /Trio soleil/);
  await addOffer(page, 'bronze', /Bronze à l’unité/);
  await expect(page.getByRole('region', { name: 'Panier' }).getByText('Trio soleil')).toBeVisible();
  await next(page);
  await fillCustomer(page, { phone: '06 12 34 56 78', name: 'Salma B.' });
  await expect(page.getByLabel('Frais de livraison facturés')).toHaveValue('35');
  await next(page);
  const recap = page.getByRole('region', { name: 'Récapitulatif' });
  await expect(recap.getByText('Jonc Bronze × 2')).toBeVisible();
  await expect(recap.getByText('370,00 MAD')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  await expect(page.getByText(/Commande SPK-\d{4} confirmée/)).toBeVisible();
  await expect(page.getByText('Stock bas : Jonc Bronze, 4 disponibles')).toBeVisible();
  await expect(page.getByText('Offres concernées : Bronze à l’unité, Trio soleil. Leur pause reste manuelle.')).toBeVisible();

  const [bronze] = await sql(`select reserved_qty, available_qty from variants where sku = 'JONC-BRONZE'`);
  expect(bronze).toEqual({ reserved_qty: 2, available_qty: 4 });
  const offers = await sql(`select on_instagram from offers where name in ('Trio soleil', 'Bronze à l’unité')`);
  expect(offers.every((o) => o.on_instagram)).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('a pick-your-trio fills three settings, then the last piece can no longer be picked', async ({ page }) => {
  await startOrder(page);
  await addOffer(page, 'composer', /Trio à composer/);
  const picker = page.getByRole('group', { name: 'Pièces choisies en DM' });
  await expect(picker.getByText('0/3')).toBeVisible();
  await picker.getByRole('button', { name: /Ajouter Perle/ }).click();
  await picker.getByRole('button', { name: /Ajouter Nacre/ }).click();
  await expect(picker.getByRole('button', { name: /Ajouter Nacre/ })).toBeDisabled();
  await picker.getByRole('button', { name: /Ajouter Jonc Argent/ }).click();
  await expect(picker.getByText('3/3')).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter ce trio' }).click();
  await next(page);
  await fillCustomer(page, { phone: '0661223344', name: 'Imane K.', city: 'Casablanca' });
  await next(page);
  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  await expect(page.getByText(/Commande SPK-\d{4} confirmée/)).toBeVisible();

  await startOrder(page);
  await addOffer(page, 'composer', /Trio à composer/);
  await expect(page.getByRole('group', { name: 'Pièces choisies en DM' }).getByRole('button', { name: /Ajouter Perle/ })).toBeDisabled();
});

test('when the stock runs out in the meantime, the error names the reference, the need and the availability', async ({ page }) => {
  await startOrder(page);
  await addOffer(page, 'bronze', /Bronze à l’unité/);
  const cart = page.getByRole('region', { name: 'Panier' });
  for (let i = 0; i < 3; i++) await cart.getByRole('button', { name: 'Augmenter la quantité de Bronze à l’unité' }).click();
  await expect(cart.getByText('4', { exact: true })).toBeVisible();
  await next(page);
  await fillCustomer(page, { phone: '0700112233', name: 'Nora T.' });
  await next(page);

  // Another order takes two bronzes before this one is confirmed.
  const other = await asAdmin<{ order_id: string }>('save_order_draft', {
    p_request_id: randomUUID(),
    p_order: {
      customer: { name: 'Autre', phone: '0611111111', city: 'Fès', address: 'Rue 1' },
      shipping_fee_cents: 0,
      lines: [{ offer_id: bronzeUnit, qty: 2 }],
    },
  });
  await asAdmin('confirm_order', { p_request_id: randomUUID(), p_order_id: other.order_id });

  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  await expect(page.getByText('Stock insuffisant pour 1 référence.')).toBeVisible();
  await expect(page.getByText('JONC-BRONZE : besoin 4, disponible 2')).toBeVisible();
  if (isPhone(page)) await page.getByRole('button', { name: 'Retour au panier' }).click();
  await expect(page.getByRole('region', { name: 'Panier' }).getByText('Bronze à l’unité')).toBeVisible();
});

test('a draft reserves nothing and can be resumed and confirmed later', async ({ page }) => {
  const before = await sql(`select reserved_qty from variants where sku = 'NACRE'`);
  await startOrder(page);
  await addOffer(page, 'composer', /Trio à composer/);
  const picker = page.getByRole('group', { name: 'Pièces choisies en DM' });
  await picker.getByRole('button', { name: /Ajouter Nacre/ }).click();
  await picker.getByRole('button', { name: /Ajouter Jonc Argent/ }).click();
  await page.getByRole('button', { name: 'Annuler ce trio' }).click();
  await addOffer(page, 'soleil', /Trio soleil/);
  await next(page);
  await page.getByLabel('Téléphone').fill('0699887766');
  await page.getByLabel('Nom de la cliente').fill('Lina M.');
  await next(page);
  await page.getByRole('button', { name: 'Enregistrer en brouillon' }).click();
  await expect(page.getByText(/Brouillon SPK-\d{4} enregistré\. Aucune pièce réservée\./)).toBeVisible();
  expect(await sql(`select reserved_qty from variants where sku = 'NACRE'`)).toEqual(before);

  await page.goto('/commandes');
  await page.getByRole('link', { name: /Lina M\./ }).first().click();
  const sheet = page.getByRole('dialog', { name: /SPK-\d{4}/ });
  await expect(sheet.locator('.badge', { hasText: 'Brouillon' })).toBeVisible();
  await sheet.getByRole('link', { name: 'Reprendre le brouillon' }).click();
  await expect(page.getByRole('region', { name: 'Panier' }).getByText('Trio soleil')).toBeVisible();
  await next(page);
  await page.getByLabel('Ville').fill('Tanger');
  await page.getByLabel('Adresse').fill('8 rue de la Plage');
  await next(page);
  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  await expect(page.getByText(/Commande SPK-\d{4} confirmée/)).toBeVisible();
  const lina = await sql(`select status from orders where customer_name = 'Lina M.'`);
  expect(lina).toEqual([{ status: 'confirmee' }]);
});

test('a known customer is recognised from the phone number', async ({ page }) => {
  await startOrder(page);
  await addOffer(page, 'soleil', /Trio soleil/);
  await next(page);
  await page.getByLabel('Téléphone').fill('+212 6 12 34 56 78');
  await page.getByLabel('Téléphone').blur();
  await expect(page.getByText('Cliente connue : Salma B.')).toBeVisible();
  await expect(page.getByText(/1 commande/)).toBeVisible();
  await page.getByRole('button', { name: 'Utiliser ses coordonnées' }).click();
  await expect(page.getByLabel('Nom de la cliente')).toHaveValue('Salma B.');
  await expect(page.getByLabel('Adresse')).toHaveValue('12 rue Oued Ziz, Agdal');
});

test('the cart survives a reload', async ({ page }) => {
  await startOrder(page);
  await addOffer(page, 'soleil', /Trio soleil/);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Panier' }).getByText('Trio soleil')).toBeVisible();
  await page.getByRole('button', { name: 'Vider le panier' }).click();
  await expect(page.getByRole('region', { name: 'Panier' }).getByText('Trio soleil')).toHaveCount(0);
});

test('a double tap on Confirmer reserves only once', async ({ page }) => {
  const [{ n: ordersBefore }] = await sql(`select count(*)::int as n from orders where status = 'confirmee'`);
  const [{ reserved_qty: before }] = await sql(`select reserved_qty from variants where sku = 'JONC-ARGENT'`);
  await startOrder(page);
  await addOffer(page, 'soleil', /Trio soleil/);
  await next(page);
  await fillCustomer(page, { phone: '0655443322', name: 'Rim A.' });
  await next(page);
  await page.getByRole('button', { name: 'Confirmer la commande' }).dblclick();
  await expect(page.getByText(/Commande SPK-\d{4} confirmée/)).toBeVisible();
  const [{ n: ordersAfter }] = await sql(`select count(*)::int as n from orders where status = 'confirmee'`);
  const [{ reserved_qty: after }] = await sql(`select reserved_qty from variants where sku = 'JONC-ARGENT'`);
  expect(ordersAfter).toBe(ordersBefore + 1);
  expect(after).toBe(before + 1);
});

test('a confirmation whose answer is lost on the network is not applied twice when retried', async ({ page }) => {
  const [{ reserved_qty: before }] = await sql(`select reserved_qty from variants where sku = 'JONC-OR'`);
  await startOrder(page);
  await addOffer(page, 'soleil', /Trio soleil/);
  await next(page);
  await fillCustomer(page, { phone: '0644556677', name: 'Hiba Z.' });
  await next(page);
  // The server confirms, but the answer never reaches the phone.
  await page.route('**/rest/v1/rpc/confirm_order', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  await expect(page.getByText('Connexion impossible. Vérifiez le réseau puis réessayez.')).toBeVisible();
  await page.unrouteAll();
  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  await expect(page.getByText(/Commande SPK-\d{4} confirmée/)).toBeVisible();
  const [{ reserved_qty: after }] = await sql(`select reserved_qty from variants where sku = 'JONC-OR'`);
  expect(after).toBe(before + 1);
  expect(await sql(`select status from orders where customer_name = 'Hiba Z.'`)).toEqual([{ status: 'confirmee' }]);
});
