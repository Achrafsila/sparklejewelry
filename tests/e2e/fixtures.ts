import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import pg from 'pg';

const root = join(import.meta.dirname, '..', '..');
const users = JSON.parse(readFileSync(join(root, 'dev', 'users.json'), 'utf8')) as {
  users: { id: string; email: string; password: string }[];
};
export const admin = users.users[0]!;

/** Fresh database for a spec file: shim + migrations + dev seed. */
export function resetDb() {
  execSync('bash dev/stack.sh reset', { cwd: root, stdio: 'ignore' });
}

const pool = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54329/sparkle', max: 2 });

/** Superuser query, to check what the UI really stored. */
export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

/** Calls a business function as the admin, to set up data a test is not about. */
export async function asAdmin<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id, role: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    const keys = Object.keys(args);
    const values = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const { rows } = await client.query(
      `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`,
      values,
    );
    await client.query('commit');
    return rows[0].r as T;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Receives references through the real arrival function. */
export async function seedStock(items: { sku: string; product: string; label?: string; qty: number; cost?: number }[]) {
  await asAdmin('validate_receipt', {
    p_request_id: randomUUID(),
    p_supplier: 'Atelier Casa',
    p_received_on: '2026-11-20',
    p_lines: items.map((i) => ({
      sku: i.sku,
      product_name: i.product,
      label: i.label ?? null,
      qty: i.qty,
      unit_cost_cents: i.cost ?? 3000,
    })),
  });
  const rows = await sql<{ id: string; sku: string }>(`select id, sku from variants where sku = any($1)`, [
    items.map((i) => i.sku),
  ]);
  return Object.fromEntries(rows.map((r) => [r.sku, r.id])) as Record<string, string>;
}

export async function seedOffer(input: {
  name: string;
  kind: 'unit' | 'fixed_trio' | 'custom_trio';
  price_cents: number;
  items: { variant_id: string; qty?: number; price_cents?: number }[];
  allow_repeat?: boolean;
  on_site?: boolean;
}) {
  const [o] = await sql<{ id: string }>(
    `insert into offers (name, kind, price_cents, allow_repeat, on_site) values ($1, $2, $3, $4, $5) returning id`,
    [input.name, input.kind, input.price_cents, input.allow_repeat ?? false, input.on_site ?? false],
  );
  for (const i of input.items) {
    await sql(`insert into offer_items (offer_id, variant_id, qty, price_cents) values ($1, $2, $3, $4)`, [
      o!.id,
      i.variant_id,
      i.qty ?? 1,
      i.price_cents ?? null,
    ]);
  }
  return o!.id;
}

export async function login(page: Page) {
  await page.goto('/connexion');
  await page.getByLabel('E-mail').fill(admin.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();
}

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(0);
}

/** WCAG contrast ratio between two CSS colors as computed by the browser. */
export async function contrastOf(page: Page, selector: string, pseudo?: '::placeholder') {
  return page.evaluate(
    ({ selector, pseudo }) => {
      const el = document.querySelector(selector) as HTMLElement;
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const style = getComputedStyle(el, pseudo ?? null);
      const fill = style.getPropertyValue('-webkit-text-fill-color') || style.color;
      const fg = parse(fill && !fill.startsWith('currentcolor') ? fill : style.color);
      let node: HTMLElement | null = el;
      let bg = [255, 255, 255, 0];
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if ((c[3] ?? 1) > 0.5) {
          bg = c;
          break;
        }
        node = node.parentElement;
      }
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (a! + 0.05) / (b! + 0.05);
    },
    { selector, pseudo },
  );
}

export const test = base;
export { expect };
