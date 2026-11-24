/** Moroccan numbers only, same rule as SQL normalize_phone(): +2125/6/7 followed by 8 digits. */
export function normalizePhone(input: string): string | null {
  const v = input.replace(/[\s().-]/g, '');
  let match = /^\+212([5-7]\d{8})$/.exec(v) ?? /^00212([5-7]\d{8})$/.exec(v) ?? /^212([5-7]\d{8})$/.exec(v);
  if (match) return `+212${match[1]}`;
  match = /^0([5-7]\d{8})$/.exec(v);
  return match ? `+212${match[1]}` : null;
}

/** "+212612345678" → "06 12 34 56 78" for display. */
export function formatPhone(phone: string): string {
  const m = /^\+212(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(phone);
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : phone;
}
