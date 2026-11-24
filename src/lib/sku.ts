/** Same rule as SQL suggest_sku(): model + variant, no accents, A–Z 0–9 and dashes, suffix when taken. */
export function suggestSku(model: string, label: string | null, taken: ReadonlySet<string>): string {
  const base =
    `${model} ${label ?? ''}`
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase() || 'REF';
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

/** What the server accepts as a reference once uppercased. */
export function normalizeSku(input: string): string {
  return input.trim().toUpperCase();
}

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;
