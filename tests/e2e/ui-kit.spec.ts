import { expect, expectNoHorizontalOverflow, isPhone, test } from './fixtures';

// The /dev/ui gallery exists only in the local-stack dev server.

/** Contrast of typed text, placeholder and caret for every field, measured in the page. */
async function fieldReport(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(parse(a)), lum(parse(b))].sort((m, n) => n - m);
      return (x! + 0.05) / (y! + 0.05);
    };
    const fields = [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')];
    return fields.map((el) => {
      const s = getComputedStyle(el);
      const ph = getComputedStyle(el, '::placeholder');
      const text = s.getPropertyValue('-webkit-text-fill-color') || s.color;
      return {
        name: el.getAttribute('aria-label') ?? el.id,
        text: ratio(text, s.backgroundColor),
        placeholder: ratio(ph.getPropertyValue('-webkit-text-fill-color') || ph.color, s.backgroundColor),
        caret: s.caretColor,
        bgAlpha: parse(s.backgroundColor)[3] ?? 1,
        inGlass: !!el.closest('.glass'),
      };
    });
  });
}

test('every field stays readable: typed text, placeholder, caret, no glass behind', async ({ page }) => {
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { level: 1, name: 'Composants' })).toBeVisible();
  await page.getByLabel('Nom du modèle').fill('Bague Luna');
  await page.getByLabel('Coût unitaire').fill('15,50');
  const report = await fieldReport(page);
  expect(report.length).toBeGreaterThanOrEqual(5);
  for (const f of report) {
    expect.soft(f.text, `${f.name} text`).toBeGreaterThanOrEqual(4.5);
    expect.soft(f.placeholder, `${f.name} placeholder`).toBeGreaterThanOrEqual(4.5);
    expect.soft(f.caret, `${f.name} caret`).not.toBe('auto');
    expect.soft(f.bgAlpha, `${f.name} opaque background`).toBe(1);
    expect.soft(f.inGlass, `${f.name} not on glass`).toBe(false);
  }
  await expect(page.getByLabel('Nom du modèle')).toHaveValue('Bague Luna');
});

test('select options keep explicit, readable colors', async ({ page }) => {
  await page.goto('/dev/ui');
  const colors = await page.getByLabel('Transporteur').evaluate((el) =>
    [...(el as HTMLSelectElement).options].map((o) => [getComputedStyle(o).color, getComputedStyle(o).backgroundColor]),
  );
  for (const [fg, bg] of colors) {
    expect(fg).toBe('rgb(34, 33, 30)');
    expect(bg).toBe('rgb(255, 253, 248)');
  }
});

test('a money field explains an invalid amount on leaving it and keeps the text', async ({ page }) => {
  await page.goto('/dev/ui');
  const field = page.getByLabel('Coût unitaire');
  await field.fill('15,5,0');
  await field.blur();
  await expect(page.getByText('Montant invalide. Exemple : 15,50')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveValue('15,5,0');
  await field.fill('15,50');
  await expect(page.getByText('Montant invalide. Exemple : 15,50')).toHaveCount(0);
});

test('a pending button is busy and cannot be pressed again', async ({ page }) => {
  await page.goto('/dev/ui');
  const busy = page.getByRole('button', { name: 'Enregistrement' });
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await expect(busy).toBeDisabled();
});

test('the search box finds a reference by name with its photo slot and reference visible', async ({ page }) => {
  await page.goto('/dev/ui');
  const box = page.getByRole('combobox', { name: 'Rechercher une référence' });
  await box.fill('luna');
  const option = page.getByRole('option', { name: /Bague Luna Or/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('BAGUE-LUNA-OR');
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(page.getByText('Sélection : BAGUE-LUNA-OR')).toBeVisible();
});

test('a side panel takes focus, closes with Escape and gives focus back', async ({ page }) => {
  await page.goto('/dev/ui');
  const opener = page.getByRole('button', { name: 'Ouvrir le panneau' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Fiche de test' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('statuses always carry a text label', async ({ page }) => {
  await page.goto('/dev/ui');
  for (const label of ['Livraison en cours', 'Livrée', 'Payée', 'Retour attendu', 'Stock bas', 'Rupture']) {
    await expect(page.locator('.badge', { hasText: label }).first()).toBeVisible();
  }
});

test('a list is a table on wide screens and cards on phones, without sideways scroll', async ({ page }) => {
  await page.goto('/dev/ui');
  if (isPhone(page)) {
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Références de test' }).getByRole('listitem')).toHaveCount(3);
  } else {
    await expect(page.getByRole('table', { name: 'Références de test' })).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
});

test('a missing photo shows a neutral slot, a present photo shows the image', async ({ page }) => {
  await page.goto('/dev/ui');
  await expect(page.locator('.ecrin--empty').first()).toBeVisible();
  await expect(page.locator('.ecrin img').first()).toBeVisible();
});
