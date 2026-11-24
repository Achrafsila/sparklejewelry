const MONEY_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;

/** Parses "15,50", "15.50" or "1 234,5" into cents. Returns null when the text is not an amount. */
export function parseMoney(input: string): number | null {
  const compact = input.replace(/[\s  ]/g, '');
  if (!MONEY_PATTERN.test(compact)) return null;
  const [units, decimals = ''] = compact.replace(',', '.').split('.');
  const cents = Number(units) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

const formatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(cents: number): string {
  return formatter.format(cents / 100);
}

/** Editable text for a money field: "15,50", or "35" when there are no cents. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  const units = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return rest === 0 ? String(units) : `${units},${String(rest).padStart(2, '0')}`;
}
