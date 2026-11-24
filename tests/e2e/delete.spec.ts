import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { asAdmin, expect, login, resetDb, seedOffer, seedStock, sql, test } from './fixtures';

test.beforeAll(async () => {
  await resetDb();
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

async function newFixedTrio(page: Page) {
  await page.goto('/offres/nouvelle');
  const sheet = page.getByRole('dialog', { name: 'Nouvelle offre' });
  await sheet.getByRole('radio', { name: 'Trio fixe' }).check();
  return sheet;
}

test('with an empty stock, the offer form says where the pieces come from', async ({ page }) => {
  const sheet = await newFixedTrio(page);
  await expect(sheet.getByText('Aucune référence en stock pour composer cette offre.')).toBeVisible();
  await expect(sheet.getByText('Les pièces d’une offre viennent du stock : validez d’abord un arrivage.')).toBeVisible();
  await sheet.getByRole('link', { name: 'Nouvel arrivage' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nouvel arrivage' })).toBeVisible();
});

test('an arrival typed but not validated is pointed out', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'sparkle:arrival',
      JSON.stringify({
        v: 1,
        savedAt: new Date().toISOString(),
        data: {
          supplier: '',
          receivedOn: '2026-11-24',
          lines: [{ key: 'l1', sku: 'RIVIERE-OR', productName: 'Rivière', label: 'Or', qty: '3', unitCost: '120' }],
        },
      }),
    ),
  );
  const sheet = await newFixedTrio(page);
  await expect(sheet.getByText('Votre arrivage en cours compte 1 ligne pas encore validée : validez-le pour que ses pièces apparaissent ici.')).toBeVisible();
  await sheet.getByRole('link', { name: 'Reprendre l’arrivage' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nouvel arrivage' })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('sparkle:arrival'));
});

test.describe('deleting', () => {
  let v: Record<string, string>;

  test.beforeAll(async () => {
    v = await seedStock([
      { sku: 'RIVIERE-OR', product: 'Rivière', label: 'Or', qty: 4 },
      { sku: 'RIVIERE-ARGENT', product: 'Rivière', label: 'Argent', qty: 2 },
    ]);
    await seedOffer({ name: 'Trio rivières', kind: 'fixed_trio', price_cents: 30000, items: [{ variant_id: v['RIVIERE-OR']!, qty: 3 }] });
    const unit = await seedOffer({ name: 'Rivière argent', kind: 'unit', price_cents: 12000, items: [{ variant_id: v['RIVIERE-ARGENT']! }] });
    // A draft order holds the silver one, then its offer goes away.
    await asAdmin('save_order_draft', {
      p_request_id: randomUUID(),
      p_order: { customer: { name: 'Salma B.', phone: '0612345678', city: 'Rabat', address: 'Agdal' }, lines: [{ offer_id: unit, qty: 1 }] },
    });
    await sql(`delete from offers where id = $1`, [unit]);
  });

  async function askToDelete(page: Page, sku: string, name: string) {
    await page.goto(`/stock/${v[sku]}`);
    await page.getByRole('dialog', { name }).getByRole('button', { name: 'Supprimer la référence' }).click();
    return page.getByRole('dialog', { name: 'Supprimer cette référence ?' });
  }

  test('a reference used by an offer is kept, and the offer is named', async ({ page }) => {
    const confirm = await askToDelete(page, 'RIVIERE-OR', 'Rivière Or');
    await expect(confirm.getByText('Les 4 pièces encore en stock seront retirées.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(confirm.getByText(/Cette référence est utilisée par l’offre « Trio rivières »/)).toBeVisible();
    expect(await sql(`select 1 from variants where sku = 'RIVIERE-OR'`)).toHaveLength(1);
  });

  test('an offer is deleted from its panel', async ({ page }) => {
    await page.goto('/offres');
    await page.getByRole('link', { name: 'Trio rivières' }).first().click();
    await page.getByRole('dialog', { name: 'Trio rivières' }).getByRole('button', { name: 'Supprimer l’offre' }).click();
    const confirm = page.getByRole('dialog', { name: 'Supprimer cette offre ?' });
    await expect(confirm.getByText('« Trio rivières » sera effacée définitivement.', { exact: false })).toBeVisible();
    await confirm.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByText('Offre supprimée : Trio rivières.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trio rivières' })).toHaveCount(0);
    expect(await sql(`select 1 from offers where name = 'Trio rivières'`)).toHaveLength(0);
  });

  test('a reference never ordered is deleted and leaves the stock', async ({ page }) => {
    const confirm = await askToDelete(page, 'RIVIERE-OR', 'Rivière Or');
    await confirm.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByText('Référence supprimée : Rivière Or.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Rivière Or/ })).toHaveCount(0);
    expect(await sql(`select 1 from variants where sku = 'RIVIERE-OR'`)).toHaveLength(0);
  });

  test('a reference already in an order is withdrawn and kept for that order', async ({ page }) => {
    const confirm = await askToDelete(page, 'RIVIERE-ARGENT', 'Rivière Argent');
    await confirm.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByText('Référence retirée du stock : Rivière Argent. Les commandes qui la contiennent la gardent dans leur historique.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Rivière Argent/ })).toHaveCount(0);
    expect(await sql(`select archived, physical_qty from variants where sku = 'RIVIERE-ARGENT'`)).toEqual([{ archived: true, physical_qty: 0 }]);
  });
});
