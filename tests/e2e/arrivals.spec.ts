import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { contrastOf, expect, expectNoHorizontalOverflow, isPhone, login, resetDb, sharedPage, sql, test } from './fixtures';

const asset = (name: string) => join(import.meta.dirname, 'assets', name);

// One arrival is built step by step, in one browser session, like at the counter.
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }, info) => {
  await resetDb();
  page = await sharedPage(browser, info);
  await login(page);
});
test.afterAll(async () => {
  await page.context().close();
});

async function openArrival(page: Page) {
  await page.goto('/stock');
  await page.getByRole('link', { name: 'Nouvel arrivage' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nouvel arrivage' })).toBeVisible();
}

const newModel = (page: Page) => page.getByRole('form', { name: 'Nouveau modèle' });
const existing = (page: Page) => page.getByRole('form', { name: 'Modèle existant' });
const summary = (page: Page) => page.getByRole('region', { name: 'Récapitulatif de l’arrivage' });

async function fillNewModel(page: Page, f: { sku?: string; model: string; label?: string; qty: string; cost: string; photo?: string }) {
  const form = newModel(page);
  await form.getByLabel('Modèle', { exact: true }).fill(f.model);
  if (f.label) await form.getByLabel('Variante').fill(f.label);
  if (f.sku) await form.getByLabel('Référence').fill(f.sku);
  await form.getByLabel('Quantité reçue').fill(f.qty);
  await form.getByLabel('Coût d’achat unitaire').fill(f.cost);
  if (f.photo) await form.getByLabel('Choisir une photo').setInputFiles(f.photo);
}

test('a model without variant and without photo goes to the summary, with a confirmation under the button', async () => {
  await openArrival(page);
  await fillNewModel(page, { model: 'Collier Soleil', qty: '10', cost: '30' });
  await expect(newModel(page).getByLabel('Référence')).toHaveValue('COLLIER-SOLEIL');
  await newModel(page).getByRole('button', { name: 'Ajouter à l’arrivage' }).click();
  await expect(newModel(page).getByText('Ligne ajoutée à l’arrivage : COLLIER-SOLEIL, 10 pièces.')).toBeVisible();
  await expect(summary(page).getByText('COLLIER-SOLEIL')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a model with two variants, one with a photo uploaded with visible progress', async () => {
  await page.unrouteAll();
  await page.route('**/storage/v1/object/photos/**', async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    await route.continue();
  });
  await openArrival(page);
  await fillNewModel(page, { model: 'Bague Luna', label: 'Or', qty: '6', cost: '40', photo: asset('bague.jpg') });
  await newModel(page).getByRole('button', { name: 'Ajouter à l’arrivage' }).click();
  await expect(newModel(page).getByRole('progressbar', { name: 'Envoi de la photo' })).toBeVisible();
  await expect(newModel(page).getByText(/Ligne ajoutée à l’arrivage : BAGUE-LUNA-OR/)).toBeVisible();
  await expect(summary(page).locator('.ecrin img').first()).toBeVisible();
  await page.unrouteAll();

  await fillNewModel(page, { model: 'Bague Luna', label: 'Argent', qty: '4', cost: '35' });
  await expect(newModel(page).getByText('Modèle existant : cette ligne ajoute une variante.')).toBeVisible();
  await newModel(page).getByRole('button', { name: 'Ajouter à l’arrivage' }).click();
  await expect(summary(page).getByText('BAGUE-LUNA-ARGENT')).toBeVisible();
});

test('an unreadable photo is reported under the photo field and the entry is kept', async () => {
  await openArrival(page);
  await fillNewModel(page, { model: 'Créole Étoile', qty: '3', cost: '22', photo: asset('illisible.jpg') });
  await newModel(page).getByRole('button', { name: 'Ajouter à l’arrivage' }).click();
  await expect(newModel(page).getByText('Photo illisible. Essayez une photo JPEG ou PNG.')).toBeVisible();
  await expect(newModel(page).getByLabel('Modèle', { exact: true })).toHaveValue('Créole Étoile');
  await expect(newModel(page).getByLabel('Quantité reçue')).toHaveValue('3');
});

test('a missing quantity is reported under the quantity field', async () => {
  await openArrival(page);
  await newModel(page).getByLabel('Quantité reçue').fill('');
  await newModel(page).getByRole('button', { name: 'Ajouter à l’arrivage' }).click();
  await expect(newModel(page).getByText('Indiquez une quantité entière, au moins 1.')).toBeVisible();
});

test('the arrival is kept after a reload, lines can be corrected or removed, then validated', async () => {
  await openArrival(page);
  await summary(page).getByLabel('Fournisseur').fill('Atelier Casa');
  await page.reload();
  await expect(summary(page).getByLabel('Fournisseur')).toHaveValue('Atelier Casa');
  await expect(summary(page).getByText('BAGUE-LUNA-ARGENT')).toBeVisible();

  await summary(page).getByLabel('Quantité pour BAGUE-LUNA-ARGENT').fill('5');
  await fillNewModel(page, { model: 'Puces Mini', qty: '2', cost: '15,50' });
  await newModel(page).getByRole('button', { name: 'Ajouter à l’arrivage' }).click();
  await expect(summary(page).getByLabel('Coût unitaire pour PUCES-MINI')).toHaveValue('15,50');
  await expect(summary(page).getByText('31,00 MAD')).toBeVisible();
  await fillNewModel(page, { model: 'Erreur de saisie', qty: '1', cost: '1' });
  await newModel(page).getByRole('button', { name: 'Ajouter à l’arrivage' }).click();
  await summary(page).getByRole('button', { name: 'Retirer ERREUR-DE-SAISIE' }).click();
  await expect(summary(page).getByText('ERREUR-DE-SAISIE')).toHaveCount(0);

  await page.getByRole('region', { name: 'Valider l’arrivage' }).getByRole('button', { name: 'Valider l’arrivage' }).click();
  await expect(page.getByText('Arrivage validé. Le stock est à jour.')).toBeVisible();

  const rows = await sql(`select sku, physical_qty from variants order by sku`);
  expect(rows).toEqual([
    { sku: 'BAGUE-LUNA-ARGENT', physical_qty: 5 },
    { sku: 'BAGUE-LUNA-OR', physical_qty: 6 },
    { sku: 'COLLIER-SOLEIL', physical_qty: 10 },
    { sku: 'PUCES-MINI', physical_qty: 2 },
  ]);
  const [cost] = await sql(`select l.unit_cost_cents from receipt_lines l join variants v on v.id = l.variant_id where v.sku = 'PUCES-MINI'`);
  expect(cost.unit_cost_cents).toBe(1550);
  const photo = await sql(`select photo_path from variants where sku = 'BAGUE-LUNA-OR'`);
  expect(photo[0].photo_path).toMatch(/^variants\/.+\.jpg$/);

  await page.getByRole('link', { name: 'Voir le stock' }).click();
  const stock = isPhone(page) ? page.getByRole('list', { name: 'Références en stock' }) : page.getByRole('table', { name: 'Références en stock' });
  await expect(stock.getByText('BAGUE-LUNA-OR')).toBeVisible();
  await expect(stock.getByText('Stock bas').first()).toBeVisible();
});

test('restocking an existing reference at another cost keeps both costs in the history', async () => {
  await openArrival(page);
  await existing(page).getByRole('combobox', { name: 'Modèle et variante' }).fill('luna or');
  await page.getByRole('option', { name: /Bague Luna Or/ }).click();
  await expect(existing(page).getByText('BAGUE-LUNA-OR')).toBeVisible();
  await existing(page).getByLabel('Quantité reçue').fill('4');
  await existing(page).getByLabel('Nouveau coût d’achat unitaire').fill('45');
  await existing(page).getByRole('button', { name: 'Ajouter à l’arrivage' }).click();
  await expect(existing(page).getByText('Ligne ajoutée à l’arrivage : BAGUE-LUNA-OR, 4 pièces.')).toBeVisible();
  await summary(page).getByLabel('Fournisseur').fill('Grossiste Derb');
  await page.getByRole('region', { name: 'Valider l’arrivage' }).getByRole('button', { name: 'Valider l’arrivage' }).click();
  await expect(page.getByText('Arrivage validé. Le stock est à jour.')).toBeVisible();

  await page.goto('/stock');
  await page.getByRole('link', { name: 'Bague Luna Or' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Bague Luna Or' });
  await expect(sheet.getByText('Physique')).toBeVisible();
  await expect(sheet.getByTestId('qty-physical')).toHaveText('10');
  await expect(sheet.getByText('40,00 MAD')).toBeVisible();
  await expect(sheet.getByText('45,00 MAD')).toBeVisible();
});

test('typed amounts stay readable whatever the device theme', async () => {
  await openArrival(page);
  await newModel(page).getByLabel('Coût d’achat unitaire').fill('15,50');
  const id = await newModel(page).getByLabel('Coût d’achat unitaire').getAttribute('id');
  expect(await contrastOf(page, `[id="${id}"]`)).toBeGreaterThanOrEqual(4.5);
});
