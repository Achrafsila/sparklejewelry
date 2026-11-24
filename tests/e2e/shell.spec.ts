import { admin, expect, expectNoHorizontalOverflow, isPhone, login, resetDb, test } from './fixtures';

test.beforeAll(() => resetDb());

const sections = ['Stock', 'Offres', 'Commandes', 'Préparation', 'Suivi', 'Pilotage'] as const;

test('signs in and lands on Stock', async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/stock$/);
});

test('a wrong password is explained under the button and the e-mail is kept', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel('E-mail').fill(admin.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('mauvais-mot-de-passe');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toContainText('E-mail ou mot de passe incorrect');
  await expect(page.getByLabel('E-mail')).toHaveValue(admin.email);
});

test('an unauthenticated visit goes to the sign-in page', async ({ page }) => {
  await page.goto('/commandes');
  await expect(page).toHaveURL(/\/connexion/);
});

test('every section is reachable and never scrolls sideways', async ({ page }) => {
  await login(page);
  for (const name of sections) {
    if (isPhone(page) && !['Stock', 'Commandes', 'Suivi'].includes(name)) {
      await page.getByRole('button', { name: 'Plus' }).click();
      await page.getByRole('menuitem', { name }).click();
    } else {
      await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name, exact: true }).click();
    }
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('the new Instagram order action is always one tap away', async ({ page }) => {
  await login(page);
  const action = isPhone(page)
    ? page.getByRole('link', { name: 'Nouvelle commande Instagram' })
    : page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Nouvelle commande Instagram' });
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await action.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nouvelle commande' })).toBeVisible();
});

test('keyboard users get a skip link and a visible focus ring', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit only tabs to links with the macOS "full keyboard access" setting');
  await login(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Aller au contenu' });
  await expect(skip).toBeFocused();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(parseFloat(outline)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Enter');
  await expect(page.locator('#contenu')).toBeFocused();
});

test('reduced motion turns transitions off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  const duration = await page
    .getByRole('heading', { level: 1, name: 'Stock' })
    .evaluate(() => getComputedStyle(document.querySelector('a, button')!).transitionDuration);
  expect(duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
});

test('a password reset link leads to choosing a new password', async ({ page, request }) => {
  const res = await request.post('/auth/v1/token?grant_type=password', { data: { email: admin.email, password: admin.password } });
  const session = await res.json();
  await page.goto(
    `/connexion#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&expires_at=${session.expires_at}&token_type=bearer&type=recovery`,
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Choisir un nouveau mot de passe' })).toBeVisible();
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('court');
  await page.getByLabel('Confirmer le mot de passe').fill('court');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByText('Trop court : au moins 10 caractères.')).toBeVisible();
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('un-mot-de-passe-solide');
  await page.getByLabel('Confirmer le mot de passe').fill('un-mot-de-passe-solide');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.getByText('Mot de passe mis à jour.')).toBeVisible();
});
