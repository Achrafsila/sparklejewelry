import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { asAdmin, expect, expectNoHorizontalOverflow, isPhone, login, resetDb, seedOffer, seedStock, sql, test } from './fixtures';

let v: Record<string, string>;
let joncBronze: string;

test.beforeAll(async () => {
  await resetDb();
  v = await seedStock([
    { sku: 'JONC-BRONZE', product: 'Jonc', label: 'Bronze', qty: 9 },
    { sku: 'JONC-OR', product: 'Jonc', label: 'Or', qty: 4 },
    { sku: 'PERLE-EAU-DOUCE', product: 'Perle eau douce', qty: 2 },
    { sku: 'BAGUE-LUNA-OR', product: 'Bague Luna', label: 'Or', qty: 6 },
    { sku: 'BAGUE-LUNA-ARGENT', product: 'Bague Luna', label: 'Argent', qty: 6 },
  ]);
  joncBronze = await seedOffer({ name: 'Jonc bronze', kind: 'unit', price_cents: 9500, items: [{ variant_id: v['JONC-BRONZE']! }] });
  await seedOffer({ name: 'Jonc or', kind: 'unit', price_cents: 12000, items: [{ variant_id: v['JONC-OR']! }] });
});

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto('/offres');
  await expect(page.getByRole('heading', { level: 1, name: 'Offres' })).toBeVisible();
});

async function newOffer(page: Page) {
  await page.getByRole('link', { name: 'Nouvelle offre' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Nouvelle offre' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('a unit offer over two variants, each with its own price', async ({ page }) => {
  const sheet = await newOffer(page);
  await sheet.getByLabel('Nom de l’offre').fill('Luna à l’unité');
  await sheet.getByRole('radio', { name: 'À l’unité' }).check();
  await sheet.getByRole('checkbox', { name: /Bague Luna Or/ }).check();
  await sheet.getByRole('checkbox', { name: /Bague Luna Argent/ }).check();
  await sheet.getByRole('radio', { name: 'Prix par variante' }).check();
  await sheet.getByLabel('Prix pour BAGUE-LUNA-OR').fill('99');
  await sheet.getByLabel('Prix pour BAGUE-LUNA-ARGENT').fill('89');
  await sheet.getByRole('button', { name: 'Enregistrer l’offre' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Offre enregistrée : Luna à l’unité.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Luna à l’unité' })).toBeVisible();
  const rows = await sql(
    `select v.sku, i.price_cents from offer_items i join offers o on o.id = i.offer_id join variants v on v.id = i.variant_id
     where o.name = 'Luna à l’unité' order by v.sku`,
  );
  expect(rows).toEqual([
    { sku: 'BAGUE-LUNA-ARGENT', price_cents: 8900 },
    { sku: 'BAGUE-LUNA-OR', price_cents: 9900 },
  ]);
  await expectNoHorizontalOverflow(page);
});

test('a fixed trio shows the unit value, warns when it is not cheaper, and how many can be made', async ({ page }) => {
  const sheet = await newOffer(page);
  await sheet.getByLabel('Nom de l’offre').fill('Trio jonc');
  await sheet.getByRole('radio', { name: 'Trio fixe' }).check();
  const picker = sheet.getByRole('group', { name: 'Composition du trio' });
  await picker.getByRole('button', { name: /Ajouter Jonc Bronze/ }).click();
  await picker.getByRole('button', { name: /Ajouter Jonc Bronze/ }).click();
  await picker.getByRole('button', { name: /Ajouter Jonc Or/ }).click();
  await expect(picker.getByText('3/3')).toBeVisible();
  await expect(sheet.getByText('Mêmes pièces à l’unité : 310,00 MAD')).toBeVisible();
  await expect(sheet.getByText('4 trios réalisables')).toBeVisible();
  await sheet.getByLabel('Prix de vente').fill('320');
  await expect(sheet.getByText('Ce trio n’est pas moins cher que les mêmes pièces à l’unité.')).toBeVisible();
  await sheet.getByLabel('Prix de vente').fill('260');
  await expect(sheet.getByText('Ce trio n’est pas moins cher que les mêmes pièces à l’unité.')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Enregistrer l’offre' }).click();
  await expect(page.getByText('Offre enregistrée : Trio jonc.')).toBeVisible();
  await expect(page.getByRole(isPhone(page) ? 'list' : 'table', { name: 'Offres' }).getByText('4 trios réalisables')).toBeVisible();
});

test('a pick-your-trio with its eligible pieces', async ({ page }) => {
  const sheet = await newOffer(page);
  await sheet.getByLabel('Nom de l’offre').fill('Trio à composer');
  await sheet.getByRole('radio', { name: 'Trio à composer' }).check();
  for (const name of [/Perle eau douce/, /Bague Luna Or/, /Bague Luna Argent/]) {
    await sheet.getByRole('checkbox', { name }).check();
  }
  await expect(sheet.getByRole('switch', { name: 'Autoriser la même pièce plusieurs fois' })).toHaveAttribute('aria-checked', 'false');
  await sheet.getByLabel('Prix de vente').fill('210');
  await sheet.getByRole('button', { name: 'Enregistrer l’offre' }).click();
  await expect(page.getByText('Offre enregistrée : Trio à composer.')).toBeVisible();
  await expect(page.getByRole(isPhone(page) ? 'list' : 'table', { name: 'Offres' }).getByText('3 pièces éligibles disponibles')).toBeVisible();
});

test('pausing an offer on Instagram is manual and says so', async ({ page }) => {
  const toggle = page.getByRole('switch', { name: 'Instagram : Jonc or' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toContainText('En pause');
  await expect.poll(async () => (await sql(`select on_instagram from offers where name = 'Jonc or'`))[0].on_instagram).toBe(false);
});

test('changing an offer price leaves confirmed orders as sold', async ({ page }) => {
  const draft = await asAdmin<{ order_id: string }>('save_order_draft', {
    p_request_id: randomUUID(),
    p_order: {
      customer: { name: 'Salma B.', phone: '0612345678', city: 'Rabat', address: '12 rue Oued Ziz' },
      shipping_fee_cents: 3500,
      lines: [{ offer_id: joncBronze, qty: 1 }],
    },
  });
  await asAdmin('confirm_order', { p_request_id: randomUUID(), p_order_id: draft.order_id });

  await page.getByRole('link', { name: 'Jonc bronze' }).click();
  const sheet = page.getByRole('dialog', { name: 'Jonc bronze' });
  await sheet.getByLabel('Prix de vente').fill('99');
  await sheet.getByRole('button', { name: 'Enregistrer l’offre' }).click();
  await expect(page.getByText('Offre enregistrée : Jonc bronze.')).toBeVisible();
  const [line] = await sql(`select unit_price_cents, offer_name from order_lines where order_id = $1`, [draft.order_id]);
  expect(line).toEqual({ unit_price_cents: 9500, offer_name: 'Jonc bronze' });
});
