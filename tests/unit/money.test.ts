import { describe, expect, test } from 'vitest';
import { centsToInput, formatMoney, parseMoney } from '../../src/lib/money';

describe('parseMoney', () => {
  test.each([
    ['15,50', 1550],
    ['15.50', 1550],
    ['15', 1500],
    [' 1 234,5 ', 123450],
    ['1 234,50', 123450],
    ['0', 0],
    ['0,05', 5],
  ])('%j gives %i cents', (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  test.each(['15,5,0', '-3', '1,234', '', '  ', 'abc', '12,', ',5', '1.2.3'])('%j is refused', (input) => {
    expect(parseMoney(input)).toBeNull();
  });
});

describe('formatMoney', () => {
  test('formats cents as MAD with a decimal comma', () => {
    const text = formatMoney(123450);
    expect(text).toMatch(/234,50/);
    expect(text).toMatch(/MAD/);
  });

  test('a zero cost shown as a deduction is never "-0,00"', () => {
    expect(formatMoney(-0)).not.toMatch(/^-/);
    expect(formatMoney(-0)).toMatch(/^0,00/);
  });

  test('formats negative amounts', () => {
    expect(formatMoney(-2000)).toMatch(/-\s?20,00|−\s?20,00/);
  });
});

describe('centsToInput', () => {
  test('gives back an editable value with a comma', () => {
    expect(centsToInput(1550)).toBe('15,50');
    expect(centsToInput(3500)).toBe('35');
    expect(centsToInput(null)).toBe('');
  });
});
